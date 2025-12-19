const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const { db } = require('../../database/index');
const { moderationLogs } = require('../../database/schema');
const { eq, and, desc } = require('drizzle-orm');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warnings')
        .setDescription('View a user\'s moderation history.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user to check')),

    async execute(interaction) {
        const target = interaction.options.getUser('target') ?? interaction.user;

        try {
            const logs = await db.select()
                .from(moderationLogs)
                .where(
                    and(
                        eq(moderationLogs.guildId, interaction.guild.id),
                        eq(moderationLogs.targetId, target.id)
                    )
                )
                .orderBy(desc(moderationLogs.timestamp))
                .limit(10);

            if (logs.length === 0) {
                return interaction.reply({
                    embeds: [embeds.brand(`${target.username}'s History`, 'This user has no moderation logs.')]
                });
            }

            const description = logs.map(log =>
                `**ID: ${log.id}** | **[${log.action}]** <t:${Math.floor(log.timestamp / 1000)}:d>: ${log.reason} (By: <@${log.executorId}>)`
            ).join('\n');

            const embed = embeds.brand(`${target.username}'s Moderation History`, description)
                .setFooter({ text: `Total entries: ${logs.length}` });

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await interaction.reply({
                embeds: [embeds.error('Error', 'An error occurred while fetching moderation history.')],
                flags: [MessageFlags.Ephemeral]
            });
        }
    },
};
