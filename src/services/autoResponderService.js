const { db } = require('../database');
const { autoResponses } = require('../database/schema');
const { eq, and, count, sql } = require('drizzle-orm');
const logger = require('../utils/logger');
const { dbLog } = require('../utils/dbLogger');
const { parseEmbedScript } = require('./lifecycleMessageService');
const AutoResponderMatcher = require('./autoResponderMatcher');
const { RoleManager } = require('../utils/discordApiUtil');
const { PermissionFlagsBits } = require('discord.js');
const RoleAutomationService = require('./roleAutomationService');

const MAX_AUTO_RESPONDERS = 500;

async function validateResponderRoleAuthority(interaction, response, extraRoleIds = []) {
    const roleIds = new Set([
        ...JSON.parse(response.actionRoles || '[]').map(action => action.roleId),
        ...(response.actionRoleId ? [response.actionRoleId] : []),
        ...extraRoleIds
    ]);
    if (!roleIds.size) return null;
    const actor = interaction.member;
    if (!actor?.id || (actor.id !== interaction.guild.ownerId
        && (!actor.permissions?.has(PermissionFlagsBits.ManageRoles) || !Number.isFinite(actor.roles?.highest?.position)))) {
        return 'You need Manage Roles to configure responder role actions.';
    }
    const validator = new RoleAutomationService();
    for (const roleId of roleIds) {
        const invalid = await validator.validateRole(interaction.guild, interaction.guild.roles.cache.get(roleId), actor);
        if (invalid) return invalid;
    }
    return null;
}

function createAutoResponder(values) {
    return db.transaction(tx => {
        const total = tx.select({ count: count() }).from(autoResponses)
            .where(eq(autoResponses.guildId, values.guildId)).get();
        if (total.count >= MAX_AUTO_RESPONDERS) {
            const error = new Error(`This server has reached the ${MAX_AUTO_RESPONDERS} auto-responder limit.`);
            error.code = 'AUTO_RESPONDER_LIMIT';
            throw error;
        }
        return tx.insert(autoResponses).values(values).returning().get();
    });
}

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
        this.matcher = new AutoResponderMatcher();
        this.pendingResponses = new Set();
        this.closed = false;

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
     * Stop accepting matches and terminate the matcher worker.
     * Call this when shutting down the service
     */
    cleanup() {
        this.closed = true;
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        return this.matcher.close();
    }

    /**
     * Check message for auto-response triggers
     * @param {Message} message - Discord.js Message object
     */
    async checkMessage(message) {
        if (this.closed) return;
        // Get cached responses for guild (cache for 5 minutes)
        let responses = this.getCachedResponses(message.guild.id);

        if (!responses) {
            responses = await dbLog.select('autoResponses',
                () => db.select()
                    .from(autoResponses)
                    .where(and(
                        eq(autoResponses.guildId, message.guild.id),
                        eq(autoResponses.enabled, true)
                    ))
                    .all(),
                { guildId: message.guild.id }
            );

            this.cacheResponses(message.guild.id, responses);
        }

        if (responses.length === 0) return;

        // Check each response
        for (const response of responses) {
            if (this.closed) return;
            const channelIds = JSON.parse(response.channelIds || '[]');
            const roleIds = JSON.parse(response.roleIds || '[]');
            // Channel restriction
            if ((response.channelId && response.channelId !== message.channel.id) || (channelIds.length && !channelIds.includes(message.channel.id))) {
                continue;
            }

            // Role restriction
            if (response.requireRoleId) {
                const member = await message.guild.members.fetch(message.author.id).catch(() => null);
                if (!member || !member.roles.cache.has(response.requireRoleId)) {
                    continue;
                }
            }
            if (roleIds.length && !roleIds.some(roleId => message.member?.roles.cache.has(roleId))) continue;

            // Cooldown check
            const cooldownKey = `${response.id}_${message.channel.id}`;
            const now = Date.now();
            const cooldownEnd = this.cooldowns.get(cooldownKey) || 0;

            if (now < cooldownEnd) {
                continue; // Still on cooldown
            }

            // Match trigger
            if (!await this.matchesTrigger(message.content, response.trigger, response.matchType)) {
                continue;
            }
            if (this.closed || this.pendingResponses.has(cooldownKey) || Date.now() < (this.cooldowns.get(cooldownKey) || 0)) continue;
            this.pendingResponses.add(cooldownKey);

            // MATCH FOUND - send response
            try {
                const parsedResponse = this.parseResponse(response.response, message);
                const mentionType = ['everyone', 'users', 'roles'].includes(response.mentionPolicy) ? response.mentionPolicy : null;
                const allowedMentions = { parse: mentionType ? [mentionType] : [], repliedUser: false };
                const payload = /\{embed\}/i.test(parsedResponse)
                    ? { ...parseEmbedScript(parsedResponse), allowedMentions }
                    : { content: parsedResponse, allowedMentions };
                const sent = response.reply ? await message.reply(payload) : await message.channel.send(payload);
                if (response.deleteTrigger) await message.delete().catch(() => null);
                if (message.member) {
                    const actions = JSON.parse(response.actionRoles || '[]');
                    if (response.actionRoleId) actions.unshift({ roleId: response.actionRoleId, mode: response.actionRoleMode });
                    for (const action of actions) {
                        const actionRole = message.guild.roles.cache.get(action.roleId);
                        if (!actionRole?.editable || actionRole.managed) continue;
                        const hasRole = message.member.roles.cache.has(action.roleId);
                        const removing = action.mode === 'remove' || (action.mode === 'toggle' && hasRole);
                        const result = await RoleManager[removing ? 'removeRole' : 'addRole'](message.member, actionRole, {
                            reason: 'Auto-responder role action', logContext: 'auto-responder'
                        });
                        if (!result.success) logger.warn(`Auto-responder role action refused: ${result.error}`);
                    }
                }
                if (response.selfDestructSeconds) {
                    if (this.client.automationService) {
                        await this.client.automationService.upsert({
                            guildId: message.guild.id, kind: 'delete-message', key: sent.id,
                            config: { channelId: message.channel.id, messageId: sent.id },
                            nextRunAt: Date.now() + response.selfDestructSeconds * 1000, createdBy: response.creatorId
                        });
                    } else {
                        const timeout = setTimeout(() => sent.delete().catch(() => null), response.selfDestructSeconds * 1000);
                        timeout.unref?.();
                    }
                }

                // Update cooldown
                this.cooldowns.set(cooldownKey, Date.now() + (response.cooldown * 1000));

                // Update stats
                await dbLog.update('autoResponses',
                    () => db.update(autoResponses)
                        .set({
                            useCount: sql`${autoResponses.useCount} + 1`,
                            lastUsed: new Date()
                        })
                        .where(eq(autoResponses.id, response.id)),
                    { responseId: response.id, guildId: message.guild.id }
                );

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
            } finally {
                this.pendingResponses.delete(cooldownKey);
            }
        }
    }

    /**
     * Check if message content matches trigger
     * @param {string} content - Message content
     * @param {string} trigger - Trigger pattern
     * @param {string} matchType - Match type (exact, contains, wildcard, regex)
     * @returns {Promise<boolean>}
     */
    async matchesTrigger(content, trigger, matchType) {
        if (this.closed) return false;
        const contentLower = content.toLowerCase();
        const triggerLower = trigger.toLowerCase();

        switch (matchType) {
            case 'exact':
                return contentLower === triggerLower;

            case 'contains':
                return contentLower.includes(triggerLower);

            case 'wildcard':
            case 'regex':
                return this.matcher.match(content, trigger, matchType);

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
module.exports.createAutoResponder = createAutoResponder;
module.exports.validateResponderRoleAuthority = validateResponderRoleAuthority;
module.exports.MAX_AUTO_RESPONDERS = MAX_AUTO_RESPONDERS;
