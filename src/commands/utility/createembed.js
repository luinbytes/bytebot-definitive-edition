const { SlashCommandBuilder } = require('discord.js');
const { renderScript } = require('../../services/richContentService');

module.exports = {
    data: new SlashCommandBuilder().setName('createembed').setDescription('Send a rich-message script')
        .addStringOption(option => option.setName('script').setDescription('Message, embed, or Components V2 script').setRequired(true).setMaxLength(6000)),
    permissions: [], cooldown: 2, longRunning: true, deferEphemeral: true,
    async execute(interaction, client) {
        if (!interaction.channel?.send) return interaction.editReply('Rich messages cannot be sent here.');
        await interaction.channel.send(renderScript(interaction.options.getString('script'), {
            user: interaction.user, member: interaction.member, guild: interaction.guild, channel: interaction.channel,
            customScripts: interaction.guild ? client.richContentService.customNames(interaction.guildId) : new Set()
        }));
        return interaction.editReply('Rich message sent.');
    }
};
