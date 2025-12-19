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
                    try {
                        // Finalize any remaining sessions for this pod (edge case: multiple users left simultaneously)
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
                        // If channel deleted manually, verify DB cleanup
                        if (error.code === 10003) { // Unknown Channel
                            await db.delete(bytepods).where(eq(bytepods.channelId, leftChannelId));
                            // Also cleanup any orphaned sessions
                            await db.delete(bytepodActiveSessions).where(eq(bytepodActiveSessions.podId, leftChannelId));
                        }
                    }
                }
            }
        }
    }
};
