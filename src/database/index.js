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
        wt_nickname: 'TEXT'
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
        user_id: 'TEXT PRIMARY KEY',
        auto_lock: 'INTEGER DEFAULT 0'
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
        updated_at: 'INTEGER'
    }
};

/**
 * Validate and fix database schema before running Drizzle migrations
 * This ensures missing columns are added to prevent migration failures
 */
function validateAndFixSchema() {
    const fixes = [];

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

    try {
        const fixes = validateAndFixSchema();
        if (fixes.length > 0) {
            logger.info('Database schema fixes applied:');
            fixes.forEach(fix => logger.info(`  → ${fix}`));
        } else {
            logger.debug('Database schema is up to date');
        }
    } catch (error) {
        logger.error(`Schema validation error: ${error.message}`);
    }

    // Now run Drizzle migrations (should work since schema is fixed)
    try {
        await migrate(db, { migrationsFolder: './drizzle' });
    } catch (error) {
        // If Drizzle migration still fails, log but don't crash - we've already fixed the schema
        logger.warn(`Drizzle migration warning (schema should be fixed): ${error.message}`);
    }
};

module.exports = { db, sqlite, runMigrations };
