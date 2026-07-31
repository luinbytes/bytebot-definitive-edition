const mockDbLog = { select: jest.fn() };
const mockRemoveRole = jest.fn();

jest.mock('../src/database', () => ({ db: {} }));
jest.mock('../src/utils/dbLogger', () => ({ dbLog: mockDbLog }));
jest.mock('../src/utils/logger', () => ({
    debug: jest.fn(), info: jest.fn(), success: jest.fn(), warn: jest.fn(), error: jest.fn()
}));
jest.mock('../src/utils/discordApiUtil', () => ({
    fetchMember: jest.fn(),
    fetchChannel: jest.fn(),
    RoleManager: { addRole: jest.fn(), removeRole: mockRemoveRole }
}));

const BirthdayService = require('../src/services/birthdayService');

test('removes stale birthday roles after a restart', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-31T12:00:00Z'));
    mockDbLog.select.mockImplementation(async (table) => {
        if (table === 'birthdayConfig') {
            return [{ guildId: 'guild-1', roleId: 'role-1', enabled: true }];
        }
        if (table === 'birthdays') {
            return [{ userId: 'today-user', month: 7, day: 31 }];
        }
        return [];
    });
    mockRemoveRole.mockResolvedValue({ success: true });
    const expiredMember = { id: 'expired-user' };
    const todayMember = { id: 'today-user' };
    const role = { id: 'role-1', members: new Map([
        [expiredMember.id, expiredMember],
        [todayMember.id, todayMember]
    ]) };
    const guild = { roles: { cache: new Map([[role.id, role]]) } };
    const service = new BirthdayService({
        guilds: { fetch: jest.fn().mockResolvedValue(guild) }
    });

    await service.cleanupExpiredBirthdayRoles();

    expect(mockRemoveRole).toHaveBeenCalledTimes(1);
    expect(mockRemoveRole).toHaveBeenCalledWith(
        expiredMember,
        role,
        expect.objectContaining({ logContext: 'birthday-role-recovery' })
    );
    jest.useRealTimers();
});
