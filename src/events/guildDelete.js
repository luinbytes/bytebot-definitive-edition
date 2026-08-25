const { Events } = require('discord.js');
const { db, sqlite } = require('../database/index');
const { guilds, musicConfig, lifecycleMessages, lifecycleMessageChannels, joinDmDeliveries, reminders, automationRules, autoResponses, uwuLockMembers, uwuRouletteConfigs } = require('../database/schema');
const { eq, and } = require('drizzle-orm');
const logger = require('../utils/logger');
const { dbLog } = require('../utils/dbLogger');
const { runGuildLifecycle } = require('../utils/guildLifecycle');
const lifecycle = require('../services/lifecycleMessageService');

const LEVEL_TABLES = [
    'member_levels', 'level_configs', 'level_role_rewards', 'level_ignores', 'level_boosts',
    'level_live_boards', 'level_role_jobs', 'server_daily_metrics', 'analytics_events',
    'reaction_placements', 'level_voice_sessions', 'member_presence', 'activity_logs'
];
const LOG_TABLES = ['event_log_outbox', 'event_log_ignores', 'event_log_channels'];

async function purgeServiceOrTables(service, guildId, tables) {
    if (service?.purgeGuild) {
        try {
            await service.purgeGuild(guildId);
            return;
        } catch (error) {
            logger.warn(`Service cleanup failed for guild ${guildId}; applying direct database fallback: ${error.message}`);
        }
    }
    sqlite.transaction(() => {
        for (const table of tables) sqlite.prepare(`DELETE FROM ${table} WHERE guild_id = ?`).run(guildId);
    })();
}

async function handleGuildDelete(guild) {
    logger.info(`Left or kicked from guild: ${guild.name} (ID: ${guild.id})`);
    const cleanup = [
        ['giveaways', () => guild.client.giveawayService?.purgeGuild(guild.id)],
        ['tickets', () => guild.client.ticketService?.purgeGuild(guild.id)],
        ['VoiceMaster', () => guild.client.voiceMasterService?.purgeGuild(guild.id)],
        ['music service', () => guild.client.musicService?.purgeGuild(guild.id)],
        ['music config', () => db.delete(musicConfig).where(eq(musicConfig.guildId, guild.id))],
        ['community utilities', () => guild.client.communityUtilityService?.purgeGuild(guild.id)],
        ['fun state', () => guild.client.funService?.purgeGuild(guild.id)],
        ['levels and analytics', () => purgeServiceOrTables(guild.client.levelAnalyticsService, guild.id, LEVEL_TABLES)],
        ['event logs', () => purgeServiceOrTables(guild.client.eventLoggingService, guild.id, LOG_TABLES)],
        ['lifecycle runtime', () => lifecycle.purgeLifecycleRuntime(guild.id)],
        ['lifecycle messages', () => db.delete(lifecycleMessages).where(eq(lifecycleMessages.guildId, guild.id))],
        ['lifecycle channels', () => db.delete(lifecycleMessageChannels).where(eq(lifecycleMessageChannels.guildId, guild.id))],
        ['join DM deliveries', () => db.delete(joinDmDeliveries).where(eq(joinDmDeliveries.guildId, guild.id))],
        ['automation rules', () => db.delete(automationRules).where(eq(automationRules.guildId, guild.id))],
        ['auto responses', () => db.delete(autoResponses).where(eq(autoResponses.guildId, guild.id))],
        ['UwU targets', () => db.delete(uwuLockMembers).where(eq(uwuLockMembers.guildId, guild.id))],
        ['UwU roulette', () => db.delete(uwuRouletteConfigs).where(eq(uwuRouletteConfigs.guildId, guild.id))],
        ['reminders', async () => {
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
        }],
        ['guild', () => dbLog.delete('guilds',
            () => db.delete(guilds).where(eq(guilds.id, guild.id)),
            { guildId: guild.id }
        )]
    ];
    for (const [name, operation] of cleanup) {
        try {
            await operation();
        } catch (error) {
            logger.error(`Failed to clean up ${name} for guild ${guild.id}: ${error}`);
        }
    }
    logger.success(`Finished database cleanup for guild ${guild.id}.`);
}

module.exports = {
    name: Events.GuildDelete,
    execute: guild => runGuildLifecycle(guild.id, () => handleGuildDelete(guild)),
};
