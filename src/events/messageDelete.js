const { Events } = require('discord.js');
const logger = require('../utils/logger');
const bookmarkUtil = require('../utils/bookmarkUtil');

module.exports = {
    name: Events.MessageDelete,
    async execute(message, client) {
        // Only process messages with IDs (ignore partial/uncached messages without proper data)
        if (!message.id) return;

        try {
            // Mark any bookmarks of this message as deleted
            const markedCount = await bookmarkUtil.markDeleted(message.id);

            if (markedCount > 0) {
                logger.debug(`Marked ${markedCount} bookmark(s) as deleted for message ${message.id}`);
            }
        } catch (error) {
            // Don't crash on bookmark update failures, just log
            logger.error(`Failed to mark bookmarks as deleted for message ${message.id}: ${error}`);
        }
    }
};
