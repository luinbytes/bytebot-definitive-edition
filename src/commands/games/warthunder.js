const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const wtService = require('../../utils/wtService');
const embeds = require('../../utils/embeds');
const { handleCommandError } = require('../../utils/errorHandlerUtil');
const { shouldBeEphemeral } = require('../../utils/ephemeralHelper');

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
                        .setDescription('The player\'s nickname (defaults to your bound account)'))
                .addBooleanOption(option =>
                    option.setName('private')
                        .setDescription('Make response visible only to you')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('bind')
                .setDescription('Bind your War Thunder account to your Discord ID')
                .addStringOption(option =>
                    option.setName('nickname')
                        .setDescription('Your War Thunder nickname')
                        .setRequired(true))),

    cooldown: 10,

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const { db } = require('../../database/index');
        const { users } = require('../../database/schema');
        const { eq } = require('drizzle-orm');

        // Manual defer with user preference support
        if (subcommand === 'bind') {
            // Bind is always ephemeral (personal account management)
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        } else if (subcommand === 'stats') {
            // Stats supports privacy control
            const nickname = interaction.options.getString('nickname');
            const isViewingSelf = !nickname; // If no nickname provided, viewing own stats

            const isEphemeral = await shouldBeEphemeral(interaction, {
                commandDefault: false, // Default public for social/competitive context
                userOverride: interaction.options.getBoolean('private'),
                targetUserId: isViewingSelf ? interaction.user.id : null
            });

            await interaction.deferReply({ flags: isEphemeral ? [MessageFlags.Ephemeral] : [] });
        }

        if (subcommand === 'bind') {
            const nickname = interaction.options.getString('nickname');

            try {
                // Verify player exists first
                const player = await wtService.searchPlayer(nickname);
                if (!player) {
                    return interaction.editReply({
                        embeds: [embeds.error('Invalid Nickname', `Could not find a War Thunder player with the nickname \`${nickname}\`.`)]
                    });
                }

                await db.update(users)
                    .set({ wtNickname: player.nick })
                    .where(eq(users.id, interaction.user.id));

                return interaction.editReply({
                    embeds: [embeds.success('Account Bound', `Successfully bound your Discord ID to War Thunder account: **${player.nick}**`)]
                });
            } catch (error) {
                await handleCommandError(error, interaction, 'binding your War Thunder account');
            }
        }

        if (subcommand === 'stats') {
            let nickname = interaction.options.getString('nickname');

            if (!nickname) {
                const [user] = await db.select().from(users).where(eq(users.id, interaction.user.id));
                nickname = user?.wtNickname;

                if (!nickname) {
                    return interaction.editReply({
                        embeds: [embeds.error('No Account Bound', 'Please provide a nickname or bind your account first using `/warthunder bind`.')]
                    });
                }
            }

            try {
                // 1. Search for player
                // ... (rest of stats logic)
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

                await interaction.editReply({ embeds: [embed] });

            } catch (error) {
                await handleCommandError(error, interaction, 'fetching War Thunder statistics', { ephemeral: false });
            }
        }
    },
};
