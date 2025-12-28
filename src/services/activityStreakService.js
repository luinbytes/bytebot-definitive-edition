const { db } = require('../database');
const {
    activityStreaks,
    activityAchievements,
    activityLogs,
    achievementDefinitions,
    customAchievements,
    achievementRoleConfig,
    achievementRoles
} = require('../database/schema');
const { eq, and, desc } = require('drizzle-orm');
const { PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');
const embeds = require('../utils/embeds');

/**
 * Achievement Manager - Loads and caches achievement definitions from database
 * Cache expires every hour to stay fresh with any definition updates
 */
class AchievementManager {
    constructor() {
        this.achievements = new Map(); // id -> achievement definition
        this.categoryMap = new Map(); // category -> [achievement_ids]
        this.rarityMap = new Map(); // rarity -> [achievement_ids]
        this.lastLoad = null;
        this.cacheExpiry = 3600000; // 1 hour in ms
    }

    /**
     * Load achievement definitions from database
     * Includes both core achievements and custom achievements
     */
    async loadDefinitions() {
        try {
            const now = Date.now();

            // Return cached if still valid
            if (this.lastLoad && (now - this.lastLoad) < this.cacheExpiry) {
                return;
            }

            logger.debug('Loading achievement definitions from database...');

            // Load core achievements from achievementDefinitions table
            const coreAchievements = await db.select()
                .from(achievementDefinitions);

            // Clear existing cache
            this.achievements.clear();
            this.categoryMap.clear();
            this.rarityMap.clear();

            // Populate maps
            for (const achievement of coreAchievements) {
                // Parse JSON criteria
                let criteria = {};
                try {
                    criteria = JSON.parse(achievement.criteria);
                } catch (e) {
                    logger.warn(`Invalid criteria JSON for achievement ${achievement.id}`);
                }

                // Store achievement with parsed criteria
                const achData = {
                    ...achievement,
                    criteria
                };

                this.achievements.set(achievement.id, achData);

                // Add to category map
                if (!this.categoryMap.has(achievement.category)) {
                    this.categoryMap.set(achievement.category, []);
                }
                this.categoryMap.get(achievement.category).push(achievement.id);

                // Add to rarity map
                if (!this.rarityMap.has(achievement.rarity)) {
                    this.rarityMap.set(achievement.rarity, []);
                }
                this.rarityMap.get(achievement.rarity).push(achievement.id);
            }

            this.lastLoad = now;
            logger.success(`Loaded ${this.achievements.size} achievement definitions`);

        } catch (error) {
            logger.error('Failed to load achievement definitions:', error);
        }
    }

    /**
     * Get achievement by ID
     * @param {string} id - Achievement ID
     * @returns {Object|null} - Achievement definition or null
     */
    async getById(id) {
        await this.loadDefinitions();
        return this.achievements.get(id) || null;
    }

    /**
     * Get all achievements
     * @returns {Array} - All achievement definitions
     */
    async getAll() {
        await this.loadDefinitions();
        return Array.from(this.achievements.values());
    }

    /**
     * Get achievements by category
     * @param {string} category - Category name
     * @returns {Array} - Matching achievement definitions
     */
    async getByCategory(category) {
        await this.loadDefinitions();
        const ids = this.categoryMap.get(category) || [];
        return ids.map(id => this.achievements.get(id)).filter(Boolean);
    }

    /**
     * Get achievements by rarity
     * @param {string} rarity - Rarity level
     * @returns {Array} - Matching achievement definitions
     */
    async getByRarity(rarity) {
        await this.loadDefinitions();
        const ids = this.rarityMap.get(rarity) || [];
        return ids.map(id => this.achievements.get(id)).filter(Boolean);
    }

    /**
     * Get all achievements that grant roles
     * @returns {Array} - Achievements with grantRole=true
     */
    async getAllGrantingRoles() {
        await this.loadDefinitions();
        return Array.from(this.achievements.values()).filter(a => a.grantRole);
    }

    /**
     * Get custom achievements for a guild
     * @param {string} guildId - Guild ID
     * @returns {Array} - Custom achievement definitions
     */
    async getCustomAchievements(guildId) {
        try {
            const custom = await db.select()
                .from(customAchievements)
                .where(and(
                    eq(customAchievements.guildId, guildId),
                    eq(customAchievements.enabled, true)
                ));

            return custom.map(ach => {
                // Parse JSON criteria
                let criteria = {};
                try {
                    criteria = ach.criteria ? JSON.parse(ach.criteria) : {};
                } catch (e) {
                    logger.warn(`Invalid criteria JSON for custom achievement ${ach.achievementId}`);
                }

                return {
                    ...ach,
                    criteria
                };
            });
        } catch (error) {
            logger.error(`Failed to load custom achievements for guild ${guildId}:`, error);
            return [];
        }
    }

    /**
     * Check if a seasonal achievement is currently active
     * @param {Object} achievement - Achievement definition
     * @param {Date} checkDate - Date to check (defaults to now)
     * @returns {boolean} - True if achievement is active/available
     */
    isSeasonalActive(achievement, checkDate = new Date()) {
        // Non-seasonal achievements are always active
        if (!achievement.seasonal) {
            return true;
        }

        // If no date range specified, treat as inactive
        if (!achievement.startDate || !achievement.endDate) {
            logger.warn(`Seasonal achievement ${achievement.id} missing date range`);
            return false;
        }

        const now = new Date(checkDate);
        const start = new Date(achievement.startDate);
        const end = new Date(achievement.endDate);

        // Handle year-agnostic seasonal events (e.g., Halloween every year)
        // If endDate < startDate, it means the event spans year boundary (Dec-Jan)
        if (end < start) {
            // Year-spanning event (e.g., Dec 20 - Jan 5)
            const currentYear = now.getFullYear();

            // Create two possible ranges:
            // 1. Event started last year, ends this year
            const range1Start = new Date(start);
            range1Start.setFullYear(currentYear - 1);
            const range1End = new Date(end);
            range1End.setFullYear(currentYear);

            // 2. Event starts this year, ends next year
            const range2Start = new Date(start);
            range2Start.setFullYear(currentYear);
            const range2End = new Date(end);
            range2End.setFullYear(currentYear + 1);

            return (now >= range1Start && now <= range1End) ||
                   (now >= range2Start && now <= range2End);
        }

        // Normal date range within same year (year-agnostic)
        // Match by month/day only, ignoring year
        const currentYear = now.getFullYear();
        const eventStart = new Date(start);
        eventStart.setFullYear(currentYear);
        const eventEnd = new Date(end);
        eventEnd.setFullYear(currentYear);

        return now >= eventStart && now <= eventEnd;
    }

    /**
     * Get all currently active seasonal achievements
     * @param {Date} checkDate - Date to check (defaults to now)
     * @returns {Array} - Active seasonal achievement definitions
     */
    async getActiveSeasonalAchievements(checkDate = new Date()) {
        await this.loadDefinitions();

        return Array.from(this.achievements.values()).filter(achievement => {
            return achievement.seasonal && this.isSeasonalActive(achievement, checkDate);
        });
    }

    /**
     * Get all seasonal achievements (active or not)
     * @returns {Array} - All seasonal achievement definitions
     */
    async getAllSeasonalAchievements() {
        await this.loadDefinitions();

        return Array.from(this.achievements.values()).filter(achievement => {
            return achievement.seasonal === true;
        });
    }

    /**
     * Check if an achievement can be awarded (respects seasonal windows)
     * @param {string} achievementId - Achievement ID to check
     * @param {Date} checkDate - Date to check (defaults to now)
     * @returns {boolean} - True if achievement can currently be awarded
     */
    async canAward(achievementId, checkDate = new Date()) {
        const achievement = await this.getById(achievementId);

        if (!achievement) {
            logger.warn(`Achievement ${achievementId} not found`);
            return false;
        }

        // For seasonal achievements, check if active
        if (achievement.seasonal) {
            return this.isSeasonalActive(achievement, checkDate);
        }

        // Non-seasonal achievements can always be awarded
        return true;
    }

    /**
     * Invalidate cache to force reload on next access
     */
    invalidateCache() {
        this.lastLoad = null;
    }
}

// Global achievement manager instance
const achievementManager = new AchievementManager();

class ActivityStreakService {
    constructor(client) {
        this.client = client;
        this.checkInterval = null;
        this.achievementManager = achievementManager; // Expose achievement manager
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
     * Record a reaction given by user
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     */
    async recordReaction(userId, guildId) {
        try {
            const today = this.getTodayDateString();
            const log = await this.getOrCreateTodayLog(userId, guildId, today);

            await db.update(activityLogs)
                .set({
                    reactionsGiven: log.reactionsGiven + 1,
                    updatedAt: new Date()
                })
                .where(and(
                    eq(activityLogs.userId, userId),
                    eq(activityLogs.guildId, guildId),
                    eq(activityLogs.activityDate, today)
                ));

            // Update streak
            await this.updateStreak(userId, guildId, today);

        } catch (error) {
            logger.error(`Error recording reaction for user ${userId}:`, error);
        }
    }

    /**
     * Record a voice channel join
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     */
    async recordChannelJoin(userId, guildId) {
        try {
            const today = this.getTodayDateString();
            const log = await this.getOrCreateTodayLog(userId, guildId, today);

            await db.update(activityLogs)
                .set({
                    channelsJoined: log.channelsJoined + 1,
                    updatedAt: new Date()
                })
                .where(and(
                    eq(activityLogs.userId, userId),
                    eq(activityLogs.guildId, guildId),
                    eq(activityLogs.activityDate, today)
                ));

            // Update streak
            await this.updateStreak(userId, guildId, today);

        } catch (error) {
            logger.error(`Error recording channel join for user ${userId}:`, error);
        }
    }

    /**
     * Record BytePod creation
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     */
    async recordBytepodCreation(userId, guildId) {
        try {
            const today = this.getTodayDateString();
            const log = await this.getOrCreateTodayLog(userId, guildId, today);

            await db.update(activityLogs)
                .set({
                    bytepodsCreated: log.bytepodsCreated + 1,
                    updatedAt: new Date()
                })
                .where(and(
                    eq(activityLogs.userId, userId),
                    eq(activityLogs.guildId, guildId),
                    eq(activityLogs.activityDate, today)
                ));

            // Update streak
            await this.updateStreak(userId, guildId, today);

            // Check for BytePod achievements
            const totals = await this.getUserTotals(userId, guildId);
            const streakData = await db.select()
                .from(activityStreaks)
                .where(and(
                    eq(activityStreaks.userId, userId),
                    eq(activityStreaks.guildId, guildId)
                ))
                .get();

            if (streakData) {
                await this.checkAndAwardAchievements(
                    userId,
                    guildId,
                    streakData.currentStreak,
                    streakData.totalActiveDays
                );
            }

        } catch (error) {
            logger.error(`Error recording BytePod creation for user ${userId}:`, error);
        }
    }

    /**
     * Record command usage (with unique command tracking)
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @param {string} commandName - Command name
     */
    async recordCommandUsage(userId, guildId, commandName) {
        try {
            const today = this.getTodayDateString();
            const log = await this.getOrCreateTodayLog(userId, guildId, today);

            // Parse existing unique commands
            let uniqueCommands = [];
            if (log.uniqueCommandsUsed) {
                try {
                    uniqueCommands = JSON.parse(log.uniqueCommandsUsed);
                } catch (e) {
                    uniqueCommands = [];
                }
            }

            // Add command if not already in list
            if (!uniqueCommands.includes(commandName)) {
                uniqueCommands.push(commandName);
            }

            await db.update(activityLogs)
                .set({
                    commandsRun: log.commandsRun + 1,
                    uniqueCommandsUsed: JSON.stringify(uniqueCommands),
                    updatedAt: new Date()
                })
                .where(and(
                    eq(activityLogs.userId, userId),
                    eq(activityLogs.guildId, guildId),
                    eq(activityLogs.activityDate, today)
                ));

            // Update streak
            await this.updateStreak(userId, guildId, today);

        } catch (error) {
            logger.error(`Error recording command usage for user ${userId}:`, error);
        }
    }

    /**
     * Record active hour (for time-based achievements)
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @param {number} hour - Hour (0-23)
     */
    async recordActiveHour(userId, guildId, hour) {
        try {
            const today = this.getTodayDateString();
            const log = await this.getOrCreateTodayLog(userId, guildId, today);

            // Parse existing active hours
            let activeHours = [];
            if (log.activeHours) {
                try {
                    activeHours = JSON.parse(log.activeHours);
                } catch (e) {
                    activeHours = [];
                }
            }

            // Add hour if not already in list
            if (!activeHours.includes(hour)) {
                activeHours.push(hour);
            }

            // Update first/last activity times
            const now = Date.now();
            const firstTime = log.firstActivityTime || now;
            const lastTime = now;

            await db.update(activityLogs)
                .set({
                    activeHours: JSON.stringify(activeHours),
                    firstActivityTime: firstTime,
                    lastActivityTime: lastTime,
                    updatedAt: new Date()
                })
                .where(and(
                    eq(activityLogs.userId, userId),
                    eq(activityLogs.guildId, guildId),
                    eq(activityLogs.activityDate, today)
                ));

        } catch (error) {
            logger.error(`Error recording active hour for user ${userId}:`, error);
        }
    }

    /**
     * Start a voice session (for marathon detection)
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @param {string} channelId - Voice channel ID
     */
    async startVoiceSession(userId, guildId, channelId) {
        try {
            // This is tracked for marathon achievement detection
            // Voice session data is stored in bytepodActiveSessions for BytePods
            // For general voice tracking, we just record the join
            logger.debug(`Voice session started: ${userId} in ${channelId}`);
        } catch (error) {
            logger.error(`Error starting voice session for user ${userId}:`, error);
        }
    }

    /**
     * End a voice session (calculate duration for marathon check)
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @param {string} channelId - Voice channel ID
     */
    async endVoiceSession(userId, guildId, channelId) {
        try {
            // This would check session duration for marathon achievement
            // For now, voice minutes are tracked via existing voice activity recording
            logger.debug(`Voice session ended: ${userId} from ${channelId}`);
        } catch (error) {
            logger.error(`Error ending voice session for user ${userId}:`, error);
        }
    }

    /**
     * Get or create today's activity log for a user
     * Helper method to reduce code duplication
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @param {string} today - Today's date string
     * @returns {Object} - Activity log
     */
    async getOrCreateTodayLog(userId, guildId, today) {
        try {
            const existingLog = await db.select()
                .from(activityLogs)
                .where(and(
                    eq(activityLogs.userId, userId),
                    eq(activityLogs.guildId, guildId),
                    eq(activityLogs.activityDate, today)
                ))
                .get();

            if (existingLog) {
                return existingLog;
            }

            // Create new log
            const newLog = {
                userId,
                guildId,
                activityDate: today,
                messageCount: 0,
                voiceMinutes: 0,
                commandsRun: 0,
                reactionsGiven: 0,
                channelsJoined: 0,
                bytepodsCreated: 0,
                uniqueCommandsUsed: '[]',
                activeHours: '[]',
                firstActivityTime: Date.now(),
                lastActivityTime: Date.now(),
                updatedAt: new Date()
            };

            await db.insert(activityLogs).values(newLog);

            return newLog;

        } catch (error) {
            logger.error(`Error getting/creating activity log for user ${userId}:`, error);
            throw error;
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
     * Check and award achievements across all categories
     * Orchestrates checking for streak, total, cumulative, special, combo, and meta achievements
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @param {number} currentStreak - Current streak value
     * @param {number} totalDays - Total active days
     */
    async checkAndAwardAchievements(userId, guildId, currentStreak, totalDays) {
        try {
            const toAward = [];

            // Get activity totals for cumulative/combo checks
            const totals = await this.getUserTotals(userId, guildId);

            // 1. Check streak achievements (exact matches)
            await this.checkStreakAchievements(currentStreak, toAward);

            // 2. Check total days achievements (threshold)
            await this.checkTotalDaysAchievements(totalDays, toAward);

            // 3. Check cumulative achievements (messages, voice, commands)
            await this.checkCumulativeAchievements(totals, toAward);

            // 4. Check combo achievements (multiple criteria)
            await this.checkComboAchievements(currentStreak, totalDays, totals, toAward);

            // 5. Check meta achievements (achievement count)
            await this.checkMetaAchievements(userId, guildId, toAward);

            // Award all newly earned achievements
            for (const achievementId of toAward) {
                await this.awardAchievement(userId, guildId, achievementId);
            }

        } catch (error) {
            logger.error(`Error checking achievements for user ${userId}:`, error);
        }
    }

    /**
     * Check streak achievements (exact milestone matches)
     * @param {number} currentStreak - Current streak value
     * @param {Array} toAward - Array to push achievement IDs into
     */
    async checkStreakAchievements(currentStreak, toAward) {
        const streakMilestones = [3, 5, 7, 10, 14, 21, 30, 45, 60, 90, 120, 150, 180, 270, 365, 500, 730, 1000];

        for (const milestone of streakMilestones) {
            if (currentStreak === milestone) {
                toAward.push(`streak_${milestone}`);
            }
        }
    }

    /**
     * Check total days achievements (threshold - award when reached or exceeded)
     * @param {number} totalDays - Total active days
     * @param {Array} toAward - Array to push achievement IDs into
     */
    async checkTotalDaysAchievements(totalDays, toAward) {
        const totalMilestones = [30, 50, 100, 150, 250, 365, 500, 750, 1000, 1500];

        for (const milestone of totalMilestones) {
            if (totalDays === milestone) {
                toAward.push(`total_${milestone}`);
            }
        }
    }

    /**
     * Check cumulative achievements (messages, voice hours, commands)
     * @param {Object} totals - User activity totals
     * @param {Array} toAward - Array to push achievement IDs into
     */
    async checkCumulativeAchievements(totals, toAward) {
        // Message milestones
        const messageMilestones = [100, 500, 1000, 5000, 10000, 25000, 50000, 100000];
        for (const milestone of messageMilestones) {
            if (totals.totalMessages === milestone) {
                toAward.push(`message_${milestone}`);
            }
        }

        // Voice hour milestones
        const voiceHours = Math.floor(totals.totalVoiceMinutes / 60);
        const voiceMilestones = [10, 50, 100, 250, 500, 1000, 2500, 5000];
        for (const milestone of voiceMilestones) {
            if (voiceHours === milestone) {
                toAward.push(`voice_${milestone}hrs`);
            }
        }

        // Command milestones
        const commandMilestones = [50, 250, 500, 1000, 2500, 5000, 10000];
        for (const milestone of commandMilestones) {
            if (totals.totalCommands === milestone) {
                toAward.push(`command_${milestone}`);
            }
        }

        // BytePod milestones
        if (totals.totalBytepods === 1) toAward.push('social_bytepod_creator');
        if (totals.totalBytepods === 50) toAward.push('social_bytepod_host');
        if (totals.totalBytepods === 200) toAward.push('social_bytepod_master');
    }

    /**
     * Check combo achievements (multiple criteria must be met)
     * @param {number} currentStreak - Current streak
     * @param {number} totalDays - Total active days
     * @param {Object} totals - User activity totals
     * @param {Array} toAward - Array to push achievement IDs into
     */
    async checkComboAchievements(currentStreak, totalDays, totals, toAward) {
        const voiceHours = Math.floor(totals.totalVoiceMinutes / 60);

        // Balanced User: 1k messages + 100 hours voice + 500 commands
        if (totals.totalMessages >= 1000 && voiceHours >= 100 && totals.totalCommands >= 500) {
            toAward.push('combo_balanced_user');
        }

        // Super Active: 30-day streak + 100 total days
        if (currentStreak >= 30 && totalDays >= 100) {
            toAward.push('combo_super_active');
        }

        // Ultimate Member: 10k messages + 500 hours voice + 1k commands
        if (totals.totalMessages >= 10000 && voiceHours >= 500 && totals.totalCommands >= 1000) {
            toAward.push('combo_ultimate_member');
        }

        // Triple Threat: 100-day streak + 500 total days + 5k messages
        if (currentStreak >= 100 && totalDays >= 500 && totals.totalMessages >= 5000) {
            toAward.push('combo_triple_threat');
        }

        // Consistency King: 180-day streak + 365+ total days
        if (currentStreak >= 180 && totalDays >= 365) {
            toAward.push('combo_consistency_king');
        }

        // Endurance Champion: 1k total days + 50k messages + 1k hours voice
        if (totalDays >= 1000 && totals.totalMessages >= 50000 && voiceHours >= 1000) {
            toAward.push('combo_endurance_champion');
        }
    }

    /**
     * Check meta achievements (achievement count milestones)
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @param {Array} toAward - Array to push achievement IDs into
     */
    async checkMetaAchievements(userId, guildId, toAward) {
        try {
            // Get current achievement count
            const achievements = await db.select()
                .from(activityAchievements)
                .where(and(
                    eq(activityAchievements.userId, userId),
                    eq(activityAchievements.guildId, guildId)
                ));

            const count = achievements.length + toAward.length; // Include pending awards

            // Meta milestones
            if (count === 10) toAward.push('meta_achievement_hunter');
            if (count === 25) toAward.push('meta_achievement_master');
            if (count === 50) toAward.push('meta_achievement_legend');
            if (count === 75) toAward.push('meta_achievement_god');
            if (count === 82) toAward.push('meta_completionist');

        } catch (error) {
            logger.error(`Error checking meta achievements for user ${userId}:`, error);
        }
    }

    /**
     * Get aggregated activity totals for a user
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @returns {Object} - Aggregated totals
     */
    async getUserTotals(userId, guildId) {
        try {
            const logs = await db.select()
                .from(activityLogs)
                .where(and(
                    eq(activityLogs.userId, userId),
                    eq(activityLogs.guildId, guildId)
                ));

            const totals = {
                totalMessages: 0,
                totalVoiceMinutes: 0,
                totalCommands: 0,
                totalReactions: 0,
                totalChannelsJoined: 0,
                totalBytepods: 0,
                uniqueCommands: new Set()
            };

            for (const log of logs) {
                totals.totalMessages += log.messageCount || 0;
                totals.totalVoiceMinutes += log.voiceMinutes || 0;
                totals.totalCommands += log.commandsRun || 0;
                totals.totalReactions += log.reactionsGiven || 0;
                totals.totalChannelsJoined += log.channelsJoined || 0;
                totals.totalBytepods += log.bytepodsCreated || 0;

                // Parse unique commands JSON
                if (log.uniqueCommandsUsed) {
                    try {
                        const commands = JSON.parse(log.uniqueCommandsUsed);
                        commands.forEach(cmd => totals.uniqueCommands.add(cmd));
                    } catch (e) {
                        // Invalid JSON, skip
                    }
                }
            }

            return {
                ...totals,
                uniqueCommandCount: totals.uniqueCommands.size
            };

        } catch (error) {
            logger.error(`Error getting user totals for ${userId}:`, error);
            return {
                totalMessages: 0,
                totalVoiceMinutes: 0,
                totalCommands: 0,
                totalReactions: 0,
                totalChannelsJoined: 0,
                totalBytepods: 0,
                uniqueCommandCount: 0
            };
        }
    }

    /**
     * Check if user has already earned an achievement
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @param {string} achievementId - Achievement ID
     * @returns {boolean} - True if already earned
     */
    async hasAchievement(userId, guildId, achievementId) {
        try {
            const existing = await db.select()
                .from(activityAchievements)
                .where(and(
                    eq(activityAchievements.userId, userId),
                    eq(activityAchievements.guildId, guildId),
                    eq(activityAchievements.achievementId, achievementId)
                ))
                .get();

            return !!existing;
        } catch (error) {
            logger.error(`Error checking achievement ${achievementId} for user ${userId}:`, error);
            return false;
        }
    }

    /**
     * Award an achievement to a user
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @param {string} achievementId - Achievement ID
     */
    async awardAchievement(userId, guildId, achievementId) {
        try {
            // Check if already earned
            if (await this.hasAchievement(userId, guildId, achievementId)) {
                return;
            }

            // Get achievement definition
            const achievement = await this.achievementManager.getById(achievementId);
            if (!achievement) {
                logger.warn(`Achievement ${achievementId} not found in definitions`);
                return;
            }

            // Validate seasonal achievement can be awarded
            if (achievement.seasonal) {
                const canAward = await this.achievementManager.canAward(achievementId);
                if (!canAward) {
                    logger.debug(`Seasonal achievement ${achievementId} not currently active, skipping award`);
                    return;
                }
            }

            // Insert into database
            await db.insert(activityAchievements).values({
                userId,
                guildId,
                achievementId,
                points: achievement.points,
                notified: false,
                earnedAt: new Date()
            });

            // Send DM notification
            await this.notifyAchievement(userId, guildId, achievementId);

            // Grant role reward if achievement provides one
            if (achievement.grantRole) {
                await this.grantAchievementRole(userId, guildId, achievement);
            }

            logger.success(`🏆 Awarded ${achievement.title} to user ${userId}`);

        } catch (error) {
            logger.error(`Error awarding achievement ${achievementId} to user ${userId}:`, error);
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
            const achievement = await this.achievementManager.getById(achievementId);
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

            // Load achievement definitions
            const achievementDefs = [];
            for (const ach of achievements) {
                const def = await this.achievementManager.getById(ach.achievementId);
                if (def) {
                    achievementDefs.push({
                        ...def,
                        earnedAt: ach.earnedAt,
                        points: ach.points
                    });
                }
            }

            return {
                ...streak,
                achievements: achievementDefs
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
     * Get rarity color code for role creation
     * @param {string} rarity - Achievement rarity
     * @returns {number} - Hex color code
     */
    getRarityColor(rarity) {
        const colors = {
            common: 0x95A5A6,      // Gray
            uncommon: 0x2ECC71,    // Green
            rare: 0x3498DB,        // Blue
            epic: 0x9B59B6,        // Purple
            legendary: 0xF39C12,   // Orange
            mythic: 0xE74C3C       // Red
        };
        return colors[rarity] || 0x8A2BE2; // Default to brand purple
    }

    /**
     * Get or create achievement role in guild
     * @param {Guild} guild - Discord guild
     * @param {Object} achievementDef - Achievement definition
     * @param {Object} config - Guild role config
     * @returns {Role|null} - Discord role or null on failure
     */
    async getOrCreateAchievementRole(guild, achievementDef, config) {
        try {
            // Check if role already exists in database
            const existingRole = await db.select()
                .from(achievementRoles)
                .where(and(
                    eq(achievementRoles.achievementId, achievementDef.id),
                    eq(achievementRoles.guildId, guild.id)
                ))
                .get();

            // If exists and role is still in Discord, return it
            if (existingRole) {
                const role = guild.roles.cache.get(existingRole.roleId);
                if (role) {
                    return role;
                } else {
                    // Role was deleted from Discord, clean up DB
                    await db.delete(achievementRoles)
                        .where(eq(achievementRoles.id, existingRole.id));
                    logger.debug(`Cleaned up orphaned role record for achievement ${achievementDef.id}`);
                }
            }

            // Create new role
            const roleName = `${config.rolePrefix} ${achievementDef.title}`;
            const roleColor = config.useRarityColors
                ? this.getRarityColor(achievementDef.rarity)
                : 0x8A2BE2; // Brand purple

            const newRole = await guild.roles.create({
                name: roleName,
                color: roleColor,
                reason: `Achievement: ${achievementDef.description}`,
                mentionable: false,
                hoist: false
            });

            // Store in database
            await db.insert(achievementRoles).values({
                achievementId: achievementDef.id,
                guildId: guild.id,
                roleId: newRole.id,
                createdAt: new Date()
            });

            logger.success(`Created achievement role: ${roleName} in ${guild.name}`);
            return newRole;

        } catch (error) {
            logger.error(`Failed to get or create achievement role for ${achievementDef.id}:`, error);
            return null;
        }
    }

    /**
     * Grant achievement role to user
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @param {Object} achievementDef - Achievement definition
     */
    async grantAchievementRole(userId, guildId, achievementDef) {
        try {
            // Check if achievement grants a role
            if (!achievementDef.grantRole) {
                return;
            }

            // Get guild role config
            const config = await db.select()
                .from(achievementRoleConfig)
                .where(eq(achievementRoleConfig.guildId, guildId))
                .get();

            // Default config if not set
            const roleConfig = config || {
                guildId,
                enabled: true,
                rolePrefix: '🏆',
                useRarityColors: true,
                cleanupOrphaned: true,
                notifyOnEarn: true
            };

            // Check if role rewards are enabled
            if (!roleConfig.enabled) {
                logger.debug(`Role rewards disabled for guild ${guildId}`);
                return;
            }

            // Fetch guild and member
            const guild = await this.client.guilds.fetch(guildId);
            if (!guild) {
                logger.warn(`Guild ${guildId} not found for role reward`);
                return;
            }

            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) {
                logger.warn(`Member ${userId} not found in guild ${guildId}`);
                return;
            }

            // Check bot permissions
            if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
                logger.warn(`Missing ManageRoles permission in guild ${guild.name}`);
                return;
            }

            // Get or create role
            const role = await this.getOrCreateAchievementRole(guild, achievementDef, roleConfig);
            if (!role) {
                logger.warn(`Failed to get role for achievement ${achievementDef.id}`);
                return;
            }

            // Check role hierarchy (bot's highest role must be above target role)
            if (guild.members.me.roles.highest.position <= role.position) {
                logger.warn(`Role hierarchy issue: Bot role not high enough to assign ${role.name}`);
                return;
            }

            // Assign role if user doesn't already have it
            if (!member.roles.cache.has(role.id)) {
                await member.roles.add(role, `Achievement earned: ${achievementDef.title}`);
                logger.success(`Granted role ${role.name} to ${member.user.tag} in ${guild.name}`);
            } else {
                logger.debug(`User ${userId} already has role ${role.name}`);
            }

        } catch (error) {
            logger.error(`Failed to grant achievement role for ${achievementDef.id}:`, error);
            // Don't crash - role rewards are optional
        }
    }

    /**
     * Clean up orphaned achievement roles
     * Removes roles that were deleted from Discord or have 0 members
     */
    async cleanupOrphanedRoles() {
        try {
            logger.info('Starting orphaned achievement role cleanup...');

            // Get all guilds with cleanup enabled
            const guildsWithCleanup = await db.select()
                .from(achievementRoleConfig)
                .where(eq(achievementRoleConfig.cleanupOrphaned, true));

            let totalCleaned = 0;
            let totalDeleted = 0;

            for (const config of guildsWithCleanup) {
                try {
                    // Fetch guild
                    const guild = await this.client.guilds.fetch(config.guildId).catch(() => null);
                    if (!guild) {
                        logger.debug(`Guild ${config.guildId} not found, skipping cleanup`);
                        continue;
                    }

                    // Get all achievement roles for this guild
                    const guildRoles = await db.select()
                        .from(achievementRoles)
                        .where(eq(achievementRoles.guildId, guild.id));

                    for (const roleRecord of guildRoles) {
                        const discordRole = guild.roles.cache.get(roleRecord.roleId);

                        // If role deleted from Discord, clean up DB
                        if (!discordRole) {
                            await db.delete(achievementRoles)
                                .where(eq(achievementRoles.id, roleRecord.id));

                            logger.debug(`Cleaned up orphaned role record for ${roleRecord.achievementId} in ${guild.name}`);
                            totalCleaned++;
                            continue;
                        }

                        // If role has 0 members, delete role and DB record
                        if (discordRole.members.size === 0) {
                            // Delete from Discord
                            await discordRole.delete('Achievement role cleanup: 0 members').catch((err) => {
                                logger.debug(`Failed to delete role ${discordRole.name}: ${err.message}`);
                            });

                            // Delete from DB
                            await db.delete(achievementRoles)
                                .where(eq(achievementRoles.id, roleRecord.id));

                            logger.debug(`Deleted unused role ${discordRole.name} in ${guild.name}`);
                            totalDeleted++;
                        }
                    }

                } catch (guildError) {
                    logger.error(`Error cleaning up roles for guild ${config.guildId}:`, guildError);
                }
            }

            logger.success(`Orphaned role cleanup complete: ${totalCleaned} records cleaned, ${totalDeleted} roles deleted`);

        } catch (error) {
            logger.error('Error during orphaned role cleanup:', error);
        }
    }

    /**
     * Cleanup on shutdown
     */
    cleanup() {
        logger.info('Cleaning up activity streak service...');

        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }

        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
    }
}

module.exports = ActivityStreakService;
