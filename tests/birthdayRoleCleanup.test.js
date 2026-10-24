const mockAddRole = jest.fn();
const mockRemoveRole = jest.fn();
const mockFetchMember = jest.fn();
const mockFetchChannel = jest.fn();

jest.mock('../src/database', () => {
    const sqlite = new (require('better-sqlite3'))(':memory:');
    const schema = require('../src/database/schema');
    sqlite.exec(require('fs').readFileSync(require('path').join(__dirname, '../drizzle/0041_birthday_role_ownership.sql'), 'utf8'));
    sqlite.exec(`CREATE TABLE birthdays (id INTEGER PRIMARY KEY, user_id TEXT, guild_id TEXT, month INTEGER, day INTEGER, created_at INTEGER);
        CREATE TABLE birthday_config (guild_id TEXT PRIMARY KEY, channel_id TEXT, role_id TEXT, enabled INTEGER, last_check INTEGER);`);
    return { sqlite, db: require('drizzle-orm/better-sqlite3').drizzle(sqlite, { schema }) };
});
jest.mock('../src/utils/dbLogger', () => ({
    dbLog: Object.fromEntries(['select', 'update', 'delete'].map(operation => [operation, (_table, query) => query()]))
}));
jest.mock('../src/utils/logger', () => ({
    debug: jest.fn(), info: jest.fn(), success: jest.fn(), warn: jest.fn(), error: jest.fn()
}));
jest.mock('../src/utils/discordApiUtil', () => ({
    fetchMember: mockFetchMember,
    fetchChannel: mockFetchChannel,
    RoleManager: { addRole: mockAddRole, removeRole: mockRemoveRole }
}));

const { sqlite } = require('../src/database');
const logger = require('../src/utils/logger');
const BirthdayService = require('../src/services/birthdayService');

let guild;
let role;
let member;
let service;
let client;

function seedGrant(overrides = {}) {
    const grant = { id: 'grant-1', guildId: 'guild-1', userId: 'birthday-user', roleId: 'role-1',
        joinedAt: 1000, expiresAt: Date.now() - 1, state: 'granted', ...overrides };
    sqlite.prepare(`INSERT INTO birthday_role_grants
        (id, guild_id, user_id, role_id, joined_at, expires_at, state) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(...Object.values(grant));
}

function seedBirthday() {
    sqlite.exec(`INSERT INTO birthday_config VALUES ('guild-1', 'channel-1', 'role-1', 1, NULL);
        INSERT INTO birthdays (user_id, guild_id, month, day) VALUES ('birthday-user', 'guild-1', 7, 31);`);
}

beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-31T12:00:00Z'));
    jest.clearAllMocks();
    sqlite.exec('DELETE FROM birthday_role_grants; DELETE FROM birthdays; DELETE FROM birthday_config;');
    role = { id: 'role-1', members: new Map() };
    member = { id: 'birthday-user', user: { tag: 'Birthday User' }, joinedTimestamp: 1000,
        roles: { cache: new Map() } };
    guild = { id: 'guild-1', name: 'Test Guild', roles: { cache: new Map([[role.id, role]]),
        fetch: jest.fn().mockResolvedValue(role) } };
    client = { guilds: { fetch: jest.fn().mockResolvedValue(guild) } };
    mockFetchMember.mockResolvedValue(member);
    mockFetchChannel.mockResolvedValue({ send: jest.fn().mockResolvedValue({}) });
    mockAddRole.mockImplementation(async (target, assignedRole) => {
        target.roles.cache.set(assignedRole.id, assignedRole);
        return { success: true };
    });
    mockRemoveRole.mockImplementation(async (target, removedRole) => {
        target.roles.cache.delete(removedRole.id);
        return { success: true };
    });
    service = new BirthdayService(client);
});

afterEach(() => {
    service.cleanup();
    jest.useRealTimers();
});
afterAll(() => sqlite.close());

test('preserves shared role members without a recorded bot grant after restart', async () => {
    seedBirthday();
    const unrelated = { id: 'unrelated-user', roles: { cache: new Map([[role.id, role]]) } };
    role.members.set(unrelated.id, unrelated);
    await service.cleanupExpiredBirthdayRoles();
    expect(mockRemoveRole).not.toHaveBeenCalled();
    expect(unrelated.roles.cache.has(role.id)).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
});

test('a confirmed grant survives restart and expires on its original role after configuration changes', async () => {
    seedBirthday();
    expect(await service.checkBirthdaysForGuild(guild.id)).toBe(true);
    expect(mockAddRole).toHaveBeenCalledTimes(1);
    expect(mockAddRole).toHaveBeenCalledWith(member, role, expect.objectContaining({ logContext: 'birthday-role-assign' }));
    sqlite.exec("UPDATE birthday_config SET role_id = 'replacement-role', enabled = 0");
    service.cleanup();
    service = new BirthdayService(client);
    jest.advanceTimersByTime(86399999);
    await service.cleanupExpiredBirthdayRoles();
    expect(mockRemoveRole).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await service.cleanupExpiredBirthdayRoles();
    expect(mockRemoveRole).toHaveBeenCalledTimes(1);
    expect(member.roles.cache.has(role.id)).toBe(false);
    await service.cleanupExpiredBirthdayRoles();
    expect(mockRemoveRole).toHaveBeenCalledTimes(1);
    expect(mockFetchMember).toHaveBeenCalledWith(guild, member.id, expect.objectContaining({ force: true, throwOnError: true }));
    expect(logger.error).not.toHaveBeenCalled();
});

test('a preexisting birthday role is never adopted or removed', async () => {
    seedBirthday();
    member.roles.cache.set(role.id, role);
    await service.checkBirthdaysForGuild(guild.id);
    expect(mockAddRole).not.toHaveBeenCalled();
    jest.advanceTimersByTime(86400000);
    await service.cleanupExpiredBirthdayRoles();
    expect(mockRemoveRole).not.toHaveBeenCalled();
    expect(member.roles.cache.has(role.id)).toBe(true);
});

test.each([false, true])('an unconfirmed add is never retried or adopted when delivery=%s', async delivered => {
    seedBirthday();
    mockAddRole.mockImplementationOnce(async () => {
        if (delivered) member.roles.cache.set(role.id, role);
        return { success: false, error: 'Connection lost' };
    });
    await service.checkBirthdaysForGuild(guild.id);
    service = new BirthdayService(client);
    await service.checkBirthdaysForGuild(guild.id);
    expect(mockAddRole).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(86400000);
    await service.cleanupExpiredBirthdayRoles();
    expect(mockRemoveRole).not.toHaveBeenCalled();
    expect(member.roles.cache.has(role.id)).toBe(delivered);
});

test('a role arriving while the durable reservation is written is preserved as preexisting', async () => {
    seedBirthday();
    sqlite.function('external_birthday_role', () => {
        Promise.resolve().then(() => member.roles.cache.set(role.id, role));
        return 0;
    });
    sqlite.exec(`CREATE TRIGGER external_birthday_role AFTER INSERT ON birthday_role_grants
        BEGIN SELECT external_birthday_role(); END`);
    try {
        await service.checkBirthdaysForGuild(guild.id);
    } finally {
        sqlite.exec('DROP TRIGGER external_birthday_role');
    }
    jest.advanceTimersByTime(86400000);
    await service.cleanupExpiredBirthdayRoles();
    expect(mockAddRole).not.toHaveBeenCalled();
    expect(mockRemoveRole).not.toHaveBeenCalled();
    expect(member.roles.cache.has(role.id)).toBe(true);
});

test('a failed reservation cannot perform a Discord grant', async () => {
    seedBirthday();
    sqlite.exec(`CREATE TRIGGER fail_birthday_reservation BEFORE INSERT ON birthday_role_grants
        BEGIN SELECT RAISE(ABORT, 'Reservation failed'); END`);
    try {
        expect(await service.checkBirthdaysForGuild(guild.id)).toBe(false);
        expect(mockAddRole).not.toHaveBeenCalled();
    } finally {
        sqlite.exec('DROP TRIGGER fail_birthday_reservation');
    }
});

test('a delivered add with an interrupted confirmation cannot be adopted after restart', async () => {
    seedBirthday();
    sqlite.exec(`CREATE TRIGGER fail_birthday_confirmation BEFORE UPDATE ON birthday_role_grants
        BEGIN SELECT RAISE(ABORT, 'Confirmation failed'); END`);
    try {
        expect(await service.checkBirthdaysForGuild(guild.id)).toBe(false);
        expect(member.roles.cache.has(role.id)).toBe(true);
    } finally {
        sqlite.exec('DROP TRIGGER fail_birthday_confirmation');
    }
    service = new BirthdayService(client);
    await service.checkBirthdaysForGuild(guild.id);
    jest.advanceTimersByTime(86400000);
    await service.cleanupExpiredBirthdayRoles();
    expect(mockAddRole).toHaveBeenCalledTimes(1);
    expect(mockRemoveRole).not.toHaveBeenCalled();
    expect(member.roles.cache.has(role.id)).toBe(true);
});

test('overlapping birthday checks can only reserve one grant for the same member and role', async () => {
    seedBirthday();
    await Promise.all([service.checkBirthdaysForGuild(guild.id), service.checkBirthdaysForGuild(guild.id)]);
    expect(mockAddRole).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(86400000);
    await service.cleanupExpiredBirthdayRoles();
    expect(mockRemoveRole).toHaveBeenCalledTimes(1);
});

test('a failed removal response after delivery is reconciled without removing a rejoined assignment', async () => {
    seedGrant();
    member.roles.cache.set(role.id, role);
    mockRemoveRole.mockImplementationOnce(async () => {
        member.roles.cache.delete(role.id);
        return { success: false, error: 'Response lost' };
    });
    await service.cleanupExpiredBirthdayRoles();
    member.joinedTimestamp = 2000;
    member.roles.cache.set(role.id, role);
    await service.cleanupExpiredBirthdayRoles();
    expect(mockRemoveRole).toHaveBeenCalledTimes(1);
    expect(member.roles.cache.has(role.id)).toBe(true);
});

test('failed removal survives another restart and retries until confirmed', async () => {
    seedGrant();
    member.roles.cache.set(role.id, role);
    mockRemoveRole.mockResolvedValueOnce({ success: false, error: 'Missing Permissions' });
    await service.cleanupExpiredBirthdayRoles();
    expect(member.roles.cache.has(role.id)).toBe(true);
    service = new BirthdayService(client);
    await service.cleanupExpiredBirthdayRoles();
    expect(mockRemoveRole).toHaveBeenCalledTimes(2);
    expect(member.roles.cache.has(role.id)).toBe(false);
    await service.cleanupExpiredBirthdayRoles();
    expect(mockRemoveRole).toHaveBeenCalledTimes(2);
});

test('a failed lookup retains ownership for a later recovery attempt', async () => {
    seedGrant();
    member.roles.cache.set(role.id, role);
    mockFetchMember.mockRejectedValueOnce(new Error('Network unavailable'));
    await service.cleanupExpiredBirthdayRoles();
    expect(mockRemoveRole).not.toHaveBeenCalled();
    await service.cleanupExpiredBirthdayRoles();
    expect(mockRemoveRole).toHaveBeenCalledTimes(1);
});

test.each(['departed', 'rejoined'])('a %s member cannot transfer ownership to a new role assignment', async status => {
    seedGrant();
    member.roles.cache.set(role.id, role);
    if (status === 'departed') mockFetchMember.mockResolvedValueOnce(null);
    else member.joinedTimestamp = 2000;
    await service.cleanupExpiredBirthdayRoles();
    await service.cleanupExpiredBirthdayRoles();
    expect(mockRemoveRole).not.toHaveBeenCalled();
    expect(member.roles.cache.has(role.id)).toBe(true);
});

test('the periodic sweep retries failed expiry without a process restart and stops on cleanup', async () => {
    seedGrant();
    member.roles.cache.set(role.id, role);
    mockRemoveRole.mockResolvedValueOnce({ success: false, error: 'Retry later' });
    service.startDailyCheck();
    await jest.advanceTimersByTimeAsync(60000);
    expect(mockRemoveRole).toHaveBeenCalledTimes(2);
    service.cleanup();
    await jest.advanceTimersByTimeAsync(86400000);
    expect(mockRemoveRole).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
});

test('guild purge forgets grants, birthdays and configuration without touching other guilds', async () => {
    seedBirthday();
    seedGrant();
    seedGrant({ id: 'grant-2', guildId: 'guild-2', userId: 'other-user' });
    await service.purgeGuild('guild-1');
    await service.cleanupExpiredBirthdayRoles();
    expect(mockFetchMember).toHaveBeenCalledTimes(1);
    expect(mockFetchMember).toHaveBeenCalledWith(guild, 'other-user', expect.any(Object));
    expect(await service.checkBirthdaysForGuild('guild-1')).toBe(false);
    expect(await service.getUpcomingBirthdays('guild-1', 30)).toEqual([]);
});

test.each([['26 dates', 26, true], ['large single day', 1000, false]])(
    'upcoming birthdays preserves every entry for %s across valid public pagination pages', async (_name, count, distinct) => {
        const command = require('../src/commands/utility/birthday');
        const entries = Array.from({ length: count }, (_, index) => ({
            userId: String(100000000000000000n + BigInt(index)), month: 8,
            day: distinct ? index + 1 : 15, daysUntil: distinct ? index + 1 : 15
        }));
        const callbacks = {};
        const collector = { on: jest.fn((event, callback) => { callbacks[event] = callback; }) };
        const message = { createMessageComponentCollector: jest.fn(() => collector), edit: jest.fn().mockResolvedValue({}) };
        const payloads = [];
        const savePage = async payload => {
            const page = payload.embeds[0].toJSON();
            expect(page.fields.length).toBeLessThanOrEqual(25);
            expect(payload.embeds[0].length).toBeLessThanOrEqual(6000);
            for (const field of page.fields) expect(field.value.length).toBeLessThanOrEqual(1024);
            payloads.push(payload);
            return message;
        };
        const interaction = {
            guild, user: { id: 'requester' },
            options: { getSubcommand: () => 'upcoming', getInteger: () => 30 },
            deferReply: jest.fn(), editReply: jest.fn(savePage)
        };
        await command.execute(interaction, { birthdayService: { getUpcomingBirthdays: jest.fn().mockResolvedValue(entries) } });
        expect(interaction.deferReply).toHaveBeenCalledWith();
        while (!payloads.at(-1).components[0].toJSON().components[1].disabled) {
            await callbacks.collect({ user: interaction.user, customId: 'birthday_upcoming_next', update: savePage });
        }
        expect(payloads.length).toBeGreaterThan(1);
        const mentions = payloads.flatMap(payload => payload.embeds[0].toJSON().fields.map(field => field.value)).join(', ');
        expect(mentions.match(/<@\d+>/g)).toEqual(entries.map(entry => `<@${entry.userId}>`));
        expect(payloads.every(payload => payload.allowedMentions?.parse.length === 0)).toBe(true);
    });
