const fs = require('fs');
const os = require('os');
const path = require('path');

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
});
