const { drizzle } = require('drizzle-orm/better-sqlite3');
const { getTableConfig } = require('drizzle-orm/sqlite-core');
const { readMigrationFiles } = require('drizzle-orm/migrator');
const Database = require('better-sqlite3');
const schema = require('./schema');
const { isValidSQLIdentifier, isValidSQLType } = require('../utils/validationUtil');
require('dotenv').config();

const { migrate } = require('drizzle-orm/better-sqlite3/migrator');

const sqlite = new Database(process.env.DATABASE_URL || 'sqlite.db');

// SECURITY & PERFORMANCE: Enable database hardening
sqlite.pragma('journal_mode = WAL'); // Write-Ahead Logging for better concurrency
sqlite.pragma('busy_timeout = 5000'); // Wait up to 5s for locks instead of failing immediately
sqlite.pragma('foreign_keys = ON'); // Enforce referential integrity

const db = drizzle(sqlite, { schema });

/**
 * Get current columns for a table from SQLite
 */
function getTableColumns(tableName) {
    try {
        const result = sqlite.prepare(`PRAGMA table_info(${tableName})`).all();
        return result.map(col => col.name);
    } catch (e) {
        return []; // Table doesn't exist
    }
}

/**
 * Check if a table exists
 */
function tableExists(tableName) {
    const result = sqlite.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    ).get(tableName);
    return !!result;
}

function sqlIdentifier(identifier) {
    return `"${identifier.replace(/"/g, '""')}"`;
}

function sqlDefault(value) {
    if (value instanceof Date) return String(value.getTime());
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (typeof value === 'number') return String(value);
    return `'${String(value).replace(/'/g, "''")}'`;
}

function createFreshSchema() {
    const tables = Object.values(schema).map(table => getTableConfig(table));
    const migrations = readMigrationFiles({ migrationsFolder: './drizzle' });

    sqlite.transaction(() => {
        for (const table of tables) {
            const compositePrimaryKeys = table.primaryKeys.map(key => key.columns);
            const definitions = table.columns.map(column => {
                const parts = [sqlIdentifier(column.name), column.getSQLType()];
                if (column.primary) parts.push('PRIMARY KEY');
                if (column.autoIncrement) parts.push('AUTOINCREMENT');
                if (column.notNull) parts.push('NOT NULL');
                if (column.default !== undefined) parts.push('DEFAULT', sqlDefault(column.default));
                return parts.join(' ');
            });

            for (const columns of compositePrimaryKeys) {
                definitions.push(`PRIMARY KEY (${columns.map(column => sqlIdentifier(column.name)).join(', ')})`);
            }
            for (const constraint of table.uniqueConstraints) {
                definitions.push(`UNIQUE (${constraint.columns.map(column => sqlIdentifier(column.name)).join(', ')})`);
            }

            sqlite.exec(`CREATE TABLE ${sqlIdentifier(table.name)} (${definitions.join(', ')})`);
        }

        for (const table of tables) {
            for (const index of table.indexes) {
                const unique = index.config.unique ? 'UNIQUE ' : '';
                const columns = index.config.columns.map(column => sqlIdentifier(column.name)).join(', ');
                sqlite.exec(`CREATE ${unique}INDEX ${sqlIdentifier(index.config.name)} ON ${sqlIdentifier(table.name)} (${columns})`);
            }
        }

        sqlite.exec(`CREATE TABLE "__drizzle_migrations" (
            id SERIAL PRIMARY KEY,
            hash TEXT NOT NULL,
            created_at NUMERIC
        )`);
        const recordMigration = sqlite.prepare(
            'INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)'
        );
        for (const migration of migrations) {
            recordMigration.run(migration.hash, migration.folderMillis);
        }
    })();
}

function hasApplicationTables() {
    return sqlite.prepare(`
        SELECT 1
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name != '__drizzle_migrations'
        LIMIT 1
    `).get() !== undefined;
}

/**
 * Expected schema definition - maps table names to their columns and types
 * This must be kept in sync with schema.js
 */
const expectedSchema = {
    guilds: {
        id: 'TEXT PRIMARY KEY',
        prefix: 'TEXT DEFAULT "!"',
        log_channel: 'TEXT',
        welcome_channel: 'TEXT',
        welcome_message: 'TEXT',
        welcome_enabled: 'INTEGER DEFAULT 0',
        welcome_use_embed: 'INTEGER DEFAULT 1',
        joined_at: 'INTEGER',
        voice_hub_channel_id: 'TEXT',
        voice_hub_category_id: 'TEXT',
        achievements_enabled: 'INTEGER DEFAULT 1'
    },
    users: {
        id: 'TEXT PRIMARY KEY',
        guild_id: 'TEXT NOT NULL',
        commands_run: 'INTEGER DEFAULT 0',
        last_seen: 'INTEGER',
        wt_nickname: 'TEXT',
        ephemeral_preference: 'TEXT DEFAULT "default"',
        achievements_opted_out: 'INTEGER DEFAULT 0'
    },
    moderation_logs: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        guild_id: 'TEXT NOT NULL',
        target_id: 'TEXT NOT NULL',
        executor_id: 'TEXT NOT NULL',
        action: 'TEXT NOT NULL',
        reason: 'TEXT',
        timestamp: 'INTEGER'
    },
    moderation_cases: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        guild_id: 'TEXT NOT NULL',
        case_number: 'INTEGER NOT NULL',
        target_id: 'TEXT NOT NULL',
        executor_id: 'TEXT NOT NULL',
        action: 'TEXT NOT NULL',
        reason: 'TEXT',
        status: 'TEXT NOT NULL',
        duration_ms: 'INTEGER',
        metadata: 'TEXT',
        created_at: 'INTEGER NOT NULL',
        updated_at: 'INTEGER NOT NULL',
        undone_by: 'TEXT',
        undo_reason: 'TEXT'
    },
    moderation_config: {
        guild_id: 'TEXT PRIMARY KEY',
        next_case_number: 'INTEGER DEFAULT 1 NOT NULL',
        log_channel_id: 'TEXT',
        image_mute_role_id: 'TEXT',
        reaction_mute_role_id: 'TEXT',
        jail_role_id: 'TEXT',
        jail_channel_id: 'TEXT',
        managed_resources: 'TEXT',
        setup_status: 'TEXT',
        lock_role_id: 'TEXT'
    },
    moderation_hardbans: {
        guild_id: 'TEXT NOT NULL',
        user_id: 'TEXT NOT NULL',
        case_number: 'INTEGER NOT NULL',
        reason: 'TEXT',
        state: 'TEXT NOT NULL',
        created_at: 'INTEGER NOT NULL'
    },
    moderation_jail_state: {
        guild_id: 'TEXT NOT NULL',
        user_id: 'TEXT NOT NULL',
        case_number: 'INTEGER NOT NULL',
        previous_role_ids: 'TEXT NOT NULL',
        state: 'TEXT NOT NULL',
        created_at: 'INTEGER NOT NULL'
    },
    lockdown_ignores: {
        guild_id: 'TEXT NOT NULL',
        channel_id: 'TEXT NOT NULL'
    },
    lockdown_states: {
        guild_id: 'TEXT NOT NULL',
        channel_id: 'TEXT NOT NULL',
        role_id: 'TEXT NOT NULL',
        prior_send_messages: 'INTEGER NOT NULL',
        state: 'TEXT NOT NULL',
        created_at: 'INTEGER NOT NULL'
    },
    forced_nicknames: {
        guild_id: 'TEXT NOT NULL',
        user_id: 'TEXT NOT NULL',
        nickname: 'TEXT NOT NULL',
        updated_at: 'INTEGER NOT NULL'
    },
    member_role_snapshots: {
        guild_id: 'TEXT NOT NULL',
        user_id: 'TEXT NOT NULL',
        role_ids: 'TEXT NOT NULL',
        updated_at: 'INTEGER NOT NULL'
    },
    antinuke_config: {
        guild_id: 'TEXT PRIMARY KEY',
        enabled: 'INTEGER DEFAULT 0 NOT NULL',
        punishment: "TEXT DEFAULT 'strip' NOT NULL",
        window_seconds: 'INTEGER DEFAULT 60 NOT NULL',
        log_channel_id: 'TEXT'
    },
    antinuke_modules: {
        guild_id: 'TEXT NOT NULL',
        module: 'TEXT NOT NULL',
        enabled: 'INTEGER DEFAULT 0 NOT NULL',
        threshold: 'INTEGER DEFAULT 3 NOT NULL',
        punishment: 'TEXT'
    },
    antinuke_admins: {
        guild_id: 'TEXT NOT NULL',
        user_id: 'TEXT NOT NULL',
        added_by: 'TEXT NOT NULL',
        created_at: 'INTEGER NOT NULL'
    },
    antinuke_whitelist: {
        guild_id: 'TEXT NOT NULL',
        user_id: 'TEXT NOT NULL',
        added_by: 'TEXT NOT NULL',
        created_at: 'INTEGER NOT NULL'
    },
    antinuke_actions: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        guild_id: 'TEXT NOT NULL',
        actor_id: 'TEXT NOT NULL',
        module: 'TEXT NOT NULL',
        audit_entry_id: 'TEXT NOT NULL',
        consumed: 'INTEGER DEFAULT 0 NOT NULL',
        occurred_at: 'INTEGER NOT NULL'
    },
    antinuke_incidents: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        guild_id: 'TEXT NOT NULL',
        actor_id: 'TEXT NOT NULL',
        module: 'TEXT NOT NULL',
        action_count: 'INTEGER NOT NULL',
        punishment: 'TEXT NOT NULL',
        status: 'TEXT NOT NULL',
        applying_at: 'INTEGER',
        applying_token: 'TEXT',
        error: 'TEXT',
        audit_entry_id: 'TEXT NOT NULL',
        created_at: 'INTEGER NOT NULL'
    },
    moderation_templates: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        guild_id: 'TEXT NOT NULL',
        action: 'TEXT NOT NULL',
        message_type: 'TEXT NOT NULL',
        template: 'TEXT NOT NULL'
    },
    moderation_staff_roles: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        guild_id: 'TEXT NOT NULL',
        role_id: 'TEXT NOT NULL'
    },
    warning_punishments: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        guild_id: 'TEXT NOT NULL',
        threshold: 'INTEGER NOT NULL',
        action: 'TEXT NOT NULL',
        duration_ms: 'INTEGER'
    },
    command_permissions: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        guild_id: 'TEXT NOT NULL',
        command_name: 'TEXT NOT NULL',
        role_id: 'TEXT NOT NULL'
    },
    command_access_rules: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        guild_id: 'TEXT NOT NULL',
        command_path: 'TEXT NOT NULL',
        effect: 'TEXT NOT NULL',
        scope_type: 'TEXT NOT NULL',
        scope_id: 'TEXT NOT NULL'
    },
    fake_permissions: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        guild_id: 'TEXT NOT NULL',
        role_id: 'TEXT NOT NULL',
        permission: 'TEXT NOT NULL'
    },
    denied_role_permissions: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        guild_id: 'TEXT NOT NULL',
        permission: 'TEXT NOT NULL'
    },
    protected_targets: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        guild_id: 'TEXT NOT NULL',
        target_type: 'TEXT NOT NULL',
        target_id: 'TEXT NOT NULL'
    },
    uwu_lock_members: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        guild_id: 'TEXT NOT NULL',
        user_id: 'TEXT NOT NULL',
        state: 'TEXT NOT NULL'
    },
    bytepods: {
        channel_id: 'TEXT PRIMARY KEY',
        guild_id: 'TEXT NOT NULL',
        owner_id: 'TEXT NOT NULL',
        original_owner_id: 'TEXT',
        owner_left_at: 'INTEGER',
        reclaim_request_pending: 'INTEGER DEFAULT 0',
        panel_message_id: 'TEXT',
        created_at: 'INTEGER'
    },
    bytepod_autowhitelist: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        user_id: 'TEXT NOT NULL',
        target_user_id: 'TEXT NOT NULL',
        guild_id: 'TEXT'
    },
    bytepod_user_settings: {
        user_id: 'TEXT NOT NULL',
        guild_id: 'TEXT NOT NULL',
        auto_lock: 'INTEGER DEFAULT 0',
        summary_enabled: 'INTEGER DEFAULT 0',
        pod_name_style: 'TEXT DEFAULT "username"'
        // Note: Composite primary key (user_id, guild_id) - handled by Drizzle migrations
    },
    bytepod_active_sessions: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        pod_id: 'TEXT NOT NULL',
        user_id: 'TEXT NOT NULL',
        guild_id: 'TEXT NOT NULL',
        start_time: 'INTEGER NOT NULL'
    },
    bytepod_voice_stats: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        user_id: 'TEXT NOT NULL',
        guild_id: 'TEXT NOT NULL',
        total_seconds: 'INTEGER DEFAULT 0',
        session_count: 'INTEGER DEFAULT 0'
    },
    bytepod_templates: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        user_id: 'TEXT NOT NULL',
        guild_id: 'TEXT NOT NULL',
        name: 'TEXT NOT NULL',
        user_limit: 'INTEGER DEFAULT 0',
        auto_lock: 'INTEGER DEFAULT 0',
        whitelist_user_ids: 'TEXT'
    },
    bytepod_session_history: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        pod_id: 'TEXT NOT NULL',
        guild_id: 'TEXT NOT NULL',
        owner_id: 'TEXT NOT NULL',
        pod_name: 'TEXT',
        started_at: 'INTEGER NOT NULL',
        ended_at: 'INTEGER NOT NULL',
        peak_users: 'INTEGER DEFAULT 1',
        unique_visitors: 'INTEGER DEFAULT 1',
        total_voice_minutes: 'INTEGER DEFAULT 0',
        visitor_data: 'TEXT'
    },
    birthdays: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        user_id: 'TEXT NOT NULL',
        guild_id: 'TEXT NOT NULL',
        month: 'INTEGER NOT NULL',
        day: 'INTEGER NOT NULL',
        created_at: 'INTEGER'
    },
    birthday_config: {
        guild_id: 'TEXT PRIMARY KEY',
        channel_id: 'TEXT NOT NULL',
        role_id: 'TEXT',
        enabled: 'INTEGER DEFAULT 1 NOT NULL',
        last_check: 'INTEGER'
    },
    bookmarks: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        user_id: 'TEXT NOT NULL',
        guild_id: 'TEXT NOT NULL',
        channel_id: 'TEXT NOT NULL',
        message_id: 'TEXT NOT NULL',
        content: 'TEXT NOT NULL',
        author_id: 'TEXT NOT NULL',
        attachment_urls: 'TEXT',
        saved_at: 'INTEGER',
        message_deleted: 'INTEGER DEFAULT 0 NOT NULL'
    },
    auto_responses: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        guild_id: 'TEXT NOT NULL',
        trigger: 'TEXT NOT NULL',
        response: 'TEXT NOT NULL',
        channel_id: 'TEXT',
        creator_id: 'TEXT NOT NULL',
        enabled: 'INTEGER DEFAULT 1 NOT NULL',
        cooldown: 'INTEGER DEFAULT 60',
        match_type: 'TEXT DEFAULT contains NOT NULL',
        require_role_id: 'TEXT',
        use_count: 'INTEGER DEFAULT 0',
        created_at: 'INTEGER',
        last_used: 'INTEGER'
    },
    starboard_config: {
        guild_id: 'TEXT PRIMARY KEY',
        channel_id: 'TEXT NOT NULL',
        threshold: 'INTEGER DEFAULT 5 NOT NULL',
        emoji: 'TEXT DEFAULT ⭐ NOT NULL',
        enabled: 'INTEGER DEFAULT 1 NOT NULL'
    },
    starboard_messages: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        guild_id: 'TEXT NOT NULL',
        original_message_id: 'TEXT NOT NULL',
        original_channel_id: 'TEXT NOT NULL',
        starboard_message_id: 'TEXT',
        author_id: 'TEXT NOT NULL',
        star_count: 'INTEGER DEFAULT 0 NOT NULL',
        content: 'TEXT',
        image_url: 'TEXT',
        posted_at: 'INTEGER NOT NULL'
    },
    honeypot_config: {
        guild_id: 'TEXT PRIMARY KEY',
        category_id: 'TEXT',
        channel_id: 'TEXT',
        warning_message_id: 'TEXT',
        shame_board_message_id: 'TEXT',
        enabled: 'INTEGER DEFAULT 0 NOT NULL',
        pin_warning_failed: 'INTEGER DEFAULT 0 NOT NULL',
        created_at: 'INTEGER',
        updated_at: 'INTEGER'
    },
    honeypot_exempt_users: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        guild_id: 'TEXT NOT NULL',
        user_id: 'TEXT NOT NULL'
    },
    honeypot_exempt_roles: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        guild_id: 'TEXT NOT NULL',
        role_id: 'TEXT NOT NULL'
    },
    honeypot_incidents: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        guild_id: 'TEXT NOT NULL',
        user_id: 'TEXT NOT NULL',
        username: 'TEXT',
        display_name: 'TEXT',
        message_id: 'TEXT',
        channel_id: 'TEXT NOT NULL',
        snippet: 'TEXT',
        attachment_summary: 'TEXT',
        status: 'TEXT NOT NULL',
        failure_reason: 'TEXT',
        account_created_at: 'INTEGER',
        joined_at: 'INTEGER',
        triggered_at: 'INTEGER'
    },
    reminders: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        user_id: 'TEXT NOT NULL',
        guild_id: 'TEXT',
        channel_id: 'TEXT',
        message: 'TEXT NOT NULL',
        trigger_at: 'INTEGER NOT NULL',
        created_at: 'INTEGER NOT NULL',
        active: 'INTEGER DEFAULT 1 NOT NULL'
    },
    suggestion_config: {
        guild_id: 'TEXT PRIMARY KEY',
        channel_id: 'TEXT NOT NULL',
        review_role_id: 'TEXT',
        enabled: 'INTEGER DEFAULT 1 NOT NULL',
        allow_anonymous: 'INTEGER DEFAULT 0 NOT NULL'
    },
    suggestions: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        guild_id: 'TEXT NOT NULL',
        user_id: 'TEXT NOT NULL',
        content: 'TEXT NOT NULL',
        message_id: 'TEXT NOT NULL',
        channel_id: 'TEXT NOT NULL',
        status: 'TEXT DEFAULT pending NOT NULL',
        upvotes: 'INTEGER DEFAULT 0',
        downvotes: 'INTEGER DEFAULT 0',
        reviewed_by: 'TEXT',
        reviewed_at: 'INTEGER',
        review_reason: 'TEXT',
        created_at: 'INTEGER',
        anonymous: 'INTEGER DEFAULT 0 NOT NULL'
    },
    activity_streaks: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        user_id: 'TEXT NOT NULL',
        guild_id: 'TEXT NOT NULL',
        current_streak: 'INTEGER DEFAULT 0 NOT NULL',
        longest_streak: 'INTEGER DEFAULT 0 NOT NULL',
        last_activity_date: 'TEXT',
        total_active_days: 'INTEGER DEFAULT 0 NOT NULL',
        freezes_available: 'INTEGER DEFAULT 1 NOT NULL',
        last_freeze_reset: 'INTEGER',
        created_at: 'INTEGER',
        updated_at: 'INTEGER'
    },
    activity_achievements: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        user_id: 'TEXT NOT NULL',
        guild_id: 'TEXT NOT NULL',
        achievement_id: 'TEXT NOT NULL',
        notified: 'INTEGER DEFAULT 0 NOT NULL',
        points: 'INTEGER DEFAULT 0 NOT NULL',
        awarded_by: 'TEXT',
        earned_at: 'INTEGER'
    },
    activity_logs: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        user_id: 'TEXT NOT NULL',
        guild_id: 'TEXT NOT NULL',
        activity_date: 'TEXT NOT NULL',
        message_count: 'INTEGER DEFAULT 0 NOT NULL',
        voice_minutes: 'INTEGER DEFAULT 0 NOT NULL',
        commands_run: 'INTEGER DEFAULT 0 NOT NULL',
        reactions_given: 'INTEGER DEFAULT 0 NOT NULL',
        channels_joined: 'INTEGER DEFAULT 0 NOT NULL',
        bytepods_created: 'INTEGER DEFAULT 0 NOT NULL',
        unique_commands_used: 'TEXT',
        active_hours: 'TEXT',
        first_activity_time: 'INTEGER',
        last_activity_time: 'INTEGER',
        updated_at: 'INTEGER'
    },
    achievement_definitions: {
        id: 'TEXT PRIMARY KEY',
        title: 'TEXT NOT NULL',
        description: 'TEXT NOT NULL',
        emoji: 'TEXT NOT NULL',
        category: 'TEXT NOT NULL',
        rarity: 'TEXT NOT NULL',
        check_type: 'TEXT NOT NULL',
        criteria: 'TEXT NOT NULL',
        grant_role: 'INTEGER DEFAULT 0 NOT NULL',
        points: 'INTEGER DEFAULT 0 NOT NULL',
        start_date: 'INTEGER',
        end_date: 'INTEGER',
        seasonal: 'INTEGER DEFAULT 0 NOT NULL',
        seasonal_event: 'TEXT',
        created_at: 'INTEGER'
    },
    achievement_role_config: {
        guild_id: 'TEXT PRIMARY KEY',
        enabled: 'INTEGER DEFAULT 1 NOT NULL',
        role_prefix: 'TEXT DEFAULT 🏆 NOT NULL',
        use_rarity_colors: 'INTEGER DEFAULT 1 NOT NULL',
        cleanup_orphaned: 'INTEGER DEFAULT 1 NOT NULL',
        notify_on_earn: 'INTEGER DEFAULT 1 NOT NULL',
        created_at: 'INTEGER',
        updated_at: 'INTEGER'
    },
    achievement_roles: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        achievement_id: 'TEXT NOT NULL',
        guild_id: 'TEXT NOT NULL',
        role_id: 'TEXT NOT NULL',
        created_at: 'INTEGER'
    },
    custom_achievements: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        guild_id: 'TEXT NOT NULL',
        achievement_id: 'TEXT NOT NULL',
        title: 'TEXT NOT NULL',
        description: 'TEXT NOT NULL',
        emoji: 'TEXT NOT NULL',
        category: 'TEXT DEFAULT custom NOT NULL',
        rarity: 'TEXT NOT NULL',
        check_type: 'TEXT NOT NULL',
        criteria: 'TEXT',
        grant_role: 'INTEGER DEFAULT 0 NOT NULL',
        points: 'INTEGER NOT NULL',
        created_by: 'TEXT NOT NULL',
        created_at: 'INTEGER',
        enabled: 'INTEGER DEFAULT 1 NOT NULL'
    }
};

const compatibilityUniqueKeys = {
    lockdown_ignores: ['guild_id', 'channel_id'],
    lockdown_states: ['guild_id', 'channel_id'],
    forced_nicknames: ['guild_id', 'user_id'],
    member_role_snapshots: ['guild_id', 'user_id'],
    antinuke_modules: ['guild_id', 'module'],
    antinuke_admins: ['guild_id', 'user_id'],
    antinuke_whitelist: ['guild_id', 'user_id'],
    antinuke_actions: ['guild_id', 'audit_entry_id'],
    antinuke_incidents: ['guild_id', 'audit_entry_id']
};

function hasUniqueKey(tableName, columns) {
    return sqlite.prepare(`PRAGMA index_list(${sqlIdentifier(tableName)})`).all()
        .filter(index => index.unique)
        .some(index => sqlite.prepare(`PRAGMA index_info(${sqlIdentifier(index.name)})`).all()
            .map(column => column.name).join(',') === columns.join(','));
}

/**
 * Fix bytepod_user_settings table to use composite primary key
 * This is a one-time fix for the migration issue
 */
function fixBytepodUserSettingsTable() {
    const logger = require('../utils/logger');

    try {
        // Check if table exists first
        if (!tableExists('bytepod_user_settings')) {
            // Table doesn't exist yet - will be created by migrations
            return null;
        }

        // Check if table has old structure (with id column)
        const tableInfo = sqlite.prepare('PRAGMA table_info(bytepod_user_settings)').all();
        const hasIdColumn = tableInfo.some(col => col.name === 'id');

        if (!hasIdColumn) {
            // Table already has composite primary key - nothing to do
            return null;
        }

        logger.info('Fixing bytepod_user_settings table structure...', 'Database');

        // Begin transaction
        sqlite.exec('BEGIN TRANSACTION');

        // Create new table with composite primary key
        sqlite.exec(`
            CREATE TABLE bytepod_user_settings_new (
                user_id TEXT NOT NULL,
                guild_id TEXT NOT NULL,
                auto_lock INTEGER DEFAULT 0,
                summary_enabled INTEGER DEFAULT 0,
                pod_name_style TEXT DEFAULT "username",
                PRIMARY KEY (user_id, guild_id)
            )
        `);

        // Copy data from old table (skip rows with NULL user_id or guild_id)
        sqlite.exec(`
            INSERT INTO bytepod_user_settings_new (user_id, guild_id, auto_lock, summary_enabled, pod_name_style)
            SELECT user_id, guild_id, auto_lock,
                   COALESCE(summary_enabled, 0),
                   COALESCE(pod_name_style, 'username')
            FROM bytepod_user_settings
            WHERE user_id IS NOT NULL AND guild_id IS NOT NULL
        `);

        const totalRows = sqlite.prepare('SELECT COUNT(*) as count FROM bytepod_user_settings').get().count;
        const copiedRows = sqlite.prepare('SELECT COUNT(*) as count FROM bytepod_user_settings_new').get().count;
        const skippedRows = totalRows - copiedRows;

        // Drop old table and rename new one
        sqlite.exec('DROP TABLE bytepod_user_settings');
        sqlite.exec('ALTER TABLE bytepod_user_settings_new RENAME TO bytepod_user_settings');

        // Commit transaction
        sqlite.exec('COMMIT');

        const message = skippedRows > 0
            ? `Fixed bytepod_user_settings table (migrated ${copiedRows} rows, skipped ${skippedRows} invalid rows)`
            : `Fixed bytepod_user_settings table (migrated ${copiedRows} rows)`;

        logger.success(message, 'Database');
        return `Fixed bytepod_user_settings table structure (${copiedRows} rows${skippedRows > 0 ? `, ${skippedRows} skipped` : ''})`;

    } catch (error) {
        // Rollback on error
        try {
            sqlite.exec('ROLLBACK');
        } catch (e) {
            // Ignore rollback errors
        }
        logger.error(`Failed to fix bytepod_user_settings: ${error.message}`, 'Database');
        return null;
    }
}

/**
 * Validate and fix database schema before running Drizzle migrations
 * This ensures missing columns are added to prevent migration failures
 */
function validateAndFixSchema() {
    const fixes = [];

    // First, fix the bytepod_user_settings table if needed
    const tableFixResult = fixBytepodUserSettingsTable();
    if (tableFixResult) {
        fixes.push(tableFixResult);
    }

    for (const [tableName, columns] of Object.entries(expectedSchema)) {
        // SECURITY: Validate table name to prevent SQL injection
        if (!isValidSQLIdentifier(tableName)) {
            const logger = require('../utils/logger');
            logger.error(`Invalid table name in expectedSchema: ${tableName}`);
            continue;
        }

        if (!tableExists(tableName)) {
            // Create the entire table if it doesn't exist
            const columnDefs = Object.entries(columns)
                .map(([col, type]) => {
                    // SECURITY: Validate column names and types
                    if (!isValidSQLIdentifier(col)) {
                        const logger = require('../utils/logger');
                        logger.error(`Invalid column name: ${col} in table ${tableName}`);
                        return null;
                    }
                    if (!isValidSQLType(type)) {
                        const logger = require('../utils/logger');
                        logger.error(`Invalid column type: ${type} for ${tableName}.${col}`);
                        return null;
                    }
                    return `${col} ${type}`;
                })
                .filter(def => def !== null)
                .join(', ');

            if (columnDefs) {
                sqlite.exec(`CREATE TABLE IF NOT EXISTS ${tableName} (${columnDefs})`);
                fixes.push(`Created table: ${tableName}`);
            }
            continue;
        }

        // Check for missing columns
        const existingColumns = getTableColumns(tableName);

        for (const [columnName, columnType] of Object.entries(columns)) {
            // SECURITY: Validate column name and type before SQL execution
            if (!isValidSQLIdentifier(columnName)) {
                const logger = require('../utils/logger');
                logger.error(`Invalid column name: ${columnName} in table ${tableName}`);
                continue;
            }
            if (!isValidSQLType(columnType)) {
                const logger = require('../utils/logger');
                logger.error(`Invalid column type: ${columnType} for ${tableName}.${columnName}`);
                continue;
            }

            if (!existingColumns.includes(columnName)) {
                // SQLite accepts constant defaults when adding columns; retain them so
                // compatibility-created rows behave like migrated rows.
                const simpleType = columnType.split(' ')[0];
                const addType = columnType.includes('DEFAULT') && !columnType.includes('PRIMARY KEY')
                    ? columnType
                    : simpleType;
                try {
                    sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${addType}`);
                    fixes.push(`Added column: ${tableName}.${columnName}`);
                } catch (e) {
                    // Column might already exist or other error - silently ignore duplicates
                    if (!e.message.includes('duplicate column')) {
                        // Will be logged by runMigrations if dbLoggingEnabled
                        throw new Error(`Failed to add column ${tableName}.${columnName}: ${e.message}`);
                    }
                }
            }
        }
    }

    for (const [tableName, columns] of Object.entries(compatibilityUniqueKeys)) {
        if (!tableExists(tableName) || hasUniqueKey(tableName, columns)) continue;
        const indexName = `${tableName}_guild_target_unique`;
        sqlite.exec(`CREATE UNIQUE INDEX ${sqlIdentifier(indexName)} ON ${sqlIdentifier(tableName)} (${columns.map(sqlIdentifier).join(', ')})`);
        fixes.push(`Added unique key: ${tableName}(${columns.join(', ')})`);
    }

    return fixes;
}

const runMigrations = async () => {
    const logger = require('../utils/logger');
    const config = require('../utils/config');

    const dbLoggingEnabled = config.logging?.database !== false;

    if (!hasApplicationTables()) {
        createFreshSchema();
        if (dbLoggingEnabled) {
            logger.info('Fresh database schema created successfully', 'Database');
        }
        return;
    }

    // Run authoritative migrations before compatibility repairs so fresh databases
    // receive every primary key, unique constraint, and index from the SQL files.
    try {
        await migrate(db, { migrationsFolder: './drizzle' });
        if (dbLoggingEnabled) {
            logger.info('Database migrations completed successfully', 'Database');
        }
    } catch (error) {
        if (dbLoggingEnabled) {
            logger.warn(`Drizzle migration warning; applying compatibility repairs: ${error.message}`, 'Database');
        }
    }

    // Older installations may predate the migration journal. Preserve their data by
    // adding missing tables/columns after the migration attempt instead of rebuilding.
    try {
        const fixes = validateAndFixSchema();
        if (fixes.length > 0) {
            if (dbLoggingEnabled) {
                logger.info('Database schema fixes applied:', 'Database');
                fixes.forEach(fix => logger.info(`  → ${fix}`, 'Database'));
            }
        } else if (dbLoggingEnabled) {
            logger.debug('Database schema is up to date', 'Database');
        }
    } catch (error) {
        if (dbLoggingEnabled) {
            logger.error(`Schema validation error: ${error.message}`, 'Database');
        }
    }
};

module.exports = { db, sqlite, runMigrations };
