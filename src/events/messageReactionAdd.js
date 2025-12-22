const { Events } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    name: Events.MessageReactionAdd,
    async execute(reaction, user, client) {
        try {
            // Handle partials
            if (reaction.partial) {
                try {
                    await reaction.fetch();
                } catch (error) {
                    logger.error('Failed to fetch partial reaction:', error);
                    return;
                }
            }

            if (reaction.message.partial) {
                try {
                    await reaction.message.fetch();
                } catch (error) {
                    logger.error('Failed to fetch partial message:', error);
                    return;
                }
            }

            // Ignore bots
            if (user.bot) return;

            // Ignore DMs
            if (!reaction.message.guild) return;

            // Check starboard
            if (client.starboardService) {
                await client.starboardService.handleReactionAdd(reaction, user);
            }

        } catch (error) {
            logger.error('Error in messageReactionAdd:', error);
        }
    }
};
