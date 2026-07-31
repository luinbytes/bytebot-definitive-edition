const mockDbLog = {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
};

jest.mock('../src/database', () => ({ db: {} }));
jest.mock('../src/utils/dbLogger', () => ({ dbLog: mockDbLog }));
jest.mock('../src/utils/logger', () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn()
}));

const StarboardService = require('../src/services/starboardService');

test('refreshes the cached count for an entry that remains below threshold', async () => {
    const message = {
        id: 'message-1',
        guild: { id: 'guild-1' },
        channel: { id: 'channel-1' },
        author: { id: 'author-1' }
    };
    const channel = {
        guild: message.guild,
        isTextBased: () => true,
        messages: { fetch: jest.fn().mockResolvedValue(message) }
    };
    const service = new StarboardService({
        channels: { fetch: jest.fn().mockResolvedValue(channel) }
    });
    service.getConfig = jest.fn().mockResolvedValue({ enabled: true, threshold: 5, emoji: '⭐' });
    service.countValidStars = jest.fn().mockResolvedValue(2);
    mockDbLog.select.mockResolvedValue({
        id: 1,
        originalMessageId: 'message-1',
        starboardMessageId: null,
        starCount: 4
    });
    mockDbLog.update.mockResolvedValue(undefined);

    await service.updateStarboardMessage('message-1', 'channel-1');

    expect(mockDbLog.update).toHaveBeenCalledWith(
        'starboardMessages',
        expect.any(Function),
        expect.objectContaining({ entryId: 1, starCount: 2 })
    );
});
