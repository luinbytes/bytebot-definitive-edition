const { Events } = require('discord.js');
const { db } = require('../database/index');
const { guilds } = require('../database/schema');
const logger = require('../utils/logger');

module.exports = {
    name: Events.GuildCreate,
    async execute(guild) {
        logger.info(`Joined new guild: ${guild.name} (ID: ${guild.id})`);

        try {
            await db.insert(guilds).values({
                id: guild.id,
                joinedAt: new Date(),
            }).onConflictDoNothing();

            logger.success(`Registered guild ${guild.id} in the database.`);
        } catch (error) {
            logger.error(`Failed to register guild ${guild.id}: ${error}`);
        }
    },
};
