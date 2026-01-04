/**
 * Moderation Utilities
 * Centralized moderation logging, notifications, and validation
 */

const { PermissionFlagsBits } = require('discord.js');
const { db } = require('../database');
const { moderationLogs } = require('../database/schema');
const logger = require('./logger');
const embeds = require('./embeds');
const { handleDMError } = require('./errorHandlerUtil');

/**
 * Log a moderation action to the database
 * @param {string} guildId - Guild ID where action occurred
 * @param {string} targetId - User ID of the target
 * @param {string} executorId - User ID of the moderator
 * @param {string} action - Action type (WARN, KICK, BAN, CLEAR)
 * @param {string} reason - Reason for the action
 * @returns {Promise<void>}
 */
async function logModerationAction(guildId, targetId, executorId, action, reason) {
    await db.insert(moderationLogs).values({
        guildId,
        targetId,
        executorId,
        action,
        reason,
        timestamp: new Date()
    });

    logger.info(`Moderation action logged: ${action} on ${targetId} by ${executorId} in ${guildId} - Reason: ${reason}`);
}

/**
 * Notify a user of a moderation action via DM
 * @param {User} user - Discord user to notify
 * @param {string} action - Action type (warn, kick, ban)
 * @param {string} guildName - Name of the guild
 * @param {string} reason - Reason for the action
 * @param {string} executorTag - Tag of the moderator who executed the action
 * @returns {Promise<boolean>} - true if DM sent successfully, false otherwise
 */
async function notifyUser(user, action, guildName, reason, executorTag) {
    const embedMap = {
        warn: () => embeds.warn(
            `Warning from ${guildName}`,
            `You have been warned${executorTag ? ` by ${executorTag}` : ''}.\n\n**Reason:** ${reason}`
        ),
        kick: () => embeds.error(
            `Kicked from ${guildName}`,
            `You have been kicked${executorTag ? ` by ${executorTag}` : ''}.\n\n**Reason:** ${reason}`
        ),
        ban: () => embeds.error(
            `Banned from ${guildName}`,
            `You have been banned${executorTag ? ` by ${executorTag}` : ''}.\n\n**Reason:** ${reason}`
        )
    };

    const embedBuilder = embedMap[action.toLowerCase()];
    if (!embedBuilder) {
        logger.error(`Unknown action type for DM notification: ${action}`);
        return false;
    }

    try {
        await user.send({ embeds: [embedBuilder()] });
        logger.debug(`DM sent to ${user.tag} for ${action} in ${guildName}`);
        return true;
    } catch (error) {
        handleDMError(error, user.id, `${action} notification`);
        return false;
    }
}

/**
 * Validate role hierarchy for moderation actions
 * Ensures executor has permission to moderate target
 * @param {GuildMember} executor - The moderator performing the action
 * @param {GuildMember} target - The member being moderated
 * @returns {Object} - { valid: boolean, error?: string }
 */
function validateHierarchy(executor, target) {
    // Can't moderate self
    if (executor.id === target.id) {
        return {
            valid: false,
            error: 'You cannot moderate yourself.'
        };
    }

    // Can't moderate bots unless admin
    if (target.user.bot && !executor.permissions.has(PermissionFlagsBits.Administrator)) {
        return {
            valid: false,
            error: 'Only administrators can moderate bots.'
        };
    }

    // Can't moderate guild owner
    if (target.id === target.guild.ownerId) {
        return {
            valid: false,
            error: 'You cannot moderate the server owner.'
        };
    }

    // Role hierarchy check (administrators bypass this)
    if (!executor.permissions.has(PermissionFlagsBits.Administrator)) {
        if (executor.roles.highest.position <= target.roles.highest.position) {
            return {
                valid: false,
                error: 'You cannot moderate users with equal or higher roles than you.'
            };
        }

        // Bot must also have higher role
        const botMember = target.guild.members.me;
        if (botMember.roles.highest.position <= target.roles.highest.position) {
            return {
                valid: false,
                error: 'I cannot moderate this user. They have a higher or equal role than me.'
            };
        }
    }

    return { valid: true };
}

/**
 * Execute a complete moderation action (log + notify + log to console)
 * Convenience function that combines logging and notification
 * @param {Object} options - Moderation action options
 * @param {string} options.guildId - Guild ID
 * @param {string} options.guildName - Guild name (for DM)
 * @param {User} options.target - Target user
 * @param {GuildMember} options.executor - Executor member
 * @param {string} options.action - Action type (WARN, KICK, BAN)
 * @param {string} options.reason - Reason for action
 * @param {boolean} options.notify - Whether to send DM notification (default: true)
 * @returns {Promise<void>}
 */
async function executeModerationAction({ guildId, guildName, target, executor, action, reason, notify = true }) {
    // Log to database
    await logModerationAction(guildId, target.id, executor.id, action, reason);

    // Send DM notification if requested
    if (notify) {
        await notifyUser(target, action, guildName, reason, executor.user.tag);
    }
}

module.exports = {
    logModerationAction,
    notifyUser,
    validateHierarchy,
    executeModerationAction
};
