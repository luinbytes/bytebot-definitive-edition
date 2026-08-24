const { Events } = require('discord.js');
const logger = require('../utils/logger');
module.exports = {
    name: Events.UserUpdate,
    async execute(oldUser, newUser, client) {
        if (oldUser?.username && oldUser.username !== newUser.username) {
            const guildIds = [...client.guilds.cache.values()]
                .filter(guild => guild.members.cache.has(newUser.id))
                .map(guild => guild.id);
            try {
                client.informationLookupService?.recordNameChange(guildIds, newUser.id, oldUser.username);
            } catch (error) {
                logger.error('Name history recording failed:', error);
            }
        }
        await client.automationService?.handleUserUpdate(oldUser, newUser).catch(error => logger.error('Username tracking failed:', error));
    }
};
