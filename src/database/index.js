const { drizzle } = require('drizzle-orm/better-sqlite3');
const Database = require('better-sqlite3');
const schema = require('./schema');
require('dotenv').config();

const { migrate } = require('drizzle-orm/better-sqlite3/migrator');

const sqlite = new Database(process.env.DATABASE_URL || 'sqlite.db');
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
        media_archive_channel_id: 'TEXT'
    },
    users: {
        id: 'TEXT PRIMARY KEY',
        guild_id: 'TEXT NOT NULL',
        commands_run: 'INTEGER DEFAULT 0',
        last_seen: 'INTEGER',
        wt_nickname: 'TEXT',
        ephemeral_preference: 'TEXT DEFAULT "default"'
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
    command_permissions: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        guild_id: 'TEXT NOT NULL',
        command_name: 'TEXT NOT NULL',
        role_id: 'TEXT NOT NULL'
    },
    bytepods: {
        channel_id: 'TEXT PRIMARY KEY',
        guild_id: 'TEXT NOT NULL',
        owner_id: 'TEXT NOT NULL',
        original_owner_id: 'TEXT',
        owner_left_at: 'INTEGER',
        reclaim_request_pending: 'INTEGER DEFAULT 0',
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
        auto_lock: 'INTEGER DEFAULT 0'
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
    media_gallery_config: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        guild_id: 'TEXT NOT NULL',
        channel_id: 'TEXT NOT NULL',
        enabled: 'INTEGER DEFAULT 1 NOT NULL',
        auto_capture: 'INTEGER DEFAULT 1 NOT NULL',
        file_types: 'TEXT DEFAULT "image,video,audio" NOT NULL',
        max_file_size_mb: 'INTEGER DEFAULT 50 NOT NULL',
        auto_tag_channel: 'INTEGER DEFAULT 1 NOT NULL',
        whitelist_role_ids: 'TEXT',
        created_by: 'TEXT NOT NULL',
        created_at: 'INTEGER',
        updated_at: 'INTEGER'
    },
    media_items: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        user_id: 'TEXT NOT NULL',
        guild_id: 'TEXT NOT NULL',
        channel_id: 'TEXT NOT NULL',
        message_id: 'TEXT NOT NULL',
        archive_message_id: 'TEXT',
        local_file_path: 'TEXT',
        storage_method: 'TEXT DEFAULT discord NOT NULL',
        file_hash: 'TEXT',
        media_url: 'TEXT NOT NULL',
        file_name: 'TEXT NOT NULL',
        file_type: 'TEXT NOT NULL',
        mime_type: 'TEXT',
        file_size: 'INTEGER',
        width: 'INTEGER',
        height: 'INTEGER',
        duration: 'REAL',
        description: 'TEXT',
        content_preview: 'TEXT',
        author_id: 'TEXT NOT NULL',
        capture_method: 'TEXT DEFAULT auto NOT NULL',
        saved_at: 'INTEGER',
        message_deleted: 'INTEGER DEFAULT 0 NOT NULL',
        url_expired: 'INTEGER DEFAULT 0 NOT NULL'
    },
    media_tags: {
        id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        media_id: 'INTEGER NOT NULL',
        tag: 'TEXT NOT NULL',
        auto_generated: 'INTEGER DEFAULT 0 NOT NULL',
        created_at: 'INTEGER'
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
                PRIMARY KEY (user_id, guild_id)
            )
        `);

        // Copy data from old table (skip rows with NULL user_id or guild_id)
        sqlite.exec(`
            INSERT INTO bytepod_user_settings_new (user_id, guild_id, auto_lock)
            SELECT user_id, guild_id, auto_lock
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
        if (!tableExists(tableName)) {
            // Create the entire table if it doesn't exist
            const columnDefs = Object.entries(columns)
                .map(([col, type]) => `${col} ${type}`)
                .join(', ');
            sqlite.exec(`CREATE TABLE IF NOT EXISTS ${tableName} (${columnDefs})`);
            fixes.push(`Created table: ${tableName}`);
            continue;
        }

        // Check for missing columns
        const existingColumns = getTableColumns(tableName);

        for (const [columnName, columnType] of Object.entries(columns)) {
            if (!existingColumns.includes(columnName)) {
                // Add missing column (SQLite only supports simple ADD COLUMN)
                const simpleType = columnType.split(' ')[0]; // Get just TEXT, INTEGER, etc.
                try {
                    sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${simpleType}`);
                    fixes.push(`Added column: ${tableName}.${columnName}`);
                } catch (e) {
                    // Column might already exist or other error
                    if (!e.message.includes('duplicate column')) {
                        console.error(`Failed to add column ${tableName}.${columnName}:`, e.message);
                    }
                }
            }
        }
    }

    return fixes;
}

const runMigrations = async () => {
    // First, validate and fix schema to prevent Drizzle migration failures
    const logger = require('../utils/logger');
    const config = require('../utils/config');

    const dbLoggingEnabled = config.logging?.database !== false;

    try {
        const fixes = validateAndFixSchema();
        if (fixes.length > 0) {
            if (dbLoggingEnabled) {
                logger.info('Database schema fixes applied:', 'Database');
                fixes.forEach(fix => logger.info(`  → ${fix}`, 'Database'));
            }
        } else {
            if (dbLoggingEnabled) {
                logger.debug('Database schema is up to date', 'Database');
            }
        }
    } catch (error) {
        if (dbLoggingEnabled) {
            logger.error(`Schema validation error: ${error.message}`, 'Database');
        }
    }

    // Now run Drizzle migrations (should work since schema is fixed)
    try {
        await migrate(db, { migrationsFolder: './drizzle' });
        if (dbLoggingEnabled) {
            logger.info('Database migrations completed successfully', 'Database');
        }
    } catch (error) {
        // If Drizzle migration still fails, log but don't crash - we've already fixed the schema
        if (dbLoggingEnabled) {
            logger.warn(`Drizzle migration warning (schema should be fixed): ${error.message}`, 'Database');
        }
    }
};

module.exports = { db, sqlite, runMigrations };
