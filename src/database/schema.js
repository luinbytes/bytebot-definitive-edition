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
    originalOwnerId: text('original_owner_id'), // Who created the pod (for reclaim eligibility)
    ownerLeftAt: integer('owner_left_at'),      // Timestamp (ms) when owner left - null if owner present
    reclaimRequestPending: integer('reclaim_request_pending', { mode: 'boolean' }).default(false), // Prevents duplicate reclaim prompts
    createdAt: integer('created_at', { mode: 'timestamp' }).default(new Date()),
});

const bytepodAutoWhitelist = sqliteTable('bytepod_autowhitelist', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id').notNull(),
    targetUserId: text('target_user_id').notNull(),
    guildId: text('guild_id'),
});

const bytepodUserSettings = sqliteTable('bytepod_user_settings', {
    userId: text('user_id').primaryKey(),
    autoLock: integer('auto_lock', { mode: 'boolean' }).default(false),
});

// Active voice sessions (persisted - survives bot restarts)
const bytepodActiveSessions = sqliteTable('bytepod_active_sessions', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    podId: text('pod_id').notNull(),       // References bytepods.channelId
    userId: text('user_id').notNull(),
    guildId: text('guild_id').notNull(),
    startTime: integer('start_time').notNull(), // Unix timestamp ms
});

// Voice activity stats (per-user, per-guild aggregate)
const bytepodVoiceStats = sqliteTable('bytepod_voice_stats', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id').notNull(),
    guildId: text('guild_id').notNull(),
    totalSeconds: integer('total_seconds').default(0),
    sessionCount: integer('session_count').default(0),
});

// Template presets (saved channel configurations)
const bytepodTemplates = sqliteTable('bytepod_templates', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    userLimit: integer('user_limit').default(0),
    autoLock: integer('auto_lock', { mode: 'boolean' }).default(false),
    whitelistUserIds: text('whitelist_user_ids'), // JSON stringified array
});

module.exports = {
    guilds,
    users,
    moderationLogs,
    commandPermissions,
    bytepods,
    bytepodAutoWhitelist,
    bytepodUserSettings,
    bytepodActiveSessions,
    bytepodVoiceStats,
    bytepodTemplates
};
