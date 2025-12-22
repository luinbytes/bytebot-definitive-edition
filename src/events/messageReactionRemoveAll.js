const { Events } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    name: Events.MessageReactionRemoveAll,
    async execute(message, reactions, client) {
        try {
            // Handle partial message
            if (message.partial) {
                try {
                    await message.fetch();
                } catch (error) {
                    logger.error('Failed to fetch partial message:', error);
                    return;
                }
            }

            // Ignore DMs
            if (!message.guild) return;

            // Check starboard
            if (client.starboardService) {
                await client.starboardService.handleReactionRemoveAll(message, reactions);
            }

        } catch (error) {
            logger.error('Error in messageReactionRemoveAll:', error);
        }
    }
};
