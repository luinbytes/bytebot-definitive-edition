/**
 * Error Handler Utility Tests
 * Tests standardized error handling functions
 */

const { handleCommandError, handleDMError, generateErrorId, safeReply } = require('../src/utils/errorHandlerUtil');
const logger = require('../src/utils/logger');

// Mock logger
jest.mock('../src/utils/logger', () => ({
    error: jest.fn(),
    debug: jest.fn()
}));

// Mock embeds
jest.mock('../src/utils/embeds', () => ({
    error: jest.fn((title, description) => ({
        setFooter: jest.fn().mockReturnThis(),
        data: { title, description }
    }))
}));

describe('Error Handler Utility', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('generateErrorId', () => {
        test('should generate 8-character hex ID', () => {
            const id = generateErrorId();
            expect(id).toMatch(/^[0-9a-f]{8}$/);
            expect(id.length).toBe(8);
        });

        test('should generate unique IDs', () => {
            const id1 = generateErrorId();
            const id2 = generateErrorId();
            expect(id1).not.toBe(id2);
        });
    });

    describe('handleCommandError', () => {
        test('should log error with unique ID', async () => {
            const mockInteraction = {
                reply: jest.fn().mockResolvedValue({}),
                replied: false,
                deferred: false
            };

            const error = new Error('Test error');
            await handleCommandError(error, mockInteraction, 'testing command');

            expect(logger.error).toHaveBeenCalled();
            const logCall = logger.error.mock.calls[0];
            expect(logCall[0]).toMatch(/\[[0-9a-f]{8}\]/); // Check for error ID
            expect(logCall[0]).toContain('testing command');
        });

        test('should handle Discord API errors with specific messages', async () => {
            const mockInteraction = {
                reply: jest.fn().mockResolvedValue({}),
                replied: false,
                deferred: false
            };

            const error = new Error('Unknown Channel');
            error.code = 10003;

            await handleCommandError(error, mockInteraction, 'deleting channel');

            expect(mockInteraction.reply).toHaveBeenCalled();
        });

        test('should use ephemeral by default', async () => {
            const mockInteraction = {
                reply: jest.fn().mockResolvedValue({}),
                replied: false,
                deferred: false
            };

            const error = new Error('Test error');
            await handleCommandError(error, mockInteraction, 'testing');

            expect(mockInteraction.reply).toHaveBeenCalledWith(
                expect.objectContaining({
                    ephemeral: true
                })
            );
        });

        test('should respect ephemeral option', async () => {
            const mockInteraction = {
                reply: jest.fn().mockResolvedValue({}),
                replied: false,
                deferred: false
            };

            const error = new Error('Test error');
            await handleCommandError(error, mockInteraction, 'testing', { ephemeral: false });

            expect(mockInteraction.reply).toHaveBeenCalledWith(
                expect.objectContaining({
                    ephemeral: false
                })
            );
        });
    });

    describe('handleDMError', () => {
        test('should log DM disabled errors as debug', () => {
            const error = new Error('Cannot send messages to this user');
            error.code = 50007;

            handleDMError(error, '123456789', 'test notification');

            expect(logger.debug).toHaveBeenCalled();
            const logCall = logger.debug.mock.calls[0];
            expect(logCall[0]).toContain('123456789');
            expect(logCall[0]).toContain('test notification');
        });

        test('should log other errors as error level', () => {
            const error = new Error('Unknown error');
            error.code = 50001;

            handleDMError(error, '123456789', 'test notification');

            expect(logger.error).toHaveBeenCalled();
        });
    });

    describe('safeReply', () => {
        test('should reply when interaction not replied/deferred', async () => {
            const mockInteraction = {
                reply: jest.fn().mockResolvedValue({}),
                editReply: jest.fn().mockResolvedValue({}),
                replied: false,
                deferred: false
            };

            const options = { content: 'test' };
            await safeReply(mockInteraction, options);

            expect(mockInteraction.reply).toHaveBeenCalledWith(options);
            expect(mockInteraction.editReply).not.toHaveBeenCalled();
        });

        test('should editReply when interaction already replied', async () => {
            const mockInteraction = {
                reply: jest.fn().mockResolvedValue({}),
                editReply: jest.fn().mockResolvedValue({}),
                replied: true,
                deferred: false
            };

            const options = { content: 'test' };
            await safeReply(mockInteraction, options);

            expect(mockInteraction.editReply).toHaveBeenCalledWith(options);
            expect(mockInteraction.reply).not.toHaveBeenCalled();
        });

        test('should editReply when interaction deferred', async () => {
            const mockInteraction = {
                reply: jest.fn().mockResolvedValue({}),
                editReply: jest.fn().mockResolvedValue({}),
                replied: false,
                deferred: true
            };

            const options = { content: 'test' };
            await safeReply(mockInteraction, options);

            expect(mockInteraction.editReply).toHaveBeenCalledWith(options);
            expect(mockInteraction.reply).not.toHaveBeenCalled();
        });

        test('should catch and log errors from failed replies', async () => {
            const mockInteraction = {
                reply: jest.fn().mockRejectedValue(new Error('Failed to reply')),
                editReply: jest.fn(),
                replied: false,
                deferred: false
            };

            const options = { content: 'test' };
            await safeReply(mockInteraction, options);

            expect(logger.error).toHaveBeenCalled();
        });
    });
});
