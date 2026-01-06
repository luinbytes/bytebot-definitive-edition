const { db } = require('../database');
const { birthdays, birthdayConfig } = require('../database/schema');
const { eq, and, or } = require('drizzle-orm');
const logger = require('../utils/logger');
const embeds = require('../utils/embeds');
const { dbLog } = require('../utils/dbLogger');
const { fetchMember, fetchChannel, RoleManager } = require('../utils/discordApiUtil');

class BirthdayService {
    constructor(client) {
        this.client = client;
        this.checkInterval = null;
        this.roleRemovalTimeouts = new Map(); // Track role removals: userId_guildId -> timeoutId
    }

    /**
     * Start the daily birthday checker
     * Calculates time until next midnight UTC and sets up recurring checks
     */
    startDailyCheck() {
        // Calculate ms until next midnight UTC
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setUTCHours(24, 0, 0, 0);
        const msUntilMidnight = tomorrow - now;

        logger.info(`Birthday system initialized. First check in ${Math.round(msUntilMidnight / 60000)} minutes (at midnight UTC)`);

        // Check for missed birthdays on startup
        this.checkMissedBirthdays();

        // Schedule first check at midnight
        setTimeout(() => {
            this.checkAllGuilds();

            // Then check every 24 hours
            this.checkInterval = setInterval(() => {
                this.checkAllGuilds();
            }, 86400000); // 24 hours
        }, msUntilMidnight);
    }

    /**
     * Check if bot missed yesterday's check (was offline)
     */
    async checkMissedBirthdays() {
        try {
            const configs = await dbLog.select('birthdayConfig',
                () => db.select()
                    .from(birthdayConfig)
                    .where(eq(birthdayConfig.enabled, 1)),
                { enabled: 1 }
            );

            const yesterdayMidnight = new Date();
            yesterdayMidnight.setUTCHours(0, 0, 0, 0);
            yesterdayMidnight.setUTCDate(yesterdayMidnight.getUTCDate() - 1);

            let missedCount = 0;

            for (const config of configs) {
                if (!config.lastCheck || new Date(config.lastCheck) < yesterdayMidnight) {
                    logger.info(`Missed birthday check for guild ${config.guildId}, running now`);
                    await this.checkBirthdaysForGuild(config.guildId);
                    missedCount++;
                }
            }

            if (missedCount > 0) {
                logger.success(`Processed ${missedCount} missed birthday check(s)`);
            }
        } catch (error) {
            logger.error('Error checking missed birthdays:', error);
        }
    }

    /**
     * Check all guilds for today's birthdays
     */
    async checkAllGuilds() {
        logger.info('Running daily birthday check...');

        try {
            const configs = await dbLog.select('birthdayConfig',
                () => db.select()
                    .from(birthdayConfig)
                    .where(eq(birthdayConfig.enabled, 1)),
                { enabled: 1 }
            );

            let totalAnnouncements = 0;

            for (const config of configs) {
                const announced = await this.checkBirthdaysForGuild(config.guildId);
                if (announced) totalAnnouncements++;
            }

            logger.success(`Birthday check complete: ${totalAnnouncements} announcement(s) sent`);
        } catch (error) {
            logger.error('Error during birthday check:', error);
        }
    }

    /**
     * Check birthdays for a specific guild
     * @param {string} guildId - Guild ID to check
     * @returns {boolean} - True if announcements were made
     */
    async checkBirthdaysForGuild(guildId) {
        try {
            // Get config
            const config = await dbLog.select('birthdayConfig',
                () => db.select()
                    .from(birthdayConfig)
                    .where(eq(birthdayConfig.guildId, guildId))
                    .get(),
                { guildId }
            );

            if (!config || !config.enabled) {
                return false;
            }

            // Get today's date
            const today = new Date();
            const month = today.getUTCMonth() + 1;
            const day = today.getUTCDate();

            // Check if this is a leap year
            const year = today.getUTCFullYear();
            const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);

            // Query for today's birthdays
            // Special case: Feb 28 in non-leap years also celebrates Feb 29 birthdays
            let birthdayQuery;

            if (month === 2 && day === 28 && !isLeapYear) {
                // Non-leap year Feb 28: check for both Feb 28 AND Feb 29 birthdays
                birthdayQuery = await dbLog.select('birthdays',
                    () => db.select()
                        .from(birthdays)
                        .where(and(
                            eq(birthdays.guildId, guildId),
                            eq(birthdays.month, 2),
                            or(
                                eq(birthdays.day, 28),
                                eq(birthdays.day, 29)
                            )
                        )),
                    { guildId, month: 2, day: '28+29' }
                );
            } else {
                // Normal day
                birthdayQuery = await dbLog.select('birthdays',
                    () => db.select()
                        .from(birthdays)
                        .where(and(
                            eq(birthdays.guildId, guildId),
                            eq(birthdays.month, month),
                            eq(birthdays.day, day)
                        )),
                    { guildId, month, day }
                );
            }

            if (birthdayQuery.length === 0) {
                // No birthdays today
                await dbLog.update('birthdayConfig',
                    () => db.update(birthdayConfig)
                        .set({ lastCheck: new Date() })
                        .where(eq(birthdayConfig.guildId, guildId)),
                    { guildId, operation: 'noBirthdays' }
                );
                return false;
            }

            // Fetch guild
            const guild = await this.client.guilds.fetch(guildId).catch(() => null);

            if (!guild) {
                logger.warn(`Guild ${guildId} not found, skipping birthday check`);
                return false;
            }

            // Filter to only members still in guild
            const validMembers = [];
            for (const birthday of birthdayQuery) {
                const member = await fetchMember(guild, birthday.userId, { logContext: 'birthday-check' });
                if (member) {
                    validMembers.push(member);
                }
            }

            if (validMembers.length === 0) {
                logger.debug(`No valid birthday members in guild ${guild.name}`);
                await dbLog.update('birthdayConfig',
                    () => db.update(birthdayConfig)
                        .set({ lastCheck: new Date() })
                        .where(eq(birthdayConfig.guildId, guildId)),
                    { guildId, operation: 'noValidMembers' }
                );
                return false;
            }

            // Get announcement channel
            const channel = await fetchChannel(this.client, config.channelId, { logContext: 'birthday-announcement-channel' });

            if (!channel) {
                // Channel deleted, disable system
                await dbLog.update('birthdayConfig',
                    () => db.update(birthdayConfig)
                        .set({ enabled: 0 })
                        .where(eq(birthdayConfig.guildId, guildId)),
                    { guildId, operation: 'channelDeleted' }
                );

                // Notify owner
                const owner = await guild.fetchOwner().catch(() => null);
                if (owner) {
                    await owner.send({
                        embeds: [embeds.warn(
                            'Birthday Announcements Disabled',
                            `The birthday announcement channel in **${guild.name}** was deleted. The birthday system has been disabled.\n\nUse \`/birthday setup\` to reconfigure.`
                        )]
                    }).catch(() => {
                        logger.warn(`Could not DM owner of ${guild.name} about birthday channel deletion`);
                    });
                }

                return false;
            }

            // Send birthday announcement
            const birthdayEmbed = this.createBirthdayEmbed(validMembers);

            await channel.send({
                content: validMembers.map(m => `<@${m.id}>`).join(' '),
                embeds: [birthdayEmbed]
            });

            logger.success(`🎂 Birthday announcement sent in ${guild.name} for ${validMembers.length} member(s)`);

            // Handle birthday role (if configured)
            if (config.roleId) {
                const role = guild.roles.cache.get(config.roleId);

                if (!role) {
                    logger.warn(`Birthday role ${config.roleId} not found in guild ${guild.name}`);
                } else {
                    // Assign role to birthday members
                    for (const member of validMembers) {
                        // Skip if already has role
                        if (member.roles.cache.has(role.id)) {
                            continue;
                        }

                        const addResult = await RoleManager.addRole(member, role, {
                            reason: 'Birthday role assigned',
                            logContext: 'birthday-role-assign'
                        });

                        if (!addResult.success) {
                            logger.error(`Failed to assign birthday role to ${member.user.tag}: ${addResult.error}`);
                            continue;
                        }

                        // Schedule role removal after 24 hours
                        const timeoutKey = `${member.id}_${guildId}`;
                        const timeout = setTimeout(async () => {
                            const refreshedMember = await fetchMember(guild, member.id, { logContext: 'birthday-role-removal' });
                            if (refreshedMember && refreshedMember.roles.cache.has(role.id)) {
                                await RoleManager.removeRole(refreshedMember, role, {
                                    reason: 'Birthday role expired (24h)',
                                    logContext: 'birthday-role-expire'
                                });
                            }
                            this.roleRemovalTimeouts.delete(timeoutKey);
                        }, 86400000); // 24 hours

                        this.roleRemovalTimeouts.set(timeoutKey, timeout);
                    }
                }
            }

            // Update lastCheck
            await dbLog.update('birthdayConfig',
                () => db.update(birthdayConfig)
                    .set({ lastCheck: new Date() })
                    .where(eq(birthdayConfig.guildId, guildId)),
                { guildId, operation: 'success' }
            );

            return true;

        } catch (error) {
            logger.error(`Error checking birthdays for guild ${guildId}:`, error);
            return false;
        }
    }

    /**
     * Create birthday announcement embed
     * @param {Array} members - Array of GuildMember objects
     * @returns {EmbedBuilder}
     */
    createBirthdayEmbed(members) {
        const randomMessages = [
            'Hope your special day is filled with joy!',
            'Another year older, another year wiser! 🎈',
            'May your birthday be as awesome as you are!',
            'Cheers to another trip around the sun! ☀️',
            'Have a fantastic birthday! 🥳',
            'Wishing you all the best on your special day!',
            'Time to celebrate another amazing year! 🎊',
            'Hope your day is filled with cake and happiness! 🍰'
        ];

        const randomMessage = randomMessages[Math.floor(Math.random() * randomMessages.length)];

        const embed = embeds.brand(
            '🎂 Happy Birthday! 🎉',
            `${randomMessage}\n\n${members.length > 1 ? 'Let\'s celebrate these wonderful members:' : 'Let\'s celebrate this wonderful member:'}`
        );

        embed.setFooter({ text: '🎈 Wishing you all the best!' });
        embed.setColor('#8A2BE2'); // Neon purple branding

        return embed;
    }

    /**
     * Get upcoming birthdays for a guild
     * @param {string} guildId - Guild ID
     * @param {number} days - Number of days to look ahead (default: 7)
     * @returns {Array} - Array of birthday objects with user info
     */
    async getUpcomingBirthdays(guildId, days = 7) {
        const today = new Date();
        const upcoming = [];

        // Check next X days
        for (let i = 1; i <= days; i++) {
            const checkDate = new Date(today);
            checkDate.setUTCDate(checkDate.getUTCDate() + i);

            const month = checkDate.getUTCMonth() + 1;
            const day = checkDate.getUTCDate();

            const birthdayList = await dbLog.select('birthdays',
                () => db.select()
                    .from(birthdays)
                    .where(and(
                        eq(birthdays.guildId, guildId),
                        eq(birthdays.month, month),
                        eq(birthdays.day, day)
                    )),
                { guildId, month, day }
            );

            for (const birthday of birthdayList) {
                upcoming.push({
                    ...birthday,
                    daysUntil: i,
                    date: checkDate
                });
            }
        }

        return upcoming;
    }

    /**
     * Cleanup on shutdown
     */
    cleanup() {
        logger.info('Cleaning up birthday service...');

        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }

        // Clear all role removal timeouts
        for (const timeout of this.roleRemovalTimeouts.values()) {
            clearTimeout(timeout);
        }

        this.roleRemovalTimeouts.clear();
    }
}

module.exports = BirthdayService;
