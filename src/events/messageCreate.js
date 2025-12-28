const { Events } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        // Ignore bot messages (prevents infinite loops)
        if (message.author.bot) return;

        // Guild only (auto-responder doesn't work in DMs)
        if (!message.guild) return;

        // Auto-responder check
        if (client.autoResponderService) {
            try {
                await client.autoResponderService.checkMessage(message);
            } catch (error) {
                logger.error('Auto-responder error:', error);
                // Don't crash on auto-responder errors, just log
            }
        }

        // Media gallery auto-capture
        if (client.mediaGalleryService) {
            try {
                await client.mediaGalleryService.checkMessage(message);
            } catch (error) {
                logger.error('Media gallery auto-capture error:', error);
                // Don't crash on media capture errors, just log
            }
        }

        // Activity streak tracking
        if (client.activityStreakService) {
            try {
                // Record message activity
                await client.activityStreakService.recordActivity(
                    message.author.id,
                    message.guild.id,
                    'message',
                    1
                );

                // Track active hour for time-based achievements
                const hour = new Date().getUTCHours();
                await client.activityStreakService.recordActiveHour(
                    message.author.id,
                    message.guild.id,
                    hour
                );
            } catch (error) {
                logger.error('Activity streak tracking error:', error);
                // Don't crash on tracking errors, just log
            }
        }
    }
};
