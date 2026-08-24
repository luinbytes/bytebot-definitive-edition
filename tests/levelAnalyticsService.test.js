const fs = require('fs');
const os = require('os');
const path = require('path');

describe('LevelAnalyticsService', () => {
    let tempDir;
    let database;
    let service;
    let now;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-level-service-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        const LevelAnalyticsService = require('../src/services/levelAnalyticsService');
        now = Date.UTC(2026, 7, 24, 12);
        service = new LevelAnalyticsService({
            sqlite: database.sqlite,
            now: () => now
        });
    });

    afterEach(() => {
        database?.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('a message is counted and awarded once even when Discord replays the event', () => {
        const message = {
            id: 'message1',
            content: 'hello there',
            webhookId: null,
            guild: { id: 'guild1' },
            channelId: 'channel1',
            author: { id: 'user1', bot: false },
            member: { roles: { cache: new Map() } }
        };

        expect(service.recordMessage(message)).toEqual(expect.objectContaining({
            accepted: true,
            duplicate: false,
            xpAwarded: 20,
            level: 0
        }));
        expect(service.recordMessage(message)).toEqual(expect.objectContaining({
            accepted: false,
            duplicate: true,
            xpAwarded: 0
        }));
        expect(database.sqlite.prepare(`
            SELECT xp, level, text_xp, message_count FROM member_levels
            WHERE guild_id = 'guild1' AND user_id = 'user1'
        `).get()).toEqual({ xp: 20, level: 0, text_xp: 20, message_count: 1 });
        expect(database.sqlite.prepare(`
            SELECT message_count FROM activity_logs
            WHERE guild_id = 'guild1' AND user_id = 'user1'
        `).get().message_count).toBe(1);
        expect(database.sqlite.prepare(`
            SELECT message_count FROM server_daily_metrics WHERE guild_id = 'guild1'
        `).get().message_count).toBe(1);
    });

    test('text XP stops at the fixed daily cap while analytics keeps counting', () => {
        database.sqlite.prepare(`
            INSERT INTO level_configs (guild_id, base_multiplier, updated_at)
            VALUES ('guild1', 10, 1)
        `).run();
        let result;
        for (let index = 0; index < 101; index += 1) {
            result = service.recordMessage({
                id: `message${index}`,
                content: 'eligible',
                webhookId: null,
                guild: { id: 'guild1' },
                channelId: 'channel1',
                author: { id: 'user1', bot: false },
                member: { roles: { cache: new Map() } }
            });
            now += 61_000;
        }

        expect(result.xpAwarded).toBe(0);
        expect(database.sqlite.prepare(`
            SELECT xp FROM member_levels WHERE guild_id = 'guild1' AND user_id = 'user1'
        `).get().xp).toBe(20_000);
        expect(database.sqlite.prepare(`
            SELECT message_count FROM server_daily_metrics WHERE guild_id = 'guild1'
        `).get().message_count).toBe(101);
    });
});
