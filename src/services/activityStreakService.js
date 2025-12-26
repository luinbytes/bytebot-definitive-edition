const { db } = require('../database');
const { activityStreaks, activityAchievements, activityLogs } = require('../database/schema');
const { eq, and, desc } = require('drizzle-orm');
const logger = require('../utils/logger');
const embeds = require('../utils/embeds');

/**
 * Achievement definitions: milestone -> { id, title, description, emoji }
 */
const ACHIEVEMENTS = {
    streak_3: { id: 'streak_3', title: 'Getting Started', description: '3-day streak', emoji: '🔥' },
    streak_7: { id: 'streak_7', title: 'Week Warrior', description: '7-day streak', emoji: '⚡' },
    streak_14: { id: 'streak_14', title: 'Two-Week Champion', description: '14-day streak', emoji: '💪' },
    streak_30: { id: 'streak_30', title: 'Monthly Master', description: '30-day streak', emoji: '🏆' },
    streak_60: { id: 'streak_60', title: 'Dedicated Member', description: '60-day streak', emoji: '🌟' },
    streak_90: { id: 'streak_90', title: 'Quarterly King', description: '90-day streak', emoji: '👑' },
    streak_180: { id: 'streak_180', title: 'Half-Year Hero', description: '180-day streak', emoji: '💎' },
    streak_365: { id: 'streak_365', title: 'Annual Legend', description: '365-day streak', emoji: '🌈' },
    total_30: { id: 'total_30', title: 'Active Member', description: '30 total active days', emoji: '📅' },
    total_100: { id: 'total_100', title: 'Seasoned Veteran', description: '100 total active days', emoji: '🎖️' },
    total_365: { id: 'total_365', title: 'Year-Long Contributor', description: '365 total active days', emoji: '🎆' }
};

class ActivityStreakService {
    constructor(client) {
        this.client = client;
        this.checkInterval = null;
    }

    /**
     * Start the daily streak checker
     * Calculates time until next midnight UTC and sets up recurring checks
     */
    startDailyCheck() {
        // Calculate ms until next midnight UTC
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setUTCHours(24, 0, 0, 0);
        const msUntilMidnight = tomorrow - now;

        logger.info(`Activity Streak system initialized. First check in ${Math.round(msUntilMidnight / 60000)} minutes (at midnight UTC)`);

        // Check for missed streak updates on startup
        this.checkMissedDays();

        // Schedule first check at midnight
        setTimeout(() => {
            this.processDailyStreaks();

            // Then check every 24 hours
            this.checkInterval = setInterval(() => {
                this.processDailyStreaks();
            }, 86400000); // 24 hours
        }, msUntilMidnight);
    }

    /**
     * Check if bot missed any daily checks (was offline)
     */
    async checkMissedDays() {
        try {
            const allStreaks = await db.select()
                .from(activityStreaks);

            const today = this.getTodayDateString();
            const yesterday = this.getYesterdayDateString();
            let processedCount = 0;

            for (const streak of allStreaks) {
                // If lastActivityDate is neither today nor yesterday, streak may have broken
                if (streak.lastActivityDate &&
                    streak.lastActivityDate !== today &&
                    streak.lastActivityDate !== yesterday &&
                    streak.currentStreak > 0) {

                    const daysSinceActivity = this.getDaysBetween(streak.lastActivityDate, today);

                    // If more than 1 day gap and no freeze, streak broke
                    if (daysSinceActivity > 1 && streak.freezesAvailable === 0) {
                        logger.info(`Streak broken for user ${streak.userId} in guild ${streak.guildId} (${daysSinceActivity} days inactive)`);
                        await this.breakStreak(streak.userId, streak.guildId);
                        processedCount++;
                    } else if (daysSinceActivity > 1 && streak.freezesAvailable > 0) {
                        // Auto-use freeze for missed days
                        logger.info(`Auto-using freeze for user ${streak.userId} in guild ${streak.guildId}`);
                        await db.update(activityStreaks)
                            .set({
                                freezesAvailable: streak.freezesAvailable - 1,
                                updatedAt: new Date()
                            })
                            .where(and(
                                eq(activityStreaks.userId, streak.userId),
                                eq(activityStreaks.guildId, streak.guildId)
                            ));
                        processedCount++;
                    }
                }
            }

            if (processedCount > 0) {
                logger.success(`Processed ${processedCount} missed streak check(s)`);
            }
        } catch (error) {
            logger.error('Error checking missed streak days:', error);
        }
    }

    /**
     * Process daily streak updates for all users
     */
    async processDailyStreaks() {
        logger.info('Running daily activity streak check...');

        try {
            const allStreaks = await db.select()
                .from(activityStreaks);

            const today = this.getTodayDateString();
            const yesterday = this.getYesterdayDateString();
            let updatedCount = 0;

            for (const streak of allStreaks) {
                // Skip if user was active today (already updated)
                if (streak.lastActivityDate === today) {
                    continue;
                }

                // Check if user was active yesterday
                if (streak.lastActivityDate === yesterday) {
                    // User maintained their streak but hasn't been active today yet
                    // No action needed - wait for them to be active
                    continue;
                }

                // User missed yesterday - check for streak break
                if (streak.currentStreak > 0) {
                    if (streak.freezesAvailable > 0) {
                        // Auto-use freeze
                        logger.debug(`Auto-using freeze for user ${streak.userId} in guild ${streak.guildId}`);
                        await db.update(activityStreaks)
                            .set({
                                freezesAvailable: streak.freezesAvailable - 1,
                                updatedAt: new Date()
                            })
                            .where(and(
                                eq(activityStreaks.userId, streak.userId),
                                eq(activityStreaks.guildId, streak.guildId)
                            ));
                        updatedCount++;
                    } else {
                        // Break streak
                        await this.breakStreak(streak.userId, streak.guildId);
                        updatedCount++;
                    }
                }
            }

            // Reset monthly freezes (1st of each month)
            await this.resetMonthlyFreezes();

            logger.success(`Daily streak check complete: ${updatedCount} streak(s) processed`);
        } catch (error) {
            logger.error('Error during daily streak check:', error);
        }
    }

    /**
     * Record activity for a user
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @param {string} activityType - Type: 'message', 'voice', or 'command'
     * @param {number} value - Amount (1 for message/command, minutes for voice)
     */
    async recordActivity(userId, guildId, activityType, value = 1) {
        try {
            const today = this.getTodayDateString();

            // Update activity log for today
            const existingLog = await db.select()
                .from(activityLogs)
                .where(and(
                    eq(activityLogs.userId, userId),
                    eq(activityLogs.guildId, guildId),
                    eq(activityLogs.activityDate, today)
                ))
                .get();

            if (existingLog) {
                // Update existing log
                const updates = { updatedAt: new Date() };
                if (activityType === 'message') updates.messageCount = existingLog.messageCount + value;
                if (activityType === 'voice') updates.voiceMinutes = existingLog.voiceMinutes + value;
                if (activityType === 'command') updates.commandsRun = existingLog.commandsRun + value;

                await db.update(activityLogs)
                    .set(updates)
                    .where(and(
                        eq(activityLogs.userId, userId),
                        eq(activityLogs.guildId, guildId),
                        eq(activityLogs.activityDate, today)
                    ));
            } else {
                // Create new log
                const logData = {
                    userId,
                    guildId,
                    activityDate: today,
                    messageCount: activityType === 'message' ? value : 0,
                    voiceMinutes: activityType === 'voice' ? value : 0,
                    commandsRun: activityType === 'command' ? value : 0,
                    updatedAt: new Date()
                };

                await db.insert(activityLogs).values(logData);
            }

            // Update streak
            await this.updateStreak(userId, guildId, today);

        } catch (error) {
            logger.error(`Error recording activity for user ${userId}:`, error);
        }
    }

    /**
     * Update user's streak
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @param {string} today - Today's date string (YYYY-MM-DD)
     */
    async updateStreak(userId, guildId, today) {
        try {
            const existing = await db.select()
                .from(activityStreaks)
                .where(and(
                    eq(activityStreaks.userId, userId),
                    eq(activityStreaks.guildId, guildId)
                ))
                .get();

            if (!existing) {
                // Create new streak record
                await db.insert(activityStreaks).values({
                    userId,
                    guildId,
                    currentStreak: 1,
                    longestStreak: 1,
                    lastActivityDate: today,
                    totalActiveDays: 1,
                    freezesAvailable: 1,
                    lastFreezeReset: new Date(),
                    createdAt: new Date(),
                    updatedAt: new Date()
                });

                // Award first achievement
                await this.checkAndAwardAchievements(userId, guildId, 1, 1);
                return;
            }

            // If already active today, skip
            if (existing.lastActivityDate === today) {
                return;
            }

            const yesterday = this.getYesterdayDateString();
            let newStreak = existing.currentStreak;
            let newTotalDays = existing.totalActiveDays + 1;

            // Check if continuing streak
            if (existing.lastActivityDate === yesterday) {
                // Continuing streak
                newStreak += 1;
            } else {
                // Streak was broken or frozen, start new
                newStreak = 1;
            }

            const newLongest = Math.max(existing.longestStreak, newStreak);

            await db.update(activityStreaks)
                .set({
                    currentStreak: newStreak,
                    longestStreak: newLongest,
                    lastActivityDate: today,
                    totalActiveDays: newTotalDays,
                    updatedAt: new Date()
                })
                .where(and(
                    eq(activityStreaks.userId, userId),
                    eq(activityStreaks.guildId, guildId)
                ));

            // Check for achievements
            await this.checkAndAwardAchievements(userId, guildId, newStreak, newTotalDays);

        } catch (error) {
            logger.error(`Error updating streak for user ${userId}:`, error);
        }
    }

    /**
     * Break a user's streak
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     */
    async breakStreak(userId, guildId) {
        try {
            await db.update(activityStreaks)
                .set({
                    currentStreak: 0,
                    updatedAt: new Date()
                })
                .where(and(
                    eq(activityStreaks.userId, userId),
                    eq(activityStreaks.guildId, guildId)
                ));

            logger.debug(`Streak broken for user ${userId} in guild ${guildId}`);
        } catch (error) {
            logger.error(`Error breaking streak for user ${userId}:`, error);
        }
    }

    /**
     * Check and award achievements for milestones
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @param {number} currentStreak - Current streak value
     * @param {number} totalDays - Total active days
     */
    async checkAndAwardAchievements(userId, guildId, currentStreak, totalDays) {
        try {
            const toCheck = [];

            // Check streak milestones
            const streakMilestones = [3, 7, 14, 30, 60, 90, 180, 365];
            for (const milestone of streakMilestones) {
                if (currentStreak === milestone) {
                    toCheck.push(`streak_${milestone}`);
                }
            }

            // Check total days milestones
            const totalMilestones = [30, 100, 365];
            for (const milestone of totalMilestones) {
                if (totalDays === milestone) {
                    toCheck.push(`total_${milestone}`);
                }
            }

            // Award new achievements
            for (const achievementId of toCheck) {
                const existing = await db.select()
                    .from(activityAchievements)
                    .where(and(
                        eq(activityAchievements.userId, userId),
                        eq(activityAchievements.guildId, guildId),
                        eq(activityAchievements.achievementId, achievementId)
                    ))
                    .get();

                if (!existing) {
                    await db.insert(activityAchievements).values({
                        userId,
                        guildId,
                        achievementId,
                        earnedAt: new Date()
                    });

                    // Send DM notification
                    await this.notifyAchievement(userId, guildId, achievementId);
                }
            }
        } catch (error) {
            logger.error(`Error checking achievements for user ${userId}:`, error);
        }
    }

    /**
     * Notify user of new achievement
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @param {string} achievementId - Achievement ID
     */
    async notifyAchievement(userId, guildId, achievementId) {
        try {
            const achievement = ACHIEVEMENTS[achievementId];
            if (!achievement) return;

            const user = await this.client.users.fetch(userId).catch(() => null);
            if (!user) return;

            const guild = await this.client.guilds.fetch(guildId).catch(() => null);
            const guildName = guild ? guild.name : 'Unknown Server';

            const embed = embeds.success(
                `${achievement.emoji} Achievement Unlocked!`,
                `**${achievement.title}**\n${achievement.description}\n\nEarned in: **${guildName}**\n\nKeep up the great work!`
            );

            await user.send({ embeds: [embed] }).catch(() => {
                logger.debug(`Could not DM achievement to user ${userId}`);
            });

            logger.success(`🏆 Achievement unlocked: ${achievement.title} for user ${userId}`);
        } catch (error) {
            logger.error(`Error notifying achievement for user ${userId}:`, error);
        }
    }

    /**
     * Reset monthly freezes (1st of each month)
     */
    async resetMonthlyFreezes() {
        try {
            const now = new Date();
            const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

            // Only reset on the 1st of the month
            if (now.getDate() !== 1) {
                return;
            }

            const allStreaks = await db.select()
                .from(activityStreaks);

            let resetCount = 0;

            for (const streak of allStreaks) {
                // Check if last reset was in a previous month
                const lastReset = streak.lastFreezeReset ? new Date(streak.lastFreezeReset) : null;

                if (!lastReset || lastReset < firstOfMonth) {
                    await db.update(activityStreaks)
                        .set({
                            freezesAvailable: 1,
                            lastFreezeReset: now,
                            updatedAt: now
                        })
                        .where(and(
                            eq(activityStreaks.userId, streak.userId),
                            eq(activityStreaks.guildId, streak.guildId)
                        ));
                    resetCount++;
                }
            }

            if (resetCount > 0) {
                logger.success(`Reset monthly freezes for ${resetCount} user(s)`);
            }
        } catch (error) {
            logger.error('Error resetting monthly freezes:', error);
        }
    }

    /**
     * Get streak data for a user
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @returns {Object|null} - Streak data or null if not found
     */
    async getUserStreak(userId, guildId) {
        try {
            const streak = await db.select()
                .from(activityStreaks)
                .where(and(
                    eq(activityStreaks.userId, userId),
                    eq(activityStreaks.guildId, guildId)
                ))
                .get();

            if (!streak) {
                return null;
            }

            // Get achievements
            const achievements = await db.select()
                .from(activityAchievements)
                .where(and(
                    eq(activityAchievements.userId, userId),
                    eq(activityAchievements.guildId, guildId)
                ));

            return {
                ...streak,
                achievements: achievements.map(a => ACHIEVEMENTS[a.achievementId]).filter(Boolean)
            };
        } catch (error) {
            logger.error(`Error getting user streak for ${userId}:`, error);
            return null;
        }
    }

    /**
     * Get guild leaderboard
     * @param {string} guildId - Guild ID
     * @param {string} type - 'current' or 'longest'
     * @param {number} limit - Number of results (default: 10)
     * @returns {Array} - Leaderboard data
     */
    async getLeaderboard(guildId, type = 'current', limit = 10) {
        try {
            const orderColumn = type === 'longest' ? activityStreaks.longestStreak : activityStreaks.currentStreak;

            const results = await db.select()
                .from(activityStreaks)
                .where(eq(activityStreaks.guildId, guildId))
                .orderBy(desc(orderColumn))
                .limit(limit);

            return results.filter(r => (type === 'longest' ? r.longestStreak : r.currentStreak) > 0);
        } catch (error) {
            logger.error(`Error getting leaderboard for guild ${guildId}:`, error);
            return [];
        }
    }

    /**
     * Get today's date as YYYY-MM-DD string
     * @returns {string}
     */
    getTodayDateString() {
        const now = new Date();
        return now.toISOString().split('T')[0];
    }

    /**
     * Get yesterday's date as YYYY-MM-DD string
     * @returns {string}
     */
    getYesterdayDateString() {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        return yesterday.toISOString().split('T')[0];
    }

    /**
     * Get number of days between two date strings
     * @param {string} date1 - First date (YYYY-MM-DD)
     * @param {string} date2 - Second date (YYYY-MM-DD)
     * @returns {number} - Days difference
     */
    getDaysBetween(date1, date2) {
        const d1 = new Date(date1);
        const d2 = new Date(date2);
        const diffTime = Math.abs(d2 - d1);
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    /**
     * Cleanup on shutdown
     */
    cleanup() {
        logger.info('Cleaning up activity streak service...');

        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
    }
}

module.exports = ActivityStreakService;
