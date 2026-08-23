const { Events } = require('discord.js');
const logger = require('../utils/logger');
module.exports = {
    name: Events.UserUpdate,
    async execute(oldUser, newUser, client) {
        await client.automationService?.handleUserUpdate(oldUser, newUser).catch(error => logger.error('Username tracking failed:', error));
    }
};
