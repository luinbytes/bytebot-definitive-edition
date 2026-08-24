jest.mock('../src/utils/honeypotUtil', () => ({ handleHoneypotMessage: jest.fn().mockResolvedValue(false) }));
jest.mock('../src/utils/uwuLockUtil', () => ({ handleUwuLockMessage: jest.fn().mockResolvedValue(false) }));
jest.mock('../src/services/antiraidService', () => ({ handleMassMention: jest.fn().mockResolvedValue(false) }));
jest.mock('../src/services/automodService', () => ({ handleMessage: jest.fn().mockResolvedValue(false) }));

const messageCreate = require('../src/events/messageCreate');

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
});
