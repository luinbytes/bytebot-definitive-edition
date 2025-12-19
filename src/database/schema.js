const { sqliteTable, text, integer } = require('drizzle-orm/sqlite-core');

const guilds = sqliteTable('guilds', {
    id: text('id').primaryKey(),
    prefix: text('prefix').default('!'),
    logChannel: text('log_channel'),
    welcomeChannel: text('welcome_channel'),
    joinedAt: integer('joined_at', { mode: 'timestamp' }),
    voiceHubChannelId: text('voice_hub_channel_id'),
    voiceHubCategoryId: text('voice_hub_category_id'),
});

const users = sqliteTable('users', {
    id: text('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    commandsRun: integer('commands_run').default(0),
    lastSeen: integer('last_seen', { mode: 'timestamp' }),
    wtNickname: text('wt_nickname'),
});

const moderationLogs = sqliteTable('moderation_logs', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    targetId: text('target_id').notNull(),
    executorId: text('executor_id').notNull(),
    action: text('action').notNull(), // 'KICK', 'BAN', 'CLEAR', etc.
    reason: text('reason'),
    timestamp: integer('timestamp', { mode: 'timestamp' }).default(new Date()),
});

const commandPermissions = sqliteTable('command_permissions', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    commandName: text('command_name').notNull(),
    roleId: text('role_id').notNull(),
});

const bytepods = sqliteTable('bytepods', {
    channelId: text('channel_id').primaryKey(),
    guildId: text('guild_id').notNull(),
    ownerId: text('owner_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(new Date()),
});

const bytepodAutoWhitelist = sqliteTable('bytepod_autowhitelist', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id').notNull(),
    targetUserId: text('target_user_id').notNull(),
    guildId: text('guild_id'),
});

module.exports = { guilds, users, moderationLogs, commandPermissions, bytepods, bytepodAutoWhitelist };
