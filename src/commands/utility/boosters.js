const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { boundedList, configOf } = require('../../services/roleAutomationService');

module.exports = {
    data: new SlashCommandBuilder().setName('boosters').setDescription('View current and recently lost boosters').setDMPermission(false)
        .addSubcommand(sub => sub.setName('list').setDescription('List current boosters'))
        .addSubcommand(sub => sub.setName('lost').setDescription('List recently lost boosters')),
    permissions: [], cooldown: 3, longRunning: true, deferEphemeral: true,
    async execute(interaction, client) {
        const action = interaction.options.getSubcommand();
        if (action === 'list') {
            const boosters = await client.roleAutomationService.listBoosters(interaction.guild);
            const lines = boosters.map(member => `<@${member.id}> — boosting since <t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>`);
            return interaction.editReply({ content: boundedList(lines, 'This server has no boosters.'), allowedMentions: { parse: [] }, flags: [MessageFlags.Ephemeral] });
        }
        const lost = (await client.automationService.list(interaction.guild.id, 'booster-lost')).sort((a, b) => configOf(b).lostAt - configOf(a).lostAt);
        const lines = lost.map(rule => `<@${rule.key}> — stopped <t:${Math.floor(configOf(rule).lostAt / 1000)}:R>`);
        return interaction.editReply({ content: boundedList(lines, 'No recently lost boosters are recorded.'), allowedMentions: { parse: [] }, flags: [MessageFlags.Ephemeral] });
    }
};
