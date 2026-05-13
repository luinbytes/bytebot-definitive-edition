jest.mock('../src/database', () => ({ db: {} }));
jest.mock('../src/database/schema', () => ({
    activityStreaks: {},
    activityAchievements: {},
    activityLogs: {},
    achievementDefinitions: {},
    customAchievements: {},
    achievementRoleConfig: {},
    achievementRoles: {},
    guilds: {},
    users: {}
}));
jest.mock('drizzle-orm', () => ({
    eq: () => ({}),
    and: () => ({}),
    desc: () => ({})
}));
jest.mock('../src/utils/dbUtil', () => ({ getOne: jest.fn() }));
jest.mock('../src/utils/dbLogger', () => ({
    dbLog: {
        select: jest.fn(async () => null),
        insert: jest.fn(async () => undefined),
        update: jest.fn(async () => undefined),
        delete: jest.fn(async () => undefined),
        operation: jest.fn(async () => undefined)
    }
}));
jest.mock('../src/utils/discordApiUtil', () => ({
    fetchMember: jest.fn(async () => null),
    RoleManager: { addRole: jest.fn(), removeRole: jest.fn() }
}));
jest.mock('../src/utils/logger', () => ({
    info: jest.fn(),
    success: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    errorContext: jest.fn()
}));

const ActivityStreakService = require('../src/services/activityStreakService');
const { dbLog } = require('../src/utils/dbLogger');

function fakeAchievement(id, overrides = {}) {
    return {
        id,
        title: `Title ${id}`,
        description: `Desc ${id}`,
        emoji: '🎯',
        points: 10,
        rarity: 'common',
        category: 'message',
        grantRole: false,
        seasonal: false,
        ...overrides
    };
}

function buildService({ achievements, isEnabled = true, canAward = true } = {}) {
    const sendMock = jest.fn().mockResolvedValue(undefined);
    const userFetch = jest.fn().mockResolvedValue({ send: sendMock });
    const guildFetch = jest.fn().mockResolvedValue({ name: 'Test Guild' });

    const mockClient = {
        users: { fetch: userFetch },
        guilds: { fetch: guildFetch }
    };

    const service = new ActivityStreakService(mockClient);

    service.isAchievementsEnabled = jest.fn().mockResolvedValue(isEnabled);
    service.hasAchievement = jest.fn().mockResolvedValue(false);
    service.grantAchievementRole = jest.fn().mockResolvedValue(undefined);

    service.achievementManager = {
        getById: jest.fn(async (id) => achievements?.[id] ?? null),
        canAward: jest.fn(async () => canAward)
    };

    return { service, mockClient, sendMock, userFetch, guildFetch };
}

beforeEach(() => {
    jest.clearAllMocks();
});

afterEach(() => {
    // ActivityStreakService can install a daily-check interval; we never start
    // it, but null it just in case future test changes do.
});

describe('Achievement DM batching', () => {
    test('cascade of multiple awards produces a single combined DM', async () => {
        const defs = {
            msg_1000: fakeAchievement('msg_1000', { emoji: '💬', title: 'Chatterbox' }),
            combo_balanced: fakeAchievement('combo_balanced', { emoji: '⚖️', title: 'Balanced User' }),
            meta_master: fakeAchievement('meta_master', { emoji: '👑', title: 'Achievement Master' })
        };
        const { service, sendMock } = buildService({ achievements: defs });

        const ids = ['msg_1000', 'combo_balanced', 'meta_master'];
        const awarded = [];
        for (const id of ids) {
            const def = await service._awardAchievementWithoutNotify('u1', 'g1', id);
            if (def) awarded.push(def);
        }
        await service.notifyAchievementsBatch('u1', 'g1', awarded);

        expect(awarded).toHaveLength(3);
        expect(dbLog.insert).toHaveBeenCalledTimes(3);
        expect(sendMock).toHaveBeenCalledTimes(1);

        const [{ embeds: sentEmbeds }] = sendMock.mock.calls[0];
        expect(sentEmbeds).toHaveLength(1);
        const embedJson = sentEmbeds[0].toJSON();
        expect(embedJson.title).toBe('✅ 🏆 Achievements Unlocked! (×3)');
        expect(embedJson.description).toContain('Chatterbox');
        expect(embedJson.description).toContain('Balanced User');
        expect(embedJson.description).toContain('Achievement Master');
        expect(embedJson.description).toContain('Earned in: **Test Guild**');
    });

    test('manual single award via awardAchievement renders the legacy single-DM embed', async () => {
        const def = fakeAchievement('msg_1000', { emoji: '💬', title: 'Chatterbox' });
        const { service, sendMock } = buildService({ achievements: { msg_1000: def } });

        await service.awardAchievement('u1', 'g1', 'msg_1000', 'admin-id');

        expect(sendMock).toHaveBeenCalledTimes(1);
        const embedJson = sendMock.mock.calls[0][0].embeds[0].toJSON();
        expect(embedJson.title).toBe('✅ 💬 Achievement Unlocked!');
        expect(embedJson.description).toContain('**Chatterbox**');
        // Underscores are escaped by discord.js escapeMarkdown to prevent injection.
        expect(embedJson.description).toContain('Desc msg\\_1000');
        expect(embedJson.description).toContain('Earned in: **Test Guild**');
        expect(embedJson.description).not.toMatch(/Achievements Unlocked! \(×/);
    });

    test('single-id notifyAchievementsBatch matches the legacy single-DM embed', async () => {
        const def = fakeAchievement('only_one');
        const { service, sendMock } = buildService({ achievements: { only_one: def } });

        await service.notifyAchievementsBatch('u1', 'g1', ['only_one']);

        expect(sendMock).toHaveBeenCalledTimes(1);
        const embedJson = sendMock.mock.calls[0][0].embeds[0].toJSON();
        expect(embedJson.title).toBe('✅ 🎯 Achievement Unlocked!');
        // Underscores are escaped by discord.js escapeMarkdown to prevent injection.
        expect(embedJson.description).toContain('**Title only\\_one**');
        expect(embedJson.description).not.toMatch(/Achievements Unlocked! \(×/);
    });

    test('back-compat notifyAchievement still produces a single DM', async () => {
        const def = fakeAchievement('legacy_one');
        const { service, sendMock } = buildService({ achievements: { legacy_one: def } });

        await service.notifyAchievement('u1', 'g1', 'legacy_one');

        expect(sendMock).toHaveBeenCalledTimes(1);
        const embedJson = sendMock.mock.calls[0][0].embeds[0].toJSON();
        expect(embedJson.title).toBe('✅ 🎯 Achievement Unlocked!');
    });

    test('already-earned achievements are excluded from the batch', async () => {
        const defs = {
            a: fakeAchievement('a'),
            b: fakeAchievement('b'),
            c: fakeAchievement('c')
        };
        const { service, sendMock } = buildService({ achievements: defs });
        service.hasAchievement = jest.fn(async (uid, gid, id) => id === 'b');

        const awarded = [];
        for (const id of ['a', 'b', 'c']) {
            const def = await service._awardAchievementWithoutNotify('u1', 'g1', id);
            if (def) awarded.push(def);
        }
        await service.notifyAchievementsBatch('u1', 'g1', awarded);

        expect(awarded.map(a => a.id)).toEqual(['a', 'c']);
        expect(dbLog.insert).toHaveBeenCalledTimes(2);
        expect(sendMock).toHaveBeenCalledTimes(1);
        const embedJson = sendMock.mock.calls[0][0].embeds[0].toJSON();
        expect(embedJson.title).toBe('✅ 🏆 Achievements Unlocked! (×2)');
        expect(embedJson.description).not.toContain('Title b');
    });

    test('seasonal-inactive achievements are excluded from the batch', async () => {
        const defs = {
            a: fakeAchievement('a'),
            seasonal_x: fakeAchievement('seasonal_x', { seasonal: true })
        };
        const { service, sendMock } = buildService({ achievements: defs });
        service.achievementManager.canAward = jest.fn(async (id) => id !== 'seasonal_x');

        const awarded = [];
        for (const id of ['a', 'seasonal_x']) {
            const def = await service._awardAchievementWithoutNotify('u1', 'g1', id);
            if (def) awarded.push(def);
        }
        await service.notifyAchievementsBatch('u1', 'g1', awarded);

        expect(awarded.map(a => a.id)).toEqual(['a']);
        expect(dbLog.insert).toHaveBeenCalledTimes(1);
        expect(sendMock).toHaveBeenCalledTimes(1);
        const embedJson = sendMock.mock.calls[0][0].embeds[0].toJSON();
        // single award path -> legacy single-DM title
        expect(embedJson.title).toBe('✅ 🎯 Achievement Unlocked!');
    });

    test('disabled-guild auto awards yield no inserts and no DM', async () => {
        const defs = { a: fakeAchievement('a'), b: fakeAchievement('b') };
        const { service, sendMock } = buildService({ achievements: defs, isEnabled: false });

        const awarded = [];
        for (const id of ['a', 'b']) {
            const def = await service._awardAchievementWithoutNotify('u1', 'g1', id);
            if (def) awarded.push(def);
        }
        if (awarded.length) await service.notifyAchievementsBatch('u1', 'g1', awarded);

        expect(awarded).toHaveLength(0);
        expect(dbLog.insert).not.toHaveBeenCalled();
        expect(sendMock).not.toHaveBeenCalled();
    });

    test('disabled-guild manual awards still insert and DM', async () => {
        const def = fakeAchievement('manual_only', { emoji: '🎖️', title: 'Manual' });
        const { service, sendMock } = buildService({ achievements: { manual_only: def }, isEnabled: false });

        await service.awardAchievement('u1', 'g1', 'manual_only', 'admin-id');

        expect(dbLog.insert).toHaveBeenCalledTimes(1);
        expect(sendMock).toHaveBeenCalledTimes(1);
    });

    test('DM disabled (send throws) is swallowed silently', async () => {
        const def = fakeAchievement('a');
        const { service, sendMock } = buildService({ achievements: { a: def } });
        sendMock.mockRejectedValueOnce(new Error('Cannot send messages to this user'));

        await expect(
            service.notifyAchievementsBatch('u1', 'g1', ['a'])
        ).resolves.toBeUndefined();
    });

    test('guild fetch failure falls back to Unknown Server', async () => {
        const def = fakeAchievement('a');
        const { service, sendMock, guildFetch } = buildService({ achievements: { a: def } });
        guildFetch.mockResolvedValueOnce(null);

        await service.notifyAchievementsBatch('u1', 'g1', ['a']);

        expect(sendMock).toHaveBeenCalledTimes(1);
        const embedJson = sendMock.mock.calls[0][0].embeds[0].toJSON();
        expect(embedJson.description).toContain('Earned in: **Unknown Server**');
    });

    test('empty-array batch is a no-op (no fetches, no DM)', async () => {
        const { service, sendMock, userFetch, guildFetch } = buildService({ achievements: {} });

        await expect(
            service.notifyAchievementsBatch('u1', 'g1', [])
        ).resolves.toBeUndefined();

        expect(userFetch).not.toHaveBeenCalled();
        expect(guildFetch).not.toHaveBeenCalled();
        expect(sendMock).not.toHaveBeenCalled();
    });

    test('users.fetch returning null short-circuits before DM', async () => {
        const def = fakeAchievement('a');
        const { service, sendMock, userFetch } = buildService({ achievements: { a: def } });
        userFetch.mockResolvedValueOnce(null);

        await service.notifyAchievementsBatch('u1', 'g1', ['a']);

        expect(userFetch).toHaveBeenCalledTimes(1);
        expect(sendMock).not.toHaveBeenCalled();
    });

    test('mid-batch role-grant throw is isolated: DB row exists, batch still includes the entry, error logged', async () => {
        // Role-grant failures happen AFTER the DB insert. They must not poison
        // the award flow — the row already exists, so the user must still get
        // the DM. The role-grant exception is logged and contained.
        const defs = {
            a: fakeAchievement('a'),
            b: fakeAchievement('b', { grantRole: true }),
            c: fakeAchievement('c')
        };
        const { service, sendMock } = buildService({ achievements: defs });
        service.grantAchievementRole = jest.fn(async (uid, gid, ach) => {
            if (ach.id === 'b') throw new Error('role API exploded');
        });

        const { error: logErrorMock } = require('../src/utils/logger');

        const awarded = [];
        for (const id of ['a', 'b', 'c']) {
            const def = await service._awardAchievementWithoutNotify('u1', 'g1', id);
            if (def) awarded.push(def);
        }
        await service.notifyAchievementsBatch('u1', 'g1', awarded);

        // All 3 DB inserts happened.
        expect(dbLog.insert).toHaveBeenCalledTimes(3);
        // 'b' must still be in the batch despite the role-grant throw.
        expect(awarded.map(a => a.id)).toEqual(['a', 'b', 'c']);
        expect(sendMock).toHaveBeenCalledTimes(1);
        const embedJson = sendMock.mock.calls[0][0].embeds[0].toJSON();
        expect(embedJson.description).toContain('Title b');

        // Role-grant failure must be logged with enough context to debug.
        const roleErrCall = logErrorMock.mock.calls.find(([msg]) =>
            typeof msg === 'string' && msg.includes('Role grant failed') && msg.includes('b')
        );
        expect(roleErrCall).toBeDefined();
    });

    test('unique-constraint insert reject is isolated to that award', async () => {
        const defs = { a: fakeAchievement('a'), b: fakeAchievement('b') };
        const { service, sendMock } = buildService({ achievements: defs });

        const constraintErr = new Error('UNIQUE constraint failed: activityAchievements.userId, activityAchievements.guildId, activityAchievements.achievementId');
        constraintErr.code = 'SQLITE_CONSTRAINT';
        dbLog.insert
            .mockImplementationOnce(async () => { throw constraintErr; })
            .mockImplementationOnce(async () => undefined);

        const awarded = [];
        for (const id of ['a', 'b']) {
            const def = await service._awardAchievementWithoutNotify('u1', 'g1', id);
            if (def) awarded.push(def);
        }
        await service.notifyAchievementsBatch('u1', 'g1', awarded);

        // 'a' threw on insert -> awarder returns null -> not in batch
        expect(awarded.map(a => a.id)).toEqual(['b']);
        expect(dbLog.insert).toHaveBeenCalledTimes(2);
        // single-item batch -> legacy single-DM embed
        expect(sendMock).toHaveBeenCalledTimes(1);
        const embedJson = sendMock.mock.calls[0][0].embeds[0].toJSON();
        expect(embedJson.title).toBe('✅ 🎯 Achievement Unlocked!');
        expect(embedJson.description).toContain('**Title b**');
        expect(embedJson.description).not.toContain('Title a');
    });
});
