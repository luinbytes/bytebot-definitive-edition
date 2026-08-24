const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
    TextInputBuilder, TextInputStyle
} = require('discord.js');
const embeds = require('../utils/embeds');

const ACTIONS = [
    ['lock', 'Lock', '🔒', ButtonStyle.Secondary],
    ['unlock', 'Unlock', '🔓', ButtonStyle.Success],
    ['hide', 'Ghost', '👻', ButtonStyle.Secondary],
    ['reveal', 'Reveal', '👁️', ButtonStyle.Success],
    ['rename', 'Rename', '✏️', ButtonStyle.Primary],
    ['claim', 'Claim', '👑', ButtonStyle.Primary],
    ['information', 'Information', 'ℹ️', ButtonStyle.Secondary],
    ['increase', 'Increase', '➕', ButtonStyle.Secondary],
    ['decrease', 'Decrease', '➖', ButtonStyle.Secondary],
    ['delete', 'Delete', '🗑️', ButtonStyle.Danger]
];

function voiceMasterInterface(channelId) {
    const rows = [ACTIONS.slice(0, 5), ACTIONS.slice(5)].map(actions => new ActionRowBuilder().addComponents(
        actions.map(([action, label, emoji, style]) => new ButtonBuilder()
            .setCustomId(`voicemaster:${channelId}:${action}`)
            .setLabel(label)
            .setEmoji(emoji)
            .setStyle(style))
    ));
    return {
        embeds: [embeds.brand('VoiceMaster Interface', 'Manage your voice channel by using the buttons below.')],
        components: rows,
        allowedMentions: { parse: [] }
    };
}

function voiceMasterRenameModal(scopeId) {
    return new ModalBuilder()
        .setCustomId(`voicemaster:${scopeId}:rename-submit`)
        .setTitle('Rename Voice Channel')
        .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('name')
                .setLabel('New channel name')
                .setStyle(TextInputStyle.Short)
                .setMinLength(1)
                .setMaxLength(100)
                .setRequired(true)
        ));
}

module.exports = { voiceMasterInterface, voiceMasterRenameModal };
