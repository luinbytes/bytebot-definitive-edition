/**
 * Moderation Utilities
 * Centralized moderation logging, notifications, and validation
 */

const { PermissionFlagsBits } = require('discord.js');
const { db, sqlite } = require('../database');
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
 * Check persisted member and role protection without requiring a live member.
 * @param {string} guildId
 * @param {string} targetId
 * @param {Iterable<string>} roleIds
 * @returns {Object} - { valid: boolean, error?: string }
 */
function validateProtectedTarget(guildId, targetId, roleIds = []) {
    try {
        if (!sqlite?.prepare) throw new Error('Database connection unavailable');

        const memberProtected = sqlite.prepare(`
            SELECT 1 FROM protected_targets
            WHERE guild_id = ? AND target_type = 'member' AND target_id = ?
        `).get(guildId, targetId);
        const protectedRoles = sqlite.prepare(`
            SELECT target_id FROM protected_targets
            WHERE guild_id = ? AND target_type = 'role'
        `).all(guildId);
        const memberRoleIds = new Set(roleIds);

        return memberProtected || protectedRoles.some(role => memberRoleIds.has(role.target_id))
            ? { valid: false, error: 'This member is protected from moderation.' }
            : { valid: true };
    } catch (error) {
        logger.error(`Protected-target check failed in ${guildId}: ${error.message}`);
        return { valid: false, error: 'Protection state is unavailable, so moderation is blocked.' };
    }
}

/**
 * Validate role hierarchy for moderation actions.
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

    const protection = validateProtectedTarget(target.guild.id, target.id, target.roles.cache?.keys() || []);
    if (!protection.valid) return protection;

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
 * @param {Function|null} options.perform - Discord action to complete before logging
 * @returns {Promise<void>}
 */
async function executeModerationAction({ guildId, guildName, target, executor, action, reason, notify = true, perform = null }) {
    if (perform) {
        await perform();
    }

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
    validateProtectedTarget,
    validateHierarchy,
    executeModerationAction
};
