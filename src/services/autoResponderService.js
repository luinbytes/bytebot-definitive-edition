const { db } = require('../database');
const { autoResponses } = require('../database/schema');
const { eq, and, sql } = require('drizzle-orm');
const logger = require('../utils/logger');

/**
 * Auto-Responder Service
 * Handles keyword-based automated responses to messages
 */
class AutoResponderService {
    constructor(client) {
        this.client = client;
        this.cooldowns = new Map(); // `${responseId}_${channelId}` -> expiryTimestamp
        this.cache = new Map(); // guildId -> array of active responses
        this.cacheExpiry = new Map(); // guildId -> expiry timestamp

        // Cleanup stale cooldowns every minute
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            for (const [key, expiry] of this.cooldowns.entries()) {
                if (expiry < now) {
                    this.cooldowns.delete(key);
                }
            }
        }, 60000);
    }

    /**
     * Cleanup method - clears interval timer
     * Call this when shutting down the service
     */
    cleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    /**
     * Check message for auto-response triggers
     * @param {Message} message - Discord.js Message object
     */
    async checkMessage(message) {
        // Get cached responses for guild (cache for 5 minutes)
        let responses = this.getCachedResponses(message.guild.id);

        if (!responses) {
            responses = await db.select()
                .from(autoResponses)
                .where(and(
                    eq(autoResponses.guildId, message.guild.id),
                    eq(autoResponses.enabled, true)
                ))
                .all();

            this.cacheResponses(message.guild.id, responses);
        }

        if (responses.length === 0) return;

        // Check each response
        for (const response of responses) {
            // Channel restriction
            if (response.channelId && response.channelId !== message.channel.id) {
                continue;
            }

            // Role restriction
            if (response.requireRoleId) {
                const member = await message.guild.members.fetch(message.author.id).catch(() => null);
                if (!member || !member.roles.cache.has(response.requireRoleId)) {
                    continue;
                }
            }

            // Cooldown check
            const cooldownKey = `${response.id}_${message.channel.id}`;
            const now = Date.now();
            const cooldownEnd = this.cooldowns.get(cooldownKey) || 0;

            if (now < cooldownEnd) {
                continue; // Still on cooldown
            }

            // Match trigger
            if (!this.matchesTrigger(message.content, response.trigger, response.matchType)) {
                continue;
            }

            // MATCH FOUND - send response
            const parsedResponse = this.parseResponse(response.response, message);

            try {
                await message.channel.send(parsedResponse);

                // Update cooldown
                this.cooldowns.set(cooldownKey, now + (response.cooldown * 1000));

                // Update stats
                await db.update(autoResponses)
                    .set({
                        useCount: sql`${autoResponses.useCount} + 1`,
                        lastUsed: new Date()
                    })
                    .where(eq(autoResponses.id, response.id));

                logger.debug(`Auto-response triggered: "${response.trigger}" in ${message.guild.name}`);

                // Only trigger ONE response per message
                break;

            } catch (error) {
                // Log error but continue (might be permissions issue)
                if (error.code === 50013) {
                    logger.warn(`Auto-response blocked in ${message.channel.id}: Missing permissions`);
                } else {
                    logger.error(`Failed to send auto-response ${response.id}:`, error);
                }
            }
        }
    }

    /**
     * Check if message content matches trigger
     * @param {string} content - Message content
     * @param {string} trigger - Trigger pattern
     * @param {string} matchType - Match type (exact, contains, wildcard, regex)
     * @returns {boolean}
     */
    matchesTrigger(content, trigger, matchType) {
        const contentLower = content.toLowerCase();
        const triggerLower = trigger.toLowerCase();

        switch (matchType) {
            case 'exact':
                return contentLower === triggerLower;

            case 'contains':
                return contentLower.includes(triggerLower);

            case 'wildcard':
                // Convert wildcard to regex: "test*" -> /^test.*$/
                const pattern = '^' + triggerLower.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
                return new RegExp(pattern).test(contentLower);

            case 'regex':
                try {
                    return new RegExp(trigger, 'i').test(content);
                } catch (error) {
                    logger.error(`Invalid regex in auto-response: ${trigger}`);
                    return false;
                }

            default:
                return false;
        }
    }

    /**
     * Parse response variables
     * @param {string} response - Response text
     * @param {Message} message - Discord.js Message object
     * @returns {string}
     */
    parseResponse(response, message) {
        return response
            .replace(/{user}/g, `<@${message.author.id}>`)
            .replace(/{mention}/g, `<@${message.author.id}>`) // Alias for {user}
            .replace(/{server}/g, message.guild.name)
            .replace(/{channel}/g, `<#${message.channel.id}>`)
            .replace(/{username}/g, message.author.username);
    }

    /**
     * Get cached responses for guild
     * @param {string} guildId - Guild ID
     * @returns {Array|null}
     */
    getCachedResponses(guildId) {
        const expiry = this.cacheExpiry.get(guildId);
        if (expiry && Date.now() < expiry) {
            return this.cache.get(guildId);
        }
        return null;
    }

    /**
     * Cache responses for guild
     * @param {string} guildId - Guild ID
     * @param {Array} responses - Array of response objects
     */
    cacheResponses(guildId, responses) {
        this.cache.set(guildId, responses);
        this.cacheExpiry.set(guildId, Date.now() + 300000); // 5 minutes
    }

    /**
     * Invalidate cache for guild (call after add/edit/delete/toggle)
     * @param {string} guildId - Guild ID
     */
    invalidateCache(guildId) {
        this.cache.delete(guildId);
        this.cacheExpiry.delete(guildId);
    }
}

module.exports = AutoResponderService;
