const { Events } = require('discord.js');
const logger = require('../utils/logger');
module.exports = {
    name: Events.GuildUpdate,
    async execute(oldGuild, newGuild, client) {
        await client.automationService?.handleGuildUpdate(oldGuild, newGuild).catch(error => logger.error('Vanity tracking failed:', error));
    }
};
