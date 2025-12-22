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
    }
};
