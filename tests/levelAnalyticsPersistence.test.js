const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { readMigrationFiles } = require('drizzle-orm/migrator');

describe('level and analytics persistence', () => {
    let tempDir;
    let database;

    beforeEach(() => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-levels-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
    });

    afterEach(() => {
        database?.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('upgrading preserves legacy XP, level, and giveaway eligibility floor', async () => {
        const seed = new Database(process.env.DATABASE_URL);
        seed.exec(`
            CREATE TABLE member_levels (
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                xp INTEGER DEFAULT 0 NOT NULL,
                level INTEGER DEFAULT 0 NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (guild_id, user_id)
            );
            INSERT INTO member_levels (guild_id, user_id, xp, level, updated_at)
            VALUES ('guild1', 'user1', 4321, 17, 99);
            CREATE TABLE __drizzle_migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                hash TEXT NOT NULL,
                created_at NUMERIC
            );
        `);
        const applied = seed.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)');
        readMigrationFiles({ migrationsFolder: './drizzle' })
            .filter(migration => migration.folderMillis <= 1787608800000)
            .forEach(migration => applied.run(migration.hash, migration.folderMillis));
        seed.close();

        database = require('../src/database');
        await database.runMigrations();

        expect(database.sqlite.prepare(`
            SELECT xp, level, text_xp, voice_xp, manual_adjustment, level_floor
            FROM member_levels WHERE guild_id = 'guild1' AND user_id = 'user1'
        `).get()).toEqual({
            xp: 4321,
            level: 17,
            text_xp: 0,
            voice_xp: 0,
            manual_adjustment: 4321,
            level_floor: 17
        });
    });

    test('fresh storage exposes the approved level, analytics, and logging state', async () => {
        database = require('../src/database');
        await database.runMigrations();

        const tables = database.sqlite.prepare(`
            SELECT name FROM sqlite_master WHERE type = 'table'
        `).all().map(row => row.name);

        expect(tables).toEqual(expect.arrayContaining([
            'level_configs', 'level_role_rewards', 'level_ignores', 'level_boosts',
            'level_live_boards', 'level_rank_cards', 'server_daily_metrics',
            'analytics_events', 'reaction_placements', 'level_voice_sessions',
            'member_presence', 'event_log_channels', 'event_log_ignores',
            'event_log_outbox'
        ]));
    });

    test('guild purge removes level and analytics state without touching another guild', async () => {
        database = require('../src/database');
        await database.runMigrations();
        const LevelAnalyticsService = require('../src/services/levelAnalyticsService');
        const service = new LevelAnalyticsService({ sqlite: database.sqlite });
        database.sqlite.prepare("INSERT INTO member_levels (guild_id, user_id, updated_at) VALUES ('guild1', 'user1', 1), ('guild2', 'user2', 1)").run();
        database.sqlite.prepare("INSERT INTO analytics_events (guild_id, event_type, event_id, occurred_at) VALUES ('guild1', 'message', 'one', 1), ('guild2', 'message', 'two', 1)").run();

        service.purgeGuild('guild1');

        expect(database.sqlite.prepare("SELECT guild_id FROM member_levels").all()).toEqual([{ guild_id: 'guild2' }]);
        expect(database.sqlite.prepare("SELECT guild_id FROM analytics_events").all()).toEqual([{ guild_id: 'guild2' }]);
        service.cleanup();
    });
});
