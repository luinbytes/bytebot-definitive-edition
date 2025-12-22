const { sqliteTable, text, integer, index, unique } = require('drizzle-orm/sqlite-core');

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

// Birthday tracking (per-user, per-guild)
const birthdays = sqliteTable('birthdays', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id').notNull(),
    guildId: text('guild_id').notNull(),
    month: integer('month').notNull(), // 1-12
    day: integer('day').notNull(),     // 1-31
    createdAt: integer('created_at', { mode: 'timestamp' }).default(new Date()),
}, (table) => ({
    // Composite unique constraint: one birthday per user per guild
    userGuildUnique: unique().on(table.userId, table.guildId),
    // Index for daily birthday queries
    guildMonthDayIdx: index('birthdays_guild_month_day_idx').on(table.guildId, table.month, table.day),
    // Index for user lookups
    userGuildIdx: index('birthdays_user_guild_idx').on(table.userId, table.guildId),
}));

// Birthday announcement configuration (per-guild)
const birthdayConfig = sqliteTable('birthday_config', {
    guildId: text('guild_id').primaryKey(),
    channelId: text('channel_id').notNull(),
    roleId: text('role_id'), // Optional birthday role
    enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
    lastCheck: integer('last_check', { mode: 'timestamp' }), // Last midnight check
});

// Message bookmarks (per-user, cross-guild)
const bookmarks = sqliteTable('bookmarks', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id').notNull(),
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id').notNull(),
    content: text('content').notNull(), // Cached message content
    authorId: text('author_id').notNull(), // Original message author
    attachmentUrls: text('attachment_urls'), // JSON array of attachment URLs
    savedAt: integer('saved_at', { mode: 'timestamp' }).default(new Date()),
    messageDeleted: integer('message_deleted', { mode: 'boolean' }).default(false).notNull()
}, (table) => ({
    // Index for user's bookmark list (sorted by saved date)
    userSavedIdx: index('bookmarks_user_saved_idx').on(table.userId, table.savedAt),
    // Index for search queries
    userContentIdx: index('bookmarks_user_content_idx').on(table.userId, table.content),
}));

// Auto-responder (keyword-based automated responses)
const autoResponses = sqliteTable('auto_responses', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    trigger: text('trigger').notNull(), // Keyword or pattern
    response: text('response').notNull(), // Response text (max 2000 chars)
    channelId: text('channel_id'), // null = guild-wide
    creatorId: text('creator_id').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
    cooldown: integer('cooldown').default(60), // Seconds between triggers
    matchType: text('match_type').default('contains').notNull(), // exact, contains, wildcard, regex
    requireRoleId: text('require_role_id'), // null = any user
    useCount: integer('use_count').default(0), // Analytics
    createdAt: integer('created_at', { mode: 'timestamp' }).default(new Date()),
    lastUsed: integer('last_used', { mode: 'timestamp' })
}, (table) => ({
    // Index for active response lookups
    guildEnabledIdx: index('autoresponse_guild_enabled_idx').on(table.guildId, table.enabled),
    // Index for channel-specific responses
    guildChannelIdx: index('autoresponse_guild_channel_idx').on(table.guildId, table.channelId),
}));

// Starboard configuration (per-guild)
const starboardConfig = sqliteTable('starboard_config', {
    guildId: text('guild_id').primaryKey(),
    channelId: text('channel_id').notNull(),
    threshold: integer('threshold').default(5).notNull(), // Stars needed to be featured
    emoji: text('emoji').default('⭐').notNull(), // Reaction emoji to track
    enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull()
});

// Starboard messages (tracks starred messages)
const starboardMessages = sqliteTable('starboard_messages', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    originalMessageId: text('original_message_id').notNull().unique(), // Original message ID
    originalChannelId: text('original_channel_id').notNull(),
    starboardMessageId: text('starboard_message_id'), // Message ID in starboard channel (null if removed)
    authorId: text('author_id').notNull(),
    starCount: integer('star_count').default(0).notNull(),
    content: text('content'), // Cached content
    imageUrl: text('image_url'), // First image attachment URL
    postedAt: integer('posted_at', { mode: 'timestamp_ms' }).notNull()
}, (table) => ({
    // Index for leaderboard queries (top starred messages)
    guildStarCountIdx: index('starboard_guild_starcount_idx').on(table.guildId, table.starCount),
    // Index for author stats
    authorGuildIdx: index('starboard_author_guild_idx').on(table.authorId, table.guildId),
}));

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
    bytepodTemplates,
    birthdays,
    birthdayConfig,
    bookmarks,
    autoResponses,
    starboardConfig,
    starboardMessages
};
