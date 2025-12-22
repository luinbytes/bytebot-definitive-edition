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
        joined_at: 'INTEGER',
        voice_hub_channel_id: 'TEXT',
        voice_hub_category_id: 'TEXT'
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
