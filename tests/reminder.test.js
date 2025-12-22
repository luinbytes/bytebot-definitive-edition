describe('Reminder System', () => {
    let serviceInstances = [];

    afterEach(() => {
        // Clean up all service instances to prevent timer leaks
        serviceInstances.forEach(service => {
            if (service && service.cleanup) {
                service.cleanup();
            }
        });
        serviceInstances = [];
    });

    describe('Service Structure', () => {
        test('reminderService should be properly structured', () => {
            const ReminderService = require('../src/services/reminderService');
            const mockClient = {
                channels: { fetch: jest.fn() },
                users: { fetch: jest.fn() },
                guilds: { fetch: jest.fn() }
            };
            const service = new ReminderService(mockClient);
            serviceInstances.push(service);

            expect(service.client).toBe(mockClient);
            expect(service.activeTimers).toBeInstanceOf(Map);
            expect(service.longDelayChecks).toBeInstanceOf(Map);
            expect(typeof service.loadReminders).toBe('function');
            expect(typeof service.scheduleReminder).toBe('function');
            expect(typeof service.fireReminder).toBe('function');
            expect(typeof service.cancelReminder).toBe('function');
        });

        test('should handle cleanup correctly', () => {
            const ReminderService = require('../src/services/reminderService');
            const mockClient = {
                channels: { fetch: jest.fn() },
                users: { fetch: jest.fn() }
            };
            const service = new ReminderService(mockClient);
            serviceInstances.push(service);

            // Mock some timers
            service.activeTimers.set(1, setTimeout(() => {}, 1000));
            service.longDelayChecks.set(2, setInterval(() => {}, 1000));

            expect(service.activeTimers.size).toBe(1);
            expect(service.longDelayChecks.size).toBe(1);

            service.cleanup();

            expect(service.activeTimers.size).toBe(0);
            expect(service.longDelayChecks.size).toBe(0);
        });
    });

    describe('Delay Handling', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        test('should use setTimeout for short delays', () => {
            const ReminderService = require('../src/services/reminderService');
            const mockClient = {
                channels: { fetch: jest.fn() },
                users: { fetch: jest.fn() }
            };
            const service = new ReminderService(mockClient);
            serviceInstances.push(service);
            service.fireReminder = jest.fn();

            const shortReminder = {
                id: 1,
                userId: 'user1',
                triggerAt: Date.now() + 60000, // 1 minute
                message: 'Test'
            };

            service.scheduleReminder(shortReminder);

            expect(service.activeTimers.has(1)).toBe(true);
            expect(service.longDelayChecks.has(1)).toBe(false);
        });

        test('should use setInterval for long delays', () => {
            const ReminderService = require('../src/services/reminderService');
            const mockClient = {
                channels: { fetch: jest.fn() },
                users: { fetch: jest.fn() }
            };
            const service = new ReminderService(mockClient);
            serviceInstances.push(service);

            const longReminder = {
                id: 2,
                userId: 'user2',
                triggerAt: Date.now() + (30 * 86400000), // 30 days
                message: 'Test'
            };

            service.scheduleReminder(longReminder);

            expect(service.activeTimers.has(2)).toBe(false);
            expect(service.longDelayChecks.has(2)).toBe(true);
        });
    });

    describe('Relative Time Formatting', () => {
        test('should format relative time correctly', () => {
            const ReminderService = require('../src/services/reminderService');
            const mockClient = {
                channels: { fetch: jest.fn() },
                users: { fetch: jest.fn() }
            };
            const service = new ReminderService(mockClient);
            serviceInstances.push(service);

            const now = Date.now();

            expect(service.getRelativeTime(now - 30000)).toContain('second');
            expect(service.getRelativeTime(now - 120000)).toContain('minute');
            expect(service.getRelativeTime(now - 7200000)).toContain('hour');
            expect(service.getRelativeTime(now - 172800000)).toContain('day');
        });
    });
});

describe('Reminder Command', () => {
    test('/reminder command should have all required subcommands', () => {
        const reminderCmd = require('../src/commands/utility/reminder');
        const subcommands = reminderCmd.data.options;

        const subcommandNames = subcommands.map(opt => opt.name);
        expect(subcommandNames).toContain('me');
        expect(subcommandNames).toContain('here');
        expect(subcommandNames).toContain('list');
        expect(subcommandNames).toContain('cancel');
    });

    test('/reminder me should require time and message', () => {
        const reminderCmd = require('../src/commands/utility/reminder');
        const meSubcommand = reminderCmd.data.options.find(opt => opt.name === 'me');

        const timeOption = meSubcommand.options.find(opt => opt.name === 'time');
        const messageOption = meSubcommand.options.find(opt => opt.name === 'message');

        expect(timeOption.required).toBe(true);
        expect(messageOption.required).toBe(true);
        expect(messageOption.max_length).toBe(1000);
    });

    test('/reminder cancel should validate ID as positive integer', () => {
        const reminderCmd = require('../src/commands/utility/reminder');
        const cancelSubcommand = reminderCmd.data.options.find(opt => opt.name === 'cancel');
        const idOption = cancelSubcommand.options.find(opt => opt.name === 'id');

        expect(idOption.required).toBe(true);
        expect(idOption.min_value).toBe(1);
    });
});
