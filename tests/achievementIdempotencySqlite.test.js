const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const { getTableConfig } = require('drizzle-orm/sqlite-core');
const { activityAchievements } = require('../src/database/schema');

let mockDb;
const mockDbProxy = {
    insert: (...args) => mockDb.insert(...args),
    select: (...args) => mockDb.select(...args),
    update: (...args) => mockDb.update(...args),
    delete: (...args) => mockDb.delete(...args)
};
jest.mock('../src/database', () => ({ db: mockDbProxy }));
jest.mock('../src/utils/dbLogger', () => ({
    dbLog: {
        insert: jest.fn(async (_table, operation) => operation()),
        select: jest.fn(async (_table, operation) => operation())
    }
}));
jest.mock('../src/utils/discordApiUtil', () => ({
    fetchMember: jest.fn(),
    RoleManager: { addRole: jest.fn(), removeRole: jest.fn() }
}));
jest.mock('../src/utils/logger', () => ({
    info: jest.fn(), success: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));

const ActivityStreakService = require('../src/services/activityStreakService');

function createService(send) {
    const service = new ActivityStreakService({
        users: { fetch: jest.fn().mockResolvedValue({ send }) },
        guilds: { fetch: jest.fn().mockResolvedValue({ name: 'Test Guild' }) }
    });
    service.hasAchievement = jest.fn().mockResolvedValue(false);
    service.achievementManager = {
        getById: jest.fn().mockResolvedValue({
            id: 'sqlite-atomic', title: 'SQLite Atomic', description: 'Real database uniqueness',
            emoji: '🏆', points: 10, seasonal: false, grantRole: false
        }),
        canAward: jest.fn().mockResolvedValue(true)
    };
    return service;
}

// The repository exposes production startup migrations, but no lightweight migration fixture
// that targets an isolated in-memory SQLite database. This test therefore mirrors the DDL
// needed by the award path and locks that mirror to the exported Drizzle table definition below.
describe('achievement idempotency with SQLite', () => {
    test('keeps the in-memory DDL aligned with the activityAchievements schema contract', () => {
        const config = getTableConfig(activityAchievements);

        expect(config.name).toBe('activity_achievements');
        expect(config.columns.map(column => column.name)).toEqual([
            'id', 'user_id', 'guild_id', 'achievement_id', 'notified', 'points', 'awarded_by', 'earned_at'
        ]);
        expect(config.uniqueConstraints.map(constraint => constraint.columns.map(column => column.name))).toContainEqual([
            'user_id', 'guild_id', 'achievement_id'
        ]);
    });

    let sqlite;

    beforeEach(() => {
        sqlite = new Database(':memory:');
        sqlite.exec(`CREATE TABLE activity_achievements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            guild_id TEXT NOT NULL,
            achievement_id TEXT NOT NULL,
            notified INTEGER NOT NULL DEFAULT 0,
            points INTEGER NOT NULL DEFAULT 0,
            awarded_by TEXT,
            earned_at INTEGER,
            UNIQUE (user_id, guild_id, achievement_id)
        )`);
        mockDb = drizzle(sqlite);
    });

    afterEach(() => sqlite.close());

    test('concurrent award attempts persist one durable row and send one notification', async () => {
        const send = jest.fn().mockResolvedValue(undefined);
        const service = createService(send);

        await Promise.all([
            service.awardAchievement('user-1', 'guild-1', 'sqlite-atomic', 'admin-1'),
            service.awardAchievement('user-1', 'guild-1', 'sqlite-atomic', 'admin-1')
        ]);

        const rows = await mockDb.select().from(activityAchievements);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ userId: 'user-1', guildId: 'guild-1', achievementId: 'sqlite-atomic' });
        expect(send).toHaveBeenCalledTimes(1);
    });
});
