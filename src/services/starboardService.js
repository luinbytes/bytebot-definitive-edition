const { db } = require('../database');
const { starboardConfig, starboardMessages } = require('../database/schema');
const { eq, and } = require('drizzle-orm');
const embeds = require('../utils/embeds');
const logger = require('../utils/logger');
const { dbLog } = require('../utils/dbLogger');

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
        this.updateQueue = new Map(); // messageId -> timeout
        this.configCache = new Map(); // guildId -> { config, expiry }
        this.cacheExpiry = 300000; // 5 minutes in ms
    }

    /**
     * Get starboard config for a guild (with caching and TTL)
     */
    async getConfig(guildId) {
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

            // Find starboard entry
            const entry = await dbLog.select('starboardMessages',
                () => db.select()
                    .from(starboardMessages)
                    .where(eq(starboardMessages.originalMessageId, message.id))
                    .get(),
                { messageId: message.id, guildId: message.guild.id }
            );

            if (!entry) return;

            // Remove from starboard if posted
            if (entry.starboardMessageId) {
                const starboardChannel = await this.client.channels.fetch(config.channelId).catch(() => null);
                if (starboardChannel) {
                    await starboardChannel.messages.delete(entry.starboardMessageId).catch(() => { });
                }
            }

            // Update DB (set star count to 0, remove starboard message ID)
            await dbLog.update('starboardMessages',
                () => db.update(starboardMessages)
                    .set({ starCount: 0, starboardMessageId: null })
                    .where(eq(starboardMessages.id, entry.id)),
                { entryId: entry.id, messageId: message.id, operation: 'clearReactions' }
            );

            logger.info(`Removed message ${message.id} from starboard (all reactions cleared)`);

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
        // Clear existing timeout
        if (this.updateQueue.has(messageId)) {
            clearTimeout(this.updateQueue.get(messageId).timeout);
        }

        // Set new timeout (5 seconds)
        const timeout = setTimeout(async () => {
            await this.updateStarboardMessage(messageId, channelId);
            this.updateQueue.delete(messageId);
        }, 5000);

        this.updateQueue.set(messageId, { timeout, channelId });
    }

    /**
     * Update starboard message (count stars and post/edit/remove as needed)
     * @param {string} messageId - The ID of the message
     * @param {string} channelId - The ID of the channel containing the message
     */
    async updateStarboardMessage(messageId, channelId) {
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
                                postedAt: Date.now()
                            }),
                            { guildId: message.guild.id, messageId: message.id, starCount, starboardMsgId }
                        );
                    }
                }
            } else {
                // Star count below threshold
                if (entry && entry.starboardMessageId) {
                    // Remove from starboard
                    const starboardChannel = await this.client.channels.fetch(config.channelId).catch(() => null);
                    if (starboardChannel) {
                        await starboardChannel.messages.delete(entry.starboardMessageId).catch(() => { });
                    }

                    // Update DB (keep entry but clear starboard message ID)
                    await dbLog.update('starboardMessages',
                        () => db.update(starboardMessages)
                            .set({ starCount: starCount, starboardMessageId: null })
                            .where(eq(starboardMessages.id, entry.id)),
                        { entryId: entry.id, messageId, starCount, operation: 'removeBelowThreshold' }
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
        try {
            const reaction = message.reactions.cache.find(r => r.emoji.name === emoji);
            if (!reaction) return 0;

            const users = await reaction.users.fetch();
            const validStars = users.filter(user =>
                !user.bot && user.id !== message.author.id
            );

            return validStars.size;
        } catch (error) {
            logger.error('Error counting stars:', error);
            return 0;
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

    /**
     * Cleanup method - Clear all pending update timeouts and cache
     */
    cleanup() {
        logger.info('Cleaning up starboard service...');

        // Clear all pending update timeouts
        for (const [messageId, entry] of this.updateQueue.entries()) {
            clearTimeout(entry.timeout);
        }
        this.updateQueue.clear();

        // Clear config cache
        this.configCache.clear();

        logger.success('Starboard service cleanup complete');
    }
}

module.exports = StarboardService;
