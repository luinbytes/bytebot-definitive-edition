const { db } = require('../database/index');
const { bookmarks } = require('../database/schema');
const { eq, and, desc, like, or } = require('drizzle-orm');
const logger = require('./logger');
const { dbLog } = require('./dbLogger');

/**
 * Bookmark Utility - Handles all bookmark database operations
 * Enforces 100 bookmark limit per user and prevents duplicates
 */

const MAX_BOOKMARKS_PER_USER = 100;

/**
 * Save a new bookmark
 * @param {string} userId - Discord user ID
 * @param {Object} message - Discord.js Message object
 * @returns {Object} { success: boolean, error?: string, bookmark?: Object }
 */
async function saveBookmark(userId, message) {
    try {
        // Check if user has reached the limit
        const count = await getBookmarkCount(userId);
        if (count >= MAX_BOOKMARKS_PER_USER) {
            return {
                success: false,
                error: `You have reached the maximum of ${MAX_BOOKMARKS_PER_USER} bookmarks. Please delete some before adding more.`
            };
        }

        // Check for duplicate
        const duplicate = await db.select().from(bookmarks)
            .where(and(
                eq(bookmarks.userId, userId),
                eq(bookmarks.messageId, message.id)
            ))
            .get();

        if (duplicate) {
            return {
                success: false,
                error: 'You have already bookmarked this message.'
            };
        }

        // Extract attachment URLs (up to 5)
        const attachmentUrls = message.attachments
            .map(att => att.url)
            .slice(0, 5)
            .join(',');

        // Cache message content (limit to 4000 chars to stay within embed limits)
        let content = message.content || '*[No text content]*';
        if (content.length > 4000) {
            content = content.substring(0, 3997) + '...';
        }

        // Insert bookmark
        const result = await db.insert(bookmarks).values({
            userId: userId,
            guildId: message.guild?.id || 'DM',
            channelId: message.channel.id,
            messageId: message.id,
            content: content,
            authorId: message.author.id,
            attachmentUrls: attachmentUrls || null,
            savedAt: new Date(),
            messageDeleted: false
        }).returning();

        return {
            success: true,
            bookmark: result[0]
        };
    } catch (error) {
        logger.error(`Failed to save bookmark: ${error}`);
        return {
            success: false,
            error: 'An unexpected error occurred while saving the bookmark.'
        };
    }
}

/**
 * Get user's bookmarks with pagination and optional search
 * @param {string} userId - Discord user ID
 * @param {Object} options - { limit: number, offset: number, search?: string }
 * @returns {Array} Array of bookmark objects
 */
async function getBookmarks(userId, options = {}) {
    try {
        const { limit = 10, offset = 0, search = null } = options;

        let query = db.select().from(bookmarks)
            .where(eq(bookmarks.userId, userId))
            .orderBy(desc(bookmarks.savedAt))
            .limit(limit)
            .offset(offset);

        // Add search filter if provided
        if (search) {
            query = db.select().from(bookmarks)
                .where(and(
                    eq(bookmarks.userId, userId),
                    like(bookmarks.content, `%${search}%`)
                ))
                .orderBy(desc(bookmarks.savedAt))
                .limit(limit)
                .offset(offset);
        }

        const results = await query.all();
        return results;
    } catch (error) {
        logger.error(`Failed to get bookmarks: ${error}`);
        return [];
    }
}

/**
 * Get total bookmark count for a user
 * @param {string} userId - Discord user ID
 * @returns {number} Total bookmark count
 */
async function getBookmarkCount(userId) {
    try {
        const results = await db.select().from(bookmarks)
            .where(eq(bookmarks.userId, userId))
            .all();
        return results.length;
    } catch (error) {
        logger.error(`Failed to get bookmark count: ${error}`);
        return 0;
    }
}

/**
 * Delete a bookmark by ID (with ownership verification)
 * @param {string} userId - Discord user ID
 * @param {number} bookmarkId - Bookmark database ID
 * @returns {Object} { success: boolean, error?: string }
 */
async function deleteBookmark(userId, bookmarkId) {
    try {
        // Verify ownership before deleting
        const bookmark = await db.select().from(bookmarks)
            .where(and(
                eq(bookmarks.id, bookmarkId),
                eq(bookmarks.userId, userId)
            ))
            .get();

        if (!bookmark) {
            return {
                success: false,
                error: 'Bookmark not found or you do not have permission to delete it.'
            };
        }

        await db.delete(bookmarks)
            .where(eq(bookmarks.id, bookmarkId));

        return { success: true };
    } catch (error) {
        logger.error(`Failed to delete bookmark: ${error}`);
        return {
            success: false,
            error: 'An unexpected error occurred while deleting the bookmark.'
        };
    }
}

/**
 * Delete all bookmarks for a user
 * @param {string} userId - Discord user ID
 * @returns {Object} { success: boolean, count: number, error?: string }
 */
async function deleteAllBookmarks(userId) {
    try {
        const count = await getBookmarkCount(userId);

        if (count === 0) {
            return {
                success: false,
                count: 0,
                error: 'You have no bookmarks to delete.'
            };
        }

        await db.delete(bookmarks)
            .where(eq(bookmarks.userId, userId));

        return {
            success: true,
            count: count
        };
    } catch (error) {
        logger.error(`Failed to delete all bookmarks: ${error}`);
        return {
            success: false,
            count: 0,
            error: 'An unexpected error occurred while deleting bookmarks.'
        };
    }
}

/**
 * Mark a bookmark as deleted when source message is deleted
 * @param {string} messageId - Discord message ID
 * @returns {number} Number of bookmarks marked as deleted
 */
async function markDeleted(messageId) {
    try {
        // Update all bookmarks for this message
        const result = await db.update(bookmarks)
            .set({ messageDeleted: true })
            .where(eq(bookmarks.messageId, messageId))
            .returning();

        return result.length;
    } catch (error) {
        logger.error(`Failed to mark bookmark as deleted: ${error}`);
        return 0;
    }
}

/**
 * Get a single bookmark by ID (with ownership verification)
 * @param {string} userId - Discord user ID
 * @param {number} bookmarkId - Bookmark database ID
 * @returns {Object|null} Bookmark object or null
 */
async function getBookmarkById(userId, bookmarkId) {
    try {
        const bookmark = await db.select().from(bookmarks)
            .where(and(
                eq(bookmarks.id, bookmarkId),
                eq(bookmarks.userId, userId)
            ))
            .get();

        return bookmark || null;
    } catch (error) {
        logger.error(`Failed to get bookmark by ID: ${error}`);
        return null;
    }
}

/**
 * Search bookmarks by content
 * @param {string} userId - Discord user ID
 * @param {string} query - Search query
 * @param {Object} options - { limit: number, offset: number }
 * @returns {Object} { results: Array, total: number }
 */
async function searchBookmarks(userId, query, options = {}) {
    try {
        const { limit = 10, offset = 0 } = options;

        // Get matching bookmarks
        const results = await db.select().from(bookmarks)
            .where(and(
                eq(bookmarks.userId, userId),
                like(bookmarks.content, `%${query}%`)
            ))
            .orderBy(desc(bookmarks.savedAt))
            .limit(limit)
            .offset(offset)
            .all();

        // Get total count for pagination
        const totalResults = await db.select().from(bookmarks)
            .where(and(
                eq(bookmarks.userId, userId),
                like(bookmarks.content, `%${query}%`)
            ))
            .all();

        return {
            results: results,
            total: totalResults.length
        };
    } catch (error) {
        logger.error(`Failed to search bookmarks: ${error}`);
        return {
            results: [],
            total: 0
        };
    }
}

module.exports = {
    saveBookmark,
    getBookmarks,
    getBookmarkCount,
    deleteBookmark,
    deleteAllBookmarks,
    markDeleted,
    getBookmarkById,
    searchBookmarks,
    MAX_BOOKMARKS_PER_USER
};
