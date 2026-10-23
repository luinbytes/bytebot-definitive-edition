const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const { getTableConfig } = require('drizzle-orm/sqlite-core');
const { activityAchievements, activityStreaks, activityLogs, customAchievements, achievementRoleConfig, achievementRoles } = require('../src/database/schema');

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
        select: jest.fn(async (_table, operation) => operation()),
        update: jest.fn(async (_table, operation) => operation()),
        delete: jest.fn(async (_table, operation) => operation())
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
describe('streak and achievement behavior with SQLite', () => {
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
        sqlite.exec(`CREATE TABLE activity_streaks (
            id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, guild_id TEXT NOT NULL,
            current_streak INTEGER NOT NULL DEFAULT 0, longest_streak INTEGER NOT NULL DEFAULT 0,
            last_activity_date TEXT, streak_covered_through TEXT, total_active_days INTEGER NOT NULL DEFAULT 0,
            freezes_available INTEGER NOT NULL DEFAULT 1, last_freeze_reset INTEGER,
            created_at INTEGER, updated_at INTEGER, UNIQUE (user_id, guild_id)
        );
        CREATE TABLE activity_logs (
            id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, guild_id TEXT NOT NULL, activity_date TEXT NOT NULL,
            message_count INTEGER NOT NULL DEFAULT 0, voice_minutes INTEGER NOT NULL DEFAULT 0,
            text_xp_awarded INTEGER NOT NULL DEFAULT 0, voice_seconds INTEGER NOT NULL DEFAULT 0,
            commands_run INTEGER NOT NULL DEFAULT 0, reactions_given INTEGER NOT NULL DEFAULT 0,
            channels_joined INTEGER NOT NULL DEFAULT 0, bytepods_created INTEGER NOT NULL DEFAULT 0,
            unique_commands_used TEXT, active_hours TEXT, first_activity_time INTEGER,
            last_activity_time INTEGER, updated_at INTEGER, UNIQUE (user_id, guild_id, activity_date)
        );
        CREATE TABLE achievement_role_config (
            guild_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, role_prefix TEXT NOT NULL DEFAULT '🏆',
            use_rarity_colors INTEGER NOT NULL DEFAULT 1, cleanup_orphaned INTEGER NOT NULL DEFAULT 1,
            notify_on_earn INTEGER NOT NULL DEFAULT 1, created_at INTEGER, updated_at INTEGER
        );
        CREATE TABLE achievement_roles (
            id INTEGER PRIMARY KEY, achievement_id TEXT NOT NULL, guild_id TEXT NOT NULL,
            role_id TEXT NOT NULL, created_at INTEGER, UNIQUE (achievement_id, guild_id)
        );
        CREATE TABLE custom_achievements (
            id INTEGER PRIMARY KEY, guild_id TEXT NOT NULL, achievement_id TEXT NOT NULL,
            title TEXT NOT NULL, description TEXT NOT NULL, emoji TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'custom',
            rarity TEXT NOT NULL, check_type TEXT NOT NULL, criteria TEXT, grant_role INTEGER NOT NULL DEFAULT 0,
            points INTEGER NOT NULL, created_by TEXT NOT NULL, created_at INTEGER, enabled INTEGER NOT NULL DEFAULT 1,
            UNIQUE (guild_id, achievement_id)
        )`);
        mockDb = drizzle(sqlite);
    });

    afterEach(() => {
        jest.useRealTimers();
        sqlite.close();
    });

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

    test('Last Active survives pruning the last retained activity log', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2022-10-21T12:00:00Z'));
        const service = createService(jest.fn());
        service.isAchievementsEnabled = jest.fn().mockResolvedValue(true);
        service.isUserOptedOut = jest.fn().mockResolvedValue(false);
        service.checkAndAwardAchievements = jest.fn();
        await service.recordActivity('user-1', 'guild-1', 'message');

        jest.setSystemTime(new Date('2026-10-23T12:00:00Z'));
        sqlite.prepare('DELETE FROM activity_logs WHERE activity_date < ?').run('2023-10-24');

        expect(await service.getUserStreak('user-1', 'guild-1')).toMatchObject({
            lastActivityDate: '2022-10-21', totalActiveDays: 1
        });
    });

    test.each([
        ['disabled', false, false],
        ['opted out', true, true]
    ])('%s activity persists Last Active and actual day counts without awards', async (_label, enabled, optedOut) => {
        jest.useFakeTimers().setSystemTime(new Date('2026-10-23T12:00:00Z'));
        const send = jest.fn();
        const service = createService(send);
        service.isAchievementsEnabled = jest.fn().mockResolvedValue(enabled);
        service.isUserOptedOut = jest.fn().mockResolvedValue(optedOut);
        await mockDb.insert(activityStreaks).values({
            userId: 'user-1', guildId: 'guild-1', currentStreak: 2, longestStreak: 2,
            totalActiveDays: 2, lastActivityDate: '2026-10-22'
        });

        await Promise.all([
            service.recordActivity('user-1', 'guild-1', 'message', 50),
            service.recordActivity('user-1', 'guild-1', 'message', 50)
        ]);

        expect((await service.getUserTotals('user-1', 'guild-1')).totalMessages).toBe(100);
        expect(await service.getUserStreak('user-1', 'guild-1')).toMatchObject({
            lastActivityDate: '2026-10-23', streakCoveredThrough: '2026-10-23',
            currentStreak: 3, longestStreak: 3, totalActiveDays: 3, freezesAvailable: 1
        });
        expect(await mockDb.select().from(activityAchievements)).toHaveLength(0);
        expect(service.achievementManager.getById).not.toHaveBeenCalled();
        expect(service.client.users.fetch).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
        expect(await mockDb.select().from(activityLogs)).toEqual([
            expect.objectContaining({ textXpAwarded: 0 })
        ]);

        sqlite.prepare('DELETE FROM activity_logs').run();
        expect(await service.getUserStreak('user-1', 'guild-1')).toMatchObject({
            lastActivityDate: '2026-10-23', totalActiveDays: 3
        });
    });

    test('freeze coverage never supplies an unknown actual activity date', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-10-23T12:00:00Z'));
        const service = createService(jest.fn());
        await mockDb.insert(activityStreaks).values({
            userId: 'user-1', guildId: 'guild-1', currentStreak: 7,
            streakCoveredThrough: '2026-10-21', freezesAvailable: 1
        });

        await service.processDailyStreaks();

        expect(await service.getUserStreak('user-1', 'guild-1')).toMatchObject({
            currentStreak: 7, lastActivityDate: null, streakCoveredThrough: '2026-10-22', freezesAvailable: 0
        });
    });

    test.each([
        ['2026-10-22', 8, 26, '2026-10-23'],
        ['2026-10-23', 7, 25, null],
        [null, 1, 26, '2026-10-23']
    ])('activity on legacy last active %s counts today once', async (lastActivityDate, currentStreak, totalActiveDays, streakCoveredThrough) => {
        jest.useFakeTimers().setSystemTime(new Date('2026-10-23T12:00:00Z'));
        const service = createService(jest.fn());
        service.isAchievementsEnabled = jest.fn().mockResolvedValue(true);
        service.isUserOptedOut = jest.fn().mockResolvedValue(false);
        service.checkAndAwardAchievements = jest.fn();
        await mockDb.insert(activityStreaks).values({
            userId: 'user-1', guildId: 'guild-1', currentStreak: 7, totalActiveDays: 25, lastActivityDate
        });

        await Promise.all([
            service.recordActivity('user-1', 'guild-1', 'message'),
            service.recordActivity('user-1', 'guild-1', 'message')
        ]);

        expect(await service.getUserStreak('user-1', 'guild-1')).toMatchObject({
            currentStreak, totalActiveDays, lastActivityDate: '2026-10-23', streakCoveredThrough
        });
    });

    test.each(['checkMissedDays', 'processDailyStreaks'])('%s protects a missed day exactly once without adding activity', async (sweep) => {
        jest.useFakeTimers().setSystemTime(new Date('2026-10-23T12:00:00Z'));
        const service = createService(jest.fn());
        service.isAchievementsEnabled = jest.fn().mockResolvedValue(true);
        service.isUserOptedOut = jest.fn().mockResolvedValue(false);
        service.processMissedAchievements = jest.fn();
        service.checkAndAwardAchievements = jest.fn();
        await mockDb.insert(activityStreaks).values({
            userId: 'user-1', guildId: 'guild-1', currentStreak: 7, longestStreak: 10,
            totalActiveDays: 25, lastActivityDate: '2026-10-21', freezesAvailable: 1
        });
        await mockDb.insert(activityLogs).values({
            userId: 'user-1', guildId: 'guild-1', activityDate: '2026-10-21', messageCount: 100
        });

        await Promise.all([service[sweep](), service[sweep]()]);
        await service[sweep]();

        expect(await service.getUserStreak('user-1', 'guild-1')).toMatchObject({
            currentStreak: 7, longestStreak: 10, totalActiveDays: 25,
            freezesAvailable: 0, lastActivityDate: '2026-10-21', streakCoveredThrough: '2026-10-22'
        });
        expect(await mockDb.select().from(activityLogs)).toHaveLength(1);
        await service.recordActivity('user-1', 'guild-1', 'message');
        await service.recordActivity('user-1', 'guild-1', 'message');
        expect(await service.getUserStreak('user-1', 'guild-1')).toMatchObject({
            currentStreak: 8, longestStreak: 10, totalActiveDays: 26,
            freezesAvailable: 0, lastActivityDate: '2026-10-23', streakCoveredThrough: '2026-10-23'
        });
        expect((await service.getUserTotals('user-1', 'guild-1')).totalMessages).toBe(102);
    });

    test.each(['checkMissedDays', 'processDailyStreaks'])('%s accounts for each missed day and survives concurrent/repeated sweeps', async (sweep) => {
        jest.useFakeTimers().setSystemTime(new Date('2026-10-25T12:00:00Z'));
        const service = createService(jest.fn());
        service.processMissedAchievements = jest.fn();
        service.checkAndAwardAchievements = jest.fn();
        service.isAchievementsEnabled = jest.fn().mockResolvedValue(true);
        service.isUserOptedOut = jest.fn().mockResolvedValue(false);
        await mockDb.insert(activityStreaks).values([
            { userId: 'covered', guildId: 'guild-1', currentStreak: 7, longestStreak: 10,
                totalActiveDays: 25, lastActivityDate: '2026-10-21', streakCoveredThrough: '2026-10-21', freezesAvailable: 4 },
            { userId: 'short', guildId: 'guild-1', currentStreak: 7, longestStreak: 10,
                totalActiveDays: 25, lastActivityDate: '2026-10-21', streakCoveredThrough: '2026-10-21', freezesAvailable: 2 }
        ]);
        await Promise.all([service[sweep](), service[sweep]()]);
        await service[sweep]();
        expect(await mockDb.select().from(activityStreaks)).toEqual(expect.arrayContaining([
            expect.objectContaining({ userId: 'covered', currentStreak: 7, freezesAvailable: 1, totalActiveDays: 25 }),
            expect.objectContaining({ userId: 'short', currentStreak: 0, freezesAvailable: 0, totalActiveDays: 25 })
        ]));
        expect(await mockDb.select().from(activityLogs)).toHaveLength(0);

        jest.setSystemTime(new Date('2026-10-26T12:00:00Z'));
        await service[sweep]();
        await service[sweep]();
        await service.recordActivity('covered', 'guild-1', 'message');
        await service.recordActivity('short', 'guild-1', 'message');
        expect(await mockDb.select().from(activityStreaks)).toEqual(expect.arrayContaining([
            expect.objectContaining({ userId: 'covered', currentStreak: 8, freezesAvailable: 0, totalActiveDays: 26, longestStreak: 10 }),
            expect.objectContaining({ userId: 'short', currentStreak: 1, freezesAvailable: 0, totalActiveDays: 26, longestStreak: 10 })
        ]));
    });

    test.each([false, true, undefined].flatMap(notifyOnEarn =>
        ['checkAndAwardAchievements', 'checkAllAchievements'].map(method => [notifyOnEarn, method])
    ))('automatic notifyOnEarn=%s via %s retains the award and role', async (notifyOnEarn, method) => {
        const send = jest.fn().mockResolvedValue(undefined);
        const service = createService(send);
        service.isAchievementsEnabled = jest.fn().mockResolvedValue(true);
        service.isUserOptedOut = jest.fn().mockResolvedValue(false);
        service.achievementManager.getById.mockResolvedValue({
            id: 'sqlite-atomic', title: 'SQLite Atomic', description: 'Award', emoji: '🏆',
            points: 10, seasonal: false, grantRole: true
        });
        service.grantAchievementRole = jest.fn();
        service.getUserTotals = jest.fn().mockResolvedValue({});
        service.checkStreakAchievements = jest.fn(async (_u, _g, _s, toAward) => toAward.push('sqlite-atomic'));
        for (const check of ['checkTotalDaysAchievements', 'checkCumulativeAchievements', 'checkComboAchievements', 'checkMetaAchievements']) {
            service[check] = jest.fn();
        }
        if (notifyOnEarn !== undefined) await mockDb.insert(achievementRoleConfig).values({ guildId: 'guild-1', notifyOnEarn });

        await mockDb.insert(activityStreaks).values({ userId: 'user-1', guildId: 'guild-1', currentStreak: 7, totalActiveDays: 25 });
        await service[method]('user-1', 'guild-1', 7, 25);

        expect(await mockDb.select().from(activityAchievements)).toHaveLength(1);
        expect(service.grantAchievementRole).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledTimes(notifyOnEarn === false ? 0 : 1);
        expect(service.client.users.fetch).toHaveBeenCalledTimes(notifyOnEarn === false ? 0 : 1);
    });

    function customInteraction(subcommand, achievementId = 'custom-local', guildId = 'guild-1') {
        return {
            guild: { id: guildId, name: 'Test Guild' }, user: { id: 'admin-1', tag: 'Admin' },
            options: {
                getSubcommand: () => subcommand,
                getUser: () => ({ id: 'user-1', username: 'Member', tag: 'Member' }),
                getString: () => achievementId,
                getFocused: () => ({ name: 'achievement', value: 'custom' })
            },
            deferReply: jest.fn(), editReply: jest.fn(), respond: jest.fn()
        };
    }

    async function customService() {
        const { fetchMember, RoleManager } = require('../src/utils/discordApiUtil');
        const role = { id: 'role-1' };
        const guild = {
            id: 'guild-1', name: 'Test Guild',
            roles: { cache: new Map([['role-1', role]]), fetch: jest.fn().mockResolvedValue(role) },
            members: { me: { permissions: { has: jest.fn().mockReturnValue(true) } } }
        };
        fetchMember.mockResolvedValue({ user: { tag: 'Member' } });
        RoleManager.addRole.mockReset().mockResolvedValue({ success: true });
        RoleManager.removeRole.mockReset().mockResolvedValue({ success: true });
        const client = {
            users: { fetch: jest.fn().mockResolvedValue({ send: jest.fn().mockResolvedValue(undefined) }) },
            guilds: { fetch: jest.fn().mockResolvedValue(guild) }
        };
        const service = new ActivityStreakService(client);
        client.activityStreakService = service;
        service.achievementManager.lastLoad = Date.now();
        await mockDb.insert(customAchievements).values([
            { guildId: 'guild-1', achievementId: 'custom-local', title: 'Custom Local', description: 'Local award',
                emoji: '🏆', rarity: 'rare', checkType: 'manual', points: 42, createdBy: 'admin-1', grantRole: true },
            { guildId: 'guild-2', achievementId: 'custom-foreign', title: 'Custom Foreign', description: 'Foreign award',
                emoji: '🏆', rarity: 'rare', checkType: 'manual', points: 50, createdBy: 'admin-2' },
            { guildId: 'guild-1', achievementId: 'custom-disabled', title: 'Custom Disabled', description: 'Disabled award',
                emoji: '🏆', rarity: 'rare', checkType: 'manual', points: 50, createdBy: 'admin-1', enabled: false }
        ]);
        await mockDb.insert(achievementRoles).values({ guildId: 'guild-1', achievementId: 'custom-local', roleId: 'role-1' });
        return { service, client, guild };
    }

    test('custom autocomplete selections can be manually awarded and removed with role rewards', async () => {
        const command = require('../src/commands/administration/achievement');
        const { RoleManager } = require('../src/utils/discordApiUtil');
        const { service, client } = await customService();
        const interaction = customInteraction('award');
        await command.autocomplete(interaction, client);
        expect(interaction.respond).toHaveBeenCalledWith([
            expect.objectContaining({ value: 'custom-local' })
        ]);
        await command.execute(interaction, client);
        expect(await service.hasAchievement('user-1', 'guild-1', 'custom-local')).toBe(true);
        expect(await mockDb.select().from(activityAchievements)).toEqual([
            expect.objectContaining({ achievementId: 'custom-local', points: 42, awardedBy: 'admin-1' })
        ]);
        expect(RoleManager.addRole).toHaveBeenCalledTimes(1);
        const removal = customInteraction('remove');
        await command.autocomplete(removal, client);
        expect(removal.respond).toHaveBeenCalledWith([expect.objectContaining({ value: 'custom-local' })]);
        await command.execute(removal, client);
        expect(await service.hasAchievement('user-1', 'guild-1', 'custom-local')).toBe(false);
        expect(RoleManager.removeRole).toHaveBeenCalledTimes(1);
    });

    test('custom commands and direct service calls reject foreign and disabled IDs', async () => {
        const command = require('../src/commands/administration/achievement');
        const { service, client } = await customService();
        await mockDb.insert(activityAchievements).values({ userId: 'user-1', guildId: 'guild-2', achievementId: 'custom-foreign' });
        for (const id of ['custom-foreign', 'custom-disabled']) {
            await command.execute(customInteraction('award', id), client);
            await command.execute(customInteraction('remove', id), client);
            await service.awardAchievement('user-1', 'guild-1', id, 'admin-1');
            await service.removeAchievement('user-1', 'guild-1', id);
        }
        expect(await mockDb.select().from(activityAchievements)).toEqual([
            expect.objectContaining({ guildId: 'guild-2', achievementId: 'custom-foreign' })
        ]);
        expect(client.users.fetch).not.toHaveBeenCalled();
    });

    test('totals aggregate retained history without materializing daily rows and stay fresh', async () => {
        const insert = sqlite.prepare(`INSERT INTO activity_logs
            (user_id, guild_id, activity_date, message_count, voice_minutes, commands_run,
            reactions_given, channels_joined, bytepods_created, unique_commands_used)
            VALUES (?, ?, ?, 1, 2, 3, 4, 5, 6, ?)`);
        sqlite.transaction(() => {
            for (let day = 0; day < 1095; day++) {
                const date = new Date(Date.UTC(2023, 0, day + 1)).toISOString().slice(0, 10);
                insert.run('user-1', 'guild-1', date, day % 3 === 0 ? '["help","ping"]' : day % 3 === 1 ? 'invalid' : '{"not":"array"}');
            }
            insert.run('user-1', 'guild-2', '2023-01-01', '["foreign"]');
            insert.run('user-2', 'guild-1', '2023-01-01', '["other-user"]');
        })();
        const service = createService(jest.fn());
        const { dbLog } = require('../src/utils/dbLogger');
        let materializedRows = 0;
        dbLog.select.mockImplementationOnce(async (_table, operation) => {
            const result = await operation();
            materializedRows += Array.isArray(result) ? result.length : 1;
            return result;
        });

        const totals = await service.getUserTotals('user-1', 'guild-1');
        expect(totals).toMatchObject({
            totalMessages: 1095, totalVoiceMinutes: 2190, totalCommands: 3285,
            totalReactions: 4380, totalChannelsJoined: 5475, totalBytepods: 6570,
            uniqueCommandCount: 2
        });
        expect(totals.uniqueCommands).toEqual(new Set(['help', 'ping']));
        expect(materializedRows).toBe(1);
        sqlite.prepare("UPDATE activity_logs SET message_count = 9 WHERE user_id = 'user-1' AND guild_id = 'guild-1' AND activity_date = '2023-01-01'").run();
        expect((await service.getUserTotals('user-1', 'guild-1')).totalMessages).toBe(1103);
        sqlite.prepare("DELETE FROM activity_logs WHERE user_id = 'user-1' AND guild_id = 'guild-1' AND activity_date = '2023-01-02'").run();
        expect((await service.getUserTotals('user-1', 'guild-1')).totalMessages).toBe(1102);
        expect(await service.getUserTotals('empty', 'guild-1')).toMatchObject({
            totalMessages: 0, totalVoiceMinutes: 0, totalCommands: 0, totalReactions: 0,
            totalChannelsJoined: 0, totalBytepods: 0, uniqueCommandCount: 0
        });
    });

    test('same-day committed messages cross a cumulative milestone once with retained history', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-10-23T12:00:00Z'));
        const send = jest.fn().mockResolvedValue(undefined);
        const service = new ActivityStreakService({
            users: { fetch: jest.fn().mockResolvedValue({ send }) },
            guilds: { fetch: jest.fn().mockResolvedValue({ name: 'Test Guild' }) }
        });
        service.isAchievementsEnabled = jest.fn().mockResolvedValue(true);
        service.isUserOptedOut = jest.fn().mockResolvedValue(false);
        service.achievementManager.lastLoad = Date.now();
        service.achievementManager.achievements.set('message_1000', {
            id: 'message_1000', title: '1000 messages', description: 'Message milestone',
            emoji: '🏆', points: 10, seasonal: false, grantRole: false
        });
        const insert = sqlite.prepare(`INSERT INTO activity_logs
            (user_id, guild_id, activity_date, message_count) VALUES ('user-1', 'guild-1', ?, ?)`);
        sqlite.transaction(() => {
            for (let day = 0; day < 1095; day++) {
                insert.run(new Date(Date.UTC(2023, 0, day + 1)).toISOString().slice(0, 10), day < 994 ? 1 : 0);
            }
            insert.run('2026-10-23', 1);
        })();
        await mockDb.insert(activityStreaks).values({
            userId: 'user-1', guildId: 'guild-1', currentStreak: 1, totalActiveDays: 2,
            lastActivityDate: '2026-10-23', streakCoveredThrough: '2026-10-23'
        });
        const { dbLog } = require('../src/utils/dbLogger');
        const previousSelect = dbLog.select.getMockImplementation();
        let materializedRows = 0;
        dbLog.select.mockImplementation(async (table, operation) => {
            const result = await operation();
            if (table === 'activityLogs') materializedRows += Array.isArray(result) ? result.length : 1;
            return result;
        });
        try {
            for (let message = 1; message <= 6; message++) {
                sqlite.prepare("UPDATE activity_logs SET message_count = message_count + 1 WHERE activity_date = '2026-10-23'").run();
                await service.recordCommittedActivity('user-1', 'guild-1');
                expect(await service.hasAchievement('user-1', 'guild-1', 'message_1000')).toBe(message >= 5);
            }
        } finally {
            dbLog.select.mockImplementation(previousSelect);
        }
        expect(materializedRows).toBe(6);
        expect(send).toHaveBeenCalledTimes(1);
        expect((await service.getUserTotals('user-1', 'guild-1')).totalMessages).toBe(1001);
        expect(await mockDb.select().from(activityStreaks)).toEqual([
            expect.objectContaining({ currentStreak: 1, totalActiveDays: 2 })
        ]);
    });

    test('custom awards retain role configuration and permission checks', async () => {
        const { RoleManager } = require('../src/utils/discordApiUtil');
        const { service, guild } = await customService();
        await mockDb.insert(achievementRoleConfig).values({ guildId: 'guild-1', enabled: false });
        await service.awardAchievement('user-1', 'guild-1', 'custom-local', 'admin-1');
        await service.removeAchievement('user-1', 'guild-1', 'custom-local');
        expect(RoleManager.addRole).not.toHaveBeenCalled();
        expect(RoleManager.removeRole).not.toHaveBeenCalled();
        await mockDb.update(achievementRoleConfig).set({ enabled: true });
        guild.members.me.permissions.has.mockReturnValue(false);
        await service.awardAchievement('user-1', 'guild-1', 'custom-local', 'admin-1');
        expect(RoleManager.addRole).not.toHaveBeenCalled();
        expect(await service.hasAchievement('user-1', 'guild-1', 'custom-local')).toBe(true);
    });

    test.each(['activity', 'sweep'])('%s overlapping a daily freeze keeps the protected streak', async first => {
        jest.useFakeTimers().setSystemTime(new Date('2026-10-23T12:00:00Z'));
        const service = createService(jest.fn());
        service.isAchievementsEnabled = jest.fn().mockResolvedValue(true);
        service.isUserOptedOut = jest.fn().mockResolvedValue(false);
        service.checkAndAwardAchievements = jest.fn();
        await mockDb.insert(activityStreaks).values({
            userId: 'user-1', guildId: 'guild-1', currentStreak: 7, totalActiveDays: 25,
            lastActivityDate: '2026-10-21', freezesAvailable: 1
        });
        const { dbLog } = require('../src/utils/dbLogger');
        const previousSelect = dbLog.select.getMockImplementation();
        let overlap = true;
        dbLog.select.mockImplementation(async (table, operation) => {
            const result = await operation();
            if (table === 'activityStreaks' && Array.isArray(result) === (first === 'sweep') && overlap) {
                overlap = false;
                if (first === 'activity') {
                    await service.processDailyStreaks();
                } else {
                    await service.recordActivity('user-1', 'guild-1', 'message');
                }
            }
            return result;
        });
        try {
            if (first === 'activity') {
                await service.recordActivity('user-1', 'guild-1', 'message');
            } else {
                await service.processDailyStreaks();
            }
        } finally {
            dbLog.select.mockImplementation(previousSelect);
        }
        expect(await mockDb.select().from(activityStreaks)).toEqual([
            expect.objectContaining({
                currentStreak: 8, totalActiveDays: 26, freezesAvailable: 0,
                lastActivityDate: '2026-10-23', streakCoveredThrough: '2026-10-23'
            })
        ]);
    });

    test.each([[0, 1], [1, 8]])('activity before a sweep uses %i available freezes and yields streak %i', async (freezesAvailable, currentStreak) => {
        jest.useFakeTimers().setSystemTime(new Date('2026-10-23T12:00:00Z'));
        const service = createService(jest.fn());
        service.isAchievementsEnabled = jest.fn().mockResolvedValue(true);
        service.isUserOptedOut = jest.fn().mockResolvedValue(false);
        service.checkAndAwardAchievements = jest.fn();
        await mockDb.insert(activityStreaks).values({
            userId: 'user-1', guildId: 'guild-1', currentStreak: 7, longestStreak: 10, totalActiveDays: 25,
            lastActivityDate: '2026-10-21', freezesAvailable
        });
        await Promise.all([
            service.recordActivity('user-1', 'guild-1', 'message'),
            service.recordActivity('user-1', 'guild-1', 'message')
        ]);
        expect(await service.getUserStreak('user-1', 'guild-1')).toMatchObject({
            currentStreak, longestStreak: 10, totalActiveDays: 26, freezesAvailable: 0,
            lastActivityDate: '2026-10-23', streakCoveredThrough: '2026-10-23'
        });
        expect((await service.getUserTotals('user-1', 'guild-1')).totalMessages).toBe(2);
    });
});
