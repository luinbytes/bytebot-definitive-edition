const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { db } = require('../../database');
const { reminders } = require('../../database/schema');
const { eq, and, count } = require('drizzle-orm');
const embeds = require('../../utils/embeds');
const { parseTime, formatDuration } = require('../../utils/timeParser');
const logger = require('../../utils/logger');

const MAX_REMINDERS_PER_USER = 25;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reminder')
        .setDescription('Set and manage reminders')
        .addSubcommand(subcommand =>
            subcommand
                .setName('me')
                .setDescription('Set a personal DM reminder')
                .addStringOption(option =>
                    option.setName('time')
                        .setDescription('Time until reminder (e.g., 10m, 2h, 3d, 2h 30m)')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('message')
                        .setDescription('What to remind you about')
                        .setRequired(true)
                        .setMaxLength(1000)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('here')
                .setDescription('Set a reminder in this channel')
                .addStringOption(option =>
                    option.setName('time')
                        .setDescription('Time until reminder (e.g., 10m, 2h, 3d, 2h 30m)')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('message')
                        .setDescription('What to remind about')
                        .setRequired(true)
                        .setMaxLength(1000)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('View your active reminders')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('cancel')
                .setDescription('Cancel a reminder')
                .addIntegerOption(option =>
                    option.setName('id')
                        .setDescription('Reminder ID (from /reminder list)')
                        .setRequired(true)
                        .setMinValue(1)
                )
        ),

    async execute(interaction, client) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'me':
                await handleRemindMe(interaction, client);
                break;
            case 'here':
                await handleRemindHere(interaction, client);
                break;
            case 'list':
                await handleList(interaction, client);
                break;
            case 'cancel':
                await handleCancel(interaction, client);
                break;
        }
    }
};

/**
 * Handle /reminder me
 */
async function handleRemindMe(interaction, client) {
    const timeInput = interaction.options.getString('time');
    const message = interaction.options.getString('message');

    // Parse time
    const parsedTime = parseTime(timeInput);
    if (!parsedTime.success) {
        return interaction.reply({
            embeds: [embeds.error('Invalid Time', parsedTime.error)],
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Check user reminder count
    const countResult = await db.select({ count: count() })
        .from(reminders)
        .where(and(
            eq(reminders.userId, interaction.user.id),
            eq(reminders.active, true)
        ))
        .get();

    if (countResult.count >= MAX_REMINDERS_PER_USER) {
        return interaction.reply({
            embeds: [embeds.error(
                'Reminder Limit Reached',
                `You have reached the maximum of ${MAX_REMINDERS_PER_USER} active reminders. Use \`/reminder list\` to manage them.`
            )],
            flags: [MessageFlags.Ephemeral]
        });
    }

    try {
        // Insert reminder
        const result = await db.insert(reminders).values({
            userId: interaction.user.id,
            guildId: null,
            channelId: null,
            message: message,
            triggerAt: parsedTime.timestamp,
            createdAt: Date.now(),
            active: true
        }).returning().get();

        // Schedule reminder
        if (client.reminderService) {
            client.reminderService.scheduleReminder(result);
        }

        const embed = embeds.success(
            '✅ Reminder Set',
            `I'll remind you **<t:${Math.floor(parsedTime.timestamp / 1000)}:R>** (<t:${Math.floor(parsedTime.timestamp / 1000)}:F>)\n\n**Message:** ${message}`
        );
        embed.setFooter({ text: `Reminder ID: ${result.id} • Use /reminder cancel ${result.id} to cancel` });

        await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });

    } catch (error) {
        logger.error('Failed to create reminder:', error);
        return interaction.reply({
            embeds: [embeds.error('Failed', 'Failed to create reminder. Please try again.')],
            flags: [MessageFlags.Ephemeral]
        });
    }
}

/**
 * Handle /reminder here
 */
async function handleRemindHere(interaction, client) {
    const timeInput = interaction.options.getString('time');
    const message = interaction.options.getString('message');

    // Check if in guild
    if (!interaction.guild) {
        return interaction.reply({
            embeds: [embeds.error('Guild Only', 'Channel reminders can only be set in servers. Use `/reminder me` for DM reminders.')],
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Check bot permissions in channel
    const botMember = await interaction.guild.members.fetch(client.user.id);
    const permissions = interaction.channel.permissionsFor(botMember);

    if (!permissions.has(PermissionFlagsBits.SendMessages)) {
        return interaction.reply({
            embeds: [embeds.error(
                'Missing Permissions',
                "I don't have permission to send messages in this channel."
            )],
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Parse time
    const parsedTime = parseTime(timeInput);
    if (!parsedTime.success) {
        return interaction.reply({
            embeds: [embeds.error('Invalid Time', parsedTime.error)],
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Check user reminder count
    const countResult = await db.select({ count: count() })
        .from(reminders)
        .where(and(
            eq(reminders.userId, interaction.user.id),
            eq(reminders.active, true)
        ))
        .get();

    if (countResult.count >= MAX_REMINDERS_PER_USER) {
        return interaction.reply({
            embeds: [embeds.error(
                'Reminder Limit Reached',
                `You have reached the maximum of ${MAX_REMINDERS_PER_USER} active reminders. Use \`/reminder list\` to manage them.`
            )],
            flags: [MessageFlags.Ephemeral]
        });
    }

    try {
        // Insert reminder
        const result = await db.insert(reminders).values({
            userId: interaction.user.id,
            guildId: interaction.guild.id,
            channelId: interaction.channel.id,
            message: message,
            triggerAt: parsedTime.timestamp,
            createdAt: Date.now(),
            active: true
        }).returning().get();

        // Schedule reminder
        if (client.reminderService) {
            client.reminderService.scheduleReminder(result);
        }

        const embed = embeds.success(
            '✅ Reminder Set',
            `I'll send a reminder in this channel **<t:${Math.floor(parsedTime.timestamp / 1000)}:R>** (<t:${Math.floor(parsedTime.timestamp / 1000)}:F>)\n\n**Message:** ${message}`
        );
        embed.setFooter({ text: `Reminder ID: ${result.id} • Use /reminder cancel ${result.id} to cancel` });

        await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });

    } catch (error) {
        logger.error('Failed to create reminder:', error);
        return interaction.reply({
            embeds: [embeds.error('Failed', 'Failed to create reminder. Please try again.')],
            flags: [MessageFlags.Ephemeral]
        });
    }
}

/**
 * Handle /reminder list
 */
async function handleList(interaction, client) {
    try {
        const userReminders = await db.select()
            .from(reminders)
            .where(and(
                eq(reminders.userId, interaction.user.id),
                eq(reminders.active, true)
            ))
            .orderBy(reminders.triggerAt)
            .all();

        if (userReminders.length === 0) {
            return interaction.reply({
                embeds: [embeds.warn(
                    'No Active Reminders',
                    'You have no active reminders. Use `/reminder me` or `/reminder here` to create one.'
                )],
                flags: [MessageFlags.Ephemeral]
            });
        }

        const embed = embeds.brand('📋 Your Active Reminders', null);

        const lines = await Promise.all(userReminders.map(async (reminder) => {
            const messagePreview = reminder.message.length > 50
                ? reminder.message.substring(0, 50) + '...'
                : reminder.message;

            let type = 'DM';
            if (reminder.channelId) {
                const channel = await client.channels.fetch(reminder.channelId).catch(() => null);
                type = channel ? `#${channel.name}` : 'deleted-channel';
            }

            return `**ID ${reminder.id}** • <t:${Math.floor(reminder.triggerAt / 1000)}:R>\n📍 ${type} • ${messagePreview}`;
        }));

        embed.setDescription(lines.join('\n\n'));
        embed.setFooter({ text: `${userReminders.length}/${MAX_REMINDERS_PER_USER} active reminders • Use /reminder cancel [id] to remove` });

        await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });

    } catch (error) {
        logger.error('Failed to list reminders:', error);
        return interaction.reply({
            embeds: [embeds.error('Failed', 'Failed to fetch reminders. Please try again.')],
            flags: [MessageFlags.Ephemeral]
        });
    }
}

/**
 * Handle /reminder cancel
 */
async function handleCancel(interaction, client) {
    const reminderId = interaction.options.getInteger('id');

    try {
        if (!client.reminderService) {
            return interaction.reply({
                embeds: [embeds.error('Service Unavailable', 'Reminder service is not available.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        const cancelled = await client.reminderService.cancelReminder(reminderId, interaction.user.id);

        const embed = embeds.success(
            '✅ Reminder Cancelled',
            `Reminder #${reminderId} has been cancelled.\n\n**Was:** ${cancelled.message}`
        );

        await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });

    } catch (error) {
        logger.error('Failed to cancel reminder:', error);
        return interaction.reply({
            embeds: [embeds.error(
                'Failed to Cancel',
                error.message || 'Could not cancel reminder. It may have already fired or does not exist.'
            )],
            flags: [MessageFlags.Ephemeral]
        });
    }
}
