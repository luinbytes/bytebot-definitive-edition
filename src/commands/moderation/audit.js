const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const logger = require('../../utils/logger');
const { db } = require('../../database/index');
const { moderationLogs } = require('../../database/schema');
const { eq, and, desc } = require('drizzle-orm');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('audit')
        .setDescription('View comprehensive moderation audit logs.')
        .addSubcommand(sub => sub
            .setName('user')
            .setDescription('View moderation history for a specific user.')
            .addUserOption(opt => opt
                .setName('target')
                .setDescription('User to audit')
                .setRequired(true))
            .addStringOption(opt => opt
                .setName('action')
                .setDescription('Filter by action type')
                .addChoices(
                    { name: 'Warn', value: 'WARN' },
                    { name: 'Kick', value: 'KICK' },
                    { name: 'Ban', value: 'BAN' },
                    { name: 'Clear', value: 'CLEAR' }
                ))
            .addIntegerOption(opt => opt
                .setName('limit')
                .setDescription('Number of results (default 10, max 50)')
                .setMinValue(1)
                .setMaxValue(50)))
        .addSubcommand(sub => sub
            .setName('recent')
            .setDescription('View the most recent moderation actions.')
            .addIntegerOption(opt => opt
                .setName('limit')
                .setDescription('Number of results (default 10, max 50)')
                .setMinValue(1)
                .setMaxValue(50)))
        .addSubcommand(sub => sub
            .setName('by')
            .setDescription('View actions taken by a specific moderator.')
            .addUserOption(opt => opt
                .setName('moderator')
                .setDescription('Moderator to view')
                .setRequired(true))
            .addIntegerOption(opt => opt
                .setName('limit')
                .setDescription('Number of results (default 10, max 50)')
                .setMinValue(1)
                .setMaxValue(50))),

    permissions: [PermissionFlagsBits.ModerateMembers],

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const limit = interaction.options.getInteger('limit') ?? 10;

        await interaction.deferReply(); // Public for transparency

        try {
            let logs = [];
            let title = '';
            let description = '';

            if (subcommand === 'user') {
                const target = interaction.options.getUser('target');
                const actionFilter = interaction.options.getString('action');

                const conditions = [
                    eq(moderationLogs.guildId, interaction.guild.id),
                    eq(moderationLogs.targetId, target.id)
                ];

                logs = await db.select()
                    .from(moderationLogs)
                    .where(and(...conditions))
                    .orderBy(desc(moderationLogs.timestamp))
                    .limit(limit);

                // Filter by action type in-memory if specified (Drizzle doesn't chain .where easily)
                if (actionFilter) {
                    logs = logs.filter(log => log.action === actionFilter);
                }

                title = `Audit: ${target.username}`;
                if (actionFilter) title += ` (${actionFilter} only)`;
            }

            if (subcommand === 'recent') {
                logs = await db.select()
                    .from(moderationLogs)
                    .where(eq(moderationLogs.guildId, interaction.guild.id))
                    .orderBy(desc(moderationLogs.timestamp))
                    .limit(limit);

                title = 'Recent Moderation Actions';
            }

            if (subcommand === 'by') {
                const moderator = interaction.options.getUser('moderator');

                logs = await db.select()
                    .from(moderationLogs)
                    .where(and(
                        eq(moderationLogs.guildId, interaction.guild.id),
                        eq(moderationLogs.executorId, moderator.id)
                    ))
                    .orderBy(desc(moderationLogs.timestamp))
                    .limit(limit);

                title = `Actions by ${moderator.username}`;
            }

            // Format results
            if (logs.length === 0) {
                return interaction.editReply({
                    embeds: [embeds.brand(title, 'No moderation logs found matching the criteria.')]
                });
            }

            description = logs.map(log => {
                const timestamp = Math.floor(log.timestamp / 1000);
                const reason = log.reason || 'No reason provided';

                if (subcommand === 'by') {
                    // Show target instead of executor
                    return `**#${log.id}** [**${log.action}**] <t:${timestamp}:d>\n→ Target: <@${log.targetId}>\n→ Reason: ${reason}`;
                } else if (subcommand === 'recent') {
                    // Show both target and executor
                    return `**#${log.id}** [**${log.action}**] <t:${timestamp}:d>\n→ Target: <@${log.targetId}> | By: <@${log.executorId}>\n→ Reason: ${reason}`;
                } else {
                    // User audit - show executor
                    return `**#${log.id}** [**${log.action}**] <t:${timestamp}:d>\n→ By: <@${log.executorId}>\n→ Reason: ${reason}`;
                }
            }).join('\n\n');

            // Truncate if too long
            if (description.length > 4000) {
                description = description.slice(0, 3950) + '\n\n*...truncated*';
            }

            const embed = embeds.brand(title, description)
                .setFooter({ text: `Showing ${logs.length} of ${limit} requested results` });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            logger.error(`Audit command error: ${error}`);
            await interaction.editReply({
                embeds: [embeds.error('Error', 'An error occurred while fetching audit logs.')]
            });
        }
    },
};
