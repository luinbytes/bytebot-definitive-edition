const { Events } = require('discord.js');
const { db } = require('../database/index');
const { guilds, reminders } = require('../database/schema');
const { eq, and } = require('drizzle-orm');
const logger = require('../utils/logger');
const { dbLog } = require('../utils/dbLogger');

module.exports = {
    name: Events.GuildDelete,
    async execute(guild) {
        logger.info(`Left or kicked from guild: ${guild.name} (ID: ${guild.id})`);

        try {
            // Cleanup guild data
            await dbLog.delete('guilds',
                () => db.delete(guilds).where(eq(guilds.id, guild.id)),
                { guildId: guild.id }
            );
            logger.success(`Cleaned up data for guild ${guild.id} from the database.`);
        } catch (error) {
            logger.error(`Failed to clean up data for guild ${guild.id}: ${error}`);
        }

        // Cleanup active reminders from this guild
        try {
            const result = await dbLog.update('reminders',
                () => db.update(reminders)
                    .set({ active: false })
                    .where(and(
                        eq(reminders.guildId, guild.id),
                        eq(reminders.active, true)
                    ))
                    .returning()
                    .all(),
                { guildId: guild.id, operation: 'cleanupGuildDelete' }
            );

            if (result.length > 0) {
                logger.info(`Deactivated ${result.length} reminder(s) for guild ${guild.id}`);
            }
        } catch (error) {
            logger.error(`Failed to cleanup reminders for guild ${guild.id}: ${error}`);
        }
    },
};
