const { PermissionFlagsBits } = require('discord.js');
const logger = require('./logger');

/**
 * Discord API Utilities
 * Consolidates duplicate Discord API patterns across the codebase
 *
 * Usage:
 * - fetchMember: Safe member fetching with automatic error handling
 * - fetchChannel: Safe channel fetching with automatic error handling
 * - safeDMUser: Safe DM sending with automatic error handling
 * - RoleManager: Role operations with hierarchy validation
 * - PermissionOverwriteManager: Simplified permission overwrite management
 */

// ============================================================
// MEMBER FETCHING
// ============================================================

/**
 * Safely fetch a guild member by user ID
 * @param {Guild} guild - Discord guild object
 * @param {string} userId - User ID to fetch
 * @param {Object} options - Optional parameters
 * @param {boolean} options.cache - Use cache if available (default: true)
 * @param {boolean} options.force - Force fetch from API (default: false)
 * @param {string} options.logContext - Optional context for error logging
 * @returns {Promise<GuildMember|null>} - GuildMember or null if not found/error
 */
async function fetchMember(guild, userId, options = {}) {
    const { cache = true, force = false, logContext = 'fetchMember' } = options;

    try {
        const member = await guild.members.fetch({ user: userId, cache, force });
        return member;
    } catch (error) {
        // User not in guild or other error
        if (error.code === 10007) {
            // Unknown Member - not in guild (expected)
            logger.debug(`[${logContext}] User ${userId} not found in guild ${guild.name}`);
        } else {
            logger.warn(`[${logContext}] Failed to fetch member ${userId} in guild ${guild.name}:`, error.message);
        }
        return null;
    }
}

// ============================================================
// CHANNEL FETCHING
// ============================================================

/**
 * Safely fetch a channel by ID
 * @param {Client|Guild} clientOrGuild - Discord client or guild object
 * @param {string} channelId - Channel ID to fetch
 * @param {Object} options - Optional parameters
 * @param {boolean} options.cache - Use cache if available (default: true)
 * @param {boolean} options.force - Force fetch from API (default: false)
 * @param {string} options.logContext - Optional context for error logging
 * @returns {Promise<Channel|null>} - Channel or null if not found/error
 */
async function fetchChannel(clientOrGuild, channelId, options = {}) {
    const { cache = true, force = false, logContext = 'fetchChannel' } = options;

    try {
        // Determine if this is client.channels or guild.channels
        const channelManager = clientOrGuild.channels;
        const channel = await channelManager.fetch(channelId, { cache, force });
        return channel;
    } catch (error) {
        // Channel not found or other error
        if (error.code === 10003) {
            // Unknown Channel - deleted or bot lacks access
            logger.debug(`[${logContext}] Channel ${channelId} not found or inaccessible`);
        } else {
            logger.warn(`[${logContext}] Failed to fetch channel ${channelId}:`, error.message);
        }
        return null;
    }
}

// ============================================================
// SAFE MESSAGE OPERATIONS
// ============================================================

/**
 * Safely send a DM to a user
 * @param {User} user - Discord user object
 * @param {Object} messageOptions - Message options (content, embeds, etc.)
 * @param {Object} options - Optional parameters
 * @param {boolean} options.logError - Log DM failures (default: false, fails silently)
 * @param {string} options.logContext - Optional context for error logging
 * @returns {Promise<Message|null>} - Message or null if failed
 */
async function safeDMUser(user, messageOptions, options = {}) {
    const { logError = false, logContext = 'safeDMUser' } = options;

    try {
        const dmChannel = await user.createDM();
        const message = await dmChannel.send(messageOptions);
        return message;
    } catch (error) {
        // DM failed - user has DMs disabled or blocked the bot
        if (logError) {
            logger.debug(`[${logContext}] Failed to DM user ${user.tag}:`, error.message);
        }
        return null;
    }
}

/**
 * Safely fetch a message from a channel
 * @param {TextChannel} channel - Discord channel object
 * @param {string} messageId - Message ID to fetch
 * @param {Object} options - Optional parameters
 * @param {boolean} options.cache - Use cache if available (default: true)
 * @param {boolean} options.force - Force fetch from API (default: false)
 * @param {string} options.logContext - Optional context for error logging
 * @returns {Promise<Message|null>} - Message or null if not found/error
 */
async function safeMessageFetch(channel, messageId, options = {}) {
    const { cache = true, force = false, logContext = 'safeMessageFetch' } = options;

    try {
        const message = await channel.messages.fetch({ message: messageId, cache, force });
        return message;
    } catch (error) {
        // Message not found or other error
        if (error.code === 10008) {
            // Unknown Message - deleted
            logger.debug(`[${logContext}] Message ${messageId} not found in channel ${channel.id}`);
        } else {
            logger.warn(`[${logContext}] Failed to fetch message ${messageId}:`, error.message);
        }
        return null;
    }
}

/**
 * Safely delete a message
 * @param {Message} message - Discord message object
 * @param {Object} options - Optional parameters
 * @param {string} options.logContext - Optional context for error logging
 * @returns {Promise<boolean>} - True if deleted, false if failed
 */
async function safeMessageDelete(message, options = {}) {
    const { logContext = 'safeMessageDelete' } = options;

    try {
        await message.delete();
        return true;
    } catch (error) {
        // Message already deleted or missing permissions
        if (error.code === 10008) {
            // Unknown Message - already deleted
            logger.debug(`[${logContext}] Message already deleted`);
        } else {
            logger.warn(`[${logContext}] Failed to delete message:`, error.message);
        }
        return false;
    }
}

/**
 * Safely send a message to a channel
 * @param {TextChannel} channel - Discord channel object
 * @param {Object} messageOptions - Message options (content, embeds, etc.)
 * @param {Object} options - Optional parameters
 * @param {string} options.logContext - Optional context for error logging
 * @returns {Promise<Message|null>} - Message or null if failed
 */
async function safeChannelSend(channel, messageOptions, options = {}) {
    const { logContext = 'safeChannelSend' } = options;

    try {
        const message = await channel.send(messageOptions);
        return message;
    } catch (error) {
        // Channel deleted or missing permissions
        if (error.code === 10003) {
            // Unknown Channel - deleted
            logger.debug(`[${logContext}] Channel ${channel.id} not found or inaccessible`);
        } else if (error.code === 50013) {
            // Missing Permissions
            logger.warn(`[${logContext}] Missing permissions to send message in channel ${channel.id}`);
        } else {
            logger.warn(`[${logContext}] Failed to send message to channel ${channel.id}:`, error.message);
        }
        return null;
    }
}

// ============================================================
// ROLE MANAGER
// ============================================================

/**
 * Role Manager - Centralized role operations with hierarchy validation
 */
class RoleManager {
    /**
     * Add a role to a member
     * @param {GuildMember} member - Guild member object
     * @param {Role|string} role - Role object or role ID
     * @param {Object} options - Optional parameters
     * @param {string} options.reason - Audit log reason
     * @param {boolean} options.validateHierarchy - Check bot role hierarchy (default: true)
     * @param {string} options.logContext - Optional context for error logging
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    static async addRole(member, role, options = {}) {
        const { reason = 'Role assigned by bot', validateHierarchy = true, logContext = 'addRole' } = options;

        try {
            // Resolve role if ID was passed
            const roleObject = typeof role === 'string' ? member.guild.roles.cache.get(role) : role;

            if (!roleObject) {
                return { success: false, error: 'Role not found' };
            }

            // Check if member already has role
            if (member.roles.cache.has(roleObject.id)) {
                logger.debug(`[${logContext}] Member ${member.user.tag} already has role ${roleObject.name}`);
                return { success: true }; // Not an error, just already has it
            }

            // Validate hierarchy
            if (validateHierarchy) {
                const botMember = member.guild.members.me;
                if (roleObject.position >= botMember.roles.highest.position) {
                    return {
                        success: false,
                        error: `Cannot manage role ${roleObject.name} - it is higher than or equal to bot's highest role`
                    };
                }
            }

            // Add role
            await member.roles.add(roleObject, reason);
            logger.debug(`[${logContext}] Added role ${roleObject.name} to ${member.user.tag}`);
            return { success: true };

        } catch (error) {
            logger.error(`[${logContext}] Failed to add role to ${member.user.tag}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Remove a role from a member
     * @param {GuildMember} member - Guild member object
     * @param {Role|string} role - Role object or role ID
     * @param {Object} options - Optional parameters
     * @param {string} options.reason - Audit log reason
     * @param {boolean} options.validateHierarchy - Check bot role hierarchy (default: true)
     * @param {string} options.logContext - Optional context for error logging
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    static async removeRole(member, role, options = {}) {
        const { reason = 'Role removed by bot', validateHierarchy = true, logContext = 'removeRole' } = options;

        try {
            // Resolve role if ID was passed
            const roleObject = typeof role === 'string' ? member.guild.roles.cache.get(role) : role;

            if (!roleObject) {
                return { success: false, error: 'Role not found' };
            }

            // Check if member has role
            if (!member.roles.cache.has(roleObject.id)) {
                logger.debug(`[${logContext}] Member ${member.user.tag} doesn't have role ${roleObject.name}`);
                return { success: true }; // Not an error, just doesn't have it
            }

            // Validate hierarchy
            if (validateHierarchy) {
                const botMember = member.guild.members.me;
                if (roleObject.position >= botMember.roles.highest.position) {
                    return {
                        success: false,
                        error: `Cannot manage role ${roleObject.name} - it is higher than or equal to bot's highest role`
                    };
                }
            }

            // Remove role
            await member.roles.remove(roleObject, reason);
            logger.debug(`[${logContext}] Removed role ${roleObject.name} from ${member.user.tag}`);
            return { success: true };

        } catch (error) {
            logger.error(`[${logContext}] Failed to remove role from ${member.user.tag}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Check if bot can manage a role
     * @param {Guild} guild - Guild object
     * @param {Role|string} role - Role object or role ID
     * @returns {boolean} - True if bot can manage role
     */
    static canManageRole(guild, role) {
        const roleObject = typeof role === 'string' ? guild.roles.cache.get(role) : role;
        if (!roleObject) return false;

        const botMember = guild.members.me;
        return roleObject.position < botMember.roles.highest.position;
    }
}

// ============================================================
// PERMISSION OVERWRITE MANAGER
// ============================================================

/**
 * Permission Overwrite Manager - Simplifies permission overwrite operations
 */
class PermissionOverwriteManager {
    /**
     * Set permission overwrites for a target (user, role, or everyone)
     * @param {Channel} channel - Discord channel object
     * @param {string|User|Role} target - User ID, Role ID, User object, Role object, or guild ID for @everyone
     * @param {Object} permissions - Permission overwrites object
     * @param {Object} options - Optional parameters
     * @param {string} options.reason - Audit log reason
     * @param {string} options.logContext - Optional context for error logging
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    static async setPermissions(channel, target, permissions, options = {}) {
        const { reason = 'Permission overwrite by bot', logContext = 'setPermissions' } = options;

        try {
            // Resolve target to ID
            const targetId = target?.id || target;

            await channel.permissionOverwrites.edit(targetId, permissions, { reason });
            logger.debug(`[${logContext}] Updated permissions for ${targetId} in channel ${channel.name}`);
            return { success: true };

        } catch (error) {
            logger.error(`[${logContext}] Failed to set permissions in channel ${channel.name}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Grant permissions to a target
     * @param {Channel} channel - Discord channel object
     * @param {string|User|Role} target - User ID, Role ID, User object, Role object, or guild ID for @everyone
     * @param {Array<string>} permissionFlags - Array of permission flag names (e.g., ['Connect', 'Speak'])
     * @param {Object} options - Optional parameters
     * @param {string} options.reason - Audit log reason
     * @param {string} options.logContext - Optional context for error logging
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    static async grantPermissions(channel, target, permissionFlags, options = {}) {
        const permissions = {};
        for (const flag of permissionFlags) {
            permissions[flag] = true;
        }
        return await this.setPermissions(channel, target, permissions, options);
    }

    /**
     * Deny permissions to a target
     * @param {Channel} channel - Discord channel object
     * @param {string|User|Role} target - User ID, Role ID, User object, Role object, or guild ID for @everyone
     * @param {Array<string>} permissionFlags - Array of permission flag names (e.g., ['Connect', 'Speak'])
     * @param {Object} options - Optional parameters
     * @param {string} options.reason - Audit log reason
     * @param {string} options.logContext - Optional context for error logging
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    static async denyPermissions(channel, target, permissionFlags, options = {}) {
        const permissions = {};
        for (const flag of permissionFlags) {
            permissions[flag] = false;
        }
        return await this.setPermissions(channel, target, permissions, options);
    }

    /**
     * Reset (remove) permissions for a target
     * @param {Channel} channel - Discord channel object
     * @param {string|User|Role} target - User ID, Role ID, User object, Role object, or guild ID for @everyone
     * @param {Array<string>} permissionFlags - Array of permission flag names (e.g., ['Connect', 'Speak'])
     * @param {Object} options - Optional parameters
     * @param {string} options.reason - Audit log reason
     * @param {string} options.logContext - Optional context for error logging
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    static async resetPermissions(channel, target, permissionFlags, options = {}) {
        const permissions = {};
        for (const flag of permissionFlags) {
            permissions[flag] = null;
        }
        return await this.setPermissions(channel, target, permissions, options);
    }

    /**
     * Lock a channel for a target (deny SendMessages, Connect based on channel type)
     * @param {Channel} channel - Discord channel object
     * @param {string|User|Role} target - User ID, Role ID, User object, Role object, or guild ID for @everyone
     * @param {Object} options - Optional parameters
     * @param {string} options.reason - Audit log reason
     * @param {string} options.logContext - Optional context for error logging
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    static async lockChannel(channel, target, options = {}) {
        const { reason = 'Channel locked by bot', logContext = 'lockChannel' } = options;

        const permissions = {};

        // Voice channel - deny Connect
        if (channel.type === 2) { // ChannelType.GuildVoice
            permissions.Connect = false;
        }
        // Text channel - deny SendMessages
        else {
            permissions.SendMessages = false;
        }

        return await this.setPermissions(channel, target, permissions, { reason, logContext });
    }

    /**
     * Unlock a channel for a target (reset SendMessages, Connect based on channel type)
     * @param {Channel} channel - Discord channel object
     * @param {string|User|Role} target - User ID, Role ID, User object, Role object, or guild ID for @everyone
     * @param {Object} options - Optional parameters
     * @param {string} options.reason - Audit log reason
     * @param {string} options.logContext - Optional context for error logging
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    static async unlockChannel(channel, target, options = {}) {
        const { reason = 'Channel unlocked by bot', logContext = 'unlockChannel' } = options;

        const permissions = {};

        // Voice channel - reset Connect
        if (channel.type === 2) { // ChannelType.GuildVoice
            permissions.Connect = null;
        }
        // Text channel - reset SendMessages
        else {
            permissions.SendMessages = null;
        }

        return await this.setPermissions(channel, target, permissions, { reason, logContext });
    }

    /**
     * Delete all permission overwrites for a target
     * @param {Channel} channel - Discord channel object
     * @param {string|User|Role} target - User ID, Role ID, User object, Role object, or guild ID for @everyone
     * @param {Object} options - Optional parameters
     * @param {string} options.reason - Audit log reason
     * @param {string} options.logContext - Optional context for error logging
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    static async deleteOverwrites(channel, target, options = {}) {
        const { reason = 'Overwrites removed by bot', logContext = 'deleteOverwrites' } = options;

        try {
            const targetId = target?.id || target;
            await channel.permissionOverwrites.delete(targetId, reason);
            logger.debug(`[${logContext}] Deleted permission overwrites for ${targetId} in channel ${channel.name}`);
            return { success: true };

        } catch (error) {
            logger.error(`[${logContext}] Failed to delete overwrites in channel ${channel.name}:`, error);
            return { success: false, error: error.message };
        }
    }
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    // Member & Channel Fetching
    fetchMember,
    fetchChannel,

    // Safe Message Operations
    safeDMUser,
    safeMessageFetch,
    safeMessageDelete,
    safeChannelSend,

    // Classes
    RoleManager,
    PermissionOverwriteManager
};
