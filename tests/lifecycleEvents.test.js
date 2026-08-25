const mockSendLifecycleMessage = jest.fn();
const mockSendJoinDm = jest.fn();
const mockHandleMemberJoin = jest.fn();
const mockHandleAutomodMemberUpdate = jest.fn();
const mockEnforceForcedNickname = jest.fn();

jest.mock('../src/services/lifecycleMessageService', () => ({
    sendLifecycleMessage: (...args) => mockSendLifecycleMessage(...args),
    sendJoinDm: (...args) => mockSendJoinDm(...args),
    isNewBoost: (oldMember, newMember) => !oldMember.premiumSince && Boolean(newMember.premiumSince)
}));
jest.mock('../src/services/antiraidService', () => ({ handleMemberJoin: (...args) => mockHandleMemberJoin(...args) }));
jest.mock('../src/services/automodService', () => ({ handleMemberUpdate: (...args) => mockHandleAutomodMemberUpdate(...args) }));
jest.mock('../src/services/roleModerationService', () => ({ enforceForcedNickname: (...args) => mockEnforceForcedNickname(...args) }));

const joined = require('../src/events/guildMemberAdd');
const removed = require('../src/events/guildMemberRemove');
const updated = require('../src/events/guildMemberUpdate');

describe('lifecycle event routing', () => {
    const member = changes => ({ id: 'user1', nickname: null, premiumSince: null, guild: { id: 'guild1' }, ...changes });

    beforeEach(() => {
        jest.clearAllMocks();
        mockHandleMemberJoin.mockResolvedValue(null);
        mockHandleAutomodMemberUpdate.mockResolvedValue(null);
        mockSendLifecycleMessage.mockResolvedValue({ status: 'sent' });
        mockSendJoinDm.mockResolvedValue({ status: 'sent' });
    });

    test('does not welcome a member punished by AntiRaid', async () => {
        mockHandleMemberJoin.mockResolvedValue({ status: 'punished' });
        await joined.execute(member());
        expect(mockSendLifecycleMessage).not.toHaveBeenCalled();
        expect(mockSendJoinDm).not.toHaveBeenCalled();
    });

    test('does not welcome when AntiRaid detects an incident but its action fails', async () => {
        mockHandleMemberJoin.mockResolvedValue({ status: 'failed' });
        await joined.execute(member());
        expect(mockSendLifecycleMessage).not.toHaveBeenCalled();
        expect(mockSendJoinDm).not.toHaveBeenCalled();
    });

    test('routes Join DM only after join protection accepts the member', async () => {
        const target = member();
        await joined.execute(target);
        expect(mockSendJoinDm).toHaveBeenCalledWith(target);
    });

    test('does not welcome after a punitive AutoMod join action or failed enforcement', async () => {
        mockHandleAutomodMemberUpdate.mockResolvedValueOnce({ filter: 'nicknames', action: 'kick' });
        await joined.execute(member());
        expect(mockSendLifecycleMessage).not.toHaveBeenCalled();
        expect(mockSendJoinDm).not.toHaveBeenCalled();

        mockHandleAutomodMemberUpdate.mockRejectedValueOnce(new Error('Discord unavailable'));
        await joined.execute(member({ id: 'user2' }));
        expect(mockSendLifecycleMessage).not.toHaveBeenCalled();
        expect(mockSendJoinDm).not.toHaveBeenCalled();
    });

    test('routes member removals to goodbye messaging', async () => {
        const target = member();
        await removed.execute(target);
        expect(mockSendLifecycleMessage).toHaveBeenCalledWith('goodbye', target);
    });

    test('routes a new boost even when the nickname is unchanged', async () => {
        const oldMember = member();
        const newMember = member({ premiumSince: new Date() });
        await updated.execute(oldMember, newMember);
        expect(mockEnforceForcedNickname).not.toHaveBeenCalled();
        expect(mockSendLifecycleMessage).toHaveBeenCalledWith('boost', newMember);
    });
});
