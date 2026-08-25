const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const { activityLogs } = require('../src/database/schema');

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
    RoleManager: { addRole: jest.fn(), removeRole: jest.fn() }
}));

const ActivityStreakService = require('../src/services/activityStreakService');

describe('activity accounting', () => {
    let sqlite;
    let service;

    beforeEach(() => {
        sqlite = new Database(':memory:');
        sqlite.exec(`CREATE TABLE activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            guild_id TEXT NOT NULL,
            activity_date TEXT NOT NULL,
            message_count INTEGER DEFAULT 0 NOT NULL,
            voice_minutes INTEGER DEFAULT 0 NOT NULL,
            text_xp_awarded INTEGER DEFAULT 0 NOT NULL,
            voice_seconds INTEGER DEFAULT 0 NOT NULL,
            commands_run INTEGER DEFAULT 0 NOT NULL,
            reactions_given INTEGER DEFAULT 0 NOT NULL,
            channels_joined INTEGER DEFAULT 0 NOT NULL,
            bytepods_created INTEGER DEFAULT 0 NOT NULL,
            unique_commands_used TEXT,
            active_hours TEXT,
            first_activity_time INTEGER,
            last_activity_time INTEGER,
            updated_at INTEGER,
            UNIQUE (user_id, guild_id, activity_date)
        )`);
        mockDb = drizzle(sqlite);
        service = new ActivityStreakService({});
        service.updateStreak = jest.fn();
    });

    afterEach(() => sqlite.close());

    test('concurrent messages are counted without losing an update', async () => {
        await Promise.all([
            service.recordActivity('user-1', 'guild-1', 'message'),
            service.recordActivity('user-1', 'guild-1', 'message')
        ]);

        const [log] = await mockDb.select().from(activityLogs);
        expect(log.messageCount).toBe(2);
    });

    test.each([
        ['reactions', 'recordReaction', 'reactionsGiven'],
        ['voice-channel joins', 'recordChannelJoin', 'channelsJoined'],
        ['BytePod creations', 'recordBytepodCreation', 'bytepodsCreated']
    ])('concurrent %s are counted without losing an update', async (_label, method, field) => {
        await Promise.all([
            service[method]('user-1', 'guild-1'),
            service[method]('user-1', 'guild-1')
        ]);

        const [log] = await mockDb.select().from(activityLogs);
        expect(log[field]).toBe(2);
    });

    test('recording a command name does not count the command twice', async () => {
        await service.recordActivity('user-1', 'guild-1', 'command');
        await service.recordCommandUsage('user-1', 'guild-1', 'help');

        const [log] = await mockDb.select().from(activityLogs);
        expect(log.commandsRun).toBe(1);
        expect(JSON.parse(log.uniqueCommandsUsed)).toEqual(['help']);
    });

    test('concurrent command names are both preserved', async () => {
        await service.recordActivity('user-1', 'guild-1', 'command');

        await Promise.all([
            service.recordCommandUsage('user-1', 'guild-1', 'help'),
            service.recordCommandUsage('user-1', 'guild-1', 'ping')
        ]);

        const [log] = await mockDb.select().from(activityLogs);
        expect(JSON.parse(log.uniqueCommandsUsed).sort()).toEqual(['help', 'ping']);
    });

    test('concurrent active hours are both preserved', async () => {
        await Promise.all([
            service.recordActiveHour('user-1', 'guild-1', 8),
            service.recordActiveHour('user-1', 'guild-1', 9)
        ]);

        const [log] = await mockDb.select().from(activityLogs);
        expect(JSON.parse(log.activeHours).sort()).toEqual([8, 9]);
    });
});
