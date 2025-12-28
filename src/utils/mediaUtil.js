const { db } = require('../database/index');
const { mediaItems, mediaTags, mediaGalleryConfig, guilds } = require('../database/schema');
const { eq, and, desc, like, or, inArray, sql } = require('drizzle-orm');
const logger = require('./logger');
const { ChannelType, PermissionFlagsBits } = require('discord.js');

const MAX_MEDIA_PER_USER = 500;

/**
 * Get or create the guild's media archive channel
 * @param {Guild} guild - Discord guild object
 * @returns {Promise<Object>} { success: boolean, channel?: Channel, error?: string }
 */
async function getOrCreateArchiveChannel(guild) {
    try {
        // Check if archive channel is already configured
        const guildConfig = await db.select().from(guilds)
            .where(eq(guilds.id, guild.id))
            .get();

        // Try to fetch existing archive channel
        if (guildConfig?.mediaArchiveChannelId) {
            try {
                const existingChannel = await guild.channels.fetch(guildConfig.mediaArchiveChannelId);
                if (existingChannel) {
                    return { success: true, channel: existingChannel };
                }
            } catch (error) {
                logger.warn(`Archive channel ${guildConfig.mediaArchiveChannelId} no longer exists, creating new one`);
            }
        }

        // Create new archive channel (hidden from everyone, bot can send)
        const archiveChannel = await guild.channels.create({
            name: 'media-archive',
            type: ChannelType.GuildText,
            topic: '🤖 Automated media archive - Do not delete! Used by ByteBot to store media gallery items.',
            permissionOverwrites: [
                {
                    id: guild.roles.everyone,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: guild.members.me.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.AttachFiles,
                        PermissionFlagsBits.EmbedLinks
                    ]
                }
            ]
        });

        // Store in database
        if (guildConfig) {
            await db.update(guilds)
                .set({ mediaArchiveChannelId: archiveChannel.id })
                .where(eq(guilds.id, guild.id));
        } else {
            await db.insert(guilds).values({
                id: guild.id,
                mediaArchiveChannelId: archiveChannel.id
            });
        }

        logger.info(`Created media archive channel for guild ${guild.id}: ${archiveChannel.id}`);
        return { success: true, channel: archiveChannel };
    } catch (error) {
        logger.error(`Failed to get/create archive channel: ${error}`);
        return { success: false, error: 'Could not create archive channel. Please check bot permissions.' };
    }
}

/**
 * Save new media item
 * @param {Object} metadata - Media metadata object
 * @returns {Object} { success: boolean, error?: string, media?: Object }
 */
async function saveMedia(metadata) {
    try {
        // Check user limit
        const count = await getMediaCount(metadata.userId);
        if (count >= MAX_MEDIA_PER_USER) {
            return {
                success: false,
                error: `Media limit reached (${MAX_MEDIA_PER_USER} items). Delete some to add more.`
            };
        }

        // Check for duplicate (same messageId + mediaUrl)
        const duplicate = await db.select().from(mediaItems)
            .where(and(
                eq(mediaItems.userId, metadata.userId),
                eq(mediaItems.messageId, metadata.messageId),
                eq(mediaItems.mediaUrl, metadata.mediaUrl)
            ))
            .get();

        if (duplicate) {
            return { success: false, error: 'This media is already saved.' };
        }

        // Insert media
        const result = await db.insert(mediaItems).values({
            ...metadata,
            savedAt: new Date(),
            messageDeleted: false,
            urlExpired: false
        }).returning();

        return { success: true, media: result[0] };
    } catch (error) {
        logger.error(`Failed to save media: ${error}`);
        return { success: false, error: 'An unexpected error occurred.' };
    }
}

/**
 * Get media items with pagination and filtering
 * @param {string} userId - User ID
 * @param {Object} options - { limit, offset, fileType?, channelId?, tags?, sortBy? }
 * @returns {Array} Media items
 */
async function getMedia(userId, options = {}) {
    const { limit = 10, offset = 0, fileType, channelId, tags, sortBy = 'date' } = options;

    try {
        let query = db.select().from(mediaItems)
            .where(eq(mediaItems.userId, userId));

        // Apply filters
        const conditions = [eq(mediaItems.userId, userId)];

        if (fileType) {
            conditions.push(eq(mediaItems.fileType, fileType));
        }
        if (channelId) {
            conditions.push(eq(mediaItems.channelId, channelId));
        }

        // Tag filtering (requires subquery)
        if (tags && tags.length > 0) {
            const taggedMediaIds = await db.select({ mediaId: mediaTags.mediaId })
                .from(mediaTags)
                .where(inArray(mediaTags.tag, tags))
                .groupBy(mediaTags.mediaId)
                .having(sql`COUNT(DISTINCT ${mediaTags.tag}) = ${tags.length}`) // AND logic
                .all();

            const ids = taggedMediaIds.map(t => t.mediaId);
            if (ids.length === 0) return []; // No matches

            conditions.push(inArray(mediaItems.id, ids));
        }

        query = db.select().from(mediaItems)
            .where(and(...conditions));

        // Sorting
        if (sortBy === 'date') {
            query = query.orderBy(desc(mediaItems.savedAt));
        } else if (sortBy === 'size') {
            query = query.orderBy(desc(mediaItems.fileSize));
        } else if (sortBy === 'name') {
            query = query.orderBy(mediaItems.fileName);
        }

        // Pagination
        const results = await query.limit(limit).offset(offset).all();
        return results;
    } catch (error) {
        logger.error(`Failed to get media: ${error}`);
        return [];
    }
}

/**
 * Search media by description, filename, or content preview
 * @param {string} userId - User ID
 * @param {string} searchQuery - Search query
 * @param {Object} options - { limit, offset }
 * @returns {Object} { results: Array, total: number }
 */
async function searchMedia(userId, searchQuery, options = {}) {
    const { limit = 10, offset = 0 } = options;

    try {
        const pattern = `%${searchQuery}%`;

        const results = await db.select().from(mediaItems)
            .where(and(
                eq(mediaItems.userId, userId),
                or(
                    like(mediaItems.description, pattern),
                    like(mediaItems.fileName, pattern),
                    like(mediaItems.contentPreview, pattern)
                )
            ))
            .orderBy(desc(mediaItems.savedAt))
            .limit(limit)
            .offset(offset)
            .all();

        const total = await db.select({ count: sql`count(*)` })
            .from(mediaItems)
            .where(and(
                eq(mediaItems.userId, userId),
                or(
                    like(mediaItems.description, pattern),
                    like(mediaItems.fileName, pattern),
                    like(mediaItems.contentPreview, pattern)
                )
            ))
            .get();

        return { results, total: total.count };
    } catch (error) {
        logger.error(`Media search error: ${error}`);
        return { results: [], total: 0 };
    }
}

/**
 * Get single media item with tags
 * @param {string} userId - User ID
 * @param {number} mediaId - Media ID
 * @returns {Object|null} Media item with tags
 */
async function getMediaById(userId, mediaId) {
    try {
        const media = await db.select().from(mediaItems)
            .where(and(
                eq(mediaItems.id, mediaId),
                eq(mediaItems.userId, userId)
            ))
            .get();

        if (!media) return null;

        // Fetch tags
        const tags = await db.select().from(mediaTags)
            .where(eq(mediaTags.mediaId, mediaId))
            .all();

        return { ...media, tags };
    } catch (error) {
        logger.error(`Failed to get media by ID: ${error}`);
        return null;
    }
}

/**
 * Delete media item
 * @param {string} userId - User ID
 * @param {number} mediaId - Media ID
 * @returns {Object} { success: boolean, error?: string }
 */
async function deleteMedia(userId, mediaId) {
    try {
        // Delete tags first (foreign key cleanup)
        await db.delete(mediaTags).where(eq(mediaTags.mediaId, mediaId));

        // Delete media
        const result = await db.delete(mediaItems)
            .where(and(
                eq(mediaItems.id, mediaId),
                eq(mediaItems.userId, userId)
            ))
            .returning();

        return { success: result.length > 0 };
    } catch (error) {
        logger.error(`Failed to delete media: ${error}`);
        return { success: false, error: 'Failed to delete media.' };
    }
}

/**
 * Add tag to media item
 * @param {number} mediaId - Media ID
 * @param {string} tag - Tag name
 * @param {boolean} autoGenerated - Whether tag was auto-generated
 * @returns {Object} { success: boolean, error?: string }
 */
async function addTag(mediaId, tag, autoGenerated = false) {
    try {
        const normalizedTag = tag.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!normalizedTag) return { success: false, error: 'Invalid tag format.' };

        await db.insert(mediaTags).values({
            mediaId,
            tag: normalizedTag,
            autoGenerated,
            createdAt: new Date()
        });

        return { success: true };
    } catch (error) {
        if (error.message.includes('UNIQUE')) {
            return { success: false, error: 'Tag already exists on this item.' };
        }
        logger.error(`Failed to add tag: ${error}`);
        return { success: false, error: 'Failed to add tag.' };
    }
}

/**
 * Remove tag from media item
 * @param {number} mediaId - Media ID
 * @param {string} tag - Tag name
 * @returns {Object} { success: boolean }
 */
async function removeTag(mediaId, tag) {
    try {
        const normalizedTag = tag.toLowerCase().replace(/[^a-z0-9]/g, '');

        await db.delete(mediaTags)
            .where(and(
                eq(mediaTags.mediaId, mediaId),
                eq(mediaTags.tag, normalizedTag)
            ));

        return { success: true };
    } catch (error) {
        logger.error(`Failed to remove tag: ${error}`);
        return { success: false };
    }
}

/**
 * Update media description
 * @param {string} userId - User ID
 * @param {number} mediaId - Media ID
 * @param {string} description - Description text
 * @returns {Object} { success: boolean, error?: string }
 */
async function updateDescription(userId, mediaId, description) {
    try {
        // Limit to 1000 chars
        const trimmed = description ? description.substring(0, 1000) : null;

        await db.update(mediaItems)
            .set({ description: trimmed })
            .where(and(
                eq(mediaItems.id, mediaId),
                eq(mediaItems.userId, userId)
            ));

        return { success: true };
    } catch (error) {
        logger.error(`Failed to update description: ${error}`);
        return { success: false };
    }
}

/**
 * Get media count for user
 * @param {string} userId - User ID
 * @returns {number} Media count
 */
async function getMediaCount(userId) {
    try {
        const result = await db.select({ count: sql`count(*)` })
            .from(mediaItems)
            .where(eq(mediaItems.userId, userId))
            .get();

        return result.count;
    } catch (error) {
        logger.error(`Failed to get media count: ${error}`);
        return 0;
    }
}

/**
 * Archive media file to guild's archive channel
 * @param {string} attachmentUrl - Original Discord CDN URL
 * @param {string} fileName - File name
 * @param {Guild} guild - Discord guild object
 * @returns {Promise<Object>} { success: boolean, archivedUrl?: string, error?: string }
 */
async function archiveMedia(attachmentUrl, fileName, guild) {
    try {
        // Get or create archive channel
        const { success, channel, error } = await getOrCreateArchiveChannel(guild);
        if (!success) {
            return { success: false, error };
        }

        // Download the file
        const axios = require('axios');
        const response = await axios.get(attachmentUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);

        // Re-upload to archive channel
        const archivedMessage = await channel.send({
            content: `📁 **Archived:** ${fileName}`,
            files: [{
                attachment: buffer,
                name: fileName
            }]
        });

        // Get the new permanent URL and message ID
        if (archivedMessage.attachments.size === 0) {
            return { success: false, error: 'Failed to upload file to archive' };
        }

        const archivedUrl = archivedMessage.attachments.first().url;
        return {
            success: true,
            archivedUrl,
            archiveMessageId: archivedMessage.id
        };
    } catch (error) {
        logger.error(`Failed to archive media: ${error}`);
        return { success: false, error: 'Failed to archive media file' };
    }
}

/**
 * Mark media as deleted (soft delete on message deletion)
 * @param {string} messageId - Message ID
 */
async function markDeleted(messageId) {
    try {
        // Get all media items for this message
        const items = await db.select()
            .from(mediaItems)
            .where(eq(mediaItems.messageId, messageId));

        // Update each item individually
        for (const item of items) {
            // Only mark URL as expired if NOT archived
            // Archived media has archiveMessageId set and URL remains valid
            const urlExpired = !item.archiveMessageId;

            await db.update(mediaItems)
                .set({
                    messageDeleted: true,
                    urlExpired: urlExpired
                })
                .where(eq(mediaItems.id, item.id));
        }
    } catch (error) {
        logger.error(`Failed to mark media as deleted: ${error}`);
    }
}

module.exports = {
    saveMedia,
    getMedia,
    searchMedia,
    getMediaById,
    deleteMedia,
    addTag,
    removeTag,
    updateDescription,
    getMediaCount,
    markDeleted,
    getOrCreateArchiveChannel,
    archiveMedia,
    MAX_MEDIA_PER_USER
};
