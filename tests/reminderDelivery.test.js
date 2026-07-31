const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const { reminders } = require('../src/database/schema');

let mockDb;
const mockDbProxy = {
    insert: (...args) => mockDb.insert(...args),
    select: (...args) => mockDb.select(...args),
    update: (...args) => mockDb.update(...args),
    delete: (...args) => mockDb.delete(...args)
};

jest.mock('../src/database', () => ({ db: mockDbProxy }));
jest.mock('../src/utils/logger', () => ({
    debug: jest.fn(), info: jest.fn(), success: jest.fn(), warn: jest.fn(),
    error: jest.fn(), errorContext: jest.fn()
}));
jest.mock('../src/utils/discordApiUtil', () => ({
    fetchMember: jest.fn(),
    fetchChannel: jest.fn(),
    safeDMUser: jest.fn().mockResolvedValue(false)
}));

const ReminderService = require('../src/services/reminderService');

describe('reminder delivery', () => {
    let sqlite;
    let service;

    beforeEach(() => {
        sqlite = new Database(':memory:');
        sqlite.exec(`CREATE TABLE reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            guild_id TEXT,
            channel_id TEXT,
            message TEXT NOT NULL,
            trigger_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            active INTEGER DEFAULT 1 NOT NULL
        )`);
        sqlite.prepare(`
            INSERT INTO reminders
                (user_id, message, trigger_at, created_at, active)
            VALUES (?, ?, ?, ?, 1)
        `).run('user-1', 'Do the thing', Date.now(), Date.now() - 60000);
        mockDb = drizzle(sqlite);
        service = new ReminderService({
            users: { fetch: jest.fn().mockResolvedValue({ id: 'user-1' }) },
            guilds: { fetch: jest.fn() }
        });
    });

    afterEach(() => {
        service.cleanup();
        sqlite.close();
    });

    test('keeps a failed delivery active for retry', async () => {
        await service.fireReminder(1);

        const [reminder] = await mockDb.select().from(reminders);
        expect(reminder.active).toBe(true);
        expect(reminder.triggerAt.getTime()).toBeGreaterThan(Date.now());
    });
});
