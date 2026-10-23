const { db } = require('../database');
const { starboardConfig, starboardMessages } = require('../database/schema');
const { eq } = require('drizzle-orm');
const embeds = require('../utils/embeds');
const logger = require('../utils/logger');
const { dbLog } = require('../utils/dbLogger');
const { ReactionType, Routes } = require('discord.js');

const UPDATE_DEBOUNCE_MS = 2000;
const MAX_TRACKED_UPDATES = 500;
const MAX_CONCURRENT_UPDATES = 4;
const REACTION_PAGE_SIZE = 100;

/**
 * StarboardService - Handles message starring and starboard management
 *
 * Features:
 * - Tracks reaction-based starred messages
 * - Debounces updates to prevent API spam
 * - Handles self-starring prevention
 * - NSFW content filtering
 * - Graceful error handling for deleted channels/messages
 */
class StarboardService {
    constructor(client) {
        this.client = client;
        this.updateQueue = new Map();
        this.runningUpdates = new Set();
        this.updateTimer = null;
        this.stopped = false;
        this.overflowWarned = false;
        this.configCache = new Map(); // guildId -> { config, expiry }
        this.cacheExpiry = 300000; // 5 minutes in ms
    }

    /**
     * Get starboard config for a guild (with caching and TTL)
     */
    async getConfig(guildId) {
        if (this.stopped) return null;
        const now = Date.now();
        const cached = this.configCache.get(guildId);

        // Return cached if still valid
        if (cached && cached.expiry > now) {
            return cached.config;
        }

        const config = await dbLog.select('starboardConfig',
            () => db.select()
                .from(starboardConfig)
                .where(eq(starboardConfig.guildId, guildId))
                .get(),
            { guildId }
        );

        if (this.stopped) return null;
        if (config) {
            this.configCache.set(guildId, {
                config: config,
                expiry: now + this.cacheExpiry
            });
        }

        return config || null;
    }

    /**
     * Invalidate config cache for a guild
     */
    invalidateCache(guildId) {
        this.configCache.delete(guildId);
    }

    /**
     * Handle reaction add event
     */
    async handleReactionAdd(reaction, user) {
        try {
            // Fetch config
            const config = await this.getConfig(reaction.message.guild.id);
            if (!config || !config.enabled) return;

            // Check if emoji matches
            if (reaction.emoji.name !== config.emoji) return;

            // Queue update (debounced) - pass channel ID for reliable fetching
            this.queueStarboardUpdate(reaction.message.id, reaction.message.channel.id);

        } catch (error) {
            logger.error('Error in handleReactionAdd:', error);
        }
    }

    /**
     * Handle reaction remove event
     */
    async handleReactionRemove(reaction, user) {
        try {
            // Fetch config
            const config = await this.getConfig(reaction.message.guild.id);
            if (!config || !config.enabled) return;

            // Check if emoji matches
            if (reaction.emoji.name !== config.emoji) return;

            // Queue update (debounced) - pass channel ID for reliable fetching
            this.queueStarboardUpdate(reaction.message.id, reaction.message.channel.id);

        } catch (error) {
            logger.error('Error in handleReactionRemove:', error);
        }
    }

    /**
     * Handle mass reaction removal (all reactions cleared)
     */
    async handleReactionRemoveAll(message, reactions) {
        try {
            const config = await this.getConfig(message.guild.id);
            if (!config || !config.enabled) return;

            this.queueStarboardUpdate(message.id, message.channel.id);
        } catch (error) {
            logger.error('Error in handleReactionRemoveAll:', error);
        }
    }

    /**
     * Handle original message deletion
     */
    async handleMessageDelete(message) {
        try {
            // Check if message is in starboard
            const entry = await dbLog.select('starboardMessages',
                () => db.select()
                    .from(starboardMessages)
                    .where(eq(starboardMessages.originalMessageId, message.id))
                    .get(),
                { messageId: message.id, guildId: message.guild.id }
            );

            if (!entry || !entry.starboardMessageId) return;

            const config = await this.getConfig(message.guild.id);
            if (!config) return;

            // Fetch starboard channel and message
            const starboardChannel = await this.client.channels.fetch(config.channelId).catch(() => null);
            if (!starboardChannel) return;

            const starboardMsg = await starboardChannel.messages.fetch(entry.starboardMessageId).catch(() => null);
            if (!starboardMsg) return;

            // Update embed with deletion warning
            const oldEmbed = starboardMsg.embeds[0];
            if (oldEmbed) {
                // Create new embed based on old one
                const { EmbedBuilder } = require('discord.js');
                const updatedEmbed = EmbedBuilder.from(oldEmbed);
                updatedEmbed.setFooter({ text: '⚠️ Original message deleted' });

                await starboardMsg.edit({ embeds: [updatedEmbed] });
            }

        } catch (error) {
            logger.error('Error in handleMessageDelete:', error);
        }
    }

    /**
     * Queue a starboard update (debounced to prevent spam)
     * @param {string} messageId - The ID of the message
     * @param {string} channelId - The ID of the channel containing the message
     */
    queueStarboardUpdate(messageId, channelId) {
        if (this.stopped) return false;

        let entry = this.updateQueue.get(messageId);
        if (!entry) {
            if (this.updateQueue.size >= MAX_TRACKED_UPDATES) {
                if (!this.overflowWarned) {
                    logger.warn('Starboard update queue full; new messages wait for another reaction to retry');
                    this.overflowWarned = true;
                }
                return false;
            }
            entry = { channelId, state: 'pending', dueAt: 0, dirty: false };
            this.updateQueue.set(messageId, entry);
        }

        entry.channelId = channelId;
        entry.dueAt = Date.now() + UPDATE_DEBOUNCE_MS;
        if (entry.state === 'running') entry.dirty = true;
        this.scheduleUpdates();
        return true;
    }

    scheduleUpdates() {
        clearTimeout(this.updateTimer);
        this.updateTimer = null;
        if (this.stopped || this.runningUpdates.size >= MAX_CONCURRENT_UPDATES) return;

        let nextDueAt = Infinity;
        for (const entry of this.updateQueue.values()) {
            if (entry.state === 'pending') nextDueAt = Math.min(nextDueAt, entry.dueAt);
        }
        if (nextDueAt === Infinity) return;

        this.updateTimer = setTimeout(() => {
            this.updateTimer = null;
            this.drainUpdates();
        }, Math.max(0, nextDueAt - Date.now()));
    }

    drainUpdates() {
        if (this.stopped) return;

        for (const [messageId, entry] of this.updateQueue) {
            if (this.runningUpdates.size >= MAX_CONCURRENT_UPDATES) break;
            if (entry.state !== 'pending' || entry.dueAt > Date.now()) continue;

            entry.state = 'running';
            entry.dirty = false;
            const update = this.updateStarboardMessage(messageId, entry.channelId)
                .finally(() => {
                    this.runningUpdates.delete(update);
                    if (this.stopped) return;

                    if (entry.dirty) {
                        entry.state = 'pending';
                        this.updateQueue.delete(messageId);
                        this.updateQueue.set(messageId, entry);
                    } else {
                        this.updateQueue.delete(messageId);
                        this.overflowWarned = false;
                    }
                    this.scheduleUpdates();
                });
            this.runningUpdates.add(update);
        }
        this.scheduleUpdates();
    }

    /**
     * Update starboard message (count stars and post/edit/remove as needed)
     * @param {string} messageId - The ID of the message
     * @param {string} channelId - The ID of the channel containing the message
     */
    async updateStarboardMessage(messageId, channelId) {
        if (this.stopped) return;
        try {
            logger.debug(`[Starboard] Processing update for message ${messageId} in channel ${channelId}`);

            // Fetch the channel first
            const channel = await this.client.channels.fetch(channelId).catch(() => null);
            if (!channel || !channel.isTextBased() || !channel.guild) {
                logger.debug(`Could not find channel ${channelId} for starboard update`);
                return;
            }

            // Fetch the message from the channel
            const message = await channel.messages.fetch(messageId).catch(() => null);
            if (!message) {
                logger.debug(`Could not find message ${messageId} in channel ${channelId} for starboard update`);
                return;
            }

            logger.debug(`[Starboard] Found message, fetching config for guild ${message.guild.id}`);

            // Get config
            const config = await this.getConfig(message.guild.id);
            if (!config || !config.enabled) {
                logger.debug(`[Starboard] No config or disabled during update`);
                return;
            }

            // Count valid stars
            const starCount = await this.countValidStars(message, config.emoji);
            logger.debug(`[Starboard] Star count: ${starCount}, threshold: ${config.threshold}`);

            // Check if already in DB
            let entry = await dbLog.select('starboardMessages',
                () => db.select()
                    .from(starboardMessages)
                    .where(eq(starboardMessages.originalMessageId, messageId))
                    .get(),
                { messageId, guildId: message.guild.id }
            );
            logger.debug(`[Starboard] Existing entry: ${entry ? `id=${entry.id}` : 'none'}`);

            // If star count >= threshold
            if (starCount >= config.threshold) {
                logger.debug(`[Starboard] Star count meets threshold, processing...`);
                if (entry) {
                    // Update existing entry
                    await dbLog.update('starboardMessages',
                        () => db.update(starboardMessages)
                            .set({ starCount: starCount })
                            .where(eq(starboardMessages.id, entry.id)),
                        { entryId: entry.id, messageId, starCount, operation: 'updateCount' }
                    );

                    // If already posted, edit
                    if (entry.starboardMessageId) {
                        await this.editStarboardMessage(message, starCount, entry.starboardMessageId, config);
                    } else {
                        // Was previously removed, re-post
                        const starboardMsgId = await this.postToStarboard(message, starCount, config);
                        if (starboardMsgId) {
                            await dbLog.update('starboardMessages',
                                () => db.update(starboardMessages)
                                    .set({ starboardMessageId: starboardMsgId })
                                    .where(eq(starboardMessages.id, entry.id)),
                                { entryId: entry.id, messageId, starboardMsgId, operation: 'repost' }
                            );
                        }
                    }
                } else {
                    // New starred message - post to starboard
                    const starboardMsgId = await this.postToStarboard(message, starCount, config);
                    if (starboardMsgId) {
                        // Insert to DB
                        const firstImage = message.attachments.find(att => att.contentType?.startsWith('image/'));
                        await dbLog.insert('starboardMessages',
                            () => db.insert(starboardMessages).values({
                                guildId: message.guild.id,
                                originalMessageId: message.id,
                                originalChannelId: message.channel.id,
                                starboardMessageId: starboardMsgId,
                                authorId: message.author.id,
                                starCount: starCount,
                                content: message.content || null,
                                imageUrl: firstImage?.url || null,
                                postedAt: new Date()
                            }),
                            { guildId: message.guild.id, messageId: message.id, starCount, starboardMsgId }
                        );
                    }
                }
            } else {
                // Star count below threshold
                const updates = { starCount };
                if (entry && entry.starboardMessageId) {
                    // Remove from starboard
                    const starboardChannel = await this.client.channels.fetch(config.channelId).catch(() => null);
                    if (starboardChannel) {
                        try {
                            await starboardChannel.messages.delete(entry.starboardMessageId);
                            updates.starboardMessageId = null;
                        } catch (error) {
                            // Unknown Message means it is already gone; transient failures should retry later.
                            if (error?.code === 10008 || error?.rawError?.code === 10008) {
                                updates.starboardMessageId = null;
                            }
                        }
                    }
                }

                if (entry) {
                    await dbLog.update('starboardMessages',
                        () => db.update(starboardMessages)
                            .set(updates)
                            .where(eq(starboardMessages.id, entry.id)),
                        { entryId: entry.id, messageId, starCount, operation: 'updateBelowThreshold' }
                    );
                }
            }

        } catch (error) {
            logger.error('Error updating starboard message:', error);
        }
    }

    /**
     * Count valid stars on a message (excluding author and bots)
     */
    async countValidStars(message, emoji) {
        const reaction = message.reactions.cache.find(r => r.emoji.name === emoji);
        if (!reaction) return 0;

        let validStars = 0;
        let after;
        while (true) {
            const query = new URLSearchParams({ limit: String(REACTION_PAGE_SIZE), type: String(ReactionType.Normal) });
            if (after) query.set('after', after);
            // Raw pages avoid filling both reaction and client user caches with every voter.
            const users = await this.client.rest.get(
                Routes.channelMessageReaction(message.channelId, message.id, reaction.emoji.identifier),
                { query }
            );

            const previousId = BigInt(after || '0');
            let nextId = previousId;
            for (const user of users) {
                const userId = BigInt(user.id);
                if (userId <= previousId) throw new Error('Reaction user pagination did not advance');
                if (userId > nextId) nextId = userId;
                if (!user.bot && user.id !== message.author.id) validStars++;
            }
            if (users.length < REACTION_PAGE_SIZE) return validStars;
            after = String(nextId);
        }
    }

    /**
     * Post a message to the starboard
     */
    async postToStarboard(message, starCount, config) {
        try {
            // Fetch starboard channel
            const starboardChannel = await this.client.channels.fetch(config.channelId).catch(() => null);

            if (!starboardChannel) {
                // Channel deleted, disable starboard
                await dbLog.update('starboardConfig',
                    () => db.update(starboardConfig)
                        .set({ enabled: false })
                        .where(eq(starboardConfig.guildId, message.guild.id)),
                    { guildId: message.guild.id, operation: 'disableChannelDeleted' }
                );

                this.invalidateCache(message.guild.id);

                // Notify guild owner
                const owner = await message.guild.fetchOwner().catch(() => null);
                if (owner) {
                    await owner.send({
                        embeds: [embeds.warn(
                            'Starboard Disabled',
                            `The starboard channel in **${message.guild.name}** was deleted. Starboard has been disabled.`
                        )]
                    }).catch(() => { }); // Owner may have DMs off
                }

                logger.warn(`Starboard channel not found for guild ${message.guild.id}, disabled starboard`);
                return null;
            }

            // NSFW content filtering
            if (message.channel.nsfw && !starboardChannel.nsfw) {
                logger.info(`Skipping NSFW message ${message.id} - starboard channel not NSFW`);
                return null;
            }

            // Create embed
            const embed = this.createStarboardEmbed(message, starCount, config.emoji);

            // Post to starboard
            const starboardMsg = await starboardChannel.send({ embeds: [embed] });
            logger.info(`Posted message ${message.id} to starboard (${starCount} stars)`);

            return starboardMsg.id;

        } catch (error) {
            logger.error('Error posting to starboard:', error);
            return null;
        }
    }

    /**
     * Edit an existing starboard message
     */
    async editStarboardMessage(message, starCount, starboardMessageId, config) {
        try {
            const starboardChannel = await this.client.channels.fetch(config.channelId).catch(() => null);
            if (!starboardChannel) return;

            const starboardMsg = await starboardChannel.messages.fetch(starboardMessageId).catch(() => null);

            if (!starboardMsg) {
                // Message deleted, re-post
                const newMsgId = await this.postToStarboard(message, starCount, config);
                if (newMsgId) {
                    // Update DB with new message ID
                    await dbLog.update('starboardMessages',
                        () => db.update(starboardMessages)
                            .set({ starboardMessageId: newMsgId })
                            .where(eq(starboardMessages.originalMessageId, message.id)),
                        { messageId: message.id, starboardMsgId: newMsgId, operation: 'recreateDeleted' }
                    );
                }
                return;
            }

            // Update embed
            const embed = this.createStarboardEmbed(message, starCount, config.emoji);
            await starboardMsg.edit({ embeds: [embed] });

        } catch (error) {
            logger.error('Error editing starboard message:', error);
        }
    }

    /**
     * Create starboard embed
     */
    createStarboardEmbed(message, starCount, emoji) {
        const embed = embeds.base(
            `${emoji} ${starCount} | #${message.channel.name}`,
            message.content || '*[No content]*'
        );

        embed.setAuthor({
            name: message.author.tag,
            iconURL: message.author.displayAvatarURL()
        });

        // Add first image if exists
        const attachment = message.attachments.find(att =>
            att.contentType?.startsWith('image/')
        );
        if (attachment) {
            embed.setImage(attachment.url);
        }

        // Jump link
        embed.addFields({
            name: 'Source',
            value: `[Jump to message](${message.url})`
        });

        embed.setTimestamp(message.createdAt);

        return embed;
    }

    async cleanup() {
        logger.info('Cleaning up starboard service...');

        this.stopped = true;
        clearTimeout(this.updateTimer);
        this.updateTimer = null;
        this.updateQueue.clear();
        // Discord requests already sent must settle before shutdown finishes.
        await Promise.allSettled(this.runningUpdates);

        // Clear config cache
        this.configCache.clear();

        logger.success('Starboard service cleanup complete');
    }
}

module.exports = StarboardService;
