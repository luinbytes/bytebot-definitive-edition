const { db } = require('../database');
const { starboardConfig, starboardMessages } = require('../database/schema');
const { eq, and } = require('drizzle-orm');
const embeds = require('../utils/embeds');
const logger = require('../utils/logger');

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
        this.configCache = new Map(); // guildId -> config (cached indefinitely, invalidate on change)
    }

    /**
     * Get starboard config for a guild (with caching)
     */
    async getConfig(guildId) {
        if (this.configCache.has(guildId)) {
            return this.configCache.get(guildId);
        }

        const config = await db.select()
            .from(starboardConfig)
            .where(eq(starboardConfig.guildId, guildId))
            .get();

        if (config) {
            this.configCache.set(guildId, config);
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

            // Queue update (debounced)
            this.queueStarboardUpdate(reaction.message.id);

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

            // Queue update (debounced)
            this.queueStarboardUpdate(reaction.message.id);

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
            const entry = await db.select()
                .from(starboardMessages)
                .where(eq(starboardMessages.originalMessageId, message.id))
                .get();

            if (!entry) return;

            // Remove from starboard if posted
            if (entry.starboardMessageId) {
                const starboardChannel = await this.client.channels.fetch(config.channelId).catch(() => null);
                if (starboardChannel) {
                    await starboardChannel.messages.delete(entry.starboardMessageId).catch(() => {});
                }
            }

            // Update DB (set star count to 0, remove starboard message ID)
            await db.update(starboardMessages)
                .set({ starCount: 0, starboardMessageId: null })
                .where(eq(starboardMessages.id, entry.id));

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
            const entry = await db.select()
                .from(starboardMessages)
                .where(eq(starboardMessages.originalMessageId, message.id))
                .get();

            if (!entry || !entry.starboardMessageId) return;

            const config = await this.getConfig(message.guild.id);
            if (!config) return;

            // Fetch starboard channel and message
            const starboardChannel = await this.client.channels.fetch(config.channelId).catch(() => null);
            if (!starboardChannel) return;

            const starboardMsg = await starboardChannel.messages.fetch(entry.starboardMessageId).catch(() => null);
            if (!starboardMsg) return;

            // Update embed with deletion warning
            const embed = starboardMsg.embeds[0];
            if (embed) {
                embed.data.footer = { text: '⚠️ Original message deleted' };
                await starboardMsg.edit({ embeds: [embed] });
            }

        } catch (error) {
            logger.error('Error in handleMessageDelete:', error);
        }
    }

    /**
     * Queue a starboard update (debounced to prevent spam)
     */
    queueStarboardUpdate(messageId) {
        // Clear existing timeout
        if (this.updateQueue.has(messageId)) {
            clearTimeout(this.updateQueue.get(messageId));
        }

        // Set new timeout (5 seconds)
        const timeout = setTimeout(async () => {
            await this.updateStarboardMessage(messageId);
            this.updateQueue.delete(messageId);
        }, 5000);

        this.updateQueue.set(messageId, timeout);
    }

    /**
     * Update starboard message (count stars and post/edit/remove as needed)
     */
    async updateStarboardMessage(messageId) {
        try {
            // Fetch the original message
            const channels = this.client.channels.cache;
            let message = null;
            let foundChannel = null;

            // Search for message in cached channels
            for (const [, channel] of channels) {
                if (channel.isTextBased() && channel.guild) {
                    try {
                        message = await channel.messages.fetch(messageId).catch(() => null);
                        if (message) {
                            foundChannel = channel;
                            break;
                        }
                    } catch (e) {
                        continue;
                    }
                }
            }

            if (!message) {
                logger.debug(`Could not find message ${messageId} for starboard update`);
                return;
            }

            // Get config
            const config = await this.getConfig(message.guild.id);
            if (!config || !config.enabled) return;

            // Count valid stars
            const starCount = await this.countValidStars(message, config.emoji);

            // Check if already in DB
            let entry = await db.select()
                .from(starboardMessages)
                .where(eq(starboardMessages.originalMessageId, messageId))
                .get();

            // If star count >= threshold
            if (starCount >= config.threshold) {
                if (entry) {
                    // Update existing entry
                    await db.update(starboardMessages)
                        .set({ starCount: starCount })
                        .where(eq(starboardMessages.id, entry.id));

                    // If already posted, edit
                    if (entry.starboardMessageId) {
                        await this.editStarboardMessage(message, starCount, entry.starboardMessageId, config);
                    } else {
                        // Was previously removed, re-post
                        const starboardMsgId = await this.postToStarboard(message, starCount, config);
                        if (starboardMsgId) {
                            await db.update(starboardMessages)
                                .set({ starboardMessageId: starboardMsgId })
                                .where(eq(starboardMessages.id, entry.id));
                        }
                    }
                } else {
                    // New starred message - post to starboard
                    const starboardMsgId = await this.postToStarboard(message, starCount, config);
                    if (starboardMsgId) {
                        // Insert to DB
                        const firstImage = message.attachments.find(att => att.contentType?.startsWith('image/'));
                        await db.insert(starboardMessages).values({
                            guildId: message.guild.id,
                            originalMessageId: message.id,
                            originalChannelId: message.channel.id,
                            starboardMessageId: starboardMsgId,
                            authorId: message.author.id,
                            starCount: starCount,
                            content: message.content || null,
                            imageUrl: firstImage?.url || null,
                            postedAt: Date.now()
                        });
                    }
                }
            } else {
                // Star count below threshold
                if (entry && entry.starboardMessageId) {
                    // Remove from starboard
                    const starboardChannel = await this.client.channels.fetch(config.channelId).catch(() => null);
                    if (starboardChannel) {
                        await starboardChannel.messages.delete(entry.starboardMessageId).catch(() => {});
                    }

                    // Update DB (keep entry but clear starboard message ID)
                    await db.update(starboardMessages)
                        .set({ starCount: starCount, starboardMessageId: null })
                        .where(eq(starboardMessages.id, entry.id));
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
                await db.update(starboardConfig)
                    .set({ enabled: false })
                    .where(eq(starboardConfig.guildId, message.guild.id));

                this.invalidateCache(message.guild.id);

                // Notify guild owner
                const owner = await message.guild.fetchOwner().catch(() => null);
                if (owner) {
                    await owner.send({
                        embeds: [embeds.warn(
                            'Starboard Disabled',
                            `The starboard channel in **${message.guild.name}** was deleted. Starboard has been disabled.`
                        )]
                    }).catch(() => {}); // Owner may have DMs off
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
                    await db.update(starboardMessages)
                        .set({ starboardMessageId: newMsgId })
                        .where(eq(starboardMessages.originalMessageId, message.id));
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
}

module.exports = StarboardService;
