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
