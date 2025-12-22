const { parseTime, formatDuration } = require('../src/utils/timeParser');

describe('Time Parser Utility', () => {
    describe('parseTime', () => {
        test('should parse simple durations correctly', () => {
            const testCases = [
                { input: '10s', expected: 10000 },
                { input: '30m', expected: 1800000 },
                { input: '2h', expected: 7200000 },
                { input: '5d', expected: 432000000 },
                { input: '1w', expected: 604800000 },
            ];

            testCases.forEach(({ input, expected }) => {
                const result = parseTime(input);
                expect(result.success).toBe(true);
                expect(result.duration).toBe(expected);
                expect(result.timestamp).toBeGreaterThan(Date.now());
            });
        });

        test('should parse compound durations correctly', () => {
            const result = parseTime('2h 30m');
            expect(result.success).toBe(true);
            expect(result.duration).toBe(9000000); // 2.5 hours in ms
        });

        test('should reject invalid time formats', () => {
            const testCases = [
                'invalid',
                '10x',
                '',
                'abc123',
                'test',
                '10',  // Missing unit
                'minutes',  // No number
            ];

            testCases.forEach(input => {
                const result = parseTime(input);
                expect(result.success).toBe(false);
                expect(result.error).toBeDefined();
            });
        });

        test('should reject durations exceeding 1 year', () => {
            const result = parseTime('400d');
            expect(result.success).toBe(false);
            expect(result.error).toContain('1 year');
        });

        test('should reject zero duration', () => {
            const result = parseTime('0m');
            expect(result.success).toBe(false);
        });

        test('should be case insensitive', () => {
            const result1 = parseTime('10M');
            const result2 = parseTime('10m');
            expect(result1.success).toBe(true);
            expect(result2.success).toBe(true);
            expect(result1.duration).toBe(result2.duration);
        });
    });

    describe('formatDuration', () => {
        test('should format single units correctly', () => {
            expect(formatDuration(1000)).toBe('1 second');
            expect(formatDuration(60000)).toBe('1 minute');
            expect(formatDuration(3600000)).toBe('1 hour');
            expect(formatDuration(86400000)).toBe('1 day');
            expect(formatDuration(604800000)).toBe('1 week');
        });

        test('should pluralize correctly', () => {
            expect(formatDuration(2000)).toBe('2 seconds');
            expect(formatDuration(120000)).toBe('2 minutes');
        });

        test('should format compound durations correctly', () => {
            expect(formatDuration(3661000)).toBe('1 hour, 1 minute, and 1 second');
            expect(formatDuration(90061000)).toBe('1 day, 1 hour, 1 minute, and 1 second');
            expect(formatDuration(3600000)).toBe('1 hour'); // Exact hour, no extra parts
        });

        test('should handle zero duration', () => {
            expect(formatDuration(0)).toBe('0 seconds');
        });
    });
});
