const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const embeds = require('../utils/embeds');

function getControlPanel(channelId, isLocked = false, userLimit = 0, whitelist = [], coOwners = []) {
    const embed = embeds.success(
        'BytePod Controls',
        'Manage your voice channel using the buttons below.\n\n' +
        '🔒 **Lock/Unlock**: Prevent others from joining.\n' +
        '👋 **Un/Whitelist**: Allow specific users to join (bypasses lock).\n' +
        '👥 **Co-Owner**: Grant another user control over this Pod.\n' +
        '🔢 **Limit**: Set a user limit.\n' +
        '🚫 **Kick**: Remove a user from the channel.\n'
    )
        .addFields(
            { name: 'Status', value: isLocked ? '🔒 **Locked**' : '🔓 **Open**', inline: true },
            { name: 'Limit', value: userLimit === 0 ? '∞' : `${userLimit}`, inline: true },
            { name: 'Whitelisted', value: whitelist.length ? whitelist.map(id => `<@${id}>`).join(', ') : 'None', inline: false },
            { name: 'Co-Owners', value: coOwners.length ? coOwners.map(id => `<@${id}>`).join(', ') : 'None', inline: false }
        );

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('bytepod_toggle_lock')
            .setEmoji(isLocked ? '🔓' : '🔒')
            .setLabel(isLocked ? 'Unlock' : 'Lock')
            .setStyle(isLocked ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('bytepod_whitelist_menu_open')
            .setEmoji('👋')
            .setLabel('Whitelist')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('bytepod_coowner_menu_open')
            .setEmoji('👥')
            .setLabel('Co-Owner')
            .setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('bytepod_rename')
            .setEmoji('✏️')
            .setLabel('Rename')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('bytepod_limit')
            .setEmoji('🔢')
            .setLabel('Limit')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('bytepod_kick_menu_open')
            .setEmoji('🚫')
            .setLabel('Kick')
            .setStyle(ButtonStyle.Danger)
    );

    return { embeds: [embed], components: [row1, row2] };
}

function getRenameModal() {
    const modal = new ModalBuilder()
        .setCustomId('bytepod_rename_modal')
        .setTitle('Rename BytePod');

    const nameInput = new TextInputBuilder()
        .setCustomId('bytepod_rename_input')
        .setLabel("New Channel Name")
        .setStyle(TextInputStyle.Short)
        .setMaxLength(100)
        .setRequired(true);

    const row = new ActionRowBuilder().addComponents(nameInput);
    modal.addComponents(row);
    return modal;
}

function getLimitModal() {
    const modal = new ModalBuilder()
        .setCustomId('bytepod_limit_modal')
        .setTitle('Set User Limit');

    const limitInput = new TextInputBuilder()
        .setCustomId('bytepod_limit_input')
        .setLabel("User Limit (0 = Unlimited)")
        .setStyle(TextInputStyle.Short)
        .setMaxLength(2)
        .setRequired(true);

    const row = new ActionRowBuilder().addComponents(limitInput);
    modal.addComponents(row);
    return modal;
}

module.exports = { getControlPanel, getRenameModal, getLimitModal };
