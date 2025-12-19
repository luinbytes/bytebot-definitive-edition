const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, UserSelectMenuBuilder, MessageFlags } = require('discord.js');
const { db } = require('../../database');
const { guilds, bytepods, bytepodAutoWhitelist, bytepodUserSettings } = require('../../database/schema');
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
                        .setDescription('View your current auto-whitelist.'))
                .addSubcommand(sub =>
                    sub.setName('autolock')
                        .setDescription('Set whether your BytePods should automatically lock on creation.')
                        .addBooleanOption(option => option.setName('enabled').setDescription('Enable or disable auto-lock').setRequired(true)))),

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

        if (subdomain === 'panel') {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            // Check if user owns a pod
            const userPod = await db.select().from(bytepods).where(eq(bytepods.ownerId, interaction.user.id)).get();
            // Also check if they are in the channel?
            if (!userPod) {
                return interaction.editReply({ embeds: [embeds.error('No Pod Found', 'You do not seem to have an active BytePod.')] });
            }

            const channel = interaction.guild.channels.cache.get(userPod.channelId);
            if (!channel) {
                return interaction.editReply({ embeds: [embeds.error('Error', 'Your BytePod channel was not found. It may have been deleted.')] });
            }

            // Get current state
            const { isLocked, limit, whitelist, coOwners } = getPodState(channel);
            const displayWhitelist = whitelist.filter(id => id !== interaction.user.id);
            const displayCoOwners = coOwners.filter(id => id !== interaction.user.id);

            const { embeds: panelEmbeds, components } = getControlPanel(channel.id, isLocked, limit, displayWhitelist, displayCoOwners);
            return interaction.editReply({ embeds: panelEmbeds, components: components });
        }

        if (group === 'preset') {
            if (subdomain === 'add') {
                const target = interaction.options.getUser('user');
                if (target.id === interaction.user.id) return interaction.reply({ content: "You can't whitelist yourself.", flags: [MessageFlags.Ephemeral] });

                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                // Check duplicate
                const existing = await db.select().from(bytepodAutoWhitelist)
                    .where(and(
                        eq(bytepodAutoWhitelist.userId, interaction.user.id),
                        eq(bytepodAutoWhitelist.targetUserId, target.id)
                    )).get();

                if (existing) return interaction.editReply({ content: `${target} is already in your preset.` });

                await db.insert(bytepodAutoWhitelist).values({
                    userId: interaction.user.id,
                    targetUserId: target.id
                });
                return interaction.editReply({ embeds: [embeds.success('Preset Added', `Added ${target} to your auto-whitelist.`)] });
            }
            if (subdomain === 'remove') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                const target = interaction.options.getUser('user');
                await db.delete(bytepodAutoWhitelist)
                    .where(and(
                        eq(bytepodAutoWhitelist.userId, interaction.user.id),
                        eq(bytepodAutoWhitelist.targetUserId, target.id)
                    ));
                return interaction.editReply({ embeds: [embeds.success('Preset Removed', `Removed ${target} from your auto-whitelist.`)] });
            }
            if (subdomain === 'list') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                const presets = await db.select().from(bytepodAutoWhitelist).where(eq(bytepodAutoWhitelist.userId, interaction.user.id));
                const names = presets.map(p => `<@${p.targetUserId}>`).join(', ') || 'No users.';
                return interaction.editReply({ embeds: [embeds.info('Auto-Whitelist Presets', names)] });
            }
            if (subdomain === 'autolock') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                const enabled = interaction.options.getBoolean('enabled');
                await db.insert(bytepodUserSettings).values({
                    userId: interaction.user.id,
                    autoLock: enabled
                }).onConflictDoUpdate({
                    target: bytepodUserSettings.userId,
                    set: { autoLock: enabled }
                });
                return interaction.editReply({ embeds: [embeds.success('Settings Updated', `Auto-Lock is now **${enabled ? 'Enabled' : 'Disabled'}**.`)] });
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
        // Strict check: Only count as Co-Owner if they have an EXPLICIT allow overwrite for ManageChannels on this channel.
        // This prevents global Admins/Mods from bypassing the "Co-Owner" list logic if that's intended, 
        // effectively locking controls to the Pod Owner and their chosen Delegates.
        const isCoOwner = channel.permissionOverwrites.cache.get(interaction.user.id)?.allow.has(PermissionFlagsBits.ManageChannels);

        if (!isOwner && !isCoOwner) {
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
                        console.error(`Failed to resolve user ${id}:`, e);
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
                        console.error(e);
                    }
                }

                const msg = action === 'add'
                    ? `Whitelisted: ${modified.join(', ')}`
                    : `Removed: ${modified.join(', ')}`;

                await interaction.editReply({ content: msg || 'No valid users selected.' });
                await updatePanel(targetPanelId);
            }

            if (customId.startsWith('bytepod_coowner_select')) {
                if (!isOwner) return interaction.reply({ content: 'Only the Owner can manage Co-Owners.', flags: [MessageFlags.Ephemeral] });
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                const targetPanelId = customId.split('_')[3];
                const targetId = interaction.values[0];
                try {
                    await channel.permissionOverwrites.edit(targetId, { ManageChannels: true, MoveMembers: true, Connect: true });
                    await interaction.editReply({ content: `<@${targetId}> is now a Co-Owner.` });
                    await updatePanel(targetPanelId);
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
                    await updatePanel(targetPanelId);
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
                await updatePanel(targetPanelId);
            }

        } catch (error) {
            console.error(error);
            if (!interaction.replied) await interaction.reply({ content: 'action failed.', flags: [MessageFlags.Ephemeral] });
        }
    }
};
