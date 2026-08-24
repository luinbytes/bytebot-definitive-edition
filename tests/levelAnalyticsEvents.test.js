jest.mock('../src/utils/honeypotUtil', () => ({ handleHoneypotMessage: jest.fn().mockResolvedValue(false) }));
jest.mock('../src/utils/uwuLockUtil', () => ({ handleUwuLockMessage: jest.fn().mockResolvedValue(false) }));
jest.mock('../src/services/antiraidService', () => ({ handleMassMention: jest.fn().mockResolvedValue(false) }));
jest.mock('../src/services/automodService', () => ({ handleMessage: jest.fn().mockResolvedValue(false) }));

const messageCreate = require('../src/events/messageCreate');
const messageReactionAdd = require('../src/events/messageReactionAdd');
const messageReactionRemove = require('../src/events/messageReactionRemove');

describe('level analytics event adapters', () => {
    test('messageCreate records activity once and updates streaks only after commit', async () => {
        const recordMessage = jest.fn(() => ({ accepted: true, duplicate: false, xpAwarded: 20 }));
        const recordCommittedActivity = jest.fn().mockResolvedValue(undefined);
        const recordActivity = jest.fn();
        const recordActiveHour = jest.fn().mockResolvedValue(undefined);
        const message = {
            id: 'message1',
            content: 'hello',
            author: { id: 'user1', bot: false },
            guild: { id: 'guild1' }
        };

        await messageCreate.execute(message, {
            levelAnalyticsService: { recordMessage },
            activityStreakService: { recordCommittedActivity, recordActivity, recordActiveHour }
        });

        expect(recordMessage).toHaveBeenCalledWith(message);
        expect(recordCommittedActivity).toHaveBeenCalledWith('user1', 'guild1');
        expect(recordActivity).not.toHaveBeenCalled();
        expect(recordActiveHour).toHaveBeenCalledWith('user1', 'guild1', expect.any(Number));
    });

    test.each([
        ['add', messageReactionAdd, true],
        ['remove', messageReactionRemove, false]
    ])('reaction %s uses the state transition seam', async (_label, event, present) => {
        const recordReactionChange = jest.fn(() => ({ accepted: true, counted: present }));
        const recordCommittedActivity = jest.fn().mockResolvedValue(undefined);
        const recordReaction = jest.fn();
        const client = {
            levelAnalyticsService: { recordReactionChange },
            activityStreakService: { recordCommittedActivity, recordReaction }
        };
        const reaction = {
            partial: false,
            client,
            emoji: { id: null, name: '✨' },
            message: { id: 'message1', partial: false, guild: { id: 'guild1' } }
        };
        const user = { id: 'user1', bot: false };

        await event.execute(reaction, user);

        expect(recordReactionChange).toHaveBeenCalledWith(reaction, user, present);
        expect(recordReaction).not.toHaveBeenCalled();
        if (present) expect(recordCommittedActivity).toHaveBeenCalledWith('user1', 'guild1');
        else expect(recordCommittedActivity).not.toHaveBeenCalled();
    });
});
