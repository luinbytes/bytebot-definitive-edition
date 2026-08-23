const mockDbLog = {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
};
const mockRecordActivity = jest.fn();
const mockScheduleOwnershipTransfer = jest.fn();
const mockRecoverPendingIncidents = jest.fn().mockResolvedValue({ recovered: 0, remaining: 0, retryAfterMs: null, failures: [] });

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
    cleanupOrphanedRoles: jest.fn(),
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

    afterEach(() => jest.useRealTimers());

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

    test('records recovered voice time while finalizing a stale session', async () => {
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

        expect(mockRecordActivity).toHaveBeenCalledWith('user-1', 'guild-1', 'voice', 2);
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
