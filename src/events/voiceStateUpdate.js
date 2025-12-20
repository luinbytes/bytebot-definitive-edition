const { Events, ChannelType, PermissionFlagsBits } = require('discord.js');
const { db } = require('../database');
const { guilds, bytepods, bytepodAutoWhitelist, bytepodUserSettings, bytepodActiveSessions, bytepodVoiceStats } = require('../database/schema');
const { eq, and } = require('drizzle-orm');
const logger = require('../utils/logger');
const embeds = require('../utils/embeds');
const { checkBotPermissions } = require('../utils/permissionCheck');
const { getControlPanel } = require('../components/bytepodControls');

// Helper to finalize a voice session and update stats
async function finalizeVoiceSession(session) {
    const durationSeconds = Math.floor((Date.now() - session.startTime) / 1000);

    // Delete active session
    await db.delete(bytepodActiveSessions)
        .where(eq(bytepodActiveSessions.id, session.id));

    // Upsert aggregate stats
    const existing = await db.select().from(bytepodVoiceStats)
        .where(and(
            eq(bytepodVoiceStats.userId, session.userId),
            eq(bytepodVoiceStats.guildId, session.guildId)
        )).get();

    if (existing) {
        await db.update(bytepodVoiceStats)
            .set({
                totalSeconds: existing.totalSeconds + durationSeconds,
                sessionCount: existing.sessionCount + 1
            })
            .where(eq(bytepodVoiceStats.id, existing.id));
    } else {
        await db.insert(bytepodVoiceStats).values({
            userId: session.userId,
            guildId: session.guildId,
            totalSeconds: durationSeconds,
            sessionCount: 1
        });
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
        // Update database
        await db.update(bytepods)
            .set({
                ownerId: newOwnerId,
                ownerLeftAt: null
            })
            .where(eq(bytepods.channelId, channel.id));

        // Remove ManageChannels from old owner (if still in server)
        try {
            await channel.permissionOverwrites.edit(oldOwnerId, {
                ManageChannels: null,
                MoveMembers: null
            });
        } catch (e) {
            // Old owner may have left the server entirely
        }

        // Grant ManageChannels to new owner
        await channel.permissionOverwrites.edit(newOwnerId, {
            Connect: true,
            ManageChannels: true,
            MoveMembers: true
        });

        // Notify the channel
        const newOwner = await client.users.fetch(newOwnerId).catch(() => null);
        const embed = embeds.info('Ownership Transferred',
            `<@${oldOwnerId}> left the channel. <@${newOwnerId}> is now the owner of this BytePod.`
        );

        // Rename channel to new owner's name
        try {
            const newOwnerMember = await guild.members.fetch(newOwnerId);
            await channel.setName(`${newOwnerMember.user.username}'s Pod`);
        } catch (e) {
            logger.warn(`Failed to rename channel for new owner: ${e.message}`);
        }

        await channel.send({ embeds: [embed] });
        logger.info(`BytePod ownership transferred: ${channel.id} from ${oldOwnerId} to ${newOwnerId}`);

    } catch (error) {
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
        const guildData = await db.select().from(guilds).where(eq(guilds.id, guild.id)).get();
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
                const userSettings = await db.select().from(bytepodUserSettings).where(eq(bytepodUserSettings.userId, member.id)).get();
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
                const presets = await db.select().from(bytepodAutoWhitelist).where(eq(bytepodAutoWhitelist.userId, member.id));
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
                await db.insert(bytepods).values({
                    channelId: newChannel.id,
                    guildId: guild.id,
                    ownerId: member.id,
                    originalOwnerId: member.id, // Track original creator for reclaim feature
                });

                // Start voice session tracking (persisted to DB)
                await db.insert(bytepodActiveSessions).values({
                    podId: newChannel.id,
                    userId: member.id,
                    guildId: guild.id,
                    startTime: Date.now()
                });

                // Send Control Panel
                const whitelistIDs = presets.map(p => p.targetUserId);
                const { embeds: panelEmbeds, components } = getControlPanel(newChannel.id, autoLock, 0, whitelistIDs); // Pass autoLock state
                await newChannel.send({ content: `Welcome to your BytePod, ${member}!`, embeds: panelEmbeds, components });

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
        if (joinedChannelId && joinedChannelId !== hubId) {
            const podData = await db.select().from(bytepods).where(eq(bytepods.channelId, joinedChannelId)).get();

            if (podData) {
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
                    await db.update(bytepods)
                        .set({ ownerLeftAt: null })
                        .where(eq(bytepods.channelId, joinedChannelId));

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
                    // Send reclaim prompt to the channel
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
                        await db.update(bytepods)
                            .set({ reclaimRequestPending: true })
                            .where(eq(bytepods.channelId, joinedChannelId));

                        logger.info(`Sent ownership reclaim prompt to ${member.id} for pod ${joinedChannelId}`);
                    } catch (e) {
                        logger.warn(`Failed to send reclaim prompt: ${e.message}`);
                    }
                }
                // Case 3: Backfill originalOwnerId for old pods that don't have it set
                else if (!podData.originalOwnerId && podData.ownerId === member.id) {
                    // Current owner joining their own pod but originalOwnerId is null - backfill it
                    await db.update(bytepods)
                        .set({ originalOwnerId: member.id })
                        .where(eq(bytepods.channelId, joinedChannelId));
                    logger.info(`Backfilled originalOwnerId for pod ${joinedChannelId}`);
                }

                // Start voice session for this user
                const existingSession = await db.select().from(bytepodActiveSessions)
                    .where(and(
                        eq(bytepodActiveSessions.podId, joinedChannelId),
                        eq(bytepodActiveSessions.userId, member.id)
                    )).get();

                if (!existingSession) {
                    await db.insert(bytepodActiveSessions).values({
                        podId: joinedChannelId,
                        userId: member.id,
                        guildId: guild.id,
                        startTime: Date.now()
                    });
                }
            }
        }

        // --- LEAVE POD TRIGGER ---
        if (leftChannelId && leftChannelId !== hubId) {
            // Finalize voice session for the leaving user
            const session = await db.select().from(bytepodActiveSessions)
                .where(and(
                    eq(bytepodActiveSessions.podId, leftChannelId),
                    eq(bytepodActiveSessions.userId, member.id)
                )).get();

            if (session) {
                try {
                    await finalizeVoiceSession(session);
                } catch (e) {
                    logger.error(`Failed to finalize voice session: ${e}`);
                }
            }

            // Check if it's a BytePod
            const podData = await db.select().from(bytepods).where(eq(bytepods.channelId, leftChannelId)).get();

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
                        const remainingSessions = await db.select().from(bytepodActiveSessions)
                            .where(eq(bytepodActiveSessions.podId, leftChannelId));
                        for (const s of remainingSessions) {
                            await finalizeVoiceSession(s);
                        }

                        // Delete channel and pod record
                        await channel.delete();
                        await db.delete(bytepods).where(eq(bytepods.channelId, leftChannelId));
                    } catch (error) {
                        logger.error(`Failed to cleanup BytePod ${leftChannelId}: ${error}`);
                        if (error.code === 10003) {
                            await db.delete(bytepods).where(eq(bytepods.channelId, leftChannelId));
                            await db.delete(bytepodActiveSessions).where(eq(bytepodActiveSessions.podId, leftChannelId));
                        }
                    }
                } else if (channel && channel.members.size > 0 && podData.ownerId === member.id) {
                    // --- OWNER LEFT BUT OTHERS REMAIN: SCHEDULE TRANSFER ---
                    logger.info(`BytePod owner ${member.id} left channel ${leftChannelId}, scheduling ownership transfer in 5 minutes`);

                    // Mark owner as left in DB
                    await db.update(bytepods)
                        .set({ ownerLeftAt: Date.now() })
                        .where(eq(bytepods.channelId, leftChannelId));

                    // Schedule transfer after 5 minutes
                    const timeoutId = setTimeout(async () => {
                        pendingOwnershipTransfers.delete(leftChannelId);

                        try {
                            // Re-fetch pod data and channel state
                            const currentPodData = await db.select().from(bytepods).where(eq(bytepods.channelId, leftChannelId)).get();
                            if (!currentPodData || !currentPodData.ownerLeftAt) {
                                // Owner returned or pod deleted
                                return;
                            }

                            const currentChannel = await guild.channels.fetch(leftChannelId).catch(() => null);
                            if (!currentChannel || currentChannel.members.size === 0) {
                                return; // Channel deleted or empty
                            }

                            // Pick the first member in the channel as new owner
                            const newOwner = currentChannel.members.first();
                            if (newOwner && !newOwner.user.bot) {
                                await transferOwnership(currentChannel, currentPodData, newOwner.id, guild.client);
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
