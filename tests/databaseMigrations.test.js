const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { readMigrationFiles } = require('drizzle-orm/migrator');

describe('database migrations', () => {
    let tempDir;
    let database;

    beforeEach(() => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-migrations-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
    });

    afterEach(() => {
        database?.sqlite.close();
        database = null;
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('a fresh database preserves migration constraints', async () => {
        database = require('../src/database');

        await database.runMigrations();

        const achievementIndexes = database.sqlite
            .prepare("PRAGMA index_list('activity_achievements')")
            .all();
        const settingsPrimaryKey = database.sqlite
            .prepare("PRAGMA table_info('bytepod_user_settings')")
            .all()
            .filter(column => column.pk > 0)
            .sort((left, right) => left.pk - right.pk)
            .map(column => column.name);

        expect(achievementIndexes.some(index => index.unique === 1)).toBe(true);
        expect(settingsPrimaryKey).toEqual(['user_id', 'guild_id']);
    });

    test('an existing database gains indexed guild-scoped UwU Lock state without data loss', async () => {
        const seed = new Database(process.env.DATABASE_URL);
        seed.exec(`
            CREATE TABLE legacy_sentinel (value TEXT NOT NULL);
            CREATE TABLE __drizzle_migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                hash TEXT NOT NULL,
                created_at NUMERIC
            );
        `);
        seed.prepare('INSERT INTO legacy_sentinel (value) VALUES (?)').run('keep me');
        const appliedMigration = seed.prepare(
            'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)'
        );
        const migrations = readMigrationFiles({ migrationsFolder: './drizzle' });
        migrations.slice(0, -1).forEach(migration => {
            appliedMigration.run(migration.hash, migration.folderMillis);
        });
        seed.close();

        database = require('../src/database');
        await database.runMigrations();

        const indexes = database.sqlite.prepare("PRAGMA index_list('uwu_lock_members')").all();
        database.sqlite.prepare(
            "INSERT INTO uwu_lock_members (guild_id, user_id, state) VALUES ('guild1', 'user1', 'target')"
        ).run();

        expect(database.sqlite.prepare('SELECT value FROM legacy_sentinel').get().value).toBe('keep me');
        expect(indexes.some(index => index.unique === 1)).toBe(true);
        expect(indexes.some(index => index.name === 'uwu_lock_members_guild_state_idx')).toBe(true);
        expect(() => database.sqlite.prepare(
            "INSERT INTO uwu_lock_members (guild_id, user_id, state) VALUES ('guild1', 'user1', 'protected')"
        ).run()).toThrow();
        expect(() => database.sqlite.prepare(
            "INSERT INTO uwu_lock_members (guild_id, user_id, state) VALUES ('guild2', 'user1', 'target')"
        ).run()).not.toThrow();
    });
});
