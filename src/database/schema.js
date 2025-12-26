const { sqliteTable, text, integer, real, index, unique } = require('drizzle-orm/sqlite-core');

const guilds = sqliteTable('guilds', {
    id: text('id').primaryKey(),
    prefix: text('prefix').default('!'),
    logChannel: text('log_channel'),
    welcomeChannel: text('welcome_channel'),
    welcomeMessage: text('welcome_message'),
    welcomeEnabled: integer('welcome_enabled', { mode: 'boolean' }).default(false),
    welcomeUseEmbed: integer('welcome_use_embed', { mode: 'boolean' }).default(true),
    joinedAt: integer('joined_at', { mode: 'timestamp' }),
    voiceHubChannelId: text('voice_hub_channel_id'),
    voiceHubCategoryId: text('voice_hub_category_id'),
    mediaArchiveChannelId: text('media_archive_channel_id'), // Archive channel for media gallery
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

// Media Gallery - Channel auto-capture configuration
const mediaGalleryConfig = sqliteTable('media_gallery_config', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
    autoCapture: integer('auto_capture', { mode: 'boolean' }).default(true).notNull(),
    fileTypes: text('file_types').default('image,video,audio').notNull(), // Comma-separated: image,video,audio,document
    maxFileSizeMB: integer('max_file_size_mb').default(50).notNull(),
    autoTagChannel: integer('auto_tag_channel', { mode: 'boolean' }).default(true).notNull(),
    whitelistRoleIds: text('whitelist_role_ids'), // Comma-separated role IDs (null = all members)
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(new Date())
}, (table) => ({
    // One config per channel
    guildChannelUnique: unique().on(table.guildId, table.channelId),
    // Index for active channel lookups
    guildEnabledIdx: index('media_config_guild_enabled_idx').on(table.guildId, table.enabled)
}));

// Media Gallery - Core media storage
const mediaItems = sqliteTable('media_items', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id').notNull(), // Who saved the media
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id').notNull(),
    archiveMessageId: text('archive_message_id'), // Message ID in archive channel (for deletion)
    mediaUrl: text('media_url').notNull(), // Discord CDN URL
    fileName: text('file_name').notNull(),
    fileType: text('file_type').notNull(), // Category: image/video/audio/document
    mimeType: text('mime_type'),
    fileSize: integer('file_size'), // Bytes
    width: integer('width'), // For images/videos
    height: integer('height'), // For images/videos
    duration: real('duration'), // For audio/video (seconds)
    description: text('description'), // User-added alt-text/caption (max 1000 chars)
    contentPreview: text('content_preview'), // Original message text (max 500 chars)
    authorId: text('author_id').notNull(), // Original message author
    captureMethod: text('capture_method').default('auto').notNull(), // auto/manual
    savedAt: integer('saved_at', { mode: 'timestamp' }).default(new Date()),
    messageDeleted: integer('message_deleted', { mode: 'boolean' }).default(false).notNull(),
    urlExpired: integer('url_expired', { mode: 'boolean' }).default(false).notNull()
}, (table) => ({
    // Index for user's media list (sorted by date)
    userSavedIdx: index('media_user_saved_idx').on(table.userId, table.savedAt),
    // Index for guild media browsing
    guildSavedIdx: index('media_guild_saved_idx').on(table.guildId, table.savedAt),
    // Index for file type filtering
    userTypeIdx: index('media_user_type_idx').on(table.userId, table.fileType),
    // Index for channel filtering
    userChannelIdx: index('media_user_channel_idx').on(table.userId, table.channelId)
}));

// Media Gallery - Tag system (many-to-many)
const mediaTags = sqliteTable('media_tags', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    mediaId: integer('media_id').notNull(), // FK to mediaItems.id
    tag: text('tag').notNull(), // Lowercase tag
    autoGenerated: integer('auto_generated', { mode: 'boolean' }).default(false).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(new Date())
}, (table) => ({
    // Prevent duplicate tags on same media
    mediaTagUnique: unique().on(table.mediaId, table.tag),
    // Index for tag-based queries
    mediaIdIdx: index('media_tags_media_idx').on(table.mediaId),
    tagIdx: index('media_tags_tag_idx').on(table.tag)
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

// Reminders (scheduled user notifications)
const reminders = sqliteTable('reminders', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id').notNull(),
    guildId: text('guild_id'), // null for DM reminders
    channelId: text('channel_id'), // null for DM reminders
    message: text('message').notNull(),
    triggerAt: integer('trigger_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    active: integer('active', { mode: 'boolean' }).default(true).notNull()
}, (table) => ({
    // Index for user reminder list queries
    userActiveIdx: index('reminders_user_active_idx').on(table.userId, table.active),
    // Index for scheduler queries (upcoming reminders)
    triggerIdx: index('reminders_trigger_idx').on(table.triggerAt, table.active),
    // Index for guild cleanup
    guildIdx: index('reminders_guild_idx').on(table.guildId, table.active)
}));

// Suggestions configuration (per-guild)
const suggestionConfig = sqliteTable('suggestion_config', {
    guildId: text('guild_id').primaryKey(),
    channelId: text('channel_id').notNull(),
    reviewRoleId: text('review_role_id'), // Role that can approve/deny (null = Admin only)
    enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
    allowAnonymous: integer('allow_anonymous', { mode: 'boolean' }).default(false).notNull()
});

// Suggestions (community ideas/feedback)
const suggestions = sqliteTable('suggestions', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(), // Suggester
    content: text('content').notNull(), // Suggestion text (max 2000 chars)
    messageId: text('message_id').notNull(), // Message ID in suggestion channel
    channelId: text('channel_id').notNull(), // Suggestion channel ID
    status: text('status').default('pending').notNull(), // pending, approved, denied, implemented
    upvotes: integer('upvotes').default(0), // Cached vote count
    downvotes: integer('downvotes').default(0), // Cached vote count
    reviewedBy: text('reviewed_by'), // Admin who approved/denied
    reviewedAt: integer('reviewed_at', { mode: 'timestamp' }), // When admin took action
    reviewReason: text('review_reason'), // Optional reason for approval/denial
    createdAt: integer('created_at', { mode: 'timestamp' }).default(new Date()),
    anonymous: integer('anonymous', { mode: 'boolean' }).default(false).notNull() // Hide suggester name
}, (table) => ({
    // Index for guild suggestion list queries
    guildStatusIdx: index('suggestions_guild_status_idx').on(table.guildId, table.status),
    // Index for user suggestion list queries
    userGuildIdx: index('suggestions_user_guild_idx').on(table.userId, table.guildId),
    // Index for leaderboard queries (top voted)
    guildUpvotesIdx: index('suggestions_guild_upvotes_idx').on(table.guildId, table.upvotes)
}));

// Activity Streaks (daily engagement tracking)
const activityStreaks = sqliteTable('activity_streaks', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id').notNull(),
    guildId: text('guild_id').notNull(),
    currentStreak: integer('current_streak').default(0).notNull(), // Consecutive active days
    longestStreak: integer('longest_streak').default(0).notNull(), // All-time best streak
    lastActivityDate: text('last_activity_date'), // YYYY-MM-DD format
    totalActiveDays: integer('total_active_days').default(0).notNull(),
    freezesAvailable: integer('freezes_available').default(1).notNull(), // Streak freeze items (1 per month)
    lastFreezeReset: integer('last_freeze_reset', { mode: 'timestamp' }), // Monthly reset tracker
    createdAt: integer('created_at', { mode: 'timestamp' }).default(new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(new Date())
}, (table) => ({
    // Composite unique constraint: one streak record per user per guild
    userGuildUnique: unique().on(table.userId, table.guildId),
    // Index for guild leaderboard queries (current streak)
    guildCurrentStreakIdx: index('streaks_guild_current_idx').on(table.guildId, table.currentStreak),
    // Index for longest streak leaderboard
    guildLongestStreakIdx: index('streaks_guild_longest_idx').on(table.guildId, table.longestStreak),
    // Index for user lookups
    userGuildIdx: index('streaks_user_guild_idx').on(table.userId, table.guildId)
}));

// Activity Achievements (milestone rewards)
const activityAchievements = sqliteTable('activity_achievements', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id').notNull(),
    guildId: text('guild_id').notNull(),
    achievementId: text('achievement_id').notNull(), // e.g., "streak_7", "streak_30", "total_100"
    earnedAt: integer('earned_at', { mode: 'timestamp' }).default(new Date())
}, (table) => ({
    // Composite unique constraint: one achievement per user per guild
    userGuildAchievementUnique: unique().on(table.userId, table.guildId, table.achievementId),
    // Index for user achievement list
    userGuildIdx: index('achievements_user_guild_idx').on(table.userId, table.guildId),
    // Index for achievement type queries
    achievementIdx: index('achievements_type_idx').on(table.achievementId)
}));

// Daily Activity Log (tracks activity types per day)
const activityLogs = sqliteTable('activity_logs', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id').notNull(),
    guildId: text('guild_id').notNull(),
    activityDate: text('activity_date').notNull(), // YYYY-MM-DD format
    messageCount: integer('message_count').default(0).notNull(),
    voiceMinutes: integer('voice_minutes').default(0).notNull(),
    commandsRun: integer('commands_run').default(0).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(new Date())
}, (table) => ({
    // Composite unique constraint: one log per user per guild per day
    userGuildDateUnique: unique().on(table.userId, table.guildId, table.activityDate),
    // Index for user activity history
    userGuildDateIdx: index('activity_user_guild_date_idx').on(table.userId, table.guildId, table.activityDate),
    // Index for daily cleanup queries
    dateIdx: index('activity_date_idx').on(table.activityDate)
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
    mediaGalleryConfig,
    mediaItems,
    mediaTags,
    autoResponses,
    starboardConfig,
    starboardMessages,
    reminders,
    suggestionConfig,
    suggestions,
    activityStreaks,
    activityAchievements,
    activityLogs
};
