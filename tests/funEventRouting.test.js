jest.mock('../src/utils/bookmarkUtil', () => ({ markDeleted: jest.fn().mockResolvedValue(0) }));
jest.mock('../src/services/antiraidService', () => ({ handleMassMention: jest.fn().mockResolvedValue(false) }));
jest.mock('../src/services/automodService', () => ({ handleMessage: jest.fn().mockResolvedValue(false) }));
jest.mock('../src/utils/honeypotUtil', () => ({ handleHoneypotMessage: jest.fn().mockResolvedValue(false) }));
jest.mock('../src/utils/uwuLockUtil', () => ({ handleUwuLockMessage: jest.fn().mockResolvedValue(false) }));

const deleted = require('../src/events/messageDelete');
const updated = require('../src/events/messageUpdate');
const reactionRemoved = require('../src/events/messageReactionRemove');
const created = require('../src/events/messageCreate');

describe('fun event routing', () => {
    test('routes deleted and edited messages into the bounded snipe service', async () => {
        const funService = { captureDeleted: jest.fn(), captureEdited: jest.fn() };
        const message = {
            id: 'message1', guild: { id: 'guild1' }, author: { bot: false },
            content: 'before', client: { funService }
        };
        await deleted.execute(message, { funService });
        await updated.execute(message, { ...message, content: 'after' }, { funService });
        expect(funService.captureDeleted).toHaveBeenCalledWith(message);
        expect(funService.captureEdited).toHaveBeenCalledWith(message, expect.objectContaining({ content: 'after' }));
    });

    test('routes removed reactions after existing partial and bot guards', async () => {
        const funService = { captureReaction: jest.fn() };
        const reaction = {
            partial: false,
            client: { funService },
            emoji: { name: '🔥' },
            message: { partial: false, guild: { id: 'guild1' } }
        };
        const user = { id: 'user1', bot: false };
        await reactionRemoved.execute(reaction, user);
        expect(funService.captureReaction).toHaveBeenCalledWith(reaction, user);
    });

    test('lets active games consume member messages before responders', async () => {
        const funService = { handleMessage: jest.fn().mockResolvedValue(true) };
        const autoResponderService = { checkMessage: jest.fn() };
        const message = { id: 'message1', guild: { id: 'guild1' }, author: { id: 'user1', bot: false } };
        await created.execute(message, { funService, autoResponderService });
        expect(funService.handleMessage).toHaveBeenCalledWith(message);
        expect(autoResponderService.checkMessage).not.toHaveBeenCalled();
    });
});
