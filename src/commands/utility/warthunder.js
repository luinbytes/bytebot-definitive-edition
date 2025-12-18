const { SlashCommandBuilder } = require('discord.js');
const wtService = require('../../utils/wtService');
const embeds = require('../../utils/embeds');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warthunder')
        .setDescription('War Thunder statistics and tools')
        .addSubcommand(subcommand =>
            subcommand
                .setName('stats')
                .setDescription('Get statistics for a War Thunder player')
                .addStringOption(option =>
                    option.setName('nickname')
                        .setDescription('The player\'s nickname')
                        .setRequired(true))),

    cooldown: 10,

    async execute(interaction) {
        const nickname = interaction.options.getString('nickname');

        await interaction.deferReply();

        try {
            // 1. Search for player
            const player = await wtService.searchPlayer(nickname);

            if (!player) {
                return interaction.editReply({
                    embeds: [embeds.error('Player Not Found', `Could not find a War Thunder player with the nickname \`${nickname}\`.`)]
                });
            }

            // 2. Fetch and aggregate stats
            const stats = await wtService.getPlayerStats(player.userid);

            if (!stats) {
                return interaction.editReply({
                    embeds: [embeds.error('Stats Error', `Could not retrieve statistics for \`${player.nick}\`.`)]
                });
            }

            // 3. Construct Embed
            const clanSuffix = stats.clan_tag ? ` [${stats.clan_tag}]` : '';
            const embed = embeds.brand(`${stats.nick}${clanSuffix}`, 'War Thunder Player Statistics')
                .addFields(
                    { name: '📊 General', value: `**Level:** ${stats.level}\n**XP:** ${stats.experience.toLocaleString()}`, inline: true },
                    { name: '⚔️ Performance', value: `**K/D Ratio:** ${stats.kd}\n**Win Rate:** ${stats.winRate}%`, inline: true },
                    { name: '🚀 Battle Totals', value: `**Total Kills:** ${stats.totals.total_kills.toLocaleString()}\n**Total Deaths:** ${stats.totals.deaths.toLocaleString()}\n**Matches:** ${stats.totals.spawns.toLocaleString()}`, inline: false },
                    { name: '🎯 Kill Breakdown', value: `**Ground:** ${stats.totals.ground_kills.toLocaleString()}\n**Air:** ${stats.totals.air_kills.toLocaleString()}\n**Naval:** ${stats.totals.naval_kills.toLocaleString()}`, inline: true }
                );

            if (stats.icon_name) {
                // Constructing an icon URL if possible, though ThunderInsights documentation doesn't specify an icon base URL.
                // If we don't have a reliable URL, we skip the thumbnail or use a placeholder if the user prefers.
                // For now, let's just show the stats.
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            logger.error(`Command Error (warthunder stats): ${error.message}`);
            await interaction.editReply({
                embeds: [embeds.error('Internal Error', 'An error occurred while fetching War Thunder statistics. Please try again later.')]
            });
        }
    },
};
