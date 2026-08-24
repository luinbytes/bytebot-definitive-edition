const { SlashCommandBuilder } = require('discord.js');
const { messageToScript, sourceReply } = require('../../services/richContentService');

module.exports = {
    data: new SlashCommandBuilder().setName('copyembed').setDescription('Convert a message to rich-message script')
        .addStringOption(option => option.setName('message').setDescription('Message link or ID').setRequired(true)),
    permissions: [], cooldown: 2, longRunning: true, deferEphemeral: true,
    async execute(interaction) {
        const match = /(?:channels\/\d+\/(\d+)\/)?(\d+)\/?$/.exec(interaction.options.getString('message'));
        const channel = match?.[1] ? await interaction.guild?.channels.fetch(match[1]).catch(() => null) : interaction.channel;
        const message = match && await channel?.messages?.fetch(match[2]).catch(() => null);
        if (!message) return interaction.editReply('That message was not found or is not accessible.');
        return interaction.editReply(sourceReply(messageToScript(message)));
    }
};
