const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, UserSelectMenuBuilder, MessageFlags } = require('discord.js');
const { db } = require('../../database');
const { guilds, bytepods, bytepodAutoWhitelist, bytepodUserSettings, bytepodVoiceStats, bytepodTemplates } = require('../../database/schema');
const { eq, and, desc } = require('drizzle-orm');
const embeds = require('../../utils/embeds');
const logger = require('../../utils/logger');
const { handleCommandError } = require('../../utils/errorHandlerUtil');
const { getControlPanel, getRenameModal, getLimitModal } = require('../../components/bytepodControls');
const { upsert, insertIfNotExists } = require('../../utils/dbUtil');

// Helper to format seconds into human-readable time
function formatDuration(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

    return parts.join(' ');
}

// Helper to get state
function getPodState(channel) {
    const isLocked = channel.permissionOverwrites.cache.get(channel.guild.id)?.deny.has(PermissionFlagsBits.Connect);
    const limit = channel.userLimit;

    const whitelist = [];
    const coOwners = [];

    channel.permissionOverwrites.cache.forEach((overwrite) => {
        if (overwrite.type !== 1) return; // Member only (0 = Role, 1 = Member)

        // Co-Owner: ManageChannels
        if (overwrite.allow.has(PermissionFlagsBits.ManageChannels)) {
            coOwners.push(overwrite.id);
        }

        // Whitelist: Connect = true
        if (overwrite.allow.has(PermissionFlagsBits.Connect)) {
            // Filter out CoOwners from Whitelist display to avoid duplicates
            if (!coOwners.includes(overwrite.id)) {
                whitelist.push(overwrite.id);
            }
        }
    });

    return { isLocked, limit, whitelist, coOwners };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bytepod')
        .setDescription('Manage BytePod ephemeral voice channels.')
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Configure the "Join to Create" Hub channel (Admin Only).')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('The voice channel to act as the Hub')
                        .addChannelTypes(ChannelType.GuildVoice)
                        .setRequired(true))
                .addChannelOption(option =>
                    option.setName('category')
                        .setDescription('The category where new BytePods will be created')
                        .addChannelTypes(ChannelType.GuildCategory)))
        .addSubcommand(sub =>
            sub.setName('disable')
                .setDescription('Disable BytePods for this server (Admin Only).'))
        .addSubcommand(sub =>
            sub.setName('panel')
                .setDescription('Resend the control panel for your current BytePod.'))
        .addSubcommandGroup(group =>
            group.setName('preset')
                .setDescription('Manage your auto-whitelist presets.')
                .addSubcommand(sub =>
                    sub.setName('add')
                        .setDescription('Add a user to your auto-whitelist.')
                        .addUserOption(option => option.setName('user').setDescription('The user to add').setRequired(true)))
                .addSubcommand(sub =>
                    sub.setName('remove')
                        .setDescription('Remove a user from your auto-whitelist.')
                        .addUserOption(option => option.setName('user').setDescription('The user to remove').setRequired(true)))
                .addSubcommand(sub =>
                    sub.setName('list')
                        .setDescription('View your current auto-whitelist.')))
        .addSubcommand(sub =>
            sub.setName('stats')
                .setDescription('View BytePod voice activity statistics.')
                .addUserOption(opt => opt
                    .setName('user')
                    .setDescription('User to view stats for (defaults to you)')))
        .addSubcommandGroup(group =>
            group.setName('template')
                .setDescription('Manage BytePod configuration templates.')
                .addSubcommand(sub =>
                    sub.setName('save')
                        .setDescription('Save current pod configuration as a template.')
                        .addStringOption(opt => opt.setName('name').setDescription('Template name').setRequired(true).setMaxLength(32)))
                .addSubcommand(sub =>
                    sub.setName('load')
                        .setDescription('Load a saved template to current pod.')
                        .addStringOption(opt => opt.setName('name').setDescription('Template name').setRequired(true)))
                .addSubcommand(sub =>
                    sub.setName('list')
                        .setDescription('List your saved templates.'))
                .addSubcommand(sub =>
                    sub.setName('delete')
                        .setDescription('Delete a saved template.')
                        .addStringOption(opt => opt.setName('name').setDescription('Template name').setRequired(true))))
        .addSubcommand(sub =>
            sub.setName('leaderboard')
                .setDescription('View the top BytePod users by voice time.'))
        .addSubcommand(sub =>
            sub.setName('autolock')
                .setDescription('Toggle auto-locking when you create a new BytePod (per-server)')
                .addBooleanOption(opt => opt
                    .setName('enabled')
                    .setDescription('Auto-lock new pods?')
                    .setRequired(true))),

    async execute(interaction) {
        const subdomain = interaction.options.getSubcommand();
        const group = interaction.options.getSubcommandGroup();

        if (subdomain === 'setup') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ embeds: [embeds.error('Permission Denied', 'Only Administrators can use this command.')], flags: [MessageFlags.Ephemeral] });
            }

            await interaction.deferReply();
            const channel = interaction.options.getChannel('channel');
            const category = interaction.options.getChannel('category');
            const targetCategoryId = category ? category.id : null; // Use null if no category

            await db.insert(guilds).values({
                id: interaction.guild.id,
                joinedAt: new Date(),
                voiceHubChannelId: channel.id,
                voiceHubCategoryId: targetCategoryId
            }).onConflictDoUpdate({
                target: guilds.id,
                set: {
                    voiceHubChannelId: channel.id,
                    voiceHubCategoryId: targetCategoryId
                }
            });

            return interaction.editReply({ embeds: [embeds.success('Setup Complete', `BytePod Hub set to ${channel}. New pods will be created in ${category ? category : 'the same category as the Hub'}.`)] });
        }

        if (subdomain === 'disable') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ embeds: [embeds.error('Permission Denied', 'Only Administrators can use this command.')], flags: [MessageFlags.Ephemeral] });
            }

            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            // Check if BytePods are currently configured
            const guildData = await db.select().from(guilds).where(eq(guilds.id, interaction.guild.id)).get();

            if (!guildData || !guildData.voiceHubChannelId) {
                return interaction.editReply({ embeds: [embeds.warn('Not Configured', 'BytePods are not currently enabled for this server.')] });
            }

            // Disable BytePods by clearing the hub channel and category
            await db.update(guilds)
                .set({
                    voiceHubChannelId: null,
                    voiceHubCategoryId: null
                })
                .where(eq(guilds.id, interaction.guild.id));

            return interaction.editReply({
                embeds: [embeds.success(
                    'BytePods Disabled',
                    'BytePod creation has been disabled. Existing BytePods will remain active until members leave.\n\nTo re-enable, use `/bytepod setup` again.'
                )]
            });
        }

        if (subdomain === 'panel') {
            await interaction.deferReply();
            // Check if user owns a pod
            const userPod = await db.select().from(bytepods).where(eq(bytepods.ownerId, interaction.user.id)).get();
            // Also check if they are in the channel?
            if (!userPod) {
                return interaction.editReply({ embeds: [embeds.error('No Pod Found', 'You do not seem to have an active BytePod.')], flags: [MessageFlags.Ephemeral] });
            }

            const channel = interaction.guild.channels.cache.get(userPod.channelId);
            if (!channel) {
                return interaction.editReply({ embeds: [embeds.error('Error', 'Your BytePod channel was not found. It may have been deleted.')], flags: [MessageFlags.Ephemeral] });
            }

            // Delete old panel if it exists (prevent stale panels)
            if (userPod.panelMessageId) {
                try {
                    const oldPanel = await channel.messages.fetch(userPod.panelMessageId).catch(() => null);
                    if (oldPanel) {
                        await oldPanel.delete().catch(() => { });
                        logger.debug(`[BytePod] Deleted old panel ${userPod.panelMessageId} for ${interaction.user.tag}`);
                    }
                } catch (e) {
                    // Ignore errors - message may already be deleted
                }
            }

            // Get current state
            const { isLocked, limit, whitelist, coOwners } = getPodState(channel);
            const displayWhitelist = whitelist.filter(id => id !== interaction.user.id);
            const displayCoOwners = coOwners.filter(id => id !== interaction.user.id);

            const { embeds: panelEmbeds, components } = getControlPanel(channel.id, isLocked, limit, displayWhitelist, displayCoOwners);
            const panelMessage = await interaction.editReply({ embeds: panelEmbeds, components: components });

            // Store the new panel message ID for future cleanup
            await db.update(bytepods)
                .set({ panelMessageId: panelMessage.id })
                .where(eq(bytepods.channelId, userPod.channelId));

            return panelMessage;
        }

        if (group === 'preset') {
            if (subdomain === 'add') {
                const target = interaction.options.getUser('user');
                if (target.id === interaction.user.id) return interaction.reply({ content: "You can't whitelist yourself.", flags: [MessageFlags.Ephemeral] });

                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

                // Insert if not duplicate
                const result = await insertIfNotExists(
                    bytepodAutoWhitelist,
                    () => and(
                        eq(bytepodAutoWhitelist.userId, interaction.user.id),
                        eq(bytepodAutoWhitelist.guildId, interaction.guild.id),
                        eq(bytepodAutoWhitelist.targetUserId, target.id)
                    ),
                    {
                        userId: interaction.user.id,
                        guildId: interaction.guild.id,
                        targetUserId: target.id
                    },
                    { userId: interaction.user.id, targetUserId: target.id, operation: 'add-auto-whitelist' },
                    `${target} is already in your preset.`
                );

                if (!result.success) {
                    return interaction.editReply({ content: result.error });
                }

                return interaction.editReply({ embeds: [embeds.success('Preset Added', `Added ${target} to your auto-whitelist.`)] });
            }
            if (subdomain === 'remove') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                const target = interaction.options.getUser('user');
                await db.delete(bytepodAutoWhitelist)
                    .where(and(
                        eq(bytepodAutoWhitelist.userId, interaction.user.id),
                        eq(bytepodAutoWhitelist.guildId, interaction.guild.id),
                        eq(bytepodAutoWhitelist.targetUserId, target.id)
                    ));
                return interaction.editReply({ embeds: [embeds.success('Preset Removed', `Removed ${target} from your auto-whitelist.`)] });
            }
            if (subdomain === 'list') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                const presets = await db.select().from(bytepodAutoWhitelist)
                    .where(and(
                        eq(bytepodAutoWhitelist.userId, interaction.user.id),
                        eq(bytepodAutoWhitelist.guildId, interaction.guild.id)
                    ));
                const names = presets.map(p => `<@${p.targetUserId}>`).join(', ') || 'No users.';
                return interaction.editReply({ embeds: [embeds.info('Auto-Whitelist Presets', names)] });
            }
        }

        // --- STATS SUBCOMMAND ---
        if (subdomain === 'stats') {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            const target = interaction.options.getUser('user') ?? interaction.user;

            const stats = await db.select().from(bytepodVoiceStats)
                .where(and(
                    eq(bytepodVoiceStats.userId, target.id),
                    eq(bytepodVoiceStats.guildId, interaction.guild.id)
                )).get();

            if (!stats || stats.totalSeconds === 0) {
                return interaction.editReply({
                    embeds: [embeds.brand(`${target.username}'s BytePod Stats`, 'No voice activity recorded yet.')]
                });
            }

            const avgSeconds = Math.floor(stats.totalSeconds / stats.sessionCount);
            const embed = embeds.brand(`${target.username}'s BytePod Stats`, 'Voice activity in this server:')
                .addFields(
                    { name: '⏱️ Total Time', value: formatDuration(stats.totalSeconds), inline: true },
                    { name: '📊 Sessions', value: stats.sessionCount.toString(), inline: true },
                    { name: '📈 Avg Session', value: formatDuration(avgSeconds), inline: true }
                );

            return interaction.editReply({ embeds: [embed] });
        }

        // --- LEADERBOARD SUBCOMMAND ---
        if (subdomain === 'leaderboard') {
            await interaction.deferReply();

            const stats = await db.select().from(bytepodVoiceStats)
                .where(eq(bytepodVoiceStats.guildId, interaction.guild.id))
                .orderBy(desc(bytepodVoiceStats.totalSeconds))
                .limit(10);

            if (stats.length === 0) {
                return interaction.editReply({
                    embeds: [embeds.brand('🏆 BytePod Leaderboard', 'No voice activity recorded yet. Join a BytePod to get started!')]
                });
            }

            const medals = ['🥇', '🥈', '🥉'];
            const lines = [];

            for (let i = 0; i < stats.length; i++) {
                const stat = stats[i];
                const rank = medals[i] || `**${i + 1}.**`;
                const user = await interaction.client.users.fetch(stat.userId).catch(() => null);
                const username = user ? user.username : `Unknown (${stat.userId})`;
                const time = formatDuration(stat.totalSeconds);
                lines.push(`${rank} **${username}** — ${time} (${stat.sessionCount} sessions)`);
            }

            const embed = embeds.brand('🏆 BytePod Leaderboard', lines.join('\n'))
                .setFooter({ text: `Top ${stats.length} users by voice time` });

            return interaction.editReply({ embeds: [embed] });
        }

        // --- AUTOLOCK SUBCOMMAND ---
        if (subdomain === 'autolock') {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            const autolock = interaction.options.getBoolean('enabled');

            try {
                await db.insert(bytepodUserSettings).values({
                    userId: interaction.user.id,
                    guildId: interaction.guildId,
                    autoLock: autolock
                }).onConflictDoUpdate({
                    target: [bytepodUserSettings.userId, bytepodUserSettings.guildId],
                    set: { autoLock: autolock }
                });

                const description = autolock
                    ? '🔒 Your BytePods will now **auto-lock** when created (in this server).'
                    : '🔓 Your BytePods will now be **unlocked** when created (in this server).';

                return interaction.editReply({
                    embeds: [embeds.success('BytePod Settings Updated', description)]
                });

            } catch (error) {
                logger.error(`Error updating BytePod autolock for ${interaction.user.id}:`, error);
                return interaction.editReply({
                    embeds: [embeds.error('Settings Update Failed', 'There was an error saving your preferences. Please try again.')]
                });
            }
        }

        // --- TEMPLATE SUBCOMMAND GROUP ---
        if (group === 'template') {
            if (subdomain === 'save') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                const templateName = interaction.options.getString('name').trim().toLowerCase();

                // Check if user is in a BytePod they own
                const voiceChannel = interaction.member.voice.channel;
                if (!voiceChannel) {
                    return interaction.editReply({ embeds: [embeds.error('Not in Voice', 'You must be in your BytePod to save a template.')] });
                }

                const podData = await db.select().from(bytepods).where(eq(bytepods.channelId, voiceChannel.id)).get();
                if (!podData || podData.ownerId !== interaction.user.id) {
                    return interaction.editReply({ embeds: [embeds.error('Not Your Pod', 'You must be in a BytePod you own to save a template.')] });
                }

                // Get current state
                const { isLocked, limit, whitelist } = getPodState(voiceChannel);
                const whitelistJson = JSON.stringify(whitelist.filter(id => id !== interaction.user.id));

                // Upsert template (update if exists, insert if not)
                const result = await upsert(
                    bytepodTemplates,
                    () => and(
                        eq(bytepodTemplates.userId, interaction.user.id),
                        eq(bytepodTemplates.guildId, interaction.guild.id),
                        eq(bytepodTemplates.name, templateName)
                    ),
                    {
                        userLimit: limit,
                        autoLock: isLocked,
                        whitelistUserIds: whitelistJson
                    },
                    {
                        userId: interaction.user.id,
                        guildId: interaction.guild.id,
                        name: templateName,
                        userLimit: limit,
                        autoLock: isLocked,
                        whitelistUserIds: whitelistJson
                    },
                    { userId: interaction.user.id, templateName, operation: 'save-template' }
                );

                if (!result.success) {
                    return interaction.editReply({ embeds: [embeds.error('Error', 'Failed to save template.')] });
                }

                const action = result.created ? 'Saved' : 'Updated';
                return interaction.editReply({ embeds: [embeds.success(`Template ${action}`, `Template **${templateName}** has been ${action.toLowerCase()}.`)] });
            }

            if (subdomain === 'load') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                const templateName = interaction.options.getString('name').trim().toLowerCase();

                // Check if user is in a BytePod they own
                const voiceChannel = interaction.member.voice.channel;
                if (!voiceChannel) {
                    return interaction.editReply({ embeds: [embeds.error('Not in Voice', 'You must be in your BytePod to load a template.')] });
                }

                const podData = await db.select().from(bytepods).where(eq(bytepods.channelId, voiceChannel.id)).get();
                if (!podData || podData.ownerId !== interaction.user.id) {
                    return interaction.editReply({ embeds: [embeds.error('Not Your Pod', 'You must be in a BytePod you own to load a template.')] });
                }

                // Fetch template
                const template = await db.select().from(bytepodTemplates)
                    .where(and(
                        eq(bytepodTemplates.userId, interaction.user.id),
                        eq(bytepodTemplates.guildId, interaction.guild.id),
                        eq(bytepodTemplates.name, templateName)
                    )).get();

                if (!template) {
                    return interaction.editReply({ embeds: [embeds.error('Not Found', `Template **${templateName}** does not exist.`)] });
                }

                // Apply settings
                await voiceChannel.setUserLimit(template.userLimit);
                await voiceChannel.permissionOverwrites.edit(interaction.guild.id, {
                    Connect: template.autoLock ? false : null
                });

                // Apply whitelist
                const whitelistIds = template.whitelistUserIds ? JSON.parse(template.whitelistUserIds) : [];
                for (const userId of whitelistIds) {
                    try {
                        await voiceChannel.permissionOverwrites.edit(userId, { Connect: true });
                    } catch (e) {
                        // User may no longer exist or be fetchable
                    }
                }

                return interaction.editReply({ embeds: [embeds.success('Template Loaded', `Template **${templateName}** has been applied to your BytePod.`)] });
            }

            if (subdomain === 'list') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                const templates = await db.select().from(bytepodTemplates)
                    .where(and(
                        eq(bytepodTemplates.userId, interaction.user.id),
                        eq(bytepodTemplates.guildId, interaction.guild.id)
                    ));

                if (templates.length === 0) {
                    return interaction.editReply({ embeds: [embeds.brand('Your Templates', 'You have no saved templates.')] });
                }

                const description = templates.map(t => {
                    const whitelistCount = t.whitelistUserIds ? JSON.parse(t.whitelistUserIds).length : 0;
                    return `**${t.name}** - Limit: ${t.userLimit}, Lock: ${t.autoLock ? 'Yes' : 'No'}, Whitelist: ${whitelistCount} users`;
                }).join('\n');

                return interaction.editReply({ embeds: [embeds.brand('Your Templates', description)] });
            }

            if (subdomain === 'delete') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                const templateName = interaction.options.getString('name').trim().toLowerCase();

                const result = await db.delete(bytepodTemplates)
                    .where(and(
                        eq(bytepodTemplates.userId, interaction.user.id),
                        eq(bytepodTemplates.guildId, interaction.guild.id),
                        eq(bytepodTemplates.name, templateName)
                    ));

                // Drizzle doesn't return affected rows easily, so we just confirm
                return interaction.editReply({ embeds: [embeds.success('Template Deleted', `Template **${templateName}** has been deleted (if it existed).`)] });
            }
        }
    },

    // --- INTERACTION HANDLER ---
    async handleInteraction(interaction) {
        const channel = interaction.channel;
        const { customId } = interaction;

        try {
            // Fetch pod data first
            const podData = await db.select().from(bytepods).where(eq(bytepods.channelId, channel.id)).get();
            if (!podData) {
                return interaction.reply({ content: 'This channel is not a valid BytePod.', flags: [MessageFlags.Ephemeral] });
            }

            logger.debug(`BytePod interaction: ${customId} by ${interaction.user.tag} in ${channel.id}`);

            // --- RECLAIM REQUEST HANDLERS (before ownership check) ---
            // These can be used by people who are NOT the current owner

            if (customId.startsWith('bytepod_reclaim_request_')) {
                // Original owner clicking "Request Ownership Back"
                const parts = customId.split('_');
                const requesterId = parts[4]; // bytepod_reclaim_request_channelId_requesterId

                if (interaction.user.id !== requesterId) {
                    return interaction.reply({ content: 'This button is not for you!', flags: [MessageFlags.Ephemeral] });
                }

                if (podData.originalOwnerId !== requesterId) {
                    return interaction.reply({ content: 'Only the original creator can request ownership back.', flags: [MessageFlags.Ephemeral] });
                }

                // Use reply instead of deferUpdate to avoid voice reconnect issue
                await interaction.reply({
                    content: '✅ Request sent to the current owner!',
                    flags: [MessageFlags.Ephemeral]
                });

                // Send request to current owner with Accept/Deny buttons
                const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

                const decisionRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`bytepod_reclaim_accept_${channel.id}_${requesterId}`)
                        .setLabel('Accept')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('✅'),
                    new ButtonBuilder()
                        .setCustomId(`bytepod_reclaim_deny_${channel.id}_${requesterId}`)
                        .setLabel('Deny')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('❌')
                );

                try {
                    await channel.send({
                        content: `<@${podData.ownerId}>`,
                        embeds: [embeds.warn('Ownership Request', `<@${requesterId}> (the original creator) is requesting ownership of this BytePod back.`)],
                        components: [decisionRow]
                    });

                    // Update the original message to disable the button (prevents duplicate requests)
                    await interaction.message.edit({
                        components: [] // Remove all buttons
                    }).catch(() => { });
                } catch (e) {
                    logger.error(`Failed to send reclaim request: ${e.message}`);
                }
                return;
            }

            if (customId.startsWith('bytepod_reclaim_accept_')) {
                const parts = customId.split('_');
                const requesterId = parts[4];

                // Only current owner can accept
                if (interaction.user.id !== podData.ownerId) {
                    return interaction.reply({ content: 'Only the current owner can accept this request.', flags: [MessageFlags.Ephemeral] });
                }

                await interaction.deferUpdate();

                try {
                    // Transfer ownership back
                    const oldOwnerId = podData.ownerId;

                    // Capture current whitelist and co-owners BEFORE making any changes
                    const currentState = getPodState(channel);
                    const whitelistUsers = currentState.whitelist.filter(id => id !== oldOwnerId && id !== requesterId);
                    const coOwnerUsers = currentState.coOwners.filter(id => id !== oldOwnerId && id !== requesterId);
                    const isLocked = currentState.isLocked;
                    const userLimit = currentState.limit;

                    // Check if old owner had Connect permission
                    const oldOwnerOverwrite = channel.permissionOverwrites.cache.get(oldOwnerId);
                    const oldOwnerHadConnect = oldOwnerOverwrite?.allow.has(PermissionFlagsBits.Connect) ?? false;

                    // Update database - clear pending flag and transfer ownership
                    await db.update(bytepods)
                        .set({
                            ownerId: requesterId,
                            reclaimRequestPending: false
                        })
                        .where(eq(bytepods.channelId, channel.id));

                    // Update permissions - preserve old owner's Connect if they had it
                    if (oldOwnerHadConnect) {
                        await channel.permissionOverwrites.edit(oldOwnerId, {
                            Connect: true,
                            ManageChannels: null,
                            MoveMembers: null
                        }).catch(() => { });
                    } else {
                        await channel.permissionOverwrites.edit(oldOwnerId, {
                            ManageChannels: null,
                            MoveMembers: null
                        }).catch(() => { });
                    }

                    // Grant full permissions to new owner (requester)
                    await channel.permissionOverwrites.edit(requesterId, {
                        Connect: true,
                        ManageChannels: true,
                        MoveMembers: true
                    });

                    // Preserve whitelist entries
                    for (const userId of whitelistUsers) {
                        try {
                            await channel.permissionOverwrites.edit(userId, { Connect: true });
                        } catch (e) {
                            logger.warn(`Failed to preserve whitelist for ${userId} during reclaim: ${e.message}`);
                        }
                    }

                    // Preserve co-owner entries
                    for (const userId of coOwnerUsers) {
                        try {
                            await channel.permissionOverwrites.edit(userId, {
                                Connect: true,
                                ManageChannels: true,
                                MoveMembers: true
                            });
                        } catch (e) {
                            logger.warn(`Failed to preserve co-owner permissions for ${userId} during reclaim: ${e.message}`);
                        }
                    }

                    // Preserve lock state (@everyone overwrite)
                    try {
                        await channel.permissionOverwrites.edit(interaction.guild.id, {
                            Connect: isLocked ? false : null
                        });
                    } catch (e) {
                        logger.warn(`Failed to preserve lock state during reclaim: ${e.message}`);
                    }

                    // Preserve user limit
                    try {
                        await channel.setUserLimit(userLimit);
                    } catch (e) {
                        logger.warn(`Failed to preserve user limit during reclaim: ${e.message}`);
                    }

                    // Notify and cleanup
                    await channel.send({
                        embeds: [embeds.success('Ownership Transferred', `<@${oldOwnerId}> accepted the request. <@${requesterId}> is now the owner.`)],
                        content: `<@${requesterId}>, run \`/bytepod panel\` to access controls.`
                    });

                    await interaction.message.delete().catch(() => { });
                } catch (e) {
                    logger.error(`Failed to transfer ownership: ${e.message}`);
                    await interaction.followUp({ content: 'Failed to transfer ownership.', flags: [MessageFlags.Ephemeral] });
                }
                return;
            }

            if (customId.startsWith('bytepod_reclaim_deny_')) {
                const parts = customId.split('_');
                const requesterId = parts[4];

                // Only current owner can deny
                if (interaction.user.id !== podData.ownerId) {
                    return interaction.reply({ content: 'Only the current owner can deny this request.', flags: [MessageFlags.Ephemeral] });
                }

                await interaction.deferUpdate();

                // Clear pending flag in database
                await db.update(bytepods)
                    .set({ reclaimRequestPending: false })
                    .where(eq(bytepods.channelId, channel.id));

                await channel.send({
                    embeds: [embeds.error('Request Denied', `<@${podData.ownerId}> denied the ownership request from <@${requesterId}>.`)]
                });

                await interaction.message.delete().catch(() => { });
                return;
            }

            // --- STANDARD CONTROLS (require ownership) ---
            const isOwner = podData.ownerId === interaction.user.id;
            const isCoOwner = channel.permissionOverwrites.cache.get(interaction.user.id)?.allow.has(PermissionFlagsBits.ManageChannels);

            if (!isOwner && !isCoOwner) {
                return interaction.reply({ content: 'You do not have permission to control this BytePod.', flags: [MessageFlags.Ephemeral] });
            }

            const panelId = interaction.message?.id; // Available for buttons on the panel (not for ephemeral menu submits)

            // Helper to update specific panel
            const updatePanel = async (messageId) => {
                if (!messageId) {
                    logger.warn(`[BytePod] updatePanel called with no messageId`);
                    return;
                }

                logger.debug(`[BytePod] Attempting to update panel ${messageId}`);
                const msg = await channel.messages.fetch(messageId).catch((err) => {
                    logger.warn(`[BytePod] Failed to fetch message ${messageId}: ${err.message}`);
                    return null;
                });

                if (!msg) {
                    logger.warn(`[BytePod] Panel message ${messageId} not found`);
                    return;
                }

                const { isLocked, limit, whitelist, coOwners } = getPodState(channel);
                const displayWhitelist = whitelist.filter(id => id !== podData.ownerId);
                const displayCoOwners = coOwners.filter(id => id !== podData.ownerId);

                const { embeds: e, components } = getControlPanel(channel.id, isLocked, limit, displayWhitelist, displayCoOwners);

                try {
                    await msg.edit({ embeds: e, components });
                    logger.debug(`[BytePod] Successfully updated panel ${messageId}`);
                } catch (error) {
                    // Message was deleted or no longer exists - silently fail
                    if (error.code === 10008 || error.code === 10003) {
                        logger.debug(`[BytePod] Panel message ${messageId} was deleted, skipping update`);
                        return;
                    }
                    throw error; // Re-throw other errors
                }
            };

            // BUTTONS
            if (customId === 'bytepod_toggle_lock') {
                await interaction.deferUpdate(); // Defer first to prevent timeout
                try {
                    const isLocked = channel.permissionOverwrites.cache.get(interaction.guild.id)?.deny.has(PermissionFlagsBits.Connect);
                    await channel.permissionOverwrites.edit(interaction.guild.id, {
                        Connect: isLocked ? null : false
                    });

                    // Calculate new state directly (cache may not have updated yet)
                    const newLock = !isLocked;
                    const { limit, whitelist, coOwners } = getPodState(channel);
                    const displayWhitelist = whitelist.filter(id => id !== podData.ownerId);
                    const displayCoOwners = coOwners.filter(id => id !== podData.ownerId);
                    const { embeds: e, components } = getControlPanel(channel.id, newLock, limit, displayWhitelist, displayCoOwners);
                    await interaction.editReply({ embeds: e, components });
                } catch (error) {
                    if (error.code === 10003) return interaction.followUp({ content: 'This BytePod channel no longer exists.', flags: [MessageFlags.Ephemeral] });
                    throw error;
                }
            }

            if (customId === 'bytepod_whitelist_menu_open') {
                const row = new ActionRowBuilder().addComponents(
                    new UserSelectMenuBuilder()
                        .setCustomId(`bytepod_whitelist_select_${panelId}`) // Pass Panel ID
                        .setPlaceholder('Select users to whitelist/remove')
                        .setMinValues(1)
                        .setMaxValues(10)
                );
                await interaction.reply({ content: 'Select users:', components: [row], flags: [MessageFlags.Ephemeral] });
            }

            if (customId === 'bytepod_coowner_menu_open') {
                if (!isOwner) return interaction.reply({ content: 'Only the Owner can add Co-Owners.', flags: [MessageFlags.Ephemeral] });
                const row = new ActionRowBuilder().addComponents(
                    new UserSelectMenuBuilder()
                        .setCustomId(`bytepod_coowner_select_${panelId}`) // Pass Panel ID
                        .setPlaceholder('Select a user to make Co-Owner')
                        .setMinValues(1)
                        .setMaxValues(1)
                );
                await interaction.reply({ content: 'Select Co-Owner:', components: [row], flags: [MessageFlags.Ephemeral] });
            }

            if (customId === 'bytepod_rename') {
                await interaction.showModal(getRenameModal());
            }

            if (customId === 'bytepod_rename_modal') {
                const newName = interaction.fields.getTextInputValue('bytepod_rename_input').trim();
                if (newName.length === 0) return interaction.reply({ content: 'Name cannot be empty.', flags: [MessageFlags.Ephemeral] });

                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                await channel.setName(newName);
                await interaction.editReply({ content: `Renamed channel to **${newName}**.` });
            }

            if (customId === 'bytepod_limit') {
                const modal = getLimitModal();
                modal.setCustomId(`bytepod_limit_modal_${panelId}`);
                await interaction.showModal(modal);
            }

            if (customId === 'bytepod_kick_menu_open') {
                const row = new ActionRowBuilder().addComponents(
                    new UserSelectMenuBuilder()
                        .setCustomId(`bytepod_kick_select_${panelId}`)
                        .setPlaceholder('Select user to kick')
                        .setMinValues(1)
                        .setMaxValues(1)
                );
                await interaction.reply({ content: 'Select user to kick:', components: [row], flags: [MessageFlags.Ephemeral] });
            }

            // DYNAMIC HANDLERS
            if (customId.startsWith('bytepod_whitelist_select')) {
                const targetPanelId = customId.split('_')[3];
                const resolvedUsers = [];
                let anyNew = false;

                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

                // 1. Resolve Users & Determine Intent
                for (const id of interaction.values) {
                    // Safety: Prevent Owner from modifying themselves via this menu
                    if (id === podData.ownerId) continue;

                    try {
                        const member = await interaction.guild.members.fetch(id).catch(() => null);
                        const user = member ? member.user : await interaction.client.users.fetch(id).catch(() => null);

                        if (user) {
                            resolvedUsers.push(user);
                            const currentPerms = channel.permissionOverwrites.cache.get(user.id);
                            // If user does not have an overwrite OR does not have Connect Allow
                            if (!currentPerms || !currentPerms.allow.has(PermissionFlagsBits.Connect)) {
                                anyNew = true;
                            }
                        }
                    } catch (e) {
                        logger.warn(`Failed to resolve user ${id}:`, e.message);
                    }
                }

                // 2. Execute Batch Action
                const modified = [];
                const action = anyNew ? 'add' : 'remove';

                for (const user of resolvedUsers) {
                    try {
                        if (action === 'add') {
                            await channel.permissionOverwrites.edit(user, { Connect: true });
                            modified.push(`${user}`);
                        } else {
                            // Only delete if they exist to avoid errors? delete is safe usually.
                            await channel.permissionOverwrites.delete(user.id);
                            modified.push(`${user}`);
                        }
                    } catch (e) {
                        if (e.code === 10003) return interaction.editReply({ content: 'Channel deleted.' });
                        logger.warn(`Failed to modify permissions: ${e.message}`);
                    }
                }

                const msg = action === 'add'
                    ? `Whitelisted: ${modified.join(', ')}`
                    : `Removed: ${modified.join(', ')}`;

                await interaction.editReply({ content: msg || 'No valid users selected.' });
                // Small delay to allow permission cache to update
                setTimeout(() => updatePanel(targetPanelId), 100);
            }

            if (customId.startsWith('bytepod_coowner_select')) {
                if (!isOwner) return interaction.reply({ content: 'Only the Owner can manage Co-Owners.', flags: [MessageFlags.Ephemeral] });
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                const targetPanelId = customId.split('_')[3];
                const targetId = interaction.values[0];
                try {
                    await channel.permissionOverwrites.edit(targetId, { ManageChannels: true, MoveMembers: true, Connect: true });
                    await interaction.editReply({ content: `<@${targetId}> is now a Co-Owner.` });
                    // Small delay to allow permission cache to update
                    setTimeout(() => updatePanel(targetPanelId), 100);
                } catch (e) {
                    if (e.code === 10003) return interaction.editReply({ content: 'Channel deleted.' });
                    throw e;
                }
            }

            if (customId.startsWith('bytepod_kick_select')) {
                const targetPanelId = customId.split('_')[3];
                const targetId = interaction.values[0];
                if (targetId === podData.ownerId) return interaction.reply({ content: 'You cannot kick the Owner.', flags: [MessageFlags.Ephemeral] });

                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                const member = await interaction.guild.members.fetch(targetId);
                if (member && member.voice.channelId === channel.id) {
                    await member.voice.disconnect('Kicked from BytePod');
                    try {
                        await channel.permissionOverwrites.edit(targetId, { Connect: false });
                    } catch (e) { }
                    await interaction.editReply({ content: `Kicked and blocked <@${targetId}>.` });
                    // Small delay to allow permission cache to update
                    setTimeout(() => updatePanel(targetPanelId), 100);
                } else {
                    await interaction.editReply({ content: `User is not in the voice channel.` });
                }
            }

            // MODALS

            if (customId.startsWith('bytepod_limit_modal')) {
                const targetPanelId = customId.split('_')[3];
                const limitStr = interaction.fields.getTextInputValue('bytepod_limit_input');
                const limit = parseInt(limitStr);
                if (isNaN(limit) || limit < 0 || limit > 99) return interaction.reply({ content: 'Invalid limit (0-99).', flags: [MessageFlags.Ephemeral] });

                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                await channel.setUserLimit(limit);
                await interaction.editReply({ content: `Limit set to ${limit}.` });
                // Small delay to allow cache to update
                setTimeout(() => updatePanel(targetPanelId), 100);
            }

        } catch (error) {
            // Handle stale control panel interactions gracefully
            if (error.code === 10062) {
                logger.info(`Stale control panel interaction (${interaction.customId}) - user clicked old panel, ignoring`);
                return; // Silently ignore - user will see "this interaction failed" which is expected for old panels
            }

            logger.errorContext('BytePod interaction failed', error, {
                customId: interaction.customId,
                user: interaction.user.tag,
                channel: interaction.channel.id,
                replied: interaction.replied,
                deferred: interaction.deferred
            });

            // Try to send an error message if possible
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: '❌ Something went wrong with this control. Please try `/bytepod panel` to get a fresh control panel.',
                        flags: [MessageFlags.Ephemeral]
                    });
                } else if (interaction.deferred) {
                    await interaction.editReply({
                        content: '❌ Something went wrong with this control. Please try `/bytepod panel` to get a fresh control panel.'
                    });
                }
            } catch (e) {
                // Failed to send error message, user will see "interaction failed"
                logger.error(`Could not send error message: ${e.message}`);
            }
        }
    }
};
