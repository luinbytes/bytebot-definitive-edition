const mockSendLifecycleMessage = jest.fn();
const mockHandleMemberJoin = jest.fn();
const mockHandleAutomodMemberUpdate = jest.fn();
const mockEnforceForcedNickname = jest.fn();

jest.mock('../src/services/lifecycleMessageService', () => ({
    sendLifecycleMessage: (...args) => mockSendLifecycleMessage(...args),
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
    });

    test('does not welcome a member punished by AntiRaid', async () => {
        mockHandleMemberJoin.mockResolvedValue({ status: 'punished' });
        await joined.execute(member());
        expect(mockSendLifecycleMessage).not.toHaveBeenCalled();
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
