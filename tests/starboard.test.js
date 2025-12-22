const { parseTime } = require('../src/utils/timeParser');

describe('Starboard System', () => {
    describe('Service Configuration', () => {
        test('starboardService should be properly structured', () => {
            const StarboardService = require('../src/services/starboardService');
            const mockClient = { channels: { cache: new Map() } };
            const service = new StarboardService(mockClient);

            expect(service.client).toBe(mockClient);
            expect(service.updateQueue).toBeInstanceOf(Map);
            expect(service.configCache).toBeInstanceOf(Map);
            expect(typeof service.getConfig).toBe('function');
            expect(typeof service.handleReactionAdd).toBe('function');
            expect(typeof service.handleReactionRemove).toBe('function');
            expect(typeof service.queueStarboardUpdate).toBe('function');
        });

        test('config cache should invalidate correctly', () => {
            const StarboardService = require('../src/services/starboardService');
            const mockClient = { channels: { cache: new Map() } };
            const service = new StarboardService(mockClient);

            const mockConfig = { guildId: '123', channelId: '456', threshold: 5 };
            service.configCache.set('123', mockConfig);
            expect(service.configCache.has('123')).toBe(true);

            service.invalidateCache('123');
            expect(service.configCache.has('123')).toBe(false);
        });
    });

    describe('Debouncing', () => {
        test('should manage update queue correctly', () => {
            const StarboardService = require('../src/services/starboardService');
            const mockClient = { channels: { cache: new Map() } };
            const service = new StarboardService(mockClient);

            // Queue update should add to queue
            service.queueStarboardUpdate('msg1');
            expect(service.updateQueue.has('msg1')).toBe(true);

            // Queueing same message should replace timeout
            const firstTimeout = service.updateQueue.get('msg1');
            service.queueStarboardUpdate('msg1');
            const secondTimeout = service.updateQueue.get('msg1');

            expect(firstTimeout).not.toBe(secondTimeout);
            expect(service.updateQueue.size).toBe(1);
        });
    });
});

describe('Starboard Command', () => {
    test('/starboard command should have all required subcommands', () => {
        const starboardCmd = require('../src/commands/administration/starboard');
        const subcommands = starboardCmd.data.options;

        const subcommandNames = subcommands.map(opt => opt.name);
        expect(subcommandNames).toContain('setup');
        expect(subcommandNames).toContain('config');
        expect(subcommandNames).toContain('disable');
        expect(subcommandNames).toContain('enable');
        expect(subcommandNames).toContain('top');
    });

    test('/starboard setup should validate threshold range', () => {
        const starboardCmd = require('../src/commands/administration/starboard');
        const setupSubcommand = starboardCmd.data.options.find(opt => opt.name === 'setup');
        const thresholdOption = setupSubcommand.options.find(opt => opt.name === 'threshold');

        expect(thresholdOption.min_value).toBe(1);
        expect(thresholdOption.max_value).toBe(50);
    });
});
