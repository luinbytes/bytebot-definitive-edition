const mockDbLog = {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
};
const mockRecordActivity = jest.fn();
const mockScheduleOwnershipTransfer = jest.fn();
const mockRecoverPendingIncidents = jest.fn().mockResolvedValue({ recovered: 0, remaining: 0, retryAfterMs: null, failures: [] });
const mockAnalyticsInstances = [];

jest.mock('../src/database', () => ({ db: {} }));
jest.mock('../src/utils/dbLogger', () => ({ dbLog: mockDbLog }));
jest.mock('../src/utils/logger', () => ({
    debug: jest.fn(), info: jest.fn(), success: jest.fn(), warn: jest.fn(),
    error: jest.fn(), errorContext: jest.fn()
}));
jest.mock('../src/services/birthdayService', () => jest.fn().mockImplementation(() => ({
    startDailyCheck: jest.fn()
})));
jest.mock('../src/services/autoResponderService', () => jest.fn());
jest.mock('../src/services/lastfmOAuthServer', () => ({
    LastfmOAuthServer: jest.fn().mockImplementation(() => ({ start: jest.fn().mockResolvedValue(false) }))
}));
jest.mock('../src/services/starboardService', () => jest.fn());
jest.mock('../src/services/reminderService', () => jest.fn().mockImplementation(() => ({
    loadReminders: jest.fn()
})));
jest.mock('../src/services/activityStreakService', () => jest.fn().mockImplementation(() => ({
    startDailyCheck: jest.fn(),
    cleanupOrphanedRoles: jest.fn().mockResolvedValue(undefined),
    recordActivity: mockRecordActivity
})));
jest.mock('../src/events/voiceStateUpdate', () => ({
    scheduleOwnershipTransfer: mockScheduleOwnershipTransfer
}));
jest.mock('../src/services/antinukeService', () => ({
    recoverPendingIncidents: mockRecoverPendingIncidents
}));
jest.mock('../src/services/antiraidService', () => ({
    recoverLockdowns: jest.fn().mockResolvedValue({ recovered: 0, failures: [] }),
    recoverPendingIncidents: jest.fn().mockReturnValue(0)
}));
jest.mock('../src/services/automodService', () => ({
    reconcileNativeRules: jest.fn().mockResolvedValue({ reconciled: 0, failures: [] }),
    recoverPendingIncidents: jest.fn().mockReturnValue(0)
}));
jest.mock('../src/services/levelAnalyticsService', () => {
    const LevelAnalyticsService = jest.requireActual('../src/services/levelAnalyticsService');
    return jest.fn().mockImplementation(options => {
        const service = new LevelAnalyticsService(options);
        service.reconcileStartup = jest.fn().mockResolvedValue({ failures: [] });
        service.refreshLiveBoards = jest.fn().mockResolvedValue({ failures: [] });
        service.processRoleJobs = jest.fn().mockResolvedValue({ failures: [] });
        service.pruneAnalytics = jest.fn().mockReturnValue({ daily: 0, activity: 0, dedupe: 0, reactions: 0 });
        service.drainAnalytics = jest.fn().mockResolvedValue({ daily: 0, activity: 0, dedupe: 0, reactions: 0 });
        mockAnalyticsInstances.push(service);
        return service;
    });
});

const ready = require('../src/events/ready');

function makeClient(fetchGuild) {
    return {
        user: { tag: 'ByteBot#0001', setPresence: jest.fn() },
        users: { fetch: jest.fn() },
        guilds: { cache: new Map(), fetch: fetchGuild }
    };
}

describe('ready event recovery', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        mockDbLog.insert.mockResolvedValue(undefined);
        mockDbLog.update.mockResolvedValue(undefined);
        mockDbLog.delete.mockResolvedValue(undefined);
        mockRecoverPendingIncidents.mockResolvedValue({ recovered: 0, remaining: 0, retryAfterMs: null, failures: [] });
    });

    afterEach(() => {
        mockAnalyticsInstances.splice(0).forEach(service => service.cleanup());
        jest.useRealTimers();
    });

    test('startup and daily retention drain asynchronously and analytics cleanup stops its scheduled work', async () => {
        mockDbLog.select.mockResolvedValue([]);
        const client = makeClient(jest.fn());

        await ready.execute(client);

        const analytics = client.levelAnalyticsService;
        const confirmationPrune = jest.spyOn(analytics, 'pruneConfirmations');
        expect(analytics.drainAnalytics).toHaveBeenCalledTimes(1);
        expect(analytics.pruneAnalytics).not.toHaveBeenCalled();
        jest.advanceTimersByTime(24 * 60 * 60 * 1000);
        await Promise.resolve();
        expect(analytics.drainAnalytics).toHaveBeenCalledTimes(2);
        expect(analytics.refreshLiveBoards).toHaveBeenCalledTimes(289);
        expect(analytics.processRoleJobs).toHaveBeenCalledTimes(2881);
        expect(confirmationPrune).toHaveBeenCalledTimes(1440);
        analytics.drainAnalytics.mockClear();
        analytics.refreshLiveBoards.mockClear();
        analytics.processRoleJobs.mockClear();
        confirmationPrune.mockClear();

        analytics.cleanup();
        const lateTask = jest.fn();
        analytics.scheduleInterval(lateTask, 60 * 60 * 1000);
        jest.advanceTimersByTime(24 * 60 * 60 * 1000);
        await Promise.resolve();

        expect(analytics.drainAnalytics).not.toHaveBeenCalled();
        expect(analytics.refreshLiveBoards).not.toHaveBeenCalled();
        expect(analytics.processRoleJobs).not.toHaveBeenCalled();
        expect(confirmationPrune).not.toHaveBeenCalled();
        expect(lateTask).not.toHaveBeenCalled();
    });

    test('keeps BytePod state when Discord guild lookup fails transiently', async () => {
        mockDbLog.select.mockImplementation(async (table) => {
            if (table === 'bytepodActiveSessions') return [];
            if (table === 'bytepods') return [{ channelId: 'pod-1', guildId: 'guild-1' }];
            return null;
        });
        const client = makeClient(jest.fn().mockRejectedValue(new Error('network unavailable')));

        await ready.execute(client);

        expect(mockDbLog.delete).not.toHaveBeenCalledWith(
            'bytepods', expect.any(Function), expect.objectContaining({ podId: 'pod-1' })
        );
    });

    test('shutdown stops ready-owned intervals and recovery retries, including in-flight retry completion', async () => {
        mockDbLog.select.mockResolvedValue([]);
        mockRecoverPendingIncidents.mockResolvedValueOnce({ recovered: 0, remaining: 1, retryAfterMs: 30000, failures: [] });
        let finishRecovery;
        mockRecoverPendingIncidents.mockImplementationOnce(() => new Promise(resolve => { finishRecovery = resolve; }));
        const client = makeClient(jest.fn());
        await ready.execute(client);
        jest.advanceTimersByTime(30000);
        expect(mockRecoverPendingIncidents).toHaveBeenCalledTimes(2);

        client.stopReadyTasks();
        client.levelAnalyticsService.cleanup();
        client.activityStreakService.cleanupOrphanedRoles.mockClear();
        client.user.setPresence.mockClear();
        finishRecovery({ recovered: 0, remaining: 1, retryAfterMs: 30000, failures: [] });
        await Promise.resolve();
        jest.advanceTimersByTime(24 * 60 * 60 * 1000);
        await Promise.resolve();

        expect(mockRecoverPendingIncidents).toHaveBeenCalledTimes(2);
        expect(client.activityStreakService.cleanupOrphanedRoles).not.toHaveBeenCalled();
        expect(client.user.setPresence).not.toHaveBeenCalled();
    });

    test('does not count bot-offline voice time while finalizing a stale session', async () => {
        const startedAt = Date.now() - 120000;
        mockDbLog.select.mockImplementation(async (table) => {
            if (table === 'bytepodActiveSessions') {
                return [{ id: 1, podId: 'pod-1', userId: 'user-1', guildId: 'guild-1', startTime: startedAt }];
            }
            if (table === 'bytepodVoiceStats') return null;
            if (table === 'bytepods') return [];
            return null;
        });
        const channel = { members: new Map(), delete: jest.fn() };
        const guild = { channels: { fetch: jest.fn().mockResolvedValue(channel) } };
        const client = makeClient(jest.fn().mockResolvedValue(guild));

        await ready.execute(client);

        expect(mockRecordActivity).not.toHaveBeenCalled();
    });

    test('resumes a pending BytePod ownership transfer', async () => {
        const ownerLeftAt = Date.now() - 60000;
        const pod = {
            channelId: 'pod-1', guildId: 'guild-1', ownerId: 'owner-1', ownerLeftAt
        };
        mockDbLog.select.mockImplementation(async (table) => {
            if (table === 'bytepodActiveSessions') return [];
            if (table === 'bytepods') return [pod];
            return null;
        });
        const channel = {
            members: new Map([['member-1', { id: 'member-1' }]]),
            delete: jest.fn()
        };
        const guild = { channels: { fetch: jest.fn().mockResolvedValue(channel) } };
        const client = makeClient(jest.fn().mockResolvedValue(guild));

        await ready.execute(client);

        expect(mockScheduleOwnershipTransfer).toHaveBeenCalledWith(
            guild,
            'pod-1',
            expect.any(Number)
        );
        expect(mockScheduleOwnershipTransfer.mock.calls[0][2]).toBeLessThanOrEqual(240000);
    });
});

describe('independent service startup recovery', () => {
    let database;
    let client;

    beforeEach(async () => {
        jest.resetModules();
        jest.useFakeTimers();
        jest.clearAllMocks();
        process.env.DATABASE_URL = ':memory:';
        database = jest.requireActual('../src/database');
        await database.runMigrations();
        Object.assign(require('../src/database'), database);
        mockDbLog.select.mockResolvedValue([]);
        mockRecoverPendingIncidents.mockResolvedValue({ recovered: 0, remaining: 0, retryAfterMs: null, failures: [] });
        client = makeClient(jest.fn());
        client.user.id = 'bot';
    });

    function stopServices() {
        client.stopReadyTasks?.();
        for (const name of ['voiceMasterService', 'giveawayService', 'ticketService', 'levelAnalyticsService',
            'eventLoggingService', 'communityUtilityService', 'automationService', 'funService']) {
            client[name]?.cleanup();
        }
    }

    afterEach(() => {
        stopServices();
        mockAnalyticsInstances.splice(0).forEach(service => service.cleanup());
        database.sqlite.close();
        delete process.env.DATABASE_URL;
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    function expiredGiveaway() {
        const { GiveawayService } = require('../src/services/giveawayService');
        const message = { edit: jest.fn().mockResolvedValue({}) };
        const channel = { id: 'giveaways', messages: { fetch: jest.fn().mockResolvedValue(message) } };
        const guild = { id: 'giveaway-guild',
            channels: { cache: new Map([[channel.id, channel]]) }, members: { cache: new Map() } };
        client.guilds.cache.set(guild.id, guild);
        const service = new GiveawayService(null, { sqlite: database.sqlite, now: () => 1000 });
        const giveaway = service.reserveGiveaway({ guildId: guild.id, channelId: channel.id,
            hostId: 'host', duration: '10s', winnerCount: 1, prize: 'Prize' });
        service.attachMessage(giveaway.id, 'giveaway-message');
        return { giveaway, message, channel };
    }

    function inactiveTicket() {
        const channel = { id: 'ticket-channel', send: jest.fn().mockResolvedValue({}),
            permissionOverwrites: { edit: jest.fn().mockResolvedValue({}) } };
        const guild = { id: 'ticket-guild', channels: { cache: new Map([[channel.id, channel]]) } };
        client.guilds.cache.set(guild.id, guild);
        const ticket = database.sqlite.prepare(`INSERT INTO tickets
            (guild_id, number, opener_id, channel_id, status, inactivity_deadline, created_at, updated_at)
            VALUES (?, 1, 'opener', ?, 'open', 1, 1, 1) RETURNING id`).get(guild.id, channel.id);
        return { ticket, channel };
    }

    test.each(['VoiceMaster', 'giveaway'])('ticket inactivity is warned once while %s REST recovery is pending', async blocked => {
        const { ChannelType } = require('discord.js');
        const { ticket, channel } = inactiveTicket();
        let release;
        let entered;
        const requested = new Promise(resolve => { entered = resolve; });
        const deferred = () => {
            entered();
            return new Promise(resolve => { release = resolve; });
        };
        let resource;
        let pod;
        let giveaway;
        if (blocked === 'VoiceMaster') {
            database.sqlite.prepare(`INSERT INTO voice_master_configs
                (guild_id, state, generation, category_id, updated_at)
                VALUES ('voice-guild', 'active', 1, 'category', 1)`).run();
            database.sqlite.prepare(`INSERT INTO bytepods
                (guild_id, channel_id, owner_id, source_channel_id, state, generation, cleanup_after, bot_owned, created_at)
                VALUES ('voice-guild', 'pod', 'owner', 'source', 'active', 1, 1, 1, 1)`).run();
            pod = { id: 'pod', type: ChannelType.GuildVoice, members: new Map(), delete: jest.fn().mockResolvedValue({}) };
            resource = { channels: { cache: new Map([['category', { type: ChannelType.GuildCategory }], ['pod', pod]]) } };
            client.guilds.fetch.mockResolvedValue(resource).mockImplementationOnce(deferred);
        } else {
            giveaway = expiredGiveaway();
            resource = giveaway.message;
            giveaway.channel.messages.fetch.mockImplementationOnce(deferred);
        }
        const startup = require('../src/events/ready').execute(client);
        try {
            await requested;
            await jest.advanceTimersByTimeAsync(60000);

            expect(channel.send).toHaveBeenCalledTimes(1);
            expect(channel.send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('inactive') }));
            expect(client.ticketService.getTicket(ticket.id).inactivityDeadline).toBeNull();
            if (pod) {
                expect(pod.delete).not.toHaveBeenCalled();
                expect(client.guilds.fetch).toHaveBeenCalledTimes(1);
            }
            if (giveaway) expect(giveaway.message.edit).not.toHaveBeenCalled();
        } finally {
            release(resource);
            await startup;
        }
        await jest.advanceTimersByTimeAsync(60000);
        expect(channel.send).toHaveBeenCalledTimes(1);
        if (pod) expect(pod.delete).toHaveBeenCalledTimes(1);
        if (giveaway) expect(giveaway.message.edit).toHaveBeenCalledTimes(1);
    });

    test('giveaway eligibility waits for persisted VoiceMaster role recovery', async () => {
        const { ChannelType } = require('discord.js');
        const { GiveawayService } = require('../src/services/giveawayService');
        const { giveaway, message } = expiredGiveaway();
        const guild = client.guilds.cache.get('giveaway-guild');
        const role = { id: 'join-role', name: 'Join', position: 1 };
        const member = { id: 'entrant', user: { id: 'entrant', bot: false }, guild,
            roles: { cache: new Map([[role.id, role]]), add: jest.fn(async () => { member.roles.cache.set(role.id, role); }) } };
        guild.members.cache.set(member.id, member);
        guild.members.fetch = jest.fn().mockResolvedValue(member);
        guild.members.me = { roles: { highest: { position: 10 } } };
        guild.roles = { cache: new Map([[role.id, role]]) };
        guild.channels.cache.set('pod', { id: 'pod', type: ChannelType.GuildVoice, members: new Map([[member.id, member]]) });
        new GiveawayService(null, { sqlite: database.sqlite, now: () => 1000 }).enter(giveaway.id, member);
        database.sqlite.prepare('UPDATE giveaways SET required_role_id = ? WHERE id = ?').run(role.id, giveaway.id);
        database.sqlite.prepare(`INSERT INTO bytepods
            (guild_id, channel_id, owner_id, source_channel_id, state, generation, bot_owned, created_at)
            VALUES (?, 'pod', ?, 'source', 'active', 1, 1, 1)`).run(guild.id, member.id);
        database.sqlite.prepare(`INSERT INTO voice_master_join_roles
            (guild_id, channel_id, member_id, role_id, state, added_by_bot, updated_at)
            VALUES (?, 'pod', ?, ?, 'pending', 1, 1)`).run(guild.id, member.id, role.id);
        member.roles.cache.clear();
        let release;
        let entered;
        const requested = new Promise(resolve => { entered = resolve; });
        client.guilds.fetch.mockResolvedValue(guild).mockImplementationOnce(() => {
            entered();
            return new Promise(resolve => { release = resolve; });
        });
        const startup = require('../src/events/ready').execute(client);
        let announcedBeforeRecovery;
        try {
            await requested;
            await jest.advanceTimersByTimeAsync(30000);
            announcedBeforeRecovery = message.edit.mock.calls.length;
        } finally {
            release(guild);
            await startup;
        }
        await jest.advanceTimersByTimeAsync(60000);

        expect(message.edit).toHaveBeenCalledWith(expect.objectContaining({ content: 'Winners: <@entrant>' }));
        expect(message.edit).toHaveBeenCalledTimes(1);
        expect(member.roles.add).toHaveBeenCalledTimes(1);
        expect(announcedBeforeRecovery).toBe(0);
    });

    test('shutdown during recovery prevents late schedulers and later ready initialization', async () => {
        const { ChannelType } = require('discord.js');
        database.sqlite.prepare(`INSERT INTO voice_master_configs
            (guild_id, state, generation, category_id, updated_at)
            VALUES ('voice-guild', 'active', 1, 'category', 1)`).run();
        const { message } = expiredGiveaway();
        const { channel: ticketChannel } = inactiveTicket();
        let releaseVoice;
        let releaseTicket;
        client.guilds.fetch.mockImplementationOnce(() => new Promise(resolve => { releaseVoice = resolve; }));
        ticketChannel.permissionOverwrites.edit.mockImplementationOnce(() => new Promise(resolve => { releaseTicket = resolve; }));
        const startup = require('../src/events/ready').execute(client);
        await jest.advanceTimersByTimeAsync(0);
        stopServices();
        releaseVoice({ channels: { cache: new Map([['category', { type: ChannelType.GuildCategory }]]) } });
        releaseTicket({});
        await startup;
        await jest.advanceTimersByTimeAsync(120000);

        expect(message.edit).not.toHaveBeenCalled();
        expect(ticketChannel.send).not.toHaveBeenCalled();
        expect(client.guilds.fetch).toHaveBeenCalledTimes(1);
        expect(client.giveawayService).toBeUndefined();
        expect(client.activityStreakService).toBeUndefined();
        expect(jest.getTimerCount()).toBe(0);
    });

    test('shutdown during giveaway recovery prevents its late scheduler and later ready initialization', async () => {
        const { message, channel } = expiredGiveaway();
        const { channel: ticketChannel } = inactiveTicket();
        let release;
        let entered;
        const requested = new Promise(resolve => { entered = resolve; });
        channel.messages.fetch.mockImplementationOnce(() => {
            entered();
            return new Promise(resolve => { release = resolve; });
        });
        const startup = require('../src/events/ready').execute(client);
        await requested;
        stopServices();
        release(message);
        await startup;
        await jest.advanceTimersByTimeAsync(120000);

        expect(message.edit).not.toHaveBeenCalled();
        expect(ticketChannel.send).not.toHaveBeenCalled();
        expect(client.communityUtilityService).toBeUndefined();
        expect(jest.getTimerCount()).toBe(0);
    });

    test('shutdown during giveaway member lookup does not claim a new winner round', async () => {
        const { GiveawayService } = require('../src/services/giveawayService');
        const { giveaway, message } = expiredGiveaway();
        const member = { id: 'entrant', user: { id: 'entrant', bot: false }, roles: { cache: new Map() } };
        new GiveawayService(null, { sqlite: database.sqlite, now: () => 1000 }).enter(giveaway.id, member);
        let release;
        let entered;
        const requested = new Promise(resolve => { entered = resolve; });
        client.guilds.cache.get('giveaway-guild').members.fetch = jest.fn(() => {
            entered();
            return new Promise(resolve => { release = resolve; });
        });
        const startup = require('../src/events/ready').execute(client);
        await requested;
        stopServices();
        release(member);
        await startup;

        expect(message.edit).not.toHaveBeenCalled();
        expect(client.giveawayService.getGiveaway(giveaway.id).status).toBe('active');
        expect(jest.getTimerCount()).toBe(0);
    });
});
