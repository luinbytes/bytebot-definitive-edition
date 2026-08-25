const { Events } = require('discord.js');
const { db } = require('../database/index');
const { guilds, musicConfig, lifecycleMessages, reminders, automationRules, autoResponses, uwuLockMembers, uwuRouletteConfigs } = require('../database/schema');
const { eq, and } = require('drizzle-orm');
const logger = require('../utils/logger');
const { dbLog } = require('../utils/dbLogger');
const { runGuildLifecycle } = require('../utils/guildLifecycle');

async function handleGuildDelete(guild) {
        logger.info(`Left or kicked from guild: ${guild.name} (ID: ${guild.id})`);

        try {
            // Cleanup guild data
            guild.client.giveawayService?.purgeGuild(guild.id);
            guild.client.ticketService?.purgeGuild(guild.id);
            guild.client.voiceMasterService?.purgeGuild(guild.id);
            await guild.client.musicService?.purgeGuild(guild.id);
            await db.delete(musicConfig).where(eq(musicConfig.guildId, guild.id));
            guild.client.communityUtilityService?.purgeGuild(guild.id);
            guild.client.funService?.purgeGuild(guild.id);
            await db.delete(lifecycleMessages).where(eq(lifecycleMessages.guildId, guild.id));
            await db.delete(automationRules).where(eq(automationRules.guildId, guild.id));
            await db.delete(autoResponses).where(eq(autoResponses.guildId, guild.id));
            await db.delete(uwuLockMembers).where(eq(uwuLockMembers.guildId, guild.id));
            await db.delete(uwuRouletteConfigs).where(eq(uwuRouletteConfigs.guildId, guild.id));
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
}

module.exports = {
    name: Events.GuildDelete,
    execute: guild => runGuildLifecycle(guild.id, () => handleGuildDelete(guild)),
};
