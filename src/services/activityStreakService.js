const { db } = require('../database');
const {
    activityStreaks,
    activityAchievements,
    activityLogs,
    achievementDefinitions,
    customAchievements,
    achievementRoleConfig,
    achievementRoles,
    guilds,
    users
} = require('../database/schema');
const { eq, and, desc } = require('drizzle-orm');
const { PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');
const embeds = require('../utils/embeds');
const { dbLog } = require('../utils/dbLogger');
const { getOne } = require('../utils/dbUtil');
const { fetchMember, RoleManager } = require('../utils/discordApiUtil');

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
     * Auto-seeds achievements on first run if database is empty
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
            let coreAchievements = await dbLog.select('achievementDefinitions',
                () => db.select()
                    .from(achievementDefinitions),
                {}
            );

            // Auto-seed if database is empty OR has missing achievements
            // Clear require cache to ensure fresh data
            const achievementPath = require.resolve('../data/achievementDefinitions');
            delete require.cache[achievementPath];

            const { ALL_ACHIEVEMENTS } = require('../data/achievementDefinitions');
            const expectedCount = ALL_ACHIEVEMENTS.length;

            if (coreAchievements.length === 0) {
                logger.info('Achievement database is empty - auto-seeding achievements...');
                await this.seedAchievements();

                // Reload after seeding
                coreAchievements = await dbLog.select('achievementDefinitions',
                    () => db.select()
                        .from(achievementDefinitions),
                    { operation: 'reload after empty seed' }
                );
            } else if (coreAchievements.length < expectedCount) {
                logger.info(`Achievement database incomplete (${coreAchievements.length}/${expectedCount}) - inserting missing achievements...`);
                await this.seedAchievements();

                // Reload after seeding
                coreAchievements = await dbLog.select('achievementDefinitions',
                    () => db.select()
                        .from(achievementDefinitions),
                    { operation: 'reload after incomplete seed' }
                );
            }

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
     * Auto-seed achievement definitions into database
     * Called automatically on first run when database is empty
     */
    async seedAchievements() {
        try {
            // Clear require cache to ensure fresh data
            const achievementPath = require.resolve('../data/achievementDefinitions');
            delete require.cache[achievementPath];

            const { ALL_ACHIEVEMENTS } = require('../data/achievementDefinitions');

            logger.info(`Seeding ${ALL_ACHIEVEMENTS.length} achievements...`);

            let inserted = 0;

            for (const achievement of ALL_ACHIEVEMENTS) {
                try {
                    // Convert string dates to Date objects for seasonal achievements
                    const achievementData = {
                        ...achievement,
                        createdAt: new Date()
                    };

                    // Convert startDate/endDate from strings to Date objects if present
                    if (achievement.startDate && typeof achievement.startDate === 'string') {
                        achievementData.startDate = new Date(achievement.startDate);
                    }
                    if (achievement.endDate && typeof achievement.endDate === 'string') {
                        achievementData.endDate = new Date(achievement.endDate);
                    }

                    // Debug: Check if checkType exists
                    if (!achievementData.checkType) {
                        logger.warn(`Achievement ${achievement.id} is missing checkType!`);
                        logger.debug('Achievement data:', JSON.stringify(achievement, null, 2));
                    }

                    await dbLog.insert('achievementDefinitions',
                        () => db.insert(achievementDefinitions).values(achievementData),
                        { achievementId: achievement.id }
                    );
                    inserted++;
                } catch (error) {
                    // Silently skip duplicates (should never happen on first run)
                    if (!error.message?.includes('UNIQUE constraint')) {
                        logger.debug(`Skipped ${achievement.id}:`, error.message);
                    }
                }
            }

            logger.success(`✅ Auto-seeded ${inserted} achievements (${ALL_ACHIEVEMENTS.length} total)`);

        } catch (error) {
            logger.error('Failed to auto-seed achievements:', error);
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
            const custom = await dbLog.select('customAchievements',
                () => db.select()
                    .from(customAchievements)
                    .where(and(
                        eq(customAchievements.guildId, guildId),
                        eq(customAchievements.enabled, true)
                    )),
                { guildId }
            );

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
     * Check if achievements are enabled for a guild
     * @param {string} guildId - Guild ID to check
     * @returns {Promise<boolean>} - True if enabled (or not explicitly disabled), false if disabled
     */
    async isAchievementsEnabled(guildId) {
        try {
            const guild = await dbLog.select('guilds',
                () => db.select()
                    .from(guilds)
                    .where(eq(guilds.id, guildId))
                    .get(),
                { guildId, operation: 'checkAchievementsEnabled' }
            );

            // If guild record doesn't exist, or achievementsEnabled is not explicitly false, return true (enabled by default)
            return !guild || guild.achievementsEnabled !== false;

        } catch (error) {
            logger.error(`Error checking if achievements are enabled for guild ${guildId}:`, error);
            // On error, default to enabled to avoid breaking existing functionality
            return true;
        }
    }

    /**
     * Check if a user has opted out of achievements globally
     * @param {string} userId - User ID to check
     * @returns {Promise<boolean>} - True if user has opted out, false otherwise
     */
    async isUserOptedOut(userId) {
        try {
            const user = await dbLog.select('users',
                () => db.select()
                    .from(users)
                    .where(eq(users.id, userId))
                    .get(),
                { userId, operation: 'checkUserOptOut' }
            );

            return user?.achievementsOptedOut === true;

        } catch (error) {
            logger.error(`Error checking user opt-out for ${userId}:`, error);
            // On error, default to NOT opted out (continue tracking)
            return false;
        }
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
            const allStreaks = await dbLog.select('activityStreaks',
                () => db.select()
                    .from(activityStreaks),
                { operation: 'checkMissedDays' }
            );

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
                        await dbLog.update('activityStreaks',
                            () => db.update(activityStreaks)
                                .set({
                                    freezesAvailable: streak.freezesAvailable - 1,
                                    updatedAt: new Date()
                                })
                                .where(and(
                                    eq(activityStreaks.userId, streak.userId),
                                    eq(activityStreaks.guildId, streak.guildId)
                                )),
                            { userId: streak.userId, guildId: streak.guildId, operation: 'auto-freeze' }
                        );
                        processedCount++;
                    }
                }
            }

            if (processedCount > 0) {
                logger.success(`Processed ${processedCount} missed streak check(s)`);
            }

            // Check for achievements that should have been awarded
            await this.processMissedAchievements();

        } catch (error) {
            logger.error('Error checking missed streak days:', error);
        }
    }

    /**
     * Process achievements for users who earned them while bot was down
     * Checks all users with activity data and awards missing achievements
     */
    async processMissedAchievements() {
        try {
            logger.info('Checking for achievements earned while bot was offline...');

            // Get all users with activity data
            const allStreaks = await dbLog.select('activityStreaks',
                () => db.select()
                    .from(activityStreaks),
                { operation: 'processMissedAchievements' }
            );

            let checkedUsers = 0;
            let awardsGranted = 0;

            for (const streak of allStreaks) {
                try {
                    const beforeCount = await dbLog.select('activityAchievements',
                        () => db.select()
                            .from(activityAchievements)
                            .where(and(
                                eq(activityAchievements.userId, streak.userId),
                                eq(activityAchievements.guildId, streak.guildId)
                            )),
                        { userId: streak.userId, guildId: streak.guildId, operation: 'before' }
                    );

                    // Check all achievements for this user
                    await this.checkAllAchievements(streak.userId, streak.guildId);

                    const afterCount = await dbLog.select('activityAchievements',
                        () => db.select()
                            .from(activityAchievements)
                            .where(and(
                                eq(activityAchievements.userId, streak.userId),
                                eq(activityAchievements.guildId, streak.guildId)
                            )),
                        { userId: streak.userId, guildId: streak.guildId, operation: 'after' }
                    );

                    const newAchievements = afterCount.length - beforeCount.length;
                    if (newAchievements > 0) {
                        awardsGranted += newAchievements;
                    }

                    checkedUsers++;
                } catch (error) {
                    logger.debug(`Error checking achievements for user ${streak.userId}:`, error.message);
                }
            }

            if (checkedUsers > 0) {
                logger.success(`Checked achievements for ${checkedUsers} users on startup (${awardsGranted} new achievements awarded)`);
            }

        } catch (error) {
            logger.error('Error processing missed achievements:', error);
        }
    }

    /**
     * Check all achievements for a specific user
     * Awards any achievements they've earned but haven't been granted yet
     *
     * This method:
     * 1. Gets user's streak data and activity logs
     * 2. Checks each achievement category (streak, total, cumulative, combo, meta)
     * 3. Awards any newly-earned achievements
     * 4. Sends DM notifications
     * 5. Grants roles if enabled
     */
    async checkAllAchievements(userId, guildId) {
        try {
            // Get user's streak data
            const streakData = await dbLog.select('activityStreaks',
                () => db.select()
                    .from(activityStreaks)
                    .where(and(
                        eq(activityStreaks.userId, userId),
                        eq(activityStreaks.guildId, guildId)
                    ))
                    .get(),
                { userId, guildId }
            );

            if (!streakData) {
                logger.debug(`No streak data for user ${userId} in guild ${guildId}`);
                return;
            }

            // Get user's cumulative activity totals
            const totals = await this.getUserTotals(userId, guildId);

            // Array to collect achievements to award
            const toAward = [];

            // Check all achievement categories
            await this.checkStreakAchievements(userId, guildId, streakData.currentStreak, toAward);
            await this.checkTotalDaysAchievements(userId, guildId, streakData.totalActiveDays, toAward);
            await this.checkCumulativeAchievements(userId, guildId, totals, toAward);
            await this.checkComboAchievements(userId, guildId, streakData.currentStreak, streakData.totalActiveDays, totals, toAward);
            await this.checkMetaAchievements(userId, guildId, toAward);

            // Award each eligible achievement
            for (const achievementId of toAward) {
                await this.awardAchievement(userId, guildId, achievementId);
            }

            if (toAward.length > 0) {
                logger.success(`Awarded ${toAward.length} achievements to user ${userId} in guild ${guildId}`);
            }

        } catch (error) {
            logger.error(`Error checking all achievements for user ${userId}:`, error);
        }
    }

    /**
     * Process daily streak updates for all users
     */
    async processDailyStreaks() {
        logger.info('Running daily activity streak check...');

        try {
            const allStreaks = await dbLog.select('activityStreaks',
                () => db.select()
                    .from(activityStreaks),
                { operation: 'processDailyStreaks' }
            );

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
                        await dbLog.update('activityStreaks',
                            () => db.update(activityStreaks)
                                .set({
                                    freezesAvailable: streak.freezesAvailable - 1,
                                    updatedAt: new Date()
                                })
                                .where(and(
                                    eq(activityStreaks.userId, streak.userId),
                                    eq(activityStreaks.guildId, streak.guildId)
                                )),
                            { userId: streak.userId, guildId: streak.guildId, operation: 'daily-auto-freeze' }
                        );
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
            const existingLog = await dbLog.select('activityLogs',
                () => db.select()
                    .from(activityLogs)
                    .where(and(
                        eq(activityLogs.userId, userId),
                        eq(activityLogs.guildId, guildId),
                        eq(activityLogs.activityDate, today)
                    ))
                    .get(),
                { userId, guildId, activityDate: today }
            );

            if (existingLog) {
                // Update existing log
                const updates = { updatedAt: new Date() };
                if (activityType === 'message') updates.messageCount = existingLog.messageCount + value;
                if (activityType === 'voice') updates.voiceMinutes = existingLog.voiceMinutes + value;
                if (activityType === 'command') updates.commandsRun = existingLog.commandsRun + value;

                await dbLog.update('activityLogs',
                    () => db.update(activityLogs)
                        .set(updates)
                        .where(and(
                            eq(activityLogs.userId, userId),
                            eq(activityLogs.guildId, guildId),
                            eq(activityLogs.activityDate, today)
                        )),
                    { userId, guildId, activityDate: today, activityType }
                );
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

                await dbLog.insert('activityLogs',
                    () => db.insert(activityLogs).values(logData),
                    { userId, guildId, activityDate: today, activityType }
                );
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

            await dbLog.update('activityLogs',
                () => db.update(activityLogs)
                    .set({
                        reactionsGiven: log.reactionsGiven + 1,
                        updatedAt: new Date()
                    })
                    .where(and(
                        eq(activityLogs.userId, userId),
                        eq(activityLogs.guildId, guildId),
                        eq(activityLogs.activityDate, today)
                    )),
                { userId, guildId, activityDate: today, operation: 'reaction' }
            );

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

            await dbLog.update('activityLogs',
                () => db.update(activityLogs)
                    .set({
                        channelsJoined: log.channelsJoined + 1,
                        updatedAt: new Date()
                    })
                    .where(and(
                        eq(activityLogs.userId, userId),
                        eq(activityLogs.guildId, guildId),
                        eq(activityLogs.activityDate, today)
                    )),
                { userId, guildId, activityDate: today, operation: 'channelJoin' }
            );

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

            await dbLog.update('activityLogs',
                () => db.update(activityLogs)
                    .set({
                        bytepodsCreated: log.bytepodsCreated + 1,
                        updatedAt: new Date()
                    })
                    .where(and(
                        eq(activityLogs.userId, userId),
                        eq(activityLogs.guildId, guildId),
                        eq(activityLogs.activityDate, today)
                    )),
                { userId, guildId, activityDate: today, operation: 'bytepod' }
            );

            // Update streak (now checks achievements for cumulative values)
            await this.updateStreak(userId, guildId, today);

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

            await dbLog.update('activityLogs',
                () => db.update(activityLogs)
                    .set({
                        commandsRun: log.commandsRun + 1,
                        uniqueCommandsUsed: JSON.stringify(uniqueCommands),
                        updatedAt: new Date()
                    })
                    .where(and(
                        eq(activityLogs.userId, userId),
                        eq(activityLogs.guildId, guildId),
                        eq(activityLogs.activityDate, today)
                    )),
                { userId, guildId, activityDate: today, commandName }
            );

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

            await dbLog.update('activityLogs',
                () => db.update(activityLogs)
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
                    )),
                { userId, guildId, activityDate: today, hour }
            );

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
            const existingLog = await getOne(
                activityLogs,
                () => and(
                    eq(activityLogs.userId, userId),
                    eq(activityLogs.guildId, guildId),
                    eq(activityLogs.activityDate, today)
                ),
                { userId, guildId, activityDate: today, operation: 'get-or-create-log' }
            );

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

            await dbLog.insert('activityLogs',
                () => db.insert(activityLogs).values(newLog),
                { userId, guildId, activityDate: today }
            );

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
            // Check if achievements are enabled for this guild
            const achievementsEnabled = await this.isAchievementsEnabled(guildId);
            if (!achievementsEnabled) {
                return;
            }

            // Check if user has opted out globally
            if (await this.isUserOptedOut(userId)) {
                return;
            }

            const existing = await dbLog.select('activityStreaks',
                () => db.select()
                    .from(activityStreaks)
                    .where(and(
                        eq(activityStreaks.userId, userId),
                        eq(activityStreaks.guildId, guildId)
                    ))
                    .get(),
                { userId, guildId }
            );

            if (!existing) {
                // Create new streak record
                await dbLog.insert('activityStreaks',
                    () => db.insert(activityStreaks).values({
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
                    }),
                    { userId, guildId, operation: 'newStreak' }
                );

                // Award first achievement
                await this.checkAndAwardAchievements(userId, guildId, 1, 1);
                return;
            }

            // If already active today, streak doesn't change but we still check cumulative achievements
            if (existing.lastActivityDate === today) {
                // Streak and total days haven't changed, but cumulative values (messages, voice, commands)
                // may have increased, so check for achievements that depend on cumulative totals
                await this.checkAndAwardAchievements(
                    userId,
                    guildId,
                    existing.currentStreak,
                    existing.totalActiveDays
                );
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

            await dbLog.update('activityStreaks',
                () => db.update(activityStreaks)
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
                    )),
                { userId, guildId, newStreak, newTotalDays }
            );

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
            await dbLog.update('activityStreaks',
                () => db.update(activityStreaks)
                    .set({
                        currentStreak: 0,
                        updatedAt: new Date()
                    })
                    .where(and(
                        eq(activityStreaks.userId, userId),
                        eq(activityStreaks.guildId, guildId)
                    )),
                { userId, guildId, operation: 'breakStreak' }
            );

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

            // 1. Check streak achievements (threshold-based)
            await this.checkStreakAchievements(userId, guildId, currentStreak, toAward);

            // 2. Check total days achievements (threshold)
            await this.checkTotalDaysAchievements(userId, guildId, totalDays, toAward);

            // 3. Check cumulative achievements (messages, voice, commands)
            await this.checkCumulativeAchievements(userId, guildId, totals, toAward);

            // 4. Check combo achievements (multiple criteria)
            await this.checkComboAchievements(userId, guildId, currentStreak, totalDays, totals, toAward);

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
     * Check streak achievements (threshold - award when reached)
     * Only awards each achievement once by checking if user has already earned it
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @param {number} currentStreak - Current streak value
     * @param {Array} toAward - Array to push achievement IDs into
     */
    async checkStreakAchievements(userId, guildId, currentStreak, toAward) {
        const streakMilestones = [3, 5, 7, 10, 14, 21, 30, 45, 60, 90, 120, 150, 180, 270, 365, 500, 730, 1000];

        for (const milestone of streakMilestones) {
            // Check if user has reached this milestone
            if (currentStreak >= milestone) {
                const achievementId = `streak_${milestone}`;

                // Only add if not already earned (prevents duplicates)
                if (!await this.hasAchievement(userId, guildId, achievementId)) {
                    toAward.push(achievementId);
                }
            }
        }
    }

    /**
     * Check total days achievements (threshold - award when reached or exceeded)
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @param {number} totalDays - Total active days
     * @param {Array} toAward - Array to push achievement IDs into
     */
    async checkTotalDaysAchievements(userId, guildId, totalDays, toAward) {
        const totalMilestones = [30, 50, 100, 150, 250, 365, 500, 750, 1000, 1500];

        for (const milestone of totalMilestones) {
            if (totalDays >= milestone) {
                const achievementId = `total_${milestone}`;

                // Only add if not already earned
                if (!await this.hasAchievement(userId, guildId, achievementId)) {
                    toAward.push(achievementId);
                }
            }
        }
    }

    /**
     * Check cumulative achievements (messages, voice hours, commands)
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @param {Object} totals - User activity totals
     * @param {Array} toAward - Array to push achievement IDs into
     */
    async checkCumulativeAchievements(userId, guildId, totals, toAward) {
        // Message milestones
        const messageMilestones = [100, 500, 1000, 5000, 10000, 25000, 50000, 100000];
        for (const milestone of messageMilestones) {
            if (totals.totalMessages >= milestone) {
                const achievementId = `message_${milestone}`;
                if (!await this.hasAchievement(userId, guildId, achievementId)) {
                    toAward.push(achievementId);
                }
            }
        }

        // Voice hour milestones
        const voiceHours = Math.floor(totals.totalVoiceMinutes / 60);
        const voiceMilestones = [10, 50, 100, 250, 500, 1000, 2500, 5000];
        for (const milestone of voiceMilestones) {
            if (voiceHours >= milestone) {
                const achievementId = `voice_${milestone}hrs`;
                if (!await this.hasAchievement(userId, guildId, achievementId)) {
                    toAward.push(achievementId);
                }
            }
        }

        // Command milestones
        const commandMilestones = [50, 250, 500, 1000, 2500, 5000, 10000];
        for (const milestone of commandMilestones) {
            if (totals.totalCommands >= milestone) {
                const achievementId = `command_${milestone}`;
                if (!await this.hasAchievement(userId, guildId, achievementId)) {
                    toAward.push(achievementId);
                }
            }
        }

        // BytePod milestones
        if (totals.totalBytepods >= 1 && !await this.hasAchievement(userId, guildId, 'social_bytepod_creator')) {
            toAward.push('social_bytepod_creator');
        }
        if (totals.totalBytepods >= 50 && !await this.hasAchievement(userId, guildId, 'social_bytepod_host')) {
            toAward.push('social_bytepod_host');
        }
        if (totals.totalBytepods >= 200 && !await this.hasAchievement(userId, guildId, 'social_bytepod_master')) {
            toAward.push('social_bytepod_master');
        }
    }

    /**
     * Check combo achievements (multiple criteria must be met)
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @param {number} currentStreak - Current streak
     * @param {number} totalDays - Total active days
     * @param {Object} totals - User activity totals
     * @param {Array} toAward - Array to push achievement IDs into
     */
    async checkComboAchievements(userId, guildId, currentStreak, totalDays, totals, toAward) {
        const voiceHours = Math.floor(totals.totalVoiceMinutes / 60);

        // Balanced User: 1k messages + 100 hours voice + 500 commands
        if (totals.totalMessages >= 1000 && voiceHours >= 100 && totals.totalCommands >= 500) {
            if (!await this.hasAchievement(userId, guildId, 'combo_balanced_user')) {
                toAward.push('combo_balanced_user');
            }
        }

        // Super Active: 30-day streak + 100 total days
        if (currentStreak >= 30 && totalDays >= 100) {
            if (!await this.hasAchievement(userId, guildId, 'combo_super_active')) {
                toAward.push('combo_super_active');
            }
        }

        // Ultimate Member: 10k messages + 500 hours voice + 1k commands
        if (totals.totalMessages >= 10000 && voiceHours >= 500 && totals.totalCommands >= 1000) {
            if (!await this.hasAchievement(userId, guildId, 'combo_ultimate_member')) {
                toAward.push('combo_ultimate_member');
            }
        }

        // Triple Threat: 100-day streak + 500 total days + 5k messages
        if (currentStreak >= 100 && totalDays >= 500 && totals.totalMessages >= 5000) {
            if (!await this.hasAchievement(userId, guildId, 'combo_triple_threat')) {
                toAward.push('combo_triple_threat');
            }
        }

        // Consistency King: 180-day streak + 365+ total days
        if (currentStreak >= 180 && totalDays >= 365) {
            if (!await this.hasAchievement(userId, guildId, 'combo_consistency_king')) {
                toAward.push('combo_consistency_king');
            }
        }

        // Endurance Champion: 1k total days + 50k messages + 1k hours voice
        if (totalDays >= 1000 && totals.totalMessages >= 50000 && voiceHours >= 1000) {
            if (!await this.hasAchievement(userId, guildId, 'combo_endurance_champion')) {
                toAward.push('combo_endurance_champion');
            }
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
            const achievements = await dbLog.select('activityAchievements',
                () => db.select()
                    .from(activityAchievements)
                    .where(and(
                        eq(activityAchievements.userId, userId),
                        eq(activityAchievements.guildId, guildId)
                    )),
                { userId, guildId, operation: 'metaCheck' }
            );

            const count = achievements.length + toAward.length; // Include pending awards

            // Meta milestones (threshold-based)
            if (count >= 10 && !await this.hasAchievement(userId, guildId, 'meta_achievement_hunter')) {
                toAward.push('meta_achievement_hunter');
            }
            if (count >= 25 && !await this.hasAchievement(userId, guildId, 'meta_achievement_master')) {
                toAward.push('meta_achievement_master');
            }
            if (count >= 50 && !await this.hasAchievement(userId, guildId, 'meta_achievement_legend')) {
                toAward.push('meta_achievement_legend');
            }
            if (count >= 75 && !await this.hasAchievement(userId, guildId, 'meta_achievement_god')) {
                toAward.push('meta_achievement_god');
            }
            if (count >= 82 && !await this.hasAchievement(userId, guildId, 'meta_completionist')) {
                toAward.push('meta_completionist');
            }

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
            const logs = await dbLog.select('activityLogs',
                () => db.select()
                    .from(activityLogs)
                    .where(and(
                        eq(activityLogs.userId, userId),
                        eq(activityLogs.guildId, guildId)
                    )),
                { userId, guildId }
            );

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
            const existing = await dbLog.select('activityAchievements',
                () => db.select()
                    .from(activityAchievements)
                    .where(and(
                        eq(activityAchievements.userId, userId),
                        eq(activityAchievements.guildId, guildId),
                        eq(activityAchievements.achievementId, achievementId)
                    ))
                    .get(),
                { userId, guildId, achievementId }
            );

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
    async awardAchievement(userId, guildId, achievementId, awardedBy = null) {
        try {
            // Only check if enabled for automatic awards (awardedBy = null means auto-awarded)
            // Manual awards by admins bypass the disabled check
            if (!awardedBy) {
                const achievementsEnabled = await this.isAchievementsEnabled(guildId);
                if (!achievementsEnabled) {
                    return;
                }
            }

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
            await dbLog.insert('activityAchievements',
                () => db.insert(activityAchievements).values({
                    userId,
                    guildId,
                    achievementId,
                    points: achievement.points,
                    awardedBy, // null = auto-tracked, userId = manually awarded
                    notified: false,
                    earnedAt: new Date()
                }),
                { userId, guildId, achievementId, points: achievement.points }
            );

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
     * Remove an achievement from a user
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @param {string} achievementId - Achievement ID
     */
    async removeAchievement(userId, guildId, achievementId) {
        try {
            // Get achievement definition before deletion (for role cleanup)
            const achievement = await this.achievementManager.getById(achievementId);
            if (!achievement) {
                logger.warn(`Achievement ${achievementId} not found in definitions`);
                return;
            }

            // Check if achievement exists before deletion
            const existing = await dbLog.select('activityAchievements',
                () => db.select()
                    .from(activityAchievements)
                    .where(and(
                        eq(activityAchievements.userId, userId),
                        eq(activityAchievements.guildId, guildId),
                        eq(activityAchievements.achievementId, achievementId)
                    ))
                    .get(),
                { userId, guildId, achievementId }
            );

            if (!existing) {
                logger.warn(`No achievement ${achievementId} found for user ${userId}`);
                return;
            }

            // Delete from database
            await dbLog.delete('activityAchievements',
                () => db.delete(activityAchievements)
                    .where(and(
                        eq(activityAchievements.userId, userId),
                        eq(activityAchievements.guildId, guildId),
                        eq(activityAchievements.achievementId, achievementId)
                    )),
                { userId, guildId, achievementId }
            );

            // Remove role if achievement granted one
            if (achievement.grantRole) {
                await this.removeAchievementRole(userId, guildId, achievement);
            }

            logger.success(`🗑️ Removed ${achievement.title} from user ${userId}`);

        } catch (error) {
            logger.error(`Error removing achievement ${achievementId} from user ${userId}:`, error);
            throw error;
        }
    }

    /**
     * Remove achievement role from user
     * @param {string} userId - User ID
     * @param {string} guildId - Guild ID
     * @param {Object} achievementDef - Achievement definition
     */
    async removeAchievementRole(userId, guildId, achievementDef) {
        try {
            const guild = await this.client.guilds.fetch(guildId).catch(() => null);
            if (!guild) return;

            const member = await fetchMember(guild, userId, { logContext: 'achievement-remove-role' });
            if (!member) return;

            // Get role configuration
            const config = await this.getRoleConfig(guildId);
            if (!config.enabled) return;

            // Find the achievement role
            const roleRecord = await dbLog.select('achievementRoles',
                () => db.select()
                    .from(achievementRoles)
                    .where(and(
                        eq(achievementRoles.guildId, guildId),
                        eq(achievementRoles.achievementId, achievementDef.id)
                    ))
                    .get(),
                { guildId, achievementId: achievementDef.id }
            );

            if (!roleRecord) return;

            const role = await guild.roles.fetch(roleRecord.roleId).catch(() => null);
            if (!role) return;

            // Remove role from member
            const removeResult = await RoleManager.removeRole(member, role, {
                reason: `Achievement removed: ${achievementDef.title}`,
                logContext: 'achievement-remove-role'
            });

            if (removeResult.success) {
                logger.success(`Removed role ${role.name} from ${member.user.tag} in ${guild.name}`);
            }

        } catch (error) {
            logger.error(`Error removing achievement role for user ${userId}:`, error);
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

            const allStreaks = await dbLog.select('activityStreaks',
                () => db.select()
                    .from(activityStreaks),
                { operation: 'resetMonthlyFreezes' }
            );

            let resetCount = 0;

            for (const streak of allStreaks) {
                // Check if last reset was in a previous month
                const lastReset = streak.lastFreezeReset ? new Date(streak.lastFreezeReset) : null;

                if (!lastReset || lastReset < firstOfMonth) {
                    await dbLog.update('activityStreaks',
                        () => db.update(activityStreaks)
                            .set({
                                freezesAvailable: 1,
                                lastFreezeReset: now,
                                updatedAt: now
                            })
                            .where(and(
                                eq(activityStreaks.userId, streak.userId),
                                eq(activityStreaks.guildId, streak.guildId)
                            )),
                        { userId: streak.userId, guildId: streak.guildId, operation: 'freezeReset' }
                    );
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
            const streak = await dbLog.select('activityStreaks',
                () => db.select()
                    .from(activityStreaks)
                    .where(and(
                        eq(activityStreaks.userId, userId),
                        eq(activityStreaks.guildId, guildId)
                    ))
                    .get(),
                { userId, guildId }
            );

            if (!streak) {
                return null;
            }

            // Get achievements
            const achievements = await dbLog.select('activityAchievements',
                () => db.select()
                    .from(activityAchievements)
                    .where(and(
                        eq(activityAchievements.userId, userId),
                        eq(activityAchievements.guildId, guildId)
                    )),
                { userId, guildId }
            );

            // Load achievement definitions
            const achievementDefs = [];
            for (const ach of achievements) {
                const def = await this.achievementManager.getById(ach.achievementId);
                if (def) {
                    achievementDefs.push({
                        ...def,
                        earnedAt: ach.earnedAt,
                        points: ach.points || def.points, // Fallback to definition if DB value is null
                        awardedBy: ach.awardedBy // Track manual awards
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

            const results = await dbLog.select('activityStreaks',
                () => db.select()
                    .from(activityStreaks)
                    .where(eq(activityStreaks.guildId, guildId))
                    .orderBy(desc(orderColumn))
                    .limit(limit),
                { guildId, type, limit }
            );

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
            const existingRole = await dbLog.select('achievementRoles',
                () => db.select()
                    .from(achievementRoles)
                    .where(and(
                        eq(achievementRoles.achievementId, achievementDef.id),
                        eq(achievementRoles.guildId, guild.id)
                    ))
                    .get(),
                { achievementId: achievementDef.id, guildId: guild.id }
            );

            // If exists and role is still in Discord, return it
            if (existingRole) {
                const role = guild.roles.cache.get(existingRole.roleId);
                if (role) {
                    return role;
                } else {
                    // Role was deleted from Discord, clean up DB
                    await dbLog.delete('achievementRoles',
                        () => db.delete(achievementRoles)
                            .where(eq(achievementRoles.id, existingRole.id)),
                        { id: existingRole.id, achievementId: achievementDef.id }
                    );
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
            await dbLog.insert('achievementRoles',
                () => db.insert(achievementRoles).values({
                    achievementId: achievementDef.id,
                    guildId: guild.id,
                    roleId: newRole.id,
                    createdAt: new Date()
                }),
                { achievementId: achievementDef.id, guildId: guild.id, roleId: newRole.id }
            );

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
            const config = await dbLog.select('achievementRoleConfig',
                () => db.select()
                    .from(achievementRoleConfig)
                    .where(eq(achievementRoleConfig.guildId, guildId))
                    .get(),
                { guildId }
            );

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

            const member = await fetchMember(guild, userId, { logContext: 'achievement-grant-role' });
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

            // Assign role (RoleManager handles hierarchy validation and duplicate check)
            const addResult = await RoleManager.addRole(member, role, {
                reason: `Achievement earned: ${achievementDef.title}`,
                validateHierarchy: true,
                logContext: 'achievement-grant-role'
            });

            if (addResult.success) {
                logger.success(`Granted role ${role.name} to ${member.user.tag} in ${guild.name}`);
            } else if (addResult.error) {
                logger.warn(`Failed to grant role ${role.name}: ${addResult.error}`);
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
            const guildsWithCleanup = await dbLog.select('achievementRoleConfig',
                () => db.select()
                    .from(achievementRoleConfig)
                    .where(eq(achievementRoleConfig.cleanupOrphaned, true)),
                { operation: 'cleanupOrphanedRoles' }
            );

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
                    const guildRoles = await dbLog.select('achievementRoles',
                        () => db.select()
                            .from(achievementRoles)
                            .where(eq(achievementRoles.guildId, guild.id)),
                        { guildId: guild.id }
                    );

                    for (const roleRecord of guildRoles) {
                        const discordRole = guild.roles.cache.get(roleRecord.roleId);

                        // If role deleted from Discord, clean up DB
                        if (!discordRole) {
                            await dbLog.delete('achievementRoles',
                                () => db.delete(achievementRoles)
                                    .where(eq(achievementRoles.id, roleRecord.id)),
                                { id: roleRecord.id, achievementId: roleRecord.achievementId }
                            );

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
                            await dbLog.delete('achievementRoles',
                                () => db.delete(achievementRoles)
                                    .where(eq(achievementRoles.id, roleRecord.id)),
                                { id: roleRecord.id, achievementId: roleRecord.achievementId, operation: '0members' }
                            );

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
