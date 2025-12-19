const { Events, ChannelType, PermissionFlagsBits } = require('discord.js');
const { db } = require('../database');
const { guilds, bytepods, bytepodAutoWhitelist, bytepodUserSettings } = require('../database/schema');
const { eq } = require('drizzle-orm');
const logger = require('../utils/logger');
const embeds = require('../utils/embeds'); // Ensure embeds is imported
const { checkBotPermissions } = require('../utils/permissionCheck');
const { getControlPanel } = require('../components/bytepodControls');

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

                // DB Insert
                await db.insert(bytepods).values({
                    channelId: newChannel.id,
                    guildId: guild.id,
                    ownerId: member.id,
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
            // Check if it's a BytePod
            const podData = await db.select().from(bytepods).where(eq(bytepods.channelId, leftChannelId)).get();

            if (podData) {
                const channel = oldState.channel || await guild.channels.fetch(leftChannelId).catch(() => null);

                if (channel && channel.members.size === 0) {
                    try {
                        // Delete
                        await channel.delete();
                        await db.delete(bytepods).where(eq(bytepods.channelId, leftChannelId));
                    } catch (error) {
                        logger.error(`Failed to cleanup BytePod ${leftChannelId}: ${error}`);
                        // If channel deleted manually, verify DB cleanup
                        if (error.code === 10003) { // Unknown Channel
                            await db.delete(bytepods).where(eq(bytepods.channelId, leftChannelId));
                        }
                    }
                }
            }
        }
    }
};
