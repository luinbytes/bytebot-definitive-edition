const { Events } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    name: Events.PresenceUpdate,
    async execute(oldPresence, newPresence, client) {
        if (!client.automationService || newPresence.user?.bot) return;
        await client.automationService.handlePresence(oldPresence, newPresence)
            .catch(error => logger.error('Vanity presence automation failed:', error));
    }
};
