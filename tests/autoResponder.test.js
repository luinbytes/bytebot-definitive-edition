describe('Auto-Responder System', () => {
    describe('Service Structure', () => {
        test('autoResponderService should be properly structured', () => {
            const AutoResponderService = require('../src/services/autoResponderService');
            const mockClient = {};
            const service = new AutoResponderService(mockClient);

            expect(service.client).toBe(mockClient);
            expect(service.cooldowns).toBeInstanceOf(Map);
            expect(service.cache).toBeInstanceOf(Map);
            expect(service.cacheExpiry).toBeInstanceOf(Map);
            expect(typeof service.checkMessage).toBe('function');
            expect(typeof service.matchesTrigger).toBe('function');
            expect(typeof service.parseResponse).toBe('function');
        });
    });

    describe('Trigger Matching', () => {
        let service;

        beforeEach(() => {
            const AutoResponderService = require('../src/services/autoResponderService');
            service = new AutoResponderService({});
        });

        test('exact match should work correctly', () => {
            expect(service.matchesTrigger('hello', 'hello', 'exact')).toBe(true);
            expect(service.matchesTrigger('Hello', 'hello', 'exact')).toBe(true); // Case insensitive
            expect(service.matchesTrigger('hello world', 'hello', 'exact')).toBe(false);
        });

        test('contains match should work correctly', () => {
            expect(service.matchesTrigger('hello world', 'world', 'contains')).toBe(true);
            expect(service.matchesTrigger('test message', 'sage', 'contains')).toBe(true);
            expect(service.matchesTrigger('test', 'example', 'contains')).toBe(false);
        });

        test('wildcard match should work correctly', () => {
            expect(service.matchesTrigger('hello world', 'hello*', 'wildcard')).toBe(true);
            expect(service.matchesTrigger('test123', 'test?23', 'wildcard')).toBe(true);
            expect(service.matchesTrigger('hello world', 'hello', 'wildcard')).toBe(false); // Must match fully
        });

        test('regex match should work correctly', () => {
            expect(service.matchesTrigger('hello123', 'hello\\d+', 'regex')).toBe(true);
            expect(service.matchesTrigger('test@example.com', '\\S+@\\S+', 'regex')).toBe(true);
            expect(service.matchesTrigger('hello', 'world', 'regex')).toBe(false);
        });

        test('regex match should handle invalid patterns gracefully', () => {
            expect(service.matchesTrigger('test', '[invalid(', 'regex')).toBe(false);
        });
    });

    describe('Response Parsing', () => {
        let service;

        beforeEach(() => {
            const AutoResponderService = require('../src/services/autoResponderService');
            service = new AutoResponderService({});
        });

        test('should parse user variable', () => {
            const mockMessage = {
                author: { id: '123456', username: 'TestUser' },
                guild: { name: 'Test Guild' },
                channel: { id: '789' }
            };

            const result = service.parseResponse('Hello {user}!', mockMessage);
            expect(result).toBe('Hello <@123456>!');
        });

        test('should parse server variable', () => {
            const mockMessage = {
                author: { id: '123', username: 'Test' },
                guild: { name: 'My Server' },
                channel: { id: '789' }
            };

            const result = service.parseResponse('Welcome to {server}', mockMessage);
            expect(result).toBe('Welcome to My Server');
        });

        test('should parse channel variable', () => {
            const mockMessage = {
                author: { id: '123', username: 'Test' },
                guild: { name: 'Test' },
                channel: { id: '456' }
            };

            const result = service.parseResponse('This is {channel}', mockMessage);
            expect(result).toBe('This is <#456>');
        });

        test('should parse username variable', () => {
            const mockMessage = {
                author: { id: '123', username: 'CoolUser' },
                guild: { name: 'Test' },
                channel: { id: '456' }
            };

            const result = service.parseResponse('Hi {username}!', mockMessage);
            expect(result).toBe('Hi CoolUser!');
        });

        test('should parse multiple variables', () => {
            const mockMessage = {
                author: { id: '123', username: 'TestUser' },
                guild: { name: 'Test Server' },
                channel: { id: '456' }
            };

            const result = service.parseResponse('{user} welcome to {server} in {channel}!', mockMessage);
            expect(result).toContain('<@123>');
            expect(result).toContain('Test Server');
            expect(result).toContain('<#456>');
        });
    });

    describe('Cache Management', () => {
        let service;

        beforeEach(() => {
            const AutoResponderService = require('../src/services/autoResponderService');
            service = new AutoResponderService({});
        });

        test('should cache and retrieve responses', () => {
            const mockResponses = [{ id: 1, trigger: 'test' }];
            service.cacheResponses('guild1', mockResponses);

            const cached = service.getCachedResponses('guild1');
            expect(cached).toEqual(mockResponses);
        });

        test('should respect cache expiry', () => {
            jest.useFakeTimers();

            const mockResponses = [{ id: 1, trigger: 'test' }];
            service.cacheResponses('guild1', mockResponses);

            // Should be cached
            expect(service.getCachedResponses('guild1')).toEqual(mockResponses);

            // Fast-forward past expiry (5 minutes)
            jest.advanceTimersByTime(301000);

            // Should be expired
            expect(service.getCachedResponses('guild1')).toBeNull();

            jest.useRealTimers();
        });

        test('should invalidate cache', () => {
            const mockResponses = [{ id: 1, trigger: 'test' }];
            service.cacheResponses('guild1', mockResponses);
            expect(service.getCachedResponses('guild1')).toEqual(mockResponses);

            service.invalidateCache('guild1');
            expect(service.getCachedResponses('guild1')).toBeNull();
        });
    });
});

describe('Auto-Responder Command', () => {
    test('/autorespond command should have all required subcommands', () => {
        const autoRespondCmd = require('../src/commands/administration/autorespond');
        const subcommands = autoRespondCmd.data.options;

        const subcommandNames = subcommands.map(opt => opt.name);
        expect(subcommandNames).toContain('add');
        expect(subcommandNames).toContain('remove');
        expect(subcommandNames).toContain('list');
        expect(subcommandNames).toContain('toggle');
        expect(subcommandNames).toContain('edit');
    });

    test('/autorespond add should have match type choices', () => {
        const autoRespondCmd = require('../src/commands/administration/autorespond');
        const addSubcommand = autoRespondCmd.data.options.find(opt => opt.name === 'add');
        const matchTypeOption = addSubcommand.options.find(opt => opt.name === 'match_type');

        expect(matchTypeOption).toBeDefined();
        expect(matchTypeOption.choices.length).toBeGreaterThan(0);

        const choiceValues = matchTypeOption.choices.map(c => c.value);
        expect(choiceValues).toContain('exact');
        expect(choiceValues).toContain('contains');
        expect(choiceValues).toContain('wildcard');
        expect(choiceValues).toContain('regex');
    });

    test('/autorespond add should validate response length', () => {
        const autoRespondCmd = require('../src/commands/administration/autorespond');
        const addSubcommand = autoRespondCmd.data.options.find(opt => opt.name === 'add');
        const responseOption = addSubcommand.options.find(opt => opt.name === 'response');

        expect(responseOption.max_length).toBe(2000); // Discord's message limit
    });
});
