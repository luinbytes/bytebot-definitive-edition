const { Events, ChannelType, PermissionFlagsBits } = require('discord.js');
const { db } = require('../database');
const { guilds, bytepods, bytepodAutoWhitelist, bytepodUserSettings, bytepodActiveSessions, bytepodVoiceStats } = require('../database/schema');
const { eq, and } = require('drizzle-orm');
const logger = require('../utils/logger');
const embeds = require('../utils/embeds');
const { checkBotPermissions } = require('../utils/permissionCheck');
const { getControlPanel } = require('../components/bytepodControls');
const { dbLog } = require('../utils/dbLogger');

// Helper to get pod state (lock status, whitelist, etc.)
function getPodState(channel) {
    const { PermissionFlagsBits } = require('discord.js');
    const isLocked = channel.permissionOverwrites.cache.get(channel.guild.id)?.deny.has(PermissionFlagsBits.Connect);
    const limit = channel.userLimit;

    const whitelist = [];
    const coOwners = [];

    channel.permissionOverwrites.cache.forEach((overwrite) => {
        if (overwrite.type !== 1) return; // Member only

        // Co-Owner: ManageChannels
        if (overwrite.allow.has(PermissionFlagsBits.ManageChannels)) {
            coOwners.push(overwrite.id);
        }

        // Whitelist: Connect = true
        if (overwrite.allow.has(PermissionFlagsBits.Connect)) {
            if (!coOwners.includes(overwrite.id)) {
                whitelist.push(overwrite.id);
            }
        }
    });

    return { isLocked, limit, whitelist, coOwners };
}

// Helper to finalize a voice session and update stats
async function finalizeVoiceSession(session, client) {
    const durationSeconds = Math.floor((Date.now() - session.startTime) / 1000);

    // Delete active session
    await dbLog.delete('bytepodActiveSessions',
        () => db.delete(bytepodActiveSessions)
            .where(eq(bytepodActiveSessions.id, session.id)),
        { sessionId: session.id, userId: session.userId, guildId: session.guildId }
    );

    // Upsert aggregate stats
    const existing = await dbLog.select('bytepodVoiceStats',
        () => db.select().from(bytepodVoiceStats)
            .where(and(
                eq(bytepodVoiceStats.userId, session.userId),
                eq(bytepodVoiceStats.guildId, session.guildId)
            )).get(),
        { userId: session.userId, guildId: session.guildId }
    );

    if (existing) {
        await dbLog.update('bytepodVoiceStats',
            () => db.update(bytepodVoiceStats)
                .set({
                    totalSeconds: existing.totalSeconds + durationSeconds,
                    sessionCount: existing.sessionCount + 1
                })
                .where(eq(bytepodVoiceStats.id, existing.id)),
            { userId: session.userId, guildId: session.guildId, durationSeconds }
        );
    } else {
        await dbLog.insert('bytepodVoiceStats',
            () => db.insert(bytepodVoiceStats).values({
                userId: session.userId,
                guildId: session.guildId,
                totalSeconds: durationSeconds,
                sessionCount: 1
            }),
            { userId: session.userId, guildId: session.guildId, durationSeconds }
        );
    }

    // Track activity streak (convert seconds to minutes)
    const durationMinutes = Math.floor(durationSeconds / 60);
    if (durationMinutes > 0 && client.activityStreakService) {
        try {
            await client.activityStreakService.recordActivity(
                session.userId,
                session.guildId,
                'voice',
                durationMinutes
            );
        } catch (error) {
            logger.error('Activity streak tracking error:', error);
            // Don't crash on tracking errors, just log
        }
    }

    return durationSeconds;
}

// --- OWNERSHIP TRANSFER SYSTEM ---
// In-memory map to track pending ownership transfers: channelId -> timeoutId
const pendingOwnershipTransfers = new Map();
const OWNERSHIP_TRANSFER_DELAY_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Transfer ownership of a BytePod to a new member
 */
async function transferOwnership(channel, podData, newOwnerId, client) {
    const guild = channel.guild;
    const oldOwnerId = podData.ownerId;

    try {
        logger.debug(`[Transfer] Step 1: Updating database for ${channel.id}`);
        // Update database (keep originalOwnerId unchanged - creator can always reclaim)
        await dbLog.update('bytepods',
            () => db.update(bytepods)
                .set({
                    ownerId: newOwnerId,
                    ownerLeftAt: null,
                    reclaimRequestPending: false // Clear any pending reclaim requests
                })
                .where(eq(bytepods.channelId, channel.id)),
            { podId: channel.id, oldOwnerId, newOwnerId, operation: 'transferOwnership' }
        );

        logger.debug(`[Transfer] Step 2: Removing old owner permissions`);
        // Remove ManageChannels from old owner (if still in server)
        try {
            await channel.permissionOverwrites.edit(oldOwnerId, {
                ManageChannels: null,
                MoveMembers: null
            });
        } catch (e) {
            // Old owner may have left the server entirely
            logger.debug(`[Transfer] Old owner permission edit failed: ${e.message}`);
        }

        logger.debug(`[Transfer] Step 3: Granting new owner permissions`);
        // Grant ManageChannels to new owner
        await channel.permissionOverwrites.edit(newOwnerId, {
            Connect: true,
            ManageChannels: true,
            MoveMembers: true
        });

        logger.debug(`[Transfer] Step 4: Fetching new owner user`);
        // Notify the channel
        const newOwner = await client.users.fetch(newOwnerId).catch(() => null);
        const embed = embeds.info('Ownership Transferred',
            `<@${oldOwnerId}> left the channel. <@${newOwnerId}> is now the owner of this BytePod.`
        );

        logger.debug(`[Transfer] Step 5: Sending notification embed`);
        await channel.send({
            embeds: [embed],
            content: `<@${newOwnerId}>, you are now the owner! Run \`/bytepod panel\` to access controls.`
        });
        logger.info(`BytePod ownership transferred: ${channel.id} from ${oldOwnerId} to ${newOwnerId}`);
        logger.debug(`[Transfer] Complete!`);

    } catch (error) {
        logger.error(`[Transfer] ERROR at step: ${error.message}`);

        // Handle channel deletion race condition
        if (error.code === 10003) {
            logger.info(`Channel ${channel.id} was deleted during ownership transfer, skipping`);
            return;
        }

        logger.errorContext('Failed to transfer BytePod ownership', error, {
            channelId: channel.id,
            oldOwnerId,
            newOwnerId
        });
    }
}

module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState) {
        const member = newState.member;
        const guild = newState.guild;

        if (member.user.bot) return;

        // DB Fetch
        const guildData = await dbLog.select('guilds',
            () => db.select().from(guilds).where(eq(guilds.id, guild.id)).get(),
            { guildId: guild.id }
        );
        if (!guildData || !guildData.voiceHubChannelId) {
            return;
        }

        const hubId = guildData.voiceHubChannelId;
        const joinedChannelId = newState.channelId;
        const leftChannelId = oldState.channelId;

        // --- JOIN HUB TRIGGER ---
        if (joinedChannelId === hubId) {
            // Check Permissions
            const hasPerms = await checkBotPermissions(guild, member);
            if (!hasPerms) {
                // Kick user from hub to prevent camping? Or just let them sit. 
                // Better to disconnect them so they know something failed if DM failed.
                try { await member.voice.disconnect(); } catch (e) { }
                return;
            }

            try {
                // Fetch User Settings
                const userSettings = await dbLog.select('bytepodUserSettings',
                    () => db.select().from(bytepodUserSettings).where(eq(bytepodUserSettings.userId, member.id)).get(),
                    { userId: member.id }
                );
                const autoLock = userSettings?.autoLock || false;

                // Determine Category
                const categoryId = guildData.voiceHubCategoryId || newState.channel.parentId;

                // Create Channel
                const channelName = `${member.user.username}'s Pod`;
                const newChannel = await guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildVoice,
                    parent: categoryId,
                    permissionOverwrites: [
                        {
                            id: guild.id,
                            allow: [PermissionFlagsBits.ViewChannel],
                            deny: autoLock ? [PermissionFlagsBits.Connect] : [], // Apply Auto-Lock
                        },
                        {
                            id: member.id,
                            allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers],
                        }
                    ]
                });

                // Apply Auto-Whitelist Presets
                const presets = await dbLog.select('bytepodAutoWhitelist',
                    () => db.select().from(bytepodAutoWhitelist).where(eq(bytepodAutoWhitelist.userId, member.id)),
                    { userId: member.id, guildId: guild.id }
                );
                for (const preset of presets) {
                    try {
                        const targetMember = await guild.members.fetch(preset.targetUserId).catch(() => null);
                        const targetUser = targetMember ? targetMember.user : await guild.client.users.fetch(preset.targetUserId).catch(() => null);

                        if (targetUser) {
                            await newChannel.permissionOverwrites.edit(targetUser, { Connect: true });
                        } else {
                            logger.warn(`Could not find user ${preset.targetUserId} for whitelist preset.`);
                        }
                    } catch (e) {
                        logger.error(`Failed to apply whitelist preset for ${preset.targetUserId}: ${e}`);
                    }
                }

                // Move Member
                await member.voice.setChannel(newChannel);

                // DB Insert - BytePod record
                await dbLog.insert('bytepods',
                    () => db.insert(bytepods).values({
                        channelId: newChannel.id,
                        guildId: guild.id,
                        ownerId: member.id,
                        originalOwnerId: member.id, // Track original creator for reclaim feature
                    }),
                    { podId: newChannel.id, guildId: guild.id, userId: member.id }
                );

                // Track BytePod creation for achievements
                if (newState.client.activityStreakService) {
                    try {
                        await newState.client.activityStreakService.recordBytepodCreation(member.id, guild.id);
                    } catch (error) {
                        logger.debug('Failed to track BytePod creation:', error);
                    }
                }

                // Start voice session tracking (persisted to DB)
                await dbLog.insert('bytepodActiveSessions',
                    () => db.insert(bytepodActiveSessions).values({
                        podId: newChannel.id,
                        userId: member.id,
                        guildId: guild.id,
                        startTime: Date.now()
                    }),
                    { podId: newChannel.id, userId: member.id, guildId: guild.id }
                );

                // Send Welcome Message
                await newChannel.send({
                    embeds: [embeds.brand('Welcome to Your BytePod!', `Your personal voice channel has been created! 🎉\n\n**To manage your pod:** Run \`/bytepod panel\` to access controls (lock/unlock, whitelist, co-owners, etc.)`)],
                    content: `Welcome, ${member}!`
                });

            } catch (error) {
                logger.error(`Failed to create BytePod for ${member.user.tag}: ${error}`);

                // Alert User
                try {
                    await member.send({
                        embeds: [embeds.error('BytePod Creation Failed', `I couldn't create your pod or move you. Please ensure I have the **Administrator** or **Manage Channels** permission and that my role is **above** yours.\n\nError: \`${error.message}\``)]
                    });
                } catch (dmError) {
                    // DMs closed
                }

                try { await member.voice.disconnect(); } catch (e) { }
            }
        }

        // --- JOIN POD TRIGGER (Existing BytePod) ---
        // Handle ownership return / reclaim when someone joins an existing pod
        // IMPORTANT: Only trigger if user actually moved channels (not just voice state change like mute/screenshare)
        if (joinedChannelId && joinedChannelId !== hubId && oldState.channelId !== newState.channelId) {
            // Track channel join for achievements
            if (newState.client.activityStreakService) {
                try {
                    await newState.client.activityStreakService.recordChannelJoin(member.id, member.guild.id);
                    await newState.client.activityStreakService.startVoiceSession(member.id, member.guild.id, joinedChannelId);
                } catch (error) {
                    logger.debug('Failed to track channel join:', error);
                }
            }

            const podData = await dbLog.select('bytepods',
                () => db.select().from(bytepods).where(eq(bytepods.channelId, joinedChannelId)).get(),
                { podId: joinedChannelId, guildId: guild.id }
            );

            if (podData) {
                logger.debug(`[Voice State] User ${member.id} joined BytePod ${joinedChannelId} (owner: ${podData.ownerId}, originalOwner: ${podData.originalOwnerId})`);
                const channel = newState.channel;

                // Case 1: Owner returned during grace period - cancel transfer
                if (podData.ownerId === member.id && podData.ownerLeftAt) {
                    logger.info(`BytePod owner ${member.id} returned to ${joinedChannelId}, cancelling ownership transfer`);

                    // Cancel pending timeout
                    if (pendingOwnershipTransfers.has(joinedChannelId)) {
                        clearTimeout(pendingOwnershipTransfers.get(joinedChannelId));
                        pendingOwnershipTransfers.delete(joinedChannelId);
                    }

                    // Clear ownerLeftAt in DB
                    await dbLog.update('bytepods',
                        () => db.update(bytepods)
                            .set({ ownerLeftAt: null })
                            .where(eq(bytepods.channelId, joinedChannelId)),
                        { podId: joinedChannelId, userId: member.id, operation: 'ownerReturned' }
                    );

                    // Notify channel
                    try {
                        await channel.send({
                            embeds: [embeds.success('Owner Returned', `<@${member.id}> has returned. Ownership transfer cancelled.`)]
                        });
                    } catch (e) { }
                }

                // Case 2: Original owner rejoins AFTER ownership was transferred
                // (They are originalOwnerId but NOT ownerId, and transfer already happened)
                else if (
                    podData.originalOwnerId === member.id &&
                    podData.ownerId !== member.id &&
                    !podData.ownerLeftAt && // Transfer already completed (not in grace period)
                    !podData.reclaimRequestPending // No pending request already
                ) {
                    // Send reclaim prompt in channel
                    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

                    const reclaimRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`bytepod_reclaim_request_${joinedChannelId}_${member.id}`)
                            .setLabel('Request Ownership Back')
                            .setStyle(ButtonStyle.Primary)
                            .setEmoji('👑')
                    );

                    try {
                        await channel.send({
                            content: `<@${member.id}>`,
                            embeds: [embeds.info('Welcome Back!', `You originally created this BytePod. Would you like to request ownership back from <@${podData.ownerId}>?`)],
                            components: [reclaimRow]
                        });

                        // Mark request as pending to prevent duplicate prompts
                        await dbLog.update('bytepods',
                            () => db.update(bytepods)
                                .set({ reclaimRequestPending: true })
                                .where(eq(bytepods.channelId, joinedChannelId)),
                            { podId: joinedChannelId, userId: member.id, operation: 'reclaimRequest' }
                        );

                        logger.info(`Sent ownership reclaim prompt to ${member.id} for pod ${joinedChannelId}`);
                    } catch (e) {
                        logger.error(`Failed to send reclaim prompt: ${e.message}`);
                    }
                }
                // Case 3: Backfill originalOwnerId for old pods that don't have it set
                else if (!podData.originalOwnerId && podData.ownerId === member.id) {
                    // Current owner joining their own pod but originalOwnerId is null - backfill it
                    await dbLog.update('bytepods',
                        () => db.update(bytepods)
                            .set({ originalOwnerId: member.id })
                            .where(eq(bytepods.channelId, joinedChannelId)),
                        { podId: joinedChannelId, userId: member.id, operation: 'backfillOriginalOwner' }
                    );
                    logger.info(`Backfilled originalOwnerId for pod ${joinedChannelId}`);
                }

                // Start voice session for this user
                const existingSession = await dbLog.select('bytepodActiveSessions',
                    () => db.select().from(bytepodActiveSessions)
                        .where(and(
                            eq(bytepodActiveSessions.podId, joinedChannelId),
                            eq(bytepodActiveSessions.userId, member.id)
                        )).get(),
                    { podId: joinedChannelId, userId: member.id }
                );

                if (!existingSession) {
                    await dbLog.insert('bytepodActiveSessions',
                        () => db.insert(bytepodActiveSessions).values({
                            podId: joinedChannelId,
                            userId: member.id,
                            guildId: guild.id,
                            startTime: Date.now()
                        }),
                        { podId: joinedChannelId, userId: member.id, guildId: guild.id }
                    );
                }
            }
        }

        // --- LEAVE POD TRIGGER ---
        // IMPORTANT: Only trigger if user actually moved channels (not just voice state change like mute/screenshare)
        if (leftChannelId && leftChannelId !== hubId && oldState.channelId !== newState.channelId) {
            logger.debug(`[Voice State] User ${member.id} left channel ${leftChannelId} (joined: ${joinedChannelId || 'none'})`);

            // Track voice session end for achievements
            if (newState.client.activityStreakService) {
                try {
                    await newState.client.activityStreakService.endVoiceSession(member.id, member.guild.id, leftChannelId);
                } catch (error) {
                    logger.debug('Failed to track voice session end:', error);
                }
            }

            // Finalize voice session for the leaving user
            const session = await dbLog.select('bytepodActiveSessions',
                () => db.select().from(bytepodActiveSessions)
                    .where(and(
                        eq(bytepodActiveSessions.podId, leftChannelId),
                        eq(bytepodActiveSessions.userId, member.id)
                    )).get(),
                { podId: leftChannelId, userId: member.id }
            );

            if (session) {
                try {
                    await finalizeVoiceSession(session, newState.client);
                } catch (e) {
                    logger.error(`Failed to finalize voice session: ${e}`);
                }
            }

            // Check if it's a BytePod
            const podData = await dbLog.select('bytepods',
                () => db.select().from(bytepods).where(eq(bytepods.channelId, leftChannelId)).get(),
                { podId: leftChannelId, guildId: guild.id }
            );

            if (podData) {
                const channel = oldState.channel || await guild.channels.fetch(leftChannelId).catch(() => null);

                if (channel && channel.members.size === 0) {
                    // --- CHANNEL EMPTY: DELETE POD ---
                    // Cancel any pending ownership transfer
                    if (pendingOwnershipTransfers.has(leftChannelId)) {
                        clearTimeout(pendingOwnershipTransfers.get(leftChannelId));
                        pendingOwnershipTransfers.delete(leftChannelId);
                    }

                    try {
                        // Finalize any remaining sessions
                        const remainingSessions = await dbLog.select('bytepodActiveSessions',
                            () => db.select().from(bytepodActiveSessions)
                                .where(eq(bytepodActiveSessions.podId, leftChannelId)),
                            { podId: leftChannelId, operation: 'finalCleanup' }
                        );
                        for (const s of remainingSessions) {
                            await finalizeVoiceSession(s, newState.client);
                        }

                        // Delete channel and pod record
                        await channel.delete();
                        await dbLog.delete('bytepods',
                            () => db.delete(bytepods).where(eq(bytepods.channelId, leftChannelId)),
                            { podId: leftChannelId, guildId: guild.id, operation: 'deletePod' }
                        );
                    } catch (error) {
                        logger.error(`Failed to cleanup BytePod ${leftChannelId}: ${error}`);
                        if (error.code === 10003) {
                            await dbLog.delete('bytepods',
                                () => db.delete(bytepods).where(eq(bytepods.channelId, leftChannelId)),
                                { podId: leftChannelId, operation: 'cleanupError' }
                            );
                            await dbLog.delete('bytepodActiveSessions',
                                () => db.delete(bytepodActiveSessions).where(eq(bytepodActiveSessions.podId, leftChannelId)),
                                { podId: leftChannelId, operation: 'cleanupError' }
                            );
                        }
                    }
                } else if (channel && channel.members.size > 0 && podData.ownerId === member.id) {
                    // --- OWNER LEFT BUT OTHERS REMAIN: SCHEDULE TRANSFER ---

                    // Defensive check: Verify owner is actually absent (Discord sometimes sends false leave events)
                    const freshChannel = await guild.channels.fetch(leftChannelId).catch(() => null);
                    if (!freshChannel) {
                        logger.debug(`Channel ${leftChannelId} no longer exists, skipping transfer logic`);
                        return;
                    }

                    if (freshChannel.members.has(member.id)) {
                        logger.warn(`[FALSE LEAVE] Owner ${member.id} appears to still be in channel ${leftChannelId} despite leave event. Skipping transfer.`);
                        logger.debug(`[FALSE LEAVE] Channel members: ${Array.from(freshChannel.members.keys()).join(', ')}`);
                        return;
                    }

                    logger.info(`BytePod owner ${member.id} left channel ${leftChannelId} (verified absent), scheduling ownership transfer in 5 minutes`);
                    logger.debug(`Remaining members: ${Array.from(freshChannel.members.keys()).join(', ')}`);

                    // Mark owner as left in DB
                    await dbLog.update('bytepods',
                        () => db.update(bytepods)
                            .set({ ownerLeftAt: Date.now() })
                            .where(eq(bytepods.channelId, leftChannelId)),
                        { podId: leftChannelId, userId: member.id, operation: 'ownerLeft' }
                    );

                    // Schedule transfer after 5 minutes
                    const timeoutId = setTimeout(async () => {
                        pendingOwnershipTransfers.delete(leftChannelId);

                        try {
                            logger.debug(`[Transfer Timeout] Checking pod ${leftChannelId} for transfer`);

                            // Re-fetch pod data and channel state
                            const currentPodData = await dbLog.select('bytepods',
                                () => db.select().from(bytepods).where(eq(bytepods.channelId, leftChannelId)).get(),
                                { podId: leftChannelId, operation: 'transferTimeoutCheck' }
                            );
                            if (!currentPodData || !currentPodData.ownerLeftAt) {
                                logger.debug(`[Transfer Timeout] Skipping - pod deleted or owner returned (ownerLeftAt: ${currentPodData?.ownerLeftAt})`);
                                return;
                            }

                            const currentChannel = await guild.channels.fetch(leftChannelId).catch(() => null);
                            if (!currentChannel || currentChannel.members.size === 0) {
                                logger.debug(`[Transfer Timeout] Skipping - channel deleted or empty (exists: ${!!currentChannel}, members: ${currentChannel?.members.size || 0})`);
                                return; // Channel deleted or empty
                            }

                            // Defensive check: Verify owner is still absent before transferring
                            if (currentChannel.members.has(currentPodData.ownerId)) {
                                logger.warn(`[Transfer Timeout] Owner ${currentPodData.ownerId} is back in channel ${leftChannelId}, cancelling transfer`);
                                logger.debug(`[Transfer Timeout] Channel members: ${Array.from(currentChannel.members.keys()).join(', ')}`);
                                // Clear ownerLeftAt since they're back
                                await dbLog.update('bytepods',
                                    () => db.update(bytepods)
                                        .set({ ownerLeftAt: null })
                                        .where(eq(bytepods.channelId, leftChannelId)),
                                    { podId: leftChannelId, operation: 'cancelTransferOwnerReturned' }
                                );
                                return;
                            }

                            // Pick the first member in the channel as new owner
                            const newOwner = currentChannel.members.first();
                            if (newOwner && !newOwner.user.bot) {
                                logger.debug(`[Transfer Timeout] Transferring ownership to ${newOwner.id}`);
                                await transferOwnership(currentChannel, currentPodData, newOwner.id, guild.client);
                            } else {
                                // No eligible members found (only old owner or bots remain)
                                // Clear the ownerLeftAt since owner is still the only eligible person
                                await dbLog.update('bytepods',
                                    () => db.update(bytepods)
                                        .set({ ownerLeftAt: null })
                                        .where(eq(bytepods.channelId, leftChannelId)),
                                    { podId: leftChannelId, operation: 'cancelTransferNoEligibleOwner' }
                                );
                                logger.debug(`[Transfer Timeout] No eligible new owner found - only old owner or bots remain`);
                            }
                        } catch (error) {
                            logger.errorContext('Ownership transfer timeout failed', error, {
                                channelId: leftChannelId
                            });
                        }
                    }, OWNERSHIP_TRANSFER_DELAY_MS);

                    pendingOwnershipTransfers.set(leftChannelId, timeoutId);
                }
            }
        }
    }
};
