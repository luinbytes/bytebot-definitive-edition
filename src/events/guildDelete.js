const { Events } = require('discord.js');
const { db } = require('../database/index');
const { guilds } = require('../database/schema');
const { eq } = require('drizzle-orm');
const logger = require('../utils/logger');

module.exports = {
    name: Events.GuildDelete,
    async execute(guild) {
        logger.info(`Left or kicked from guild: ${guild.name} (ID: ${guild.id})`);

        try {
            await db.delete(guilds).where(eq(guilds.id, guild.id));
            logger.success(`Cleaned up data for guild ${guild.id} from the database.`);
        } catch (error) {
            logger.error(`Failed to clean up data for guild ${guild.id}: ${error}`);
        }
    },
};
