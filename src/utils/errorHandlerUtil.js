/**
 * Standardized Error Handling Utilities
 * Provides consistent error responses and logging across all commands
 */

const logger = require('./logger');
const embeds = require('./embeds');
const crypto = require('crypto');

/**
 * Generate unique error ID for tracking
 * @returns {string} - 8-character hex ID
 */
function generateErrorId() {
    return crypto.randomBytes(4).toString('hex');
}

/**
 * Handle command execution errors with standardized response
 * @param {Error} error - The error object
 * @param {Interaction} interaction - Discord interaction
 * @param {string} context - Description of what was being done (e.g., "banning user", "fetching stats")
 * @param {Object} options - Additional options
 * @param {boolean} options.ephemeral - Whether to make the error message ephemeral (default: true)
 * @returns {Promise<void>}
 */
async function handleCommandError(error, interaction, context, options = {}) {
    const { ephemeral = true } = options;
    const errorId = generateErrorId();

    // Log the error with unique ID
    logger.error(`[${errorId}] Error ${context}:`, error);

    // Handle specific Discord API errors
    if (error.code) {
        const errorMessages = {
            10003: 'Unknown Channel - The channel may have been deleted.',
            10008: 'Unknown Message - The message may have been deleted.',
            10013: 'Unknown User - Could not find the user.',
            50013: 'Missing Permissions - I don\'t have permission to do that.',
            50035: 'Invalid Form Body - Invalid input provided.',
        };

        const userMessage = errorMessages[error.code];
        if (userMessage) {
            const embed = embeds.error('Error', userMessage);
            embed.setFooter({ text: `Error ID: ${errorId}` });

            return await safeReply(interaction, { embeds: [embed], ephemeral });
        }
    }

    // Generic error response
    const embed = embeds.error(
        'An Error Occurred',
        `Something went wrong while ${context}. The error has been logged.\n\nPlease try again later or contact a server administrator if the problem persists.`
    );
    embed.setFooter({ text: `Error ID: ${errorId}` });

    await safeReply(interaction, { embeds: [embed], ephemeral });
}

/**
 * Handle DM errors (when sending DMs to users fails)
 * @param {Error} error - The error object
 * @param {string} userId - User ID who couldn't be DMed
 * @param {string} action - What action was attempted (e.g., "warning notification", "achievement notification")
 * @returns {void}
 */
function handleDMError(error, userId, action) {
    if (error.code === 50007) {
        // Cannot send messages to this user (DMs disabled or not sharing a server)
        logger.debug(`Cannot DM user ${userId} for ${action} - DMs disabled or not sharing a server`);
    } else {
        logger.error(`Failed to DM user ${userId} for ${action}:`, error);
    }
}

/**
 * Handle Discord API errors specifically
 * @param {Error} error - The Discord API error
 * @param {Interaction} interaction - Discord interaction
 * @returns {Promise<void>}
 */
async function handleDiscordAPIError(error, interaction) {
    const errorId = generateErrorId();
    logger.error(`[${errorId}] Discord API Error:`, error);

    const embed = embeds.error(
        'Discord API Error',
        error.code === 10003 ? 'The channel no longer exists.' :
        error.code === 10008 ? 'The message no longer exists.' :
        error.code === 10013 ? 'Unknown user.' :
        error.code === 50013 ? 'I don\'t have permission to perform this action.' :
        'A Discord API error occurred. Please try again.'
    );
    embed.setFooter({ text: `Error ID: ${errorId}` });

    await safeReply(interaction, { embeds: [embed], ephemeral: true });
}

/**
 * Safely reply to an interaction (handles deferred/replied states)
 * @param {Interaction} interaction - Discord interaction
 * @param {Object} replyOptions - Reply options (embeds, content, etc.)
 * @returns {Promise<void>}
 */
async function safeReply(interaction, replyOptions) {
    try {
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply(replyOptions);
        } else {
            await interaction.reply(replyOptions);
        }
    } catch (error) {
        // Last resort - log if even the error message fails
        logger.error('Failed to send error message to user:', error);
    }
}

module.exports = {
    handleCommandError,
    handleDMError,
    handleDiscordAPIError,
    generateErrorId,
    safeReply,
};
