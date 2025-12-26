const ActivityStreakService = require('../src/services/activityStreakService');

describe('Activity Streak Service', () => {
    let service;
    let mockClient;

    beforeEach(() => {
        mockClient = {};
        service = new ActivityStreakService(mockClient);
    });

    afterEach(() => {
        if (service && service.checkInterval) {
            clearInterval(service.checkInterval);
            service.checkInterval = null;
        }
    });

    describe('Service Structure', () => {
        test('should initialize with client and null checkInterval', () => {
            expect(service.client).toBe(mockClient);
            expect(service.checkInterval).toBeNull();
        });

        test('should have all required methods', () => {
            expect(typeof service.startDailyCheck).toBe('function');
            expect(typeof service.checkMissedDays).toBe('function');
            expect(typeof service.processDailyStreaks).toBe('function');
            expect(typeof service.recordActivity).toBe('function');
            expect(typeof service.breakStreak).toBe('function');
            expect(typeof service.getTodayDateString).toBe('function');
            expect(typeof service.getYesterdayDateString).toBe('function');
            expect(typeof service.getDaysBetween).toBe('function');
            expect(typeof service.resetMonthlyFreezes).toBe('function');
            expect(typeof service.cleanup).toBe('function');
        });
    });

    describe('Date Utilities', () => {
        test('getTodayDateString should return YYYY-MM-DD format', () => {
            const today = service.getTodayDateString();
            expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        test('getYesterdayDateString should return date one day before today', () => {
            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setUTCDate(yesterday.getUTCDate() - 1);

            const expectedDate = yesterday.toISOString().split('T')[0];
            const actualDate = service.getYesterdayDateString();

            expect(actualDate).toBe(expectedDate);
        });

        test('getDaysBetween should calculate correct day difference', () => {
            expect(service.getDaysBetween('2025-01-01', '2025-01-01')).toBe(0);
            expect(service.getDaysBetween('2025-01-01', '2025-01-02')).toBe(1);
            expect(service.getDaysBetween('2025-01-01', '2025-01-05')).toBe(4);
            expect(service.getDaysBetween('2025-01-01', '2025-02-01')).toBe(31);
        });

        test('getDaysBetween should handle reverse order dates', () => {
            const result = service.getDaysBetween('2025-01-05', '2025-01-01');
            expect(Math.abs(result)).toBe(4);
        });
    });

    describe('Cleanup', () => {
        test('should have cleanup method', () => {
            expect(typeof service.cleanup).toBe('function');
        });

        test('cleanup should call clearInterval', () => {
            const originalClearInterval = global.clearInterval;
            const mockClearInterval = jest.fn();
            global.clearInterval = mockClearInterval;

            service.checkInterval = setInterval(() => {}, 10000);
            service.cleanup();

            expect(mockClearInterval).toHaveBeenCalled();

            global.clearInterval = originalClearInterval;
        });
    });

    describe('Activity Tracking Methods', () => {
        test('recordActivity should have correct signature', () => {
            expect(service.recordActivity.length).toBeGreaterThanOrEqual(3);
        });

        test('breakStreak should have correct signature', () => {
            expect(service.breakStreak.length).toBe(2); // userId, guildId
        });
    });
});
