const { sql } = require('drizzle-orm');
const { sqliteTable, text, integer, real, index, uniqueIndex, unique, primaryKey, check } = require('drizzle-orm/sqlite-core');

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
    achievementsEnabled: integer('achievements_enabled', { mode: 'boolean' }).default(true), // Guild-level achievement toggle
});

const musicConfig = sqliteTable('music_config', {
    guildId: text('guild_id').primaryKey(),
    djRoleId: text('dj_role_id'),
    autoplay: integer('autoplay', { mode: 'boolean' }).default(false).notNull(),
});

const voiceMasterConfigs = sqliteTable('voice_master_configs', {
    guildId: text('guild_id').primaryKey(),
    state: text('state').default('active').notNull(),
    generation: integer('generation').default(0).notNull(),
    categoryId: text('category_id'),
    primaryChannelId: text('primary_channel_id'),
    interfaceMessageId: text('interface_message_id'),
    nameTemplate: text('name_template').default("{owner}'s channel").notNull(),
    defaultRoleId: text('default_role_id'),
    defaultBitrate: integer('default_bitrate'),
    defaultRegion: text('default_region'),
    sendInterface: integer('send_interface', { mode: 'boolean' }).default(true).notNull(),
    temporaryEnabled: integer('temporary_enabled', { mode: 'boolean' }).default(true).notNull(),
    joinRoleId: text('join_role_id'),
    updatedAt: integer('updated_at').notNull(),
}, table => ({
    stateCheck: check('voice_master_configs_state_check', sql`${table.state} IN ('creating','active','resetting','failed')`),
    templateCheck: check('voice_master_configs_template_check', sql`length(${table.nameTemplate}) BETWEEN 1 AND 32`),
    bitrateCheck: check('voice_master_configs_bitrate_check', sql`${table.defaultBitrate} IS NULL OR ${table.defaultBitrate} >= 8000`),
}));

const voiceMasterSources = sqliteTable('voice_master_sources', {
    channelId: text('channel_id').primaryKey(),
    guildId: text('guild_id').notNull(),
    categoryId: text('category_id'),
    interfaceMessageId: text('interface_message_id'),
    state: text('state').default('active').notNull(),
    isPrimary: integer('is_primary', { mode: 'boolean' }).default(false).notNull(),
    owned: integer('owned', { mode: 'boolean' }).default(false).notNull(),
    createdAt: integer('created_at').notNull(),
}, table => ({
    stateCheck: check('voice_master_sources_state_check', sql`${table.state} IN ('pending','active','lost')`),
    primaryUnique: uniqueIndex('voice_master_sources_primary_unique').on(table.guildId).where(sql`${table.isPrimary} = 1`),
    guildIdx: index('voice_master_sources_guild_idx').on(table.guildId, table.channelId),
}));

const voiceMasterCreations = sqliteTable('voice_master_creations', {
    guildId: text('guild_id').notNull(),
    sourceChannelId: text('source_channel_id').notNull(),
    memberId: text('member_id').notNull(),
    channelId: text('channel_id'),
    state: text('state').notNull(),
    generation: integer('generation').default(0).notNull(),
    error: text('error'),
    updatedAt: integer('updated_at').notNull(),
}, table => ({
    pk: primaryKey({ columns: [table.guildId, table.sourceChannelId, table.memberId] }),
    stateCheck: check('voice_master_creations_state_check', sql`${table.state} IN ('pending','active','failed')`),
}));

const voiceMasterAccess = sqliteTable('voice_master_access', {
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    userId: text('user_id').notNull(),
    effect: text('effect').notNull(),
    state: text('state').default('active').notNull(),
    generation: integer('generation').default(0).notNull(),
    updatedAt: integer('updated_at').notNull(),
}, table => ({
    pk: primaryKey({ columns: [table.guildId, table.channelId, table.userId] }),
    effectCheck: check('voice_master_access_effect_check', sql`${table.effect} IN ('permit','reject')`),
    stateCheck: check('voice_master_access_state_check', sql`${table.state} IN ('pending','active')`),
}));

const voiceMasterJoinRoles = sqliteTable('voice_master_join_roles', {
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    memberId: text('member_id').notNull(),
    roleId: text('role_id').notNull(),
    state: text('state').default('active').notNull(),
    addedByBot: integer('added_by_bot', { mode: 'boolean' }).default(false).notNull(),
    updatedAt: integer('updated_at').notNull(),
}, table => ({
    pk: primaryKey({ columns: [table.guildId, table.channelId, table.memberId] }),
    stateCheck: check('voice_master_join_roles_state_check', sql`${table.state} IN ('pending','active')`),
}));

const lifecycleMessages = sqliteTable('lifecycle_messages', {
    guildId: text('guild_id').notNull(),
    type: text('type').notNull(),
    channelId: text('channel_id'),
    template: text('template'),
    enabled: integer('enabled', { mode: 'boolean' }).default(false).notNull(),
    format: text('format').default('embed').notNull(),
    deleteAfterSeconds: integer('delete_after_seconds'),
    updatedAt: integer('updated_at').notNull(),
}, (table) => ({
    pk: primaryKey({ columns: [table.guildId, table.type] }),
}));

const users = sqliteTable('users', {
    id: text('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    commandsRun: integer('commands_run').default(0),
    lastSeen: integer('last_seen', { mode: 'timestamp' }),
    wtNickname: text('wt_nickname'),
    ephemeralPreference: text('ephemeral_preference').default('default'), // 'always' | 'public' | 'default'
    achievementsOptedOut: integer('achievements_opted_out', { mode: 'boolean' }).default(false), // Global opt-out from achievement tracking
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

const moderationCases = sqliteTable('moderation_cases', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    caseNumber: integer('case_number').notNull(),
    targetId: text('target_id').notNull(),
    executorId: text('executor_id').notNull(),
    action: text('action').notNull(),
    reason: text('reason'),
    status: text('status').notNull(), // pending | completed | failed | undo_pending | undone | cleanup_required
    durationMs: integer('duration_ms'),
    metadata: text('metadata'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    undoneBy: text('undone_by'),
    undoReason: text('undo_reason'),
}, (table) => ({
    guildCaseUnique: unique().on(table.guildId, table.caseNumber),
    targetIdx: index('moderation_cases_guild_target_idx').on(table.guildId, table.targetId, table.caseNumber),
    executorIdx: index('moderation_cases_guild_executor_idx').on(table.guildId, table.executorId, table.caseNumber),
}));

const moderationConfig = sqliteTable('moderation_config', {
    guildId: text('guild_id').primaryKey(),
    nextCaseNumber: integer('next_case_number').default(1).notNull(),
    logChannelId: text('log_channel_id'),
    imageMuteRoleId: text('image_mute_role_id'),
    reactionMuteRoleId: text('reaction_mute_role_id'),
    jailRoleId: text('jail_role_id'),
    jailChannelId: text('jail_channel_id'),
    managedResources: text('managed_resources'),
    setupStatus: text('setup_status'),
    lockRoleId: text('lock_role_id'),
});

const moderationHardbans = sqliteTable('moderation_hardbans', {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    caseNumber: integer('case_number').notNull(),
    reason: text('reason'),
    state: text('state').notNull(), // pending | active | removing
    createdAt: integer('created_at').notNull(),
}, (table) => ({
    pk: primaryKey({ columns: [table.guildId, table.userId] }),
}));

const moderationJailState = sqliteTable('moderation_jail_state', {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    caseNumber: integer('case_number').notNull(),
    previousRoleIds: text('previous_role_ids').notNull(),
    state: text('state').notNull(), // pending | active | removing
    createdAt: integer('created_at').notNull(),
}, (table) => ({
    pk: primaryKey({ columns: [table.guildId, table.userId] }),
}));

const lockdownIgnores = sqliteTable('lockdown_ignores', {
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
}, (table) => ({
    pk: primaryKey({ columns: [table.guildId, table.channelId] }),
}));

const lockdownStates = sqliteTable('lockdown_states', {
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    roleId: text('role_id').notNull(),
    priorSendMessages: integer('prior_send_messages').notNull(), // -1 deny | 0 unset | 1 allow
    state: text('state').notNull(), // pending | active
    createdAt: integer('created_at').notNull(),
}, (table) => ({
    pk: primaryKey({ columns: [table.guildId, table.channelId] }),
}));

const forcedNicknames = sqliteTable('forced_nicknames', {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    nickname: text('nickname').notNull(),
    updatedAt: integer('updated_at').notNull(),
}, (table) => ({
    pk: primaryKey({ columns: [table.guildId, table.userId] }),
}));

const memberRoleSnapshots = sqliteTable('member_role_snapshots', {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    roleIds: text('role_ids').notNull(),
    updatedAt: integer('updated_at').notNull(),
}, (table) => ({
    pk: primaryKey({ columns: [table.guildId, table.userId] }),
}));

const antinukeConfig = sqliteTable('antinuke_config', {
    guildId: text('guild_id').primaryKey(),
    enabled: integer('enabled', { mode: 'boolean' }).default(false).notNull(),
    punishment: text('punishment').default('strip').notNull(),
    windowSeconds: integer('window_seconds').default(60).notNull(),
    logChannelId: text('log_channel_id'),
});

const antinukeModules = sqliteTable('antinuke_modules', {
    guildId: text('guild_id').notNull(),
    module: text('module').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).default(false).notNull(),
    threshold: integer('threshold').default(3).notNull(),
    punishment: text('punishment'),
}, (table) => ({
    pk: primaryKey({ columns: [table.guildId, table.module] }),
}));

const antinukeAdmins = sqliteTable('antinuke_admins', {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    addedBy: text('added_by').notNull(),
    createdAt: integer('created_at').notNull(),
}, (table) => ({
    pk: primaryKey({ columns: [table.guildId, table.userId] }),
}));

const antinukeWhitelist = sqliteTable('antinuke_whitelist', {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    addedBy: text('added_by').notNull(),
    createdAt: integer('created_at').notNull(),
}, (table) => ({
    pk: primaryKey({ columns: [table.guildId, table.userId] }),
}));

const antinukeActions = sqliteTable('antinuke_actions', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    actorId: text('actor_id').notNull(),
    module: text('module').notNull(),
    auditEntryId: text('audit_entry_id').notNull(),
    consumed: integer('consumed', { mode: 'boolean' }).default(false).notNull(),
    occurredAt: integer('occurred_at').notNull(),
}, (table) => ({
    auditUnique: unique().on(table.guildId, table.auditEntryId),
    windowIdx: index('antinuke_actions_window_idx').on(table.guildId, table.actorId, table.module, table.consumed, table.occurredAt),
}));

const antinukeIncidents = sqliteTable('antinuke_incidents', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    actorId: text('actor_id').notNull(),
    module: text('module').notNull(),
    actionCount: integer('action_count').notNull(),
    punishment: text('punishment').notNull(),
    status: text('status').notNull(),
    applyingAt: integer('applying_at'),
    applyingToken: text('applying_token'),
    error: text('error'),
    auditEntryId: text('audit_entry_id').notNull(),
    createdAt: integer('created_at').notNull(),
}, (table) => ({
    auditUnique: unique().on(table.guildId, table.auditEntryId),
    guildCreatedIdx: index('antinuke_incidents_guild_created_idx').on(table.guildId, table.createdAt),
    statusIdx: index('antinuke_incidents_status_idx').on(table.status, table.id),
}));

const antiraidConfig = sqliteTable('antiraid_config', {
    guildId: text('guild_id').primaryKey(),
    enabled: integer('enabled', { mode: 'boolean' }).default(false).notNull(),
    punishment: text('punishment').default('kick').notNull(),
    usernamePunishment: text('username_punishment').default('kick').notNull(),
    unverifiedbotPunishment: text('unverifiedbot_punishment').default('kick').notNull(),
    massmentionThreshold: integer('massmention_threshold').default(5).notNull(),
    massmentionPunishment: text('massmention_punishment').default('timeout').notNull(),
    massmentionLockdownSeconds: integer('massmention_lockdown_seconds').default(0).notNull(),
    lockdownEnabled: integer('lockdown_enabled', { mode: 'boolean' }).default(false).notNull(),
    lockdownExpiresAt: integer('lockdown_expires_at'),
});

const antiraidModules = sqliteTable('antiraid_modules', {
    guildId: text('guild_id').notNull(),
    module: text('module').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).default(false).notNull(),
    threshold: integer('threshold').default(5).notNull(),
    windowSeconds: integer('window_seconds').default(60).notNull(),
    punishment: text('punishment'),
    lockChannels: integer('lock_channels', { mode: 'boolean' }).default(false).notNull(),
    punishMembers: integer('punish_members', { mode: 'boolean' }).default(false).notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.guildId, table.module] }) }));

const antiraidUsernamePatterns = sqliteTable('antiraid_username_patterns', {
    guildId: text('guild_id').notNull(),
    pattern: text('pattern').notNull(),
    punishment: text('punishment'),
    createdAt: integer('created_at').default(0).notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.guildId, table.pattern] }) }));

const antiraidExemptions = sqliteTable('antiraid_exemptions', {
    guildId: text('guild_id').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    createdAt: integer('created_at').default(0).notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.guildId, table.targetType, table.targetId] }) }));

const antiraidIncidents = sqliteTable('antiraid_incidents', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    module: text('module').notNull(),
    actionCount: integer('action_count').default(1).notNull(),
    punishment: text('punishment').notNull(),
    status: text('status').notNull(),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
}, (table) => ({ guildCreatedIdx: index('antiraid_incidents_guild_created_idx').on(table.guildId, table.createdAt) }));

const automodConfig = sqliteTable('automod_config', {
    guildId: text('guild_id').primaryKey(),
    enabled: integer('enabled', { mode: 'boolean' }).default(false).notNull(),
    timeoutMs: integer('timeout_ms').default(300000).notNull(),
    strikesEnabled: integer('strikes_enabled', { mode: 'boolean' }).default(false).notNull(),
    strikeDecayHours: integer('strike_decay_hours').default(24).notNull(),
    strikeCap: integer('strike_cap').default(10).notNull(),
    nativeRuleId: text('native_rule_id'),
    nativeNsfwRuleId: text('native_nsfw_rule_id'),
});

const automodFilters = sqliteTable('automod_filters', {
    guildId: text('guild_id').notNull(),
    filter: text('filter').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).default(false).notNull(),
    threshold: integer('threshold').default(5).notNull(),
    secondaryThreshold: integer('secondary_threshold').default(0).notNull(),
    action: text('action').default('delete').notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.guildId, table.filter] }) }));

const automodRules = sqliteTable('automod_rules', {
    guildId: text('guild_id').notNull(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    value: text('value').notNull(),
    createdAt: integer('created_at').notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.guildId, table.kind, table.name] }) }));

const automodExemptions = sqliteTable('automod_exemptions', {
    guildId: text('guild_id').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    createdAt: integer('created_at').default(0).notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.guildId, table.targetType, table.targetId] }) }));

const automodStrikeLevels = sqliteTable('automod_strike_levels', {
    guildId: text('guild_id').notNull(),
    level: integer('level').notNull(),
    action: text('action').notNull(),
    durationMs: integer('duration_ms'),
}, (table) => ({ pk: primaryKey({ columns: [table.guildId, table.level] }) }));

const automodStrikes = sqliteTable('automod_strikes', {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    count: integer('count').default(0).notNull(),
    lastStrikeAt: integer('last_strike_at').notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.guildId, table.userId] }) }));

const automodIncidents = sqliteTable('automod_incidents', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    messageId: text('message_id').notNull(),
    filter: text('filter').notNull(),
    action: text('action').notNull(),
    status: text('status').notNull(),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
}, (table) => ({
    messageUnique: unique().on(table.guildId, table.messageId),
    guildCreatedIdx: index('automod_incidents_guild_created_idx').on(table.guildId, table.createdAt),
}));

const moderationTemplates = sqliteTable('moderation_templates', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    action: text('action').notNull(),
    messageType: text('message_type').notNull(), // dm | message
    template: text('template').notNull(),
}, (table) => ({
    templateUnique: unique().on(table.guildId, table.action, table.messageType),
}));

const moderationStaffRoles = sqliteTable('moderation_staff_roles', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    roleId: text('role_id').notNull(),
}, (table) => ({
    staffRoleUnique: unique().on(table.guildId, table.roleId),
}));

const warningPunishments = sqliteTable('warning_punishments', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    threshold: integer('threshold').notNull(),
    action: text('action').notNull(),
    durationMs: integer('duration_ms'),
}, (table) => ({
    thresholdUnique: unique().on(table.guildId, table.threshold),
}));

const commandPermissions = sqliteTable('command_permissions', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    commandName: text('command_name').notNull(),
    roleId: text('role_id').notNull(),
});

const commandAccessRules = sqliteTable('command_access_rules', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    commandPath: text('command_path').notNull(),
    effect: text('effect').notNull(), // disabled | allow | deny
    scopeType: text('scope_type').notNull(), // guild | channel | role | member
    scopeId: text('scope_id').notNull(),
}, (table) => ({
    ruleUnique: unique().on(table.guildId, table.commandPath, table.effect, table.scopeType, table.scopeId),
    guildCommandIdx: index('command_access_rules_guild_command_idx').on(table.guildId, table.commandPath),
}));

const fakePermissions = sqliteTable('fake_permissions', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    roleId: text('role_id').notNull(),
    permission: text('permission').notNull(),
}, (table) => ({
    permissionUnique: unique().on(table.guildId, table.roleId, table.permission),
    guildRoleIdx: index('fake_permissions_guild_role_idx').on(table.guildId, table.roleId),
}));

const deniedRolePermissions = sqliteTable('denied_role_permissions', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    permission: text('permission').notNull(),
}, (table) => ({
    permissionUnique: unique().on(table.guildId, table.permission),
    guildIdx: index('denied_role_permissions_guild_idx').on(table.guildId),
}));

const protectedTargets = sqliteTable('protected_targets', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    targetType: text('target_type').notNull(), // member | role
    targetId: text('target_id').notNull(),
}, (table) => ({
    targetUnique: unique().on(table.guildId, table.targetType, table.targetId),
    guildTypeIdx: index('protected_targets_guild_type_idx').on(table.guildId, table.targetType),
}));

const uwuLockMembers = sqliteTable('uwu_lock_members', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    state: text('state').notNull(), // target | protected
}, (table) => ({
    guildUserUnique: unique().on(table.guildId, table.userId),
    guildStateIdx: index('uwu_lock_members_guild_state_idx').on(table.guildId, table.state),
}));

const bytepods = sqliteTable('bytepods', {
    channelId: text('channel_id').primaryKey(),
    guildId: text('guild_id').notNull(),
    ownerId: text('owner_id').notNull(),
    originalOwnerId: text('original_owner_id'), // Who created the pod (for reclaim eligibility)
    ownerLeftAt: integer('owner_left_at'),      // Timestamp (ms) when owner left - null if owner present
    reclaimRequestPending: integer('reclaim_request_pending', { mode: 'boolean' }).default(false), // Prevents duplicate reclaim prompts
    panelMessageId: text('panel_message_id'), // Message ID of the active control panel (for cleanup)
    sourceChannelId: text('source_channel_id'),
    state: text('state').default('active').notNull(),
    generation: integer('generation').default(0).notNull(),
    cleanupAfter: integer('cleanup_after'),
    botOwned: integer('bot_owned', { mode: 'boolean' }).default(true).notNull(),
    pendingOwnerId: text('pending_owner_id'),
    claimSnapshot: text('claim_snapshot'),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(new Date()),
}, table => ({
    guildStateIdx: index('bytepods_guild_state_idx').on(table.guildId, table.state),
}));

const bytepodAutoWhitelist = sqliteTable('bytepod_autowhitelist', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id').notNull(),
    targetUserId: text('target_user_id').notNull(),
    guildId: text('guild_id'),
});

const bytepodUserSettings = sqliteTable('bytepod_user_settings', {
    userId: text('user_id').notNull(),
    guildId: text('guild_id').notNull(),
    autoLock: integer('auto_lock', { mode: 'boolean' }).default(false),
    summaryEnabled: integer('summary_enabled', { mode: 'boolean' }).default(false), // Receive BytePod session summaries via DM
    podNameStyle: text('pod_name_style').default('username'), // 'username' | 'random'
}, (table) => ({
    // Composite primary key: one setting per user per guild
    pk: primaryKey({ columns: [table.userId, table.guildId] }),
}));

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
    guildId: text('guild_id').notNull(),
    name: text('name').notNull(),
    userLimit: integer('user_limit').default(0),
    autoLock: integer('auto_lock', { mode: 'boolean' }).default(false),
    whitelistUserIds: text('whitelist_user_ids'), // JSON stringified array
}, (table) => ({
    // Composite unique constraint: one template name per user per guild
    userGuildNameUnique: unique().on(table.userId, table.guildId, table.name),
}));

// Session history (archived pod sessions for stats/analytics)
const bytepodSessionHistory = sqliteTable('bytepod_session_history', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    podId: text('pod_id').notNull(),
    guildId: text('guild_id').notNull(),
    ownerId: text('owner_id').notNull(),
    podName: text('pod_name'),
    startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
    endedAt: integer('ended_at', { mode: 'timestamp' }).notNull(),
    peakUsers: integer('peak_users').default(1),
    uniqueVisitors: integer('unique_visitors').default(1),
    totalVoiceMinutes: integer('total_voice_minutes').default(0),
    visitorData: text('visitor_data'), // JSON: [{userId, durationSeconds}]
}, (table) => ({
    // Index for owner session history queries
    ownerIdx: index('bytepod_session_owner_idx').on(table.ownerId, table.guildId),
    // Index for guild analytics
    guildIdx: index('bytepod_session_guild_idx').on(table.guildId, table.endedAt),
}));

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
    reply: integer('reply', { mode: 'boolean' }).default(false).notNull(),
    deleteTrigger: integer('delete_trigger', { mode: 'boolean' }).default(false).notNull(),
    selfDestructSeconds: integer('self_destruct_seconds'),
    mentionPolicy: text('mention_policy').default('none').notNull(),
    actionRoleId: text('action_role_id'),
    actionRoleMode: text('action_role_mode'),
    channelIds: text('channel_ids').default('[]').notNull(),
    roleIds: text('role_ids').default('[]').notNull(),
    actionRoles: text('action_roles').default('[]').notNull(),
    useCount: integer('use_count').default(0), // Analytics
    createdAt: integer('created_at', { mode: 'timestamp' }).default(new Date()),
    lastUsed: integer('last_used', { mode: 'timestamp' })
}, (table) => ({
    // Index for active response lookups
    guildEnabledIdx: index('autoresponse_guild_enabled_idx').on(table.guildId, table.enabled),
    // Index for channel-specific responses
    guildChannelIdx: index('autoresponse_guild_channel_idx').on(table.guildId, table.channelId),
}));

// Shared storage for message/member automations. Kind + key identifies the
// public command object (for example timer + channel ID).
const automationRules = sqliteTable('automation_rules', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    kind: text('kind').notNull(),
    key: text('key').notNull(),
    config: text('config').default('{}').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
    nextRunAt: integer('next_run_at'),
    lastRunAt: integer('last_run_at'),
    lastMessageId: text('last_message_id'),
    runCount: integer('run_count').default(0).notNull(),
    leaseToken: text('lease_token'),
    leaseExpiresAt: integer('lease_expires_at'),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
}, (table) => ({
    guildKindKeyUnique: unique('automation_guild_kind_key_unique').on(table.guildId, table.kind, table.key),
    dueIdx: index('automation_due_idx').on(table.enabled, table.nextRunAt),
    guildKindIdx: index('automation_guild_kind_idx').on(table.guildId, table.kind)
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

const honeypotConfig = sqliteTable('honeypot_config', {
    guildId: text('guild_id').primaryKey(),
    categoryId: text('category_id'),
    channelId: text('channel_id').unique(),
    warningMessageId: text('warning_message_id'),
    shameBoardMessageId: text('shame_board_message_id'),
    enabled: integer('enabled', { mode: 'boolean' }).default(false).notNull(),
    pinWarningFailed: integer('pin_warning_failed', { mode: 'boolean' }).default(false).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(new Date())
}, (table) => ({
    channelIdx: index('honeypot_config_channel_idx').on(table.channelId),
    enabledChannelIdx: index('honeypot_config_enabled_channel_idx').on(table.enabled, table.channelId)
}));

const honeypotExemptUsers = sqliteTable('honeypot_exempt_users', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull()
}, (table) => ({
    guildUserUnique: unique().on(table.guildId, table.userId),
    guildIdx: index('honeypot_exempt_users_guild_idx').on(table.guildId)
}));

const honeypotExemptRoles = sqliteTable('honeypot_exempt_roles', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    roleId: text('role_id').notNull()
}, (table) => ({
    guildRoleUnique: unique().on(table.guildId, table.roleId),
    guildIdx: index('honeypot_exempt_roles_guild_idx').on(table.guildId)
}));

const honeypotIncidents = sqliteTable('honeypot_incidents', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    username: text('username'),
    displayName: text('display_name'),
    messageId: text('message_id'),
    channelId: text('channel_id').notNull(),
    snippet: text('snippet'),
    attachmentSummary: text('attachment_summary'),
    status: text('status').notNull(),
    failureReason: text('failure_reason'),
    accountCreatedAt: integer('account_created_at', { mode: 'timestamp' }),
    joinedAt: integer('joined_at', { mode: 'timestamp' }),
    triggeredAt: integer('triggered_at', { mode: 'timestamp' }).default(new Date()).notNull()
}, (table) => ({
    guildTriggeredIdx: index('honeypot_incidents_guild_triggered_idx').on(table.guildId, table.triggeredAt),
    guildStatusIdx: index('honeypot_incidents_guild_status_idx').on(table.guildId, table.status)
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
    notified: integer('notified', { mode: 'boolean' }).default(false).notNull(), // Has user been DM'd?
    points: integer('points').default(0).notNull(), // Points value of achievement
    awardedBy: text('awarded_by'), // null = auto-tracked, userId = manually awarded by admin
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
    reactionsGiven: integer('reactions_given').default(0).notNull(), // Track reactions given
    channelsJoined: integer('channels_joined').default(0).notNull(), // Track unique voice channels joined
    bytepodsCreated: integer('bytepods_created').default(0).notNull(), // Track BytePods created
    uniqueCommandsUsed: text('unique_commands_used'), // JSON array of unique command names
    activeHours: text('active_hours'), // JSON array of hours (0-23) when user was active
    firstActivityTime: integer('first_activity_time'), // Unix timestamp of first activity this day
    lastActivityTime: integer('last_activity_time'), // Unix timestamp of last activity this day
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(new Date())
}, (table) => ({
    // Composite unique constraint: one log per user per guild per day
    userGuildDateUnique: unique().on(table.userId, table.guildId, table.activityDate),
    // Index for user activity history
    userGuildDateIdx: index('activity_user_guild_date_idx').on(table.userId, table.guildId, table.activityDate),
    // Index for daily cleanup queries
    dateIdx: index('activity_date_idx').on(table.activityDate)
}));

// Achievement Definitions (metadata for all achievements - core + seasonal)
const achievementDefinitions = sqliteTable('achievement_definitions', {
    id: text('id').primaryKey(), // e.g., "message_1000", "streak_365"
    title: text('title').notNull(),
    description: text('description').notNull(),
    emoji: text('emoji').notNull(),
    category: text('category').notNull(), // streak, total, message, voice, command, special, social, combo, meta, custom
    rarity: text('rarity').notNull(), // common, uncommon, rare, epic, legendary, mythic
    checkType: text('check_type').notNull(), // exact, threshold, special, combo, time-based, manual
    criteria: text('criteria').notNull(), // JSON: {"messageCount": 1000} or {"streak": 7}
    grantRole: integer('grant_role', { mode: 'boolean' }).default(false).notNull(), // Grant role reward?
    points: integer('points').default(0).notNull(), // Point value
    startDate: integer('start_date', { mode: 'timestamp' }), // When achievement becomes available (seasonal)
    endDate: integer('end_date', { mode: 'timestamp' }), // When achievement expires (seasonal)
    seasonal: integer('seasonal', { mode: 'boolean' }).default(false).notNull(), // Is time-limited?
    seasonalEvent: text('seasonal_event'), // halloween, christmas, anniversary, etc.
    createdAt: integer('created_at', { mode: 'timestamp' }).default(new Date())
}, (table) => ({
    // Index for category-based queries
    categoryIdx: index('achievement_defs_category_idx').on(table.category),
    // Index for rarity filtering
    rarityIdx: index('achievement_defs_rarity_idx').on(table.rarity),
    // Index for seasonal achievement queries
    seasonalIdx: index('achievement_defs_seasonal_idx').on(table.seasonal, table.startDate, table.endDate)
}));

// Achievement Role Configuration (per-guild settings for role rewards)
const achievementRoleConfig = sqliteTable('achievement_role_config', {
    guildId: text('guild_id').primaryKey(),
    enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(), // Enable role rewards
    rolePrefix: text('role_prefix').default('🏆').notNull(), // Role name prefix
    useRarityColors: integer('use_rarity_colors', { mode: 'boolean' }).default(true).notNull(), // Color by rarity vs brand color
    cleanupOrphaned: integer('cleanup_orphaned', { mode: 'boolean' }).default(true).notNull(), // Delete roles with 0 members
    notifyOnEarn: integer('notify_on_earn', { mode: 'boolean' }).default(true).notNull(), // Send DM notifications
    createdAt: integer('created_at', { mode: 'timestamp' }).default(new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(new Date())
});

// Achievement Roles (track dynamically created achievement roles)
const achievementRoles = sqliteTable('achievement_roles', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    achievementId: text('achievement_id').notNull(), // FK to achievementDefinitions.id
    guildId: text('guild_id').notNull(),
    roleId: text('role_id').notNull(), // Discord role ID
    createdAt: integer('created_at', { mode: 'timestamp' }).default(new Date())
}, (table) => ({
    // Composite unique constraint: one role per achievement per guild
    achievementGuildUnique: unique().on(table.achievementId, table.guildId),
    // Index for guild role queries
    guildIdx: index('achievement_roles_guild_idx').on(table.guildId),
    // Index for achievement lookups
    achievementIdx: index('achievement_roles_achievement_idx').on(table.achievementId)
}));

// Custom Achievements (server-created custom achievements)
const customAchievements = sqliteTable('custom_achievements', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    achievementId: text('achievement_id').notNull(), // custom_guild123_timestamp
    title: text('title').notNull(),
    description: text('description').notNull(),
    emoji: text('emoji').notNull(),
    category: text('category').default('custom').notNull(),
    rarity: text('rarity').notNull(), // common, uncommon, rare, epic, legendary, mythic
    checkType: text('check_type').notNull(), // manual, auto (message/voice/event)
    criteria: text('criteria'), // JSON for auto-check (null for manual)
    grantRole: integer('grant_role', { mode: 'boolean' }).default(false).notNull(),
    points: integer('points').notNull(),
    createdBy: text('created_by').notNull(), // Admin who created it
    createdAt: integer('created_at', { mode: 'timestamp' }).default(new Date()),
    enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull()
}, (table) => ({
    // Composite unique constraint: unique achievement ID per guild
    guildAchievementUnique: unique().on(table.guildId, table.achievementId),
    // Index for guild custom achievement queries
    guildIdx: index('custom_achievements_guild_idx').on(table.guildId),
    // Index for enabled achievements
    guildEnabledIdx: index('custom_achievements_guild_enabled_idx').on(table.guildId, table.enabled)
}));

const ticketConfigs = sqliteTable('ticket_configs', {
    guildId: text('guild_id').primaryKey(),
    nextNumber: integer('next_number').default(1).notNull(),
    defaultCategoryId: text('default_category_id'),
    supportRoleId: text('support_role_id'),
    openingMessage: text('opening_message').default('Thanks for contacting support.').notNull(),
    buttonLabel: text('button_label').default('Create ticket').notNull(),
    buttonStyle: text('button_style').default('primary').notNull(),
    dmsEnabled: integer('dms_enabled', { mode: 'boolean' }).default(false).notNull(),
    inactivityHours: integer('inactivity_hours'),
    limitMode: text('limit_mode').default('one_total').notNull(),
    logChannelId: text('log_channel_id'),
    ratingsEnabled: integer('ratings_enabled', { mode: 'boolean' }).default(false).notNull(),
    vouchChannelId: text('vouch_channel_id'),
    updatedAt: integer('updated_at').notNull()
});

const ticketPanels = sqliteTable('ticket_panels', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    name: text('name').notNull(),
    mode: text('mode').default('dropdown').notNull(),
    defaultCategoryId: text('default_category_id'),
    messageScript: text('message_script'),
    channelId: text('channel_id'),
    messageId: text('message_id'),
    enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
}, table => ({ guildNameUnique: unique().on(table.guildId, table.name) }));

const ticketTopics = sqliteTable('ticket_topics', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    categoryId: text('category_id'),
    embedScript: text('embed_script'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
}, table => ({ guildNameUnique: unique().on(table.guildId, table.name) }));

const ticketTopicRoles = sqliteTable('ticket_topic_roles', {
    topicId: integer('topic_id').notNull(),
    roleId: text('role_id').notNull()
}, table => ({ pk: primaryKey({ columns: [table.topicId, table.roleId] }) }));

const ticketForms = sqliteTable('ticket_forms', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    panelId: integer('panel_id').notNull(),
    name: text('name').notNull(),
    createdAt: integer('created_at').notNull()
}, table => ({ panelNameUnique: unique().on(table.panelId, table.name) }));

const ticketFormFields = sqliteTable('ticket_form_fields', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    formId: integer('form_id').notNull(),
    label: text('label').notNull(),
    type: text('type').default('short').notNull(),
    placeholder: text('placeholder'),
    required: integer('required', { mode: 'boolean' }).default(true).notNull(),
    position: integer('position').notNull()
}, table => ({ formPositionUnique: unique().on(table.formId, table.position) }));

const ticketOptions = sqliteTable('ticket_options', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    panelId: integer('panel_id').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    emoji: text('emoji'),
    style: text('style').default('primary').notNull(),
    categoryId: text('category_id'),
    topicId: integer('topic_id'),
    formId: integer('form_id'),
    closeOnLeave: integer('close_on_leave', { mode: 'boolean' }).default(false).notNull(),
    traineeClaim: integer('trainee_claim', { mode: 'boolean' }).default(false).notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
    position: integer('position').notNull()
}, table => ({ panelPositionUnique: unique().on(table.panelId, table.position) }));

const ticketOptionRoles = sqliteTable('ticket_option_roles', {
    optionId: integer('option_id').notNull(),
    roleId: text('role_id').notNull(),
    kind: text('kind').notNull()
}, table => ({ pk: primaryKey({ columns: [table.optionId, table.roleId, table.kind] }) }));

const ticketBlacklist = sqliteTable('ticket_blacklist', {
    guildId: text('guild_id').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull()
}, table => ({ pk: primaryKey({ columns: [table.guildId, table.targetType, table.targetId] }) }));

const ticketProfiles = sqliteTable('ticket_profiles', {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    greeting: text('greeting').notNull(),
    updatedAt: integer('updated_at').notNull()
}, table => ({ pk: primaryKey({ columns: [table.guildId, table.userId] }) }));

const tickets = sqliteTable('tickets', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    number: integer('number').notNull(),
    openerId: text('opener_id').notNull(),
    panelId: integer('panel_id'),
    optionId: integer('option_id'),
    topicId: integer('topic_id'),
    topicName: text('topic_name'),
    channelId: text('channel_id'),
    status: text('status').default('pending').notNull(),
    claimerId: text('claimer_id'),
    reason: text('reason'),
    formSnapshot: text('form_snapshot'),
    accessSnapshot: text('access_snapshot'),
    inactivityDeadline: integer('inactivity_deadline'),
    warnedAt: integer('warned_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    closedAt: integer('closed_at'),
    deletedAt: integer('deleted_at')
}, table => ({
    guildNumberUnique: unique().on(table.guildId, table.number),
    channelUnique: unique().on(table.channelId),
    openerStatusIdx: index('tickets_guild_opener_status_idx').on(table.guildId, table.openerId, table.status),
    deadlineIdx: index('tickets_inactivity_deadline_idx').on(table.inactivityDeadline, table.status)
}));

const ticketMembers = sqliteTable('ticket_members', {
    ticketId: integer('ticket_id').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    addedBy: text('added_by').notNull(),
    createdAt: integer('created_at').notNull()
}, table => ({ pk: primaryKey({ columns: [table.ticketId, table.targetType, table.targetId] }) }));

const ticketActions = sqliteTable('ticket_actions', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ticketId: integer('ticket_id').notNull(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    detail: text('detail'),
    createdAt: integer('created_at').notNull()
}, table => ({ ticketIdx: index('ticket_actions_ticket_idx').on(table.ticketId, table.id) }));

const ticketTranscripts = sqliteTable('ticket_transcripts', {
    ticketId: integer('ticket_id').primaryKey(),
    html: text('html').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
});

const ticketRatings = sqliteTable('ticket_ratings', {
    ticketId: integer('ticket_id').primaryKey(),
    userId: text('user_id').notNull(),
    stars: integer('stars').notNull(),
    comment: text('comment'),
    createdAt: integer('created_at').notNull()
});

const giveawayConfigs = sqliteTable('giveaway_configs', {
    guildId: text('guild_id').primaryKey(),
    dmCreator: integer('dm_creator', { mode: 'boolean' }).default(false).notNull(),
    dmWinners: integer('dm_winners', { mode: 'boolean' }).default(false).notNull(),
    template: text('template'),
    updatedAt: integer('updated_at').notNull()
});

const giveawayPresets = sqliteTable('giveaway_presets', {
    guildId: text('guild_id').notNull(),
    name: text('name').notNull(),
    script: text('script').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
}, table => ({ pk: primaryKey({ columns: [table.guildId, table.name] }) }));

const giveawayBlacklist = sqliteTable('giveaway_blacklist', {
    guildId: text('guild_id').notNull(),
    roleId: text('role_id').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull()
}, table => ({ pk: primaryKey({ columns: [table.guildId, table.roleId] }) }));

const giveawayRoleLimits = sqliteTable('giveaway_role_limits', {
    guildId: text('guild_id').notNull(),
    roleId: text('role_id').notNull(),
    maxEntries: integer('max_entries').notNull(),
    createdBy: text('created_by').notNull(),
    updatedAt: integer('updated_at').notNull()
}, table => ({ pk: primaryKey({ columns: [table.guildId, table.roleId] }) }));

const memberLevels = sqliteTable('member_levels', {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    xp: integer('xp').default(0).notNull(),
    level: integer('level').default(0).notNull(),
    updatedAt: integer('updated_at').notNull()
}, table => ({ pk: primaryKey({ columns: [table.guildId, table.userId] }) }));

const giveaways = sqliteTable('giveaways', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id'),
    hostId: text('host_id').notNull(),
    prize: text('prize').notNull(),
    description: text('description'),
    requiredRoleId: text('required_role_id'),
    imageUrl: text('image_url'),
    thumbnailUrl: text('thumbnail_url'),
    winnerCount: integer('winner_count').notNull(),
    minLevel: integer('min_level'),
    maxLevel: integer('max_level'),
    templateSnapshot: text('template_snapshot'),
    status: text('status').default('pending').notNull(),
    endsAt: integer('ends_at').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    endedAt: integer('ended_at')
}, table => ({
    messageUnique: unique().on(table.messageId),
    dueIdx: index('giveaways_due_idx').on(table.status, table.endsAt),
    guildStatusIdx: index('giveaways_guild_status_idx').on(table.guildId, table.status)
}));

const giveawayEntries = sqliteTable('giveaway_entries', {
    giveawayId: integer('giveaway_id').notNull(),
    userId: text('user_id').notNull(),
    entries: integer('entries').default(1).notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
}, table => ({ pk: primaryKey({ columns: [table.giveawayId, table.userId] }) }));

const giveawayRounds = sqliteTable('giveaway_rounds', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    giveawayId: integer('giveaway_id').notNull(),
    roundNumber: integer('round_number').notNull(),
    candidatesSnapshot: text('candidates_snapshot').notNull(),
    exclusionsSnapshot: text('exclusions_snapshot').notNull(),
    winnersSnapshot: text('winners_snapshot').notNull(),
    actorId: text('actor_id').notNull(),
    createdAt: integer('created_at').notNull(),
    deliveryToken: text('delivery_token'),
    deliveryLeaseUntil: integer('delivery_lease_until'),
    announcedAt: integer('announced_at')
}, table => ({ numberUnique: unique().on(table.giveawayId, table.roundNumber) }));

const giveawayActions = sqliteTable('giveaway_actions', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    giveawayId: integer('giveaway_id').notNull(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    detail: text('detail'),
    createdAt: integer('created_at').notNull()
}, table => ({ giveawayIdx: index('giveaway_actions_giveaway_idx').on(table.giveawayId, table.id) }));

const guildBackups = sqliteTable('guild_backups', {
    id: text('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    creatorId: text('creator_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    schemaVersion: integer('schema_version').notNull(),
    payload: text('payload').notNull(),
    digest: text('digest').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
}, table => ({
    nameUnique: unique('guild_backups_name_unique').on(table.guildId, table.creatorId, table.name),
    ownerIdx: index('guild_backups_owner_idx').on(table.guildId, table.creatorId, table.createdAt)
}));

const customizationPresets = sqliteTable('customization_presets', {
    id: text('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    name: text('name').notNull(),
    nickname: text('nickname'),
    avatarUrl: text('avatar_url'),
    bannerUrl: text('banner_url'),
    bio: text('bio'),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
}, table => ({
    nameUnique: unique('customization_presets_name_unique').on(table.guildId, table.name),
    guildIdx: index('customization_presets_guild_idx').on(table.guildId, table.createdAt)
}));

const serverListings = sqliteTable('server_listings', {
    guildId: text('guild_id').primaryKey(),
    name: text('name').notNull(),
    iconUrl: text('icon_url'),
    description: text('description'),
    memberCount: integer('member_count').notNull(),
    inviteUrl: text('invite_url').notNull(),
    tags: text('tags').default('[]').notNull(),
    bannerUrl: text('banner_url'),
    bumpedAt: integer('bumped_at').notNull(),
    updatedBy: text('updated_by').notNull(),
    updatedAt: integer('updated_at').notNull()
}, table => ({ bumpedIdx: index('server_listings_bumped_idx').on(table.bumpedAt) }));

const economyConfigs = sqliteTable('economy_configs', {
    guildId: text('guild_id').primaryKey(),
    enabled: integer('enabled', { mode: 'boolean' }).default(false).notNull(),
    currencyName: text('currency_name').default('coins').notNull(),
    currencyEmoji: text('currency_emoji').default('🪙').notNull(),
    startingBalance: integer('starting_balance').default(0).notNull(),
    dailyCap: integer('daily_cap').default(50000).notNull(),
    preset: text('preset').default('standard').notNull(),
    updatedBy: text('updated_by').notNull(),
    updatedAt: integer('updated_at').notNull()
});

const economyModes = sqliteTable('economy_modes', {
    userId: text('user_id').primaryKey(),
    scopeType: text('scope_type').default('guild').notNull(),
    updatedAt: integer('updated_at').notNull()
});

const economyScopeTotals = sqliteTable('economy_scope_totals', {
    scopeType: text('scope_type').notNull(),
    scopeId: text('scope_id').notNull(),
    mintedText: text('minted_text').default('0').notNull(),
    destroyedText: text('destroyed_text').default('0').notNull(),
    updatedAt: integer('updated_at').notNull()
}, table => ({ pk: primaryKey({ columns: [table.scopeType, table.scopeId] }) }));

const economyAccounts = sqliteTable('economy_accounts', {
    scopeType: text('scope_type').notNull(),
    scopeId: text('scope_id').notNull(),
    userId: text('user_id').notNull(),
    wallet: integer('wallet').default(0).notNull(),
    bank: integer('bank').default(0).notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
}, table => ({
    pk: primaryKey({ columns: [table.scopeType, table.scopeId, table.userId] }),
    rankIdx: index('economy_accounts_rank_idx').on(table.scopeType, table.scopeId, table.wallet, table.bank),
    walletCheck: check('economy_accounts_wallet_check', sql`${table.wallet} BETWEEN 0 AND 1000000000000`),
    bankCheck: check('economy_accounts_bank_check', sql`${table.bank} BETWEEN 0 AND 1000000000000`)
}));

const economyLedger = sqliteTable('economy_ledger', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    transactionId: text('transaction_id').notNull(),
    scopeType: text('scope_type').notNull(),
    scopeId: text('scope_id').notNull(),
    userId: text('user_id').notNull(),
    walletDelta: integer('wallet_delta').default(0).notNull(),
    bankDelta: integer('bank_delta').default(0).notNull(),
    supplyDelta: integer('supply_delta').default(0).notNull(),
    walletBalance: integer('wallet_balance').notNull(),
    bankBalance: integer('bank_balance').notNull(),
    kind: text('kind').notNull(),
    actorId: text('actor_id').notNull(),
    counterpartyId: text('counterparty_id'),
    reason: text('reason'),
    createdAt: integer('created_at').notNull()
}, table => ({
    transactionIdx: index('economy_ledger_transaction_idx').on(table.transactionId),
    accountIdx: index('economy_ledger_account_idx').on(table.scopeType, table.scopeId, table.userId, table.id),
    walletBalanceCheck: check('economy_ledger_wallet_balance_check', sql`${table.walletBalance} BETWEEN 0 AND 1000000000000`),
    bankBalanceCheck: check('economy_ledger_bank_balance_check', sql`${table.bankBalance} BETWEEN 0 AND 1000000000000`)
}));

const economyEarnedTotals = sqliteTable('economy_earned_totals', {
    userId: text('user_id').notNull(),
    utcDay: text('utc_day').notNull(),
    amount: integer('amount').default(0).notNull(),
    updatedAt: integer('updated_at').notNull()
}, table => ({ pk: primaryKey({ columns: [table.userId, table.utcDay] }) }));

const economyEarningGuilds = sqliteTable('economy_earning_guilds', {
    userId: text('user_id').notNull(),
    utcDay: text('utc_day').notNull(),
    guildId: text('guild_id').notNull(),
    createdAt: integer('created_at').notNull()
}, table => ({ pk: primaryKey({ columns: [table.userId, table.utcDay, table.guildId] }) }));

const economyActionCooldowns = sqliteTable('economy_action_cooldowns', {
    userId: text('user_id').notNull(),
    action: text('action').notNull(),
    scopeType: text('scope_type').notNull(),
    scopeId: text('scope_id').notNull(),
    subjectId: text('subject_id').notNull(),
    availableAt: integer('available_at').notNull()
}, table => ({ pk: primaryKey({ columns: [table.userId, table.action, table.scopeType, table.scopeId, table.subjectId] }) }));

const economyJobs = sqliteTable('economy_jobs', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    name: text('name').notNull(),
    minimum: integer('minimum').notNull(),
    maximum: integer('maximum').notNull(),
    cooldownSeconds: integer('cooldown_seconds').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
}, table => ({ nameUnique: unique('economy_jobs_name_unique').on(table.guildId, table.name) }));

const economyShopItems = sqliteTable('economy_shop_items', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    roleId: text('role_id').notNull(),
    roleName: text('role_name').notNull(),
    price: integer('price').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
}, table => ({ roleUnique: unique('economy_shop_items_role_unique').on(table.guildId, table.roleId) }));

const economyShopPurchases = sqliteTable('economy_shop_purchases', {
    id: text('id').primaryKey(),
    transactionId: text('transaction_id').notNull(),
    reversalTransactionId: text('reversal_transaction_id'),
    guildId: text('guild_id').notNull(),
    itemId: integer('item_id').notNull(),
    userId: text('user_id').notNull(),
    scopeType: text('scope_type').notNull(),
    scopeId: text('scope_id').notNull(),
    roleId: text('role_id').notNull(),
    price: integer('price').notNull(),
    status: text('status').default('pending').notNull(),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deliveredAt: integer('delivered_at'),
    reversedAt: integer('reversed_at')
}, table => ({
    pendingIdx: index('economy_shop_purchases_pending_idx').on(table.status, table.guildId, table.id),
    onePendingItem: uniqueIndex('economy_shop_purchases_one_pending_item')
        .on(table.guildId, table.userId, table.itemId).where(sql`${table.status} = 'pending'`)
}));

const economyGameSessions = sqliteTable('economy_game_sessions', {
    id: text('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    scopeType: text('scope_type').default('guild').notNull(),
    scopeId: text('scope_id').notNull(),
    userId: text('user_id').notNull(),
    game: text('game').notNull(),
    bet: integer('bet').notNull(),
    stateJson: text('state_json').default('{}').notNull(),
    status: text('status').notNull(),
    nonce: text('nonce').notNull(),
    transactionId: text('transaction_id').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    settledAt: integer('settled_at'),
    settlementAmount: integer('settlement_amount')
}, table => ({
    oneActive: uniqueIndex('economy_game_sessions_one_active')
        .on(table.guildId, table.userId).where(sql`${table.status} = 'active'`),
    activeExpiryIdx: index('economy_game_sessions_active_expiry_idx').on(table.status, table.expiresAt),
    scopeCheck: check('economy_game_sessions_scope_check', sql`${table.scopeType} = 'guild' AND ${table.scopeId} = ${table.guildId}`),
    betCheck: check('economy_game_sessions_bet_check', sql`${table.bet} BETWEEN 10 AND 1000000`),
    gameCheck: check('economy_game_sessions_game_check', sql`${table.game} IN ('coinflip','dice','gamble','roulette','highlow','slots','plinko','bombs','ladder','crash','scratch','blackjack')`),
    statusCheck: check('economy_game_sessions_status_check', sql`${table.status} IN ('active','won','lost','cashed_out','refunded','forfeited')`)
}));

const economyGangs = sqliteTable('economy_gangs', {
    id: text('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    name: text('name').notNull(),
    ownerId: text('owner_id').notNull(),
    bannerUrl: text('banner_url'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
}, table => ({ nameUnique: unique('economy_gangs_name_unique').on(table.guildId, table.name) }));

const economyGangMembers = sqliteTable('economy_gang_members', {
    guildId: text('guild_id').notNull(),
    gangId: text('gang_id').notNull().references(() => economyGangs.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    role: text('role').notNull(),
    joinedAt: integer('joined_at').notNull()
}, table => ({
    pk: primaryKey({ columns: [table.guildId, table.userId] }),
    oneOwner: uniqueIndex('economy_gang_members_one_owner').on(table.gangId).where(sql`${table.role} = 'owner'`),
    gangIdx: index('economy_gang_members_gang_idx').on(table.gangId, table.joinedAt),
    roleCheck: check('economy_gang_members_role_check', sql`${table.role} IN ('owner','admin','member')`)
}));

const economyGangInvites = sqliteTable('economy_gang_invites', {
    id: text('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    gangId: text('gang_id').references(() => economyGangs.id, { onDelete: 'set null' }),
    inviterId: text('inviter_id').notNull(),
    inviteeId: text('invitee_id').notNull(),
    status: text('status').default('pending').notNull(),
    nonce: text('nonce').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    actedAt: integer('acted_at')
}, table => ({
    onePending: uniqueIndex('economy_gang_invites_one_pending')
        .on(table.guildId, table.gangId, table.inviteeId).where(sql`${table.status} = 'pending'`),
    statusCheck: check('economy_gang_invites_status_check', sql`${table.status} IN ('pending','accepted','declined','expired','revoked')`)
}));

const economyLabs = sqliteTable('economy_labs', {
    id: text('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    level: integer('level').default(1).notNull(),
    ampoules: integer('ampoules').default(1).notNull(),
    storedAmount: integer('stored_amount').default(0).notNull(),
    storageCap: integer('storage_cap').default(1000).notNull(),
    lastAccrualAt: integer('last_accrual_at').notNull(),
    pausedAt: integer('paused_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
}, table => ({
    ownerUnique: unique('economy_labs_owner_unique').on(table.guildId, table.userId),
    levelCheck: check('economy_labs_level_check', sql`${table.level} BETWEEN 1 AND 10`),
    ampoulesCheck: check('economy_labs_ampoules_check', sql`${table.ampoules} BETWEEN 1 AND 5`),
    storageCheck: check('economy_labs_storage_check', sql`${table.storageCap} = ${table.level} * 1000 AND ${table.storedAmount} BETWEEN 0 AND ${table.storageCap}`)
}));

const economyLabOperations = sqliteTable('economy_lab_operations', {
    operationId: text('operation_id').primaryKey(),
    labId: text('lab_id').references(() => economyLabs.id, { onDelete: 'set null' }),
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    kind: text('kind').notNull(),
    inputAmount: integer('input_amount').default(0).notNull(),
    resultAmount: integer('result_amount').default(0).notNull(),
    resultJson: text('result_json').notNull(),
    createdAt: integer('created_at').notNull()
}, table => ({
    actorIdx: index('economy_lab_operations_actor_idx').on(table.guildId, table.userId, table.createdAt),
    kindCheck: check('economy_lab_operations_kind_check', sql`${table.kind} IN ('buy','upgrade','ampoules','collect')`),
    amountCheck: check('economy_lab_operations_amount_check', sql`${table.inputAmount} >= 0 AND ${table.resultAmount} >= 0`)
}));

module.exports = {
    guilds,
    musicConfig,
    voiceMasterConfigs,
    voiceMasterSources,
    voiceMasterCreations,
    voiceMasterAccess,
    voiceMasterJoinRoles,
    lifecycleMessages,
    users,
    moderationLogs,
    moderationCases,
    moderationConfig,
    moderationHardbans,
    moderationJailState,
    lockdownIgnores,
    lockdownStates,
    forcedNicknames,
    memberRoleSnapshots,
    antinukeConfig,
    antinukeModules,
    antinukeAdmins,
    antinukeWhitelist,
    antinukeActions,
    antinukeIncidents,
    antiraidConfig,
    antiraidModules,
    antiraidUsernamePatterns,
    antiraidExemptions,
    antiraidIncidents,
    automodConfig,
    automodFilters,
    automodRules,
    automodExemptions,
    automodStrikeLevels,
    automodStrikes,
    automodIncidents,
    moderationTemplates,
    moderationStaffRoles,
    warningPunishments,
    commandPermissions,
    commandAccessRules,
    fakePermissions,
    deniedRolePermissions,
    protectedTargets,
    uwuLockMembers,
    bytepods,
    bytepodAutoWhitelist,
    bytepodUserSettings,
    bytepodActiveSessions,
    bytepodVoiceStats,
    bytepodTemplates,
    bytepodSessionHistory,
    birthdays,
    birthdayConfig,
    bookmarks,
    autoResponses,
    automationRules,
    starboardConfig,
    starboardMessages,
    honeypotConfig,
    honeypotExemptUsers,
    honeypotExemptRoles,
    honeypotIncidents,
    reminders,
    suggestionConfig,
    suggestions,
    activityStreaks,
    activityAchievements,
    activityLogs,
    achievementDefinitions,
    achievementRoleConfig,
    achievementRoles,
    customAchievements,
    ticketConfigs,
    ticketPanels,
    ticketTopics,
    ticketTopicRoles,
    ticketForms,
    ticketFormFields,
    ticketOptions,
    ticketOptionRoles,
    ticketBlacklist,
    ticketProfiles,
    tickets,
    ticketMembers,
    ticketActions,
    ticketTranscripts,
    ticketRatings,
    giveawayConfigs,
    giveawayPresets,
    giveawayBlacklist,
    giveawayRoleLimits,
    memberLevels,
    giveaways,
    giveawayEntries,
    giveawayRounds,
    giveawayActions,
    guildBackups,
    customizationPresets,
    serverListings,
    economyConfigs,
    economyModes,
    economyScopeTotals,
    economyAccounts,
    economyLedger,
    economyEarnedTotals,
    economyEarningGuilds,
    economyActionCooldowns,
    economyJobs,
    economyShopItems,
    economyShopPurchases,
    economyGameSessions,
    economyGangs,
    economyGangMembers,
    economyGangInvites,
    economyLabs,
    economyLabOperations
};
