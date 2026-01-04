const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const { handleCommandError } = require('../../utils/errorHandlerUtil');
const { executeModerationAction } = require('../../utils/moderationUtil');
const { db } = require('../../database/index');
const { moderationLogs } = require('../../database/schema');
const { eq, and, desc } = require('drizzle-orm');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warning')
        .setDescription('Manage user warnings')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Warn a member')
                .addUserOption(option =>
                    option.setName('target')
                        .setDescription('The member to warn')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('reason')
                        .setDescription('The reason for warning')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a warning from a user')
                .addUserOption(option =>
                    option.setName('target')
                        .setDescription('The user to unwarn')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('id')
                        .setDescription('The Warning ID to remove')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('View a user\'s moderation history')
                .addUserOption(option =>
                    option.setName('target')
                        .setDescription('The user to check (defaults to yourself)')
                        .setRequired(false)))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    permissions: [PermissionFlagsBits.ModerateMembers],

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'add':
                return handleWarnAdd(interaction);
            case 'remove':
                return handleWarnRemove(interaction);
            case 'list':
                return handleWarnList(interaction);
        }
    },
};

/**
 * Handle /warning add subcommand
 */
async function handleWarnAdd(interaction) {
    const target = interaction.options.getUser('target');
    const reason = interaction.options.getString('reason');

    try {
        // Execute moderation action (log to DB + send DM notification)
        await executeModerationAction({
            guildId: interaction.guild.id,
            guildName: interaction.guild.name,
            target,
            executor: interaction.member,
            action: 'WARN',
            reason
        });

        await interaction.reply({
            embeds: [embeds.success('Member Warned', `**${target.tag}** has been warned.\n**Reason:** ${reason}`)]
        });
    } catch (error) {
        await handleCommandError(error, interaction, 'warning member');
    }
}

/**
 * Handle /warning remove subcommand
 */
async function handleWarnRemove(interaction) {
    const target = interaction.options.getUser('target');
    const id = interaction.options.getInteger('id');

    try {
        // Check if warning exists and matches target
        const warning = await db.select()
            .from(moderationLogs)
            .where(and(
                eq(moderationLogs.id, id),
                eq(moderationLogs.guildId, interaction.guild.id)
            ))
            .get();

        if (!warning) {
            return interaction.reply({
                embeds: [embeds.error('Not Found', `Warning ID **${id}** was not found in this server.`)],
                flags: [MessageFlags.Ephemeral]
            });
        }

        if (warning.targetId !== target.id) {
            return interaction.reply({
                embeds: [embeds.error('Mismatch', `Warning ID **${id}** does not belong to ${target}.`)],
                flags: [MessageFlags.Ephemeral]
            });
        }

        // Delete warning
        await db.delete(moderationLogs)
            .where(eq(moderationLogs.id, id));

        return interaction.reply({
            embeds: [embeds.success('Warning Removed', `Successfully removed Warning ID **${id}** from ${target}.`)]
        });

    } catch (error) {
        await handleCommandError(error, interaction, 'removing warning');
    }
}

/**
 * Handle /warning list subcommand
 */
async function handleWarnList(interaction) {
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
        await handleCommandError(error, interaction, 'fetching moderation history');
    }
}
