const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, UserSelectMenuBuilder, MessageFlags } = require('discord.js');
const { db } = require('../../database');
const { guilds, bytepods, bytepodAutoWhitelist } = require('../../database/schema');
const { eq, and } = require('drizzle-orm');
const embeds = require('../../utils/embeds');
const { getControlPanel, getRenameModal, getLimitModal } = require('../../components/bytepodControls');

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
                        .setDescription('View your current auto-whitelist.'))),

    async execute(interaction) {
        const subdomain = interaction.options.getSubcommand();
        const group = interaction.options.getSubcommandGroup();

        if (subdomain === 'setup') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ embeds: [embeds.error('Permission Denied', 'Only Administrators can use this command.')], flags: [MessageFlags.Ephemeral] });
            }

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

            return interaction.reply({ embeds: [embeds.success('Setup Complete', `BytePod Hub set to ${channel}. New pods will be created in ${category ? category : 'the same category as the Hub'}.`)] });
        }

        if (subdomain === 'panel') {
            // Check if user owns a pod
            const userPod = await db.select().from(bytepods).where(eq(bytepods.ownerId, interaction.user.id)).get();
            // Also check if they are in the channel?
            if (!userPod) {
                return interaction.reply({ embeds: [embeds.error('No Pod Found', 'You do not seem to have an active BytePod.')], flags: [MessageFlags.Ephemeral] });
            }

            const channel = interaction.guild.channels.cache.get(userPod.channelId);
            if (!channel) {
                return interaction.reply({ embeds: [embeds.error('Error', 'Your BytePod channel was not found. It may have been deleted.')], flags: [MessageFlags.Ephemeral] });
            }

            // Get current state
            const { isLocked, limit, whitelist, coOwners } = getPodState(channel);
            // Optional: Filter out logic if needed, but getPodState handles basic logic.
            // Owner is not in stored whitelist usually if implicit, but if they are there, filter them?
            // Actually bytepods.ownerId tells us who the owner is.
            const displayWhitelist = whitelist.filter(id => id !== interaction.user.id);
            const displayCoOwners = coOwners.filter(id => id !== interaction.user.id);

            const { embeds: panelEmbeds, components } = getControlPanel(channel.id, isLocked, limit, displayWhitelist, displayCoOwners);
            return interaction.reply({ embeds: panelEmbeds, components: components });
        }

        if (group === 'preset') {
            if (subdomain === 'add') {
                const target = interaction.options.getUser('user');
                if (target.id === interaction.user.id) return interaction.reply({ content: "You can't whitelist yourself.", flags: [MessageFlags.Ephemeral] });

                // Check duplicate
                const existing = await db.select().from(bytepodAutoWhitelist)
                    .where(and(
                        eq(bytepodAutoWhitelist.userId, interaction.user.id),
                        eq(bytepodAutoWhitelist.targetUserId, target.id)
                    )).get();

                if (existing) return interaction.reply({ content: `${target} is already in your preset.`, flags: [MessageFlags.Ephemeral] });

                await db.insert(bytepodAutoWhitelist).values({
                    userId: interaction.user.id,
                    targetUserId: target.id
                });
                return interaction.reply({ embeds: [embeds.success('Preset Added', `Added ${target} to your auto-whitelist.`)], flags: [MessageFlags.Ephemeral] });
            }
            if (subdomain === 'remove') {
                const target = interaction.options.getUser('user');
                await db.delete(bytepodAutoWhitelist)
                    .where(and(
                        eq(bytepodAutoWhitelist.userId, interaction.user.id),
                        eq(bytepodAutoWhitelist.targetUserId, target.id)
                    ));
                return interaction.reply({ embeds: [embeds.success('Preset Removed', `Removed ${target} from your auto-whitelist.`)], flags: [MessageFlags.Ephemeral] });
            }
            if (subdomain === 'list') {
                const presets = await db.select().from(bytepodAutoWhitelist).where(eq(bytepodAutoWhitelist.userId, interaction.user.id));
                const names = presets.map(p => `<@${p.targetUserId}>`).join(', ') || 'No users.';
                return interaction.reply({ embeds: [embeds.info('Auto-Whitelist Presets', names)], flags: [MessageFlags.Ephemeral] });
            }
        }
    },

    // --- INTERACTION HANDLER ---
    async handleInteraction(interaction) {
        // Verify ownership/permissions
        const channel = interaction.channel;

        // We need to check if this channel is a valid BytePod TO SECURE IT.
        const podData = await db.select().from(bytepods).where(eq(bytepods.channelId, channel.id)).get();
        if (!podData) {
            return interaction.reply({ content: 'This channel is not a valid BytePod.', flags: [MessageFlags.Ephemeral] });
        }

        const isOwner = podData.ownerId === interaction.user.id;
        const isCoOwner = channel.permissionsFor(interaction.user).has(PermissionFlagsBits.ManageChannels);

        // Check permissions based on the base ID (remove dynamic part)
        const baseCustomId = interaction.customId.split('_').slice(0, 3).join('_'); // bytepod_whitelist_select_... -> bytepod_whitelist_select
        const isPublicInteraction = ['bytepod_whitelist_select', 'bytepod_whitelist_menu_open'].includes(baseCustomId) || ['bytepod_whitelist_select', 'bytepod_whitelist_menu_open'].includes(interaction.customId);

        if (!isOwner && !isCoOwner && !isPublicInteraction) {
            return interaction.reply({ content: 'You do not have permission to control this BytePod.', flags: [MessageFlags.Ephemeral] });
        }

        const { customId } = interaction;
        const panelId = interaction.message?.id; // Available for buttons on the panel (not for ephemeral menu submits)

        // Helper to update specific panel
        const updatePanel = async (messageId) => {
            if (!messageId) return;
            const msg = await channel.messages.fetch(messageId).catch(() => null);
            if (!msg) return;

            const { isLocked, limit, whitelist, coOwners } = getPodState(channel);
            // We need permission data for getControlPanel.
            // But getPodState returns whitelist array.
            // Oh wait, PodData.ownerId is needed.
            const displayWhitelist = whitelist.filter(id => id !== podData.ownerId);
            const displayCoOwners = coOwners.filter(id => id !== podData.ownerId);

            const { embeds: e, components } = getControlPanel(channel.id, isLocked, limit, displayWhitelist, displayCoOwners);
            await msg.edit({ embeds: e, components });
        };


        try {
            // BUTTONS
            if (customId === 'bytepod_toggle_lock') {
                try {
                    const isLocked = channel.permissionOverwrites.cache.get(interaction.guild.id)?.deny.has(PermissionFlagsBits.Connect);
                    await channel.permissionOverwrites.edit(interaction.guild.id, {
                        Connect: isLocked ? null : false
                    });

                    // Update via update() since we are on the button
                    const { isLocked: newLock, limit, whitelist, coOwners } = getPodState(channel);
                    const displayWhitelist = whitelist.filter(id => id !== podData.ownerId);
                    const displayCoOwners = coOwners.filter(id => id !== podData.ownerId);
                    const { embeds: e, components } = getControlPanel(channel.id, newLock, limit, displayWhitelist, displayCoOwners);
                    await interaction.update({ embeds: e, components });
                } catch (error) {
                    if (error.code === 10003) return interaction.reply({ content: 'This BytePod channel no longer exists.', flags: [MessageFlags.Ephemeral] });
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
                const added = [];
                const removed = [];

                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

                for (const targetId of interaction.values) {
                    try {
                        const hasPerm = channel.permissionOverwrites.cache.get(targetId)?.allow.has(PermissionFlagsBits.Connect);
                        if (hasPerm) {
                            await channel.permissionOverwrites.delete(targetId);
                            removed.push(targetId);
                        } else {
                            await channel.permissionOverwrites.edit(targetId, { Connect: true });
                            added.push(targetId);
                        }
                    } catch (error) {
                        if (error.code === 10003) return interaction.editReply({ content: 'Channel deleted.' });
                        throw error;
                    }
                }

                let msg = '';
                if (added.length) msg += `Whitelisted: ${added.map(id => `<@${id}>`).join(', ')}. `;
                if (removed.length) msg += `Removed: ${removed.map(id => `<@${id}>`).join(', ')}.`;

                await interaction.editReply({ content: msg || 'No changes made.' });
                await updatePanel(targetPanelId);
            }

            if (customId.startsWith('bytepod_coowner_select')) {
                const targetPanelId = customId.split('_')[3];
                const targetId = interaction.values[0];
                try {
                    await channel.permissionOverwrites.edit(targetId, { ManageChannels: true, MoveMembers: true, Connect: true });
                    await interaction.reply({ content: `<@${targetId}> is now a Co-Owner.`, flags: [MessageFlags.Ephemeral] });
                    await updatePanel(targetPanelId);
                } catch (e) {
                    if (e.code === 10003) return interaction.reply({ content: 'Channel deleted.', flags: [MessageFlags.Ephemeral] });
                    throw e;
                }
            }

            if (customId.startsWith('bytepod_kick_select')) {
                const targetPanelId = customId.split('_')[3];
                const targetId = interaction.values[0];
                const member = await interaction.guild.members.fetch(targetId);
                if (member && member.voice.channelId === channel.id) {
                    await member.voice.disconnect('Kicked from BytePod');
                    try {
                        await channel.permissionOverwrites.edit(targetId, { Connect: false });
                    } catch (e) { }
                    await interaction.reply({ content: `Kicked and blocked <@${targetId}>.`, flags: [MessageFlags.Ephemeral] });
                    await updatePanel(targetPanelId);
                } else {
                    await interaction.reply({ content: `User is not in the voice channel.`, flags: [MessageFlags.Ephemeral] });
                }
            }

            // MODALS
            if (customId === 'bytepod_rename_modal') {
                const newName = interaction.fields.getTextInputValue('bytepod_rename_input');
                await channel.setName(newName);
                await interaction.reply({ content: `Renamed channel to **${newName}**.`, flags: [MessageFlags.Ephemeral] });
            }

            if (customId.startsWith('bytepod_limit_modal')) {
                const targetPanelId = customId.split('_')[3];
                const limitStr = interaction.fields.getTextInputValue('bytepod_limit_input');
                const limit = parseInt(limitStr);
                if (isNaN(limit) || limit < 0 || limit > 99) return interaction.reply({ content: 'Invalid limit (0-99).', flags: [MessageFlags.Ephemeral] });

                await channel.setUserLimit(limit);
                await interaction.reply({ content: `Limit set to ${limit}.`, flags: [MessageFlags.Ephemeral] });
                await updatePanel(targetPanelId);
            }

        } catch (error) {
            console.error(error);
            if (!interaction.replied) await interaction.reply({ content: 'action failed.', flags: [MessageFlags.Ephemeral] });
        }
    }
};
