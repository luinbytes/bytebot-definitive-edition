const { SlashCommandBuilder } = require('discord.js');
const { messageToScript, sourceReply } = require('../../services/richContentService');
const { fetchReadableMessage } = require('../../utils/messageAccess');

module.exports = {
    data: new SlashCommandBuilder().setName('copyembed').setDescription('Convert a message to rich-message script')
        .addStringOption(option => option.setName('message').setDescription('Message link or ID').setRequired(true)),
    permissions: [], cooldown: 2, longRunning: true, deferEphemeral: true,
    async execute(interaction) {
        const message = await fetchReadableMessage(interaction, interaction.options.getString('message'));
        if (!message) return interaction.editReply('That message was not found or is not accessible.');
        return interaction.editReply(sourceReply(messageToScript(message)));
    }
};
