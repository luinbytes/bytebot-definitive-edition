const { db } = require('../database');
const { reminders } = require('../database/schema');
const { eq, and, lte } = require('drizzle-orm');
const embeds = require('../utils/embeds');
const logger = require('../utils/logger');
const { dbLog } = require('../utils/dbLogger');
const { fetchMember, fetchChannel, safeDMUser } = require('../utils/discordApiUtil');

// Max safe timeout for setTimeout (24.8 days in ms)
const MAX_SAFE_TIMEOUT = 2147483647;
const ONE_DAY = 86400000;
const GRACE_PERIOD = 5 * 60 * 1000; // 5 minutes

/**
 * ReminderService - Handles scheduled user notifications
 *
 * Features:
 * - Personal DM reminders
 * - Channel reminders
 * - Restart resilience (loads active reminders on startup)
 * - Long delay handling (> 24.8 days)
 * - Automatic cleanup on guild leave
 */
class ReminderService {
    constructor(client) {
        this.client = client;
        this.activeTimers = new Map(); // reminderId -> timeoutId
        this.longDelayChecks = new Map(); // reminderId -> intervalId

        // Cleanup on process exit
        process.on('SIGTERM', () => this.cleanup());
        process.on('SIGINT', () => this.cleanup());
    }

    /**
     * Load all active reminders on startup
     */
    async loadReminders() {
        try {
            const now = Date.now();

            // Get all active reminders
            const activeReminders = await dbLog.select('reminders',
                () => db.select()
                    .from(reminders)
                    .where(eq(reminders.active, true))
                    .all(),
                { active: true }
            );

            logger.info(`Loading ${activeReminders.length} active reminders`);

            for (const reminder of activeReminders) {
                if (reminder.triggerAt <= now) {
                    // Overdue reminder
                    if (now - reminder.triggerAt < GRACE_PERIOD) {
                        // Within grace period, fire immediately
                        logger.info(`Firing overdue reminder ${reminder.id} (${Math.round((now - reminder.triggerAt) / 1000)}s late)`);
                        await this.fireReminder(reminder.id);
                    } else {
                        // Too old, mark as missed
                        logger.warn(`Reminder ${reminder.id} missed by ${Math.round((now - reminder.triggerAt) / 60000)}min, marking inactive`);
                        await dbLog.update('reminders',
                            () => db.update(reminders)
                                .set({ active: false })
                                .where(eq(reminders.id, reminder.id)),
                            { reminderId: reminder.id, operation: 'markMissed' }
                        );
                    }
                } else {
                    // Future reminder, schedule it
                    this.scheduleReminder(reminder);
                }
            }

            logger.success(`Reminder service loaded ${activeReminders.length} reminders`);

        } catch (error) {
            logger.error('Failed to load reminders:', error);
        }
    }

    /**
     * Schedule a reminder
     */
    scheduleReminder(reminder) {
        const delay = reminder.triggerAt - Date.now();

        if (delay <= 0) {
            // Immediate fire
            this.fireReminder(reminder.id);
            return;
        }

        if (delay > MAX_SAFE_TIMEOUT) {
            // Long delay - use interval check
            logger.debug(`Scheduling long-delay reminder ${reminder.id} (checking daily)`);

            const intervalId = setInterval(async () => {
                if (Date.now() >= reminder.triggerAt) {
                    await this.fireReminder(reminder.id);
                    clearInterval(intervalId);
                    this.longDelayChecks.delete(reminder.id);
                }
            }, ONE_DAY); // Check daily

            this.longDelayChecks.set(reminder.id, intervalId);

        } else {
            // Normal setTimeout
            logger.debug(`Scheduling reminder ${reminder.id} in ${Math.round(delay / 1000)}s`);

            const timeoutId = setTimeout(async () => {
                await this.fireReminder(reminder.id);
                this.activeTimers.delete(reminder.id);
            }, delay);

            this.activeTimers.set(reminder.id, timeoutId);
        }
    }

    /**
     * Fire a reminder (send to user/channel and mark as inactive)
     */
    async fireReminder(reminderId) {
        try {
            // Atomic check-and-mark (prevents duplicate fires in sharded environments)
            const result = await dbLog.update('reminders',
                () => db.update(reminders)
                    .set({ active: false })
                    .where(and(
                        eq(reminders.id, reminderId),
                        eq(reminders.active, true)
                    ))
                    .returning()
                    .all(),
                { reminderId, operation: 'fire' }
            );

            if (result.length === 0) {
                // Already fired by another instance or cancelled
                logger.debug(`Reminder ${reminderId} already fired or cancelled`);
                return;
            }

            const reminder = result[0];

            // Build embed
            const embed = embeds.brand('⏰ Reminder', reminder.message);
            embed.setFooter({ text: `Set ${this.getRelativeTime(reminder.createdAt)}` });
            embed.setTimestamp(reminder.createdAt);

            // Determine where to send
            if (reminder.channelId) {
                // Channel reminder
                await this.sendChannelReminder(reminder, embed);
            } else {
                // DM reminder
                await this.sendDMReminder(reminder, embed);
            }

            logger.info(`Fired reminder ${reminderId} for user ${reminder.userId}`);

            // Clear from active timers
            this.activeTimers.delete(reminderId);
            this.longDelayChecks.delete(reminderId);

        } catch (error) {
            logger.error(`Failed to fire reminder ${reminderId}:`, error);
        }
    }

    /**
     * Send a channel reminder
     */
    async sendChannelReminder(reminder, embed) {
        try {
            const channel = await fetchChannel(this.client, reminder.channelId, { logContext: 'reminder-channel' });

            if (!channel) {
                // Channel deleted, send DM instead
                logger.warn(`Channel ${reminder.channelId} deleted, sending reminder to user DM`);
                await this.sendDMReminder(reminder, embed);
                return;
            }

            // Check if bot has permissions
            const botMember = await fetchMember(channel.guild, this.client.user.id, { logContext: 'reminder-bot-perms' });
            if (!botMember || !channel.permissionsFor(botMember).has('SendMessages')) {
                // Lost permissions, send DM instead
                logger.warn(`Lost permissions in channel ${reminder.channelId}, sending reminder to user DM`);
                await this.sendDMReminder(reminder, embed);
                return;
            }

            // Fetch user to mention
            const user = await this.client.users.fetch(reminder.userId).catch(() => null);
            const mention = user ? `${user}` : `<@${reminder.userId}>`;

            await channel.send({
                content: mention,
                embeds: [embed]
            });

        } catch (error) {
            logger.error(`Failed to send channel reminder:`, error);

            // Fallback to DM
            try {
                await this.sendDMReminder(reminder, embed);
            } catch (dmError) {
                logger.error(`Failed to send fallback DM for reminder ${reminder.id}:`, dmError);
            }
        }
    }

    /**
     * Send a DM reminder
     */
    async sendDMReminder(reminder, embed) {
        try {
            const user = await this.client.users.fetch(reminder.userId);

            // Add context if reminder was from a guild
            if (reminder.guildId) {
                const guild = await this.client.guilds.fetch(reminder.guildId).catch(() => null);
                const guildName = guild ? guild.name : 'Unknown Server';

                // Check if user is still in guild
                const member = guild ? await fetchMember(guild, reminder.userId, { logContext: 'reminder-user-guild-check' }) : null;
                if (!member) {
                    embed.setDescription(`📍 From **${guildName}** (you are no longer a member)\n\n${reminder.message}`);
                } else {
                    embed.setDescription(`📍 From **${guildName}**\n\n${reminder.message}`);
                }
            }

            const dmResult = await safeDMUser(user, { embeds: [embed] }, { logError: true, logContext: 'reminder-dm' });

            if (!dmResult) {
                logger.warn(`Failed to send DM reminder to user ${reminder.userId} (DMs disabled or blocked)`);
            }

        } catch (error) {
            logger.error(`Failed to send DM reminder to user ${reminder.userId}:`, error);
        }
    }

    /**
     * Cancel a reminder
     */
    async cancelReminder(reminderId, userId) {
        try {
            // Atomic check and update
            const result = await dbLog.update('reminders',
                () => db.update(reminders)
                    .set({ active: false })
                    .where(and(
                        eq(reminders.id, reminderId),
                        eq(reminders.userId, userId),
                        eq(reminders.active, true)
                    ))
                    .returning()
                    .all(),
                { reminderId, userId, operation: 'cancel' }
            );

            if (result.length === 0) {
                throw new Error('Reminder not found or already inactive');
            }

            // Clear timeout/interval
            if (this.activeTimers.has(reminderId)) {
                clearTimeout(this.activeTimers.get(reminderId));
                this.activeTimers.delete(reminderId);
            }

            if (this.longDelayChecks.has(reminderId)) {
                clearInterval(this.longDelayChecks.get(reminderId));
                this.longDelayChecks.delete(reminderId);
            }

            logger.debug(`Cancelled reminder ${reminderId}`);
            return result[0];

        } catch (error) {
            logger.error(`Failed to cancel reminder ${reminderId}:`, error);
            throw error;
        }
    }

    /**
     * Cleanup all timers
     */
    cleanup() {
        logger.info('Cleaning up reminder service...');

        this.activeTimers.forEach(timeoutId => clearTimeout(timeoutId));
        this.longDelayChecks.forEach(intervalId => clearInterval(intervalId));

        this.activeTimers.clear();
        this.longDelayChecks.clear();
    }

    /**
     * Get relative time string
     */
    getRelativeTime(timestamp) {
        const diff = Date.now() - timestamp;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
        if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
        if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        return `${seconds} second${seconds > 1 ? 's' : ''} ago`;
    }
}

module.exports = ReminderService;
