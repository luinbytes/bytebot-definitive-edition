const { db } = require('../database');
const { users } = require('../database/schema');
const { eq, and } = require('drizzle-orm');

/**
 * Get user's ephemeral preference from database
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Discord guild ID
 * @returns {Promise<string>} - User's preference ('always', 'public', or 'default')
 */
async function getUserPreference(userId, guildId) {
    try {
        const user = await db
            .select()
            .from(users)
            .where(and(eq(users.id, userId), eq(users.guildId, guildId)))
            .get();

        return user?.ephemeralPreference || 'default';
    } catch (error) {
        console.error('[ephemeralHelper] Error fetching user preference:', error);
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
    const userPref = await getUserPreference(interaction.user.id, interaction.guildId);
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
 * Update user's ephemeral preference
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Discord guild ID
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
        // Check if user exists
        const existingUser = await db
            .select()
            .from(users)
            .where(and(eq(users.id, userId), eq(users.guildId, guildId)))
            .get();

        if (existingUser) {
            // Update existing user
            await db
                .update(users)
                .set({ ephemeralPreference: preference })
                .where(and(eq(users.id, userId), eq(users.guildId, guildId)))
                .run();
        } else {
            // Create new user record
            await db
                .insert(users)
                .values({
                    id: userId,
                    guildId: guildId,
                    ephemeralPreference: preference,
                    commandsRun: 0
                })
                .run();
        }

        return true;
    } catch (error) {
        console.error('[ephemeralHelper] Error setting user preference:', error);
        return false;
    }
}

module.exports = {
    getUserPreference,
    shouldBeEphemeral,
    setUserPreference
};
