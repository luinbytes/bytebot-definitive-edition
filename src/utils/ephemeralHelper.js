const { db } = require('../database');
const { users } = require('../database/schema');
const { eq, and } = require('drizzle-orm');
const { MessageFlags } = require('discord.js');
const { dbLog } = require('./dbLogger');
const logger = require('./logger');

/**
 * Get user's ephemeral preference from database
 * @param {string} userId - Discord user ID
 * @returns {Promise<string>} - User's preference ('always', 'public', or 'default')
 */
async function getUserPreference(userId) {
    try {
        const user = await dbLog.select('users',
            () => db
                .select()
                .from(users)
                .where(eq(users.id, userId))
                .get(),
            { userId }
        );

        return user?.ephemeralPreference || 'default';
    } catch (error) {
        logger.error(`Error fetching user preference: ${error.message}`, 'EphemeralHelper');
        return 'default'; // Fallback to default on error
    }
}

/**
 * Determine if command response should be ephemeral
 *
 * Priority order:
 * 1. User's explicit override via command parameter (highest priority)
 * 2. User's saved preference ('always' or 'public')
 * 3. Smart default based on context (viewing self vs others, command type)
 *
 * @param {CommandInteraction} interaction - Discord interaction
 * @param {Object} options - Configuration options
 * @param {boolean} options.commandDefault - Default ephemeral state for this command type
 * @param {boolean|null} options.userOverride - Optional private parameter from command
 * @param {string|null} options.targetUserId - User being viewed (null = viewing self)
 * @returns {Promise<boolean>} - Should use ephemeral flag
 *
 * @example
 * // In a command:
 * const isEphemeral = await shouldBeEphemeral(interaction, {
 *     commandDefault: false,  // Default public
 *     userOverride: interaction.options.getBoolean('private'),
 *     targetUserId: targetUser.id
 * });
 *
 * await interaction.reply({
 *     embeds: [embed],
 *     flags: isEphemeral ? [MessageFlags.Ephemeral] : []
 * });
 */
async function shouldBeEphemeral(interaction, options = {}) {
    const {
        commandDefault = false,      // Default for this command type
        userOverride = null,          // Optional private:true/false param
        targetUserId = null           // User being viewed (null = self)
    } = options;

    // 1. User explicitly chose visibility via parameter (highest priority)
    if (userOverride !== null) return userOverride;

    // 2. Check user's global preference
    const userPref = await getUserPreference(interaction.user.id);
    if (userPref === 'always') return true;   // Always ephemeral
    if (userPref === 'public') return false;  // Always public

    // 3. Smart defaults for 'default' preference
    // When viewing another user, default to public (social context)
    if (targetUserId && targetUserId !== interaction.user.id) {
        return false;
    }

    // Fall back to command's default behavior
    return commandDefault;
}

/**
 * Update user's ephemeral preference (global across all guilds)
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Discord guild ID (for user creation only)
 * @param {string} preference - New preference ('always' | 'public' | 'default')
 * @returns {Promise<boolean>} - Success status
 */
async function setUserPreference(userId, guildId, preference) {
    // Validate preference value
    const validPreferences = ['always', 'public', 'default'];
    if (!validPreferences.includes(preference)) {
        throw new Error(`Invalid preference: ${preference}. Must be one of: ${validPreferences.join(', ')}`);
    }

    try {
        // Use onConflictDoUpdate pattern like the rest of the codebase
        await dbLog.insert('users',
            () => db
                .insert(users)
                .values({
                    id: userId,
                    guildId: guildId, // Only used if creating new user
                    ephemeralPreference: preference,
                    commandsRun: 0,
                    lastSeen: new Date()
                })
                .onConflictDoUpdate({
                    target: users.id,
                    set: {
                        ephemeralPreference: preference
                    }
                }),
            { userId, preference }
        );

        return true;
    } catch (error) {
        logger.error(`Error setting user preference: ${error.message}`, 'EphemeralHelper');
        return false;
    }
}

module.exports = {
    getUserPreference,
    shouldBeEphemeral,
    setUserPreference
};
