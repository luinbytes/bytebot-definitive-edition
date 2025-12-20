/**
 * Logger Utility Tests
 * Tests the enhanced logging functionality
 */

const logger = require('../src/utils/logger');

describe('Logger Utility', () => {
    let consoleSpy;

    beforeEach(() => {
        consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
        consoleSpy.mockRestore();
    });

    test('logger should have all required methods', () => {
        expect(typeof logger.info).toBe('function');
        expect(typeof logger.success).toBe('function');
        expect(typeof logger.warn).toBe('function');
        expect(typeof logger.error).toBe('function');
        expect(typeof logger.debug).toBe('function');
        expect(typeof logger.errorContext).toBe('function');
    });

    test('info should log with [INFO] tag', () => {
        logger.info('Test message');
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('[INFO]');
        expect(output).toContain('Test message');
    });

    test('error should handle Error objects with stack traces', () => {
        const error = new Error('Test error');
        logger.error(error);
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('[ERROR]');
        expect(output).toContain('Test error');
        expect(output).toContain('Stack Trace');
    });

    test('error should handle string messages', () => {
        logger.error('Simple error string');
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('[ERROR]');
        expect(output).toContain('Simple error string');
    });

    test('errorContext should log with context details', () => {
        const error = new Error('Context error');
        logger.errorContext('Test Context', error, { userId: '123', guildId: '456' });

        expect(consoleSpy).toHaveBeenCalled();
        const calls = consoleSpy.mock.calls.map(c => c[0]).join('\n');
        expect(calls).toContain('Test Context');
        expect(calls).toContain('Context Details');
        expect(calls).toContain('userId');
        expect(calls).toContain('123');
    });

    test('error should include Discord API error details when present', () => {
        const discordError = new Error('Unknown Channel');
        discordError.code = 10003;
        discordError.status = 404;

        logger.error(discordError);
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('Code: 10003');
        expect(output).toContain('Status: 404');
    });
});
