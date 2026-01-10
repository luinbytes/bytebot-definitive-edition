const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const { handleCommandError } = require('../../utils/errorHandlerUtil');
const { executeModerationAction } = require('../../utils/moderationUtil');
const { db } = require('../../database/index');
const { moderationLogs } = require('../../database/schema');
const { eq, and, desc } = require('drizzle-orm');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mod')
        .setDescription('Moderation commands')
        // Ban subcommand
        .addSubcommand(sub => sub
            .setName('ban')
            .setDescription('Ban a member from the server')
            .addUserOption(opt => opt
                .setName('target')
                .setDescription('The member to ban')
                .setRequired(true))
            .addStringOption(opt => opt
                .setName('reason')
                .setDescription('Reason for the ban')))
        // Kick subcommand
        .addSubcommand(sub => sub
            .setName('kick')
            .setDescription('Kick a member from the server')
            .addUserOption(opt => opt
                .setName('target')
                .setDescription('The member to kick')
                .setRequired(true))
            .addStringOption(opt => opt
                .setName('reason')
                .setDescription('Reason for the kick')))
        // Warn subcommand
        .addSubcommand(sub => sub
            .setName('warn')
            .setDescription('Warn a member')
            .addUserOption(opt => opt
                .setName('target')
                .setDescription('The member to warn')
                .setRequired(true))
            .addStringOption(opt => opt
                .setName('reason')
                .setDescription('Reason for the warning')
                .setRequired(true)))
        // Remove warning subcommand
        .addSubcommand(sub => sub
            .setName('unwarn')
            .setDescription('Remove a warning from a user')
            .addUserOption(opt => opt
                .setName('target')
                .setDescription('The user to remove the warning from')
                .setRequired(true))
            .addIntegerOption(opt => opt
                .setName('id')
                .setDescription('The warning ID to remove')
                .setRequired(true)))
        // History for specific user
        .addSubcommand(sub => sub
            .setName('history')
            .setDescription('View moderation history for a user')
            .addUserOption(opt => opt
                .setName('target')
                .setDescription('User to view history for')
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
        // Recent actions server-wide
        .addSubcommand(sub => sub
            .setName('recent')
            .setDescription('View recent moderation actions')
            .addIntegerOption(opt => opt
                .setName('limit')
                .setDescription('Number of results (default 10, max 50)')
                .setMinValue(1)
                .setMaxValue(50)))
        // Actions by specific moderator
        .addSubcommand(sub => sub
            .setName('actions')
            .setDescription('View actions taken by a specific moderator')
            .addUserOption(opt => opt
                .setName('moderator')
                .setDescription('Moderator to view')
                .setRequired(true))
            .addIntegerOption(opt => opt
                .setName('limit')
                .setDescription('Number of results (default 10, max 50)')
                .setMinValue(1)
                .setMaxValue(50)))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    permissions: [PermissionFlagsBits.ModerateMembers],
    cooldown: 3,

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'ban':
                await handleBan(interaction);
                break;
            case 'kick':
                await handleKick(interaction);
                break;
            case 'warn':
                await handleWarn(interaction);
                break;
            case 'unwarn':
                await handleUnwarn(interaction);
                break;
            case 'history':
                await handleHistory(interaction);
                break;
            case 'recent':
                await handleRecent(interaction);
                break;
            case 'actions':
                await handleActions(interaction);
                break;
        }
    }
};

/**
 * Handle /mod ban
 */
async function handleBan(interaction) {
    const target = interaction.options.getMember('target');
    const reason = interaction.options.getString('reason') ?? 'No reason provided';

    if (!target) {
        return interaction.reply({
            embeds: [embeds.error('Error', 'Target member not found.')],
            flags: [MessageFlags.Ephemeral]
        });
    }

    if (!target.bannable) {
        return interaction.reply({
            embeds: [embeds.error('Error', 'I cannot ban this user. They might have a higher role than me.')],
            flags: [MessageFlags.Ephemeral]
        });
    }

    try {
        await executeModerationAction({
            guildId: interaction.guild.id,
            guildName: interaction.guild.name,
            target: target.user,
            executor: interaction.member,
            action: 'BAN',
            reason
        });

        await target.ban({ reason });

        await interaction.reply({
            embeds: [embeds.success('Member Banned', `**${target.user.tag}** has been banned.\n**Reason:** ${reason}`)]
        });
    } catch (error) {
        await handleCommandError(error, interaction, 'banning member');
    }
}

/**
 * Handle /mod kick
 */
async function handleKick(interaction) {
    const target = interaction.options.getMember('target');
    const reason = interaction.options.getString('reason') ?? 'No reason provided';

    if (!target) {
        return interaction.reply({
            embeds: [embeds.error('Error', 'Target member not found.')],
            flags: [MessageFlags.Ephemeral]
        });
    }

    if (!target.kickable) {
        return interaction.reply({
            embeds: [embeds.error('Error', 'I cannot kick this user. They might have a higher role than me.')],
            flags: [MessageFlags.Ephemeral]
        });
    }

    try {
        await executeModerationAction({
            guildId: interaction.guild.id,
            guildName: interaction.guild.name,
            target: target.user,
            executor: interaction.member,
            action: 'KICK',
            reason
        });

        await target.kick(reason);

        await interaction.reply({
            embeds: [embeds.success('Member Kicked', `**${target.user.tag}** has been kicked.\n**Reason:** ${reason}`)]
        });
    } catch (error) {
        await handleCommandError(error, interaction, 'kicking member');
    }
}

/**
 * Handle /mod warn
 */
async function handleWarn(interaction) {
    const target = interaction.options.getUser('target');
    const reason = interaction.options.getString('reason');

    try {
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
 * Handle /mod unwarn
 */
async function handleUnwarn(interaction) {
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
 * Handle /mod history
 */
async function handleHistory(interaction) {
    const target = interaction.options.getUser('target');
    const actionFilter = interaction.options.getString('action');
    const limit = interaction.options.getInteger('limit') ?? 10;

    await interaction.deferReply(); // Public for transparency

    try {
        let logs = await db.select()
            .from(moderationLogs)
            .where(and(
                eq(moderationLogs.guildId, interaction.guild.id),
                eq(moderationLogs.targetId, target.id)
            ))
            .orderBy(desc(moderationLogs.timestamp))
            .limit(limit);

        // Filter by action type if specified
        if (actionFilter) {
            logs = logs.filter(log => log.action === actionFilter);
        }

        const title = actionFilter
            ? `History: ${target.username} (${actionFilter} only)`
            : `History: ${target.username}`;

        if (logs.length === 0) {
            return interaction.editReply({
                embeds: [embeds.brand(title, 'No moderation logs found.')]
            });
        }

        const description = logs.map(log => {
            const timestamp = Math.floor(log.timestamp / 1000);
            const reason = log.reason || 'No reason provided';
            return `**#${log.id}** [**${log.action}**] <t:${timestamp}:d>\n→ By: <@${log.executorId}>\n→ Reason: ${reason}`;
        }).join('\n\n');

        const embed = embeds.brand(title, description.slice(0, 4000))
            .setFooter({ text: `Showing ${logs.length} results` });

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        await handleCommandError(error, interaction, 'fetching history', { ephemeral: false });
    }
}

/**
 * Handle /mod recent
 */
async function handleRecent(interaction) {
    const limit = interaction.options.getInteger('limit') ?? 10;

    await interaction.deferReply(); // Public for transparency

    try {
        const logs = await db.select()
            .from(moderationLogs)
            .where(eq(moderationLogs.guildId, interaction.guild.id))
            .orderBy(desc(moderationLogs.timestamp))
            .limit(limit);

        if (logs.length === 0) {
            return interaction.editReply({
                embeds: [embeds.brand('Recent Moderation Actions', 'No moderation logs found.')]
            });
        }

        const description = logs.map(log => {
            const timestamp = Math.floor(log.timestamp / 1000);
            const reason = log.reason || 'No reason provided';
            return `**#${log.id}** [**${log.action}**] <t:${timestamp}:d>\n→ Target: <@${log.targetId}> | By: <@${log.executorId}>\n→ Reason: ${reason}`;
        }).join('\n\n');

        const embed = embeds.brand('Recent Moderation Actions', description.slice(0, 4000))
            .setFooter({ text: `Showing ${logs.length} results` });

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        await handleCommandError(error, interaction, 'fetching recent actions', { ephemeral: false });
    }
}

/**
 * Handle /mod actions (by moderator)
 */
async function handleActions(interaction) {
    const moderator = interaction.options.getUser('moderator');
    const limit = interaction.options.getInteger('limit') ?? 10;

    await interaction.deferReply(); // Public for transparency

    try {
        const logs = await db.select()
            .from(moderationLogs)
            .where(and(
                eq(moderationLogs.guildId, interaction.guild.id),
                eq(moderationLogs.executorId, moderator.id)
            ))
            .orderBy(desc(moderationLogs.timestamp))
            .limit(limit);

        const title = `Actions by ${moderator.username}`;

        if (logs.length === 0) {
            return interaction.editReply({
                embeds: [embeds.brand(title, 'No moderation logs found.')]
            });
        }

        const description = logs.map(log => {
            const timestamp = Math.floor(log.timestamp / 1000);
            const reason = log.reason || 'No reason provided';
            return `**#${log.id}** [**${log.action}**] <t:${timestamp}:d>\n→ Target: <@${log.targetId}>\n→ Reason: ${reason}`;
        }).join('\n\n');

        const embed = embeds.brand(title, description.slice(0, 4000))
            .setFooter({ text: `Showing ${logs.length} results` });

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        await handleCommandError(error, interaction, 'fetching moderator actions', { ephemeral: false });
    }
}
