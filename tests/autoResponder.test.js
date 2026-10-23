const { Worker } = require('worker_threads');

function isolatedMatch(content, trigger, matchType, workerFault) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(`
            const workerThreads = require('worker_threads');
            const { parentPort, workerData, Worker } = workerThreads;
            if (workerData.workerFault) {
                let failed = false;
                workerThreads.Worker = class extends Worker {
                    constructor(filename, options) {
                        if (!failed && workerData.workerFault === 'startup') {
                            failed = true;
                            super('setInterval(() => {}, 1000)', { eval: true });
                            return;
                        }
                        super(filename, options);
                        if (!failed) {
                            failed = true;
                            queueMicrotask(() => workerData.workerFault === 'error'
                                ? this.emit('error', new Error('Injected worker failure'))
                                : this.terminate());
                        }
                    }
                };
            }
            const AutoResponderService = require(workerData.servicePath);
            const service = new AutoResponderService({});
            const heartbeat = setInterval(() => parentPort.postMessage({ heartbeat: true }), 10);
            parentPort.once('message', async () => {
                const matched = await service.matchesTrigger(workerData.content, workerData.trigger, workerData.matchType);
                const recovered = await service.matchesTrigger('HELLO123', '^hello[0-9]+$', 'regex');
                await service.cleanup();
                clearInterval(heartbeat);
                parentPort.postMessage({ finished: true, matched, recovered });
            });
            parentPort.postMessage({ ready: true });
        `, {
            eval: true,
            workerData: { servicePath: require.resolve('../src/services/autoResponderService'), content, trigger, matchType, workerFault }
        });
        let heartbeat = false;
        let timer = setTimeout(() => finish({ finished: false }), 3000);
        const finish = async result => {
            clearTimeout(timer);
            await worker.terminate();
            resolve({ ...result, heartbeat });
        };
        worker.on('error', async error => {
            clearTimeout(timer);
            await worker.terminate();
            reject(error);
        });
        worker.on('message', result => {
            if (result.ready) {
                clearTimeout(timer);
                timer = setTimeout(() => finish({ finished: false }), 2000);
                worker.postMessage('match');
            } else if (result.heartbeat) heartbeat = true;
            else if (result.finished) finish(result);
        });
    });
}

describe('Auto-Responder System', () => {
    let serviceInstances = [];

    afterEach(async () => {
        // Clean up all service instances to prevent timer leaks
        await Promise.all(serviceInstances.map(service => {
            if (service && service.cleanup) {
                return service.cleanup();
            }
        }));
        serviceInstances = [];
    });

    describe('Service Structure', () => {
        test('uses the current public 500-responder maximum', () => {
            const AutoResponderService = require('../src/services/autoResponderService');
            expect(AutoResponderService.MAX_AUTO_RESPONDERS).toBe(500);
        });

        test('autoResponderService should be properly structured', () => {
            const AutoResponderService = require('../src/services/autoResponderService');
            const mockClient = {};
            const service = new AutoResponderService(mockClient);
            serviceInstances.push(service);

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
            serviceInstances.push(service);
        });

        test('exact match should work correctly', async () => {
            expect(await service.matchesTrigger('hello', 'hello', 'exact')).toBe(true);
            expect(await service.matchesTrigger('Hello', 'hello', 'exact')).toBe(true);
            expect(await service.matchesTrigger('hello world', 'hello', 'exact')).toBe(false);
        });

        test('contains match should work correctly', async () => {
            expect(await service.matchesTrigger('hello world', 'world', 'contains')).toBe(true);
            expect(await service.matchesTrigger('test message', 'sage', 'contains')).toBe(true);
            expect(await service.matchesTrigger('test', 'example', 'contains')).toBe(false);
        });

        test('wildcard match should work correctly', async () => {
            expect(await service.matchesTrigger('hello world', 'hello*', 'wildcard')).toBe(true);
            expect(await service.matchesTrigger('test123', 'test?23', 'wildcard')).toBe(true);
            expect(await service.matchesTrigger('hello world', 'hello', 'wildcard')).toBe(false);
        });

        test('wildcard match treats regex punctuation as literal text', async () => {
            expect(await service.matchesTrigger('file[1].txt', 'file[1].*', 'wildcard')).toBe(true);
            expect(await service.matchesTrigger('file1.txt', 'file[1].*', 'wildcard')).toBe(false);
        });

        test('regex match should work correctly', async () => {
            expect(await service.matchesTrigger('hello123', 'hello\\d+', 'regex')).toBe(true);
            expect(await service.matchesTrigger('test@example.com', '\\S+@\\S+', 'regex')).toBe(true);
            expect(await service.matchesTrigger('hello', 'world', 'regex')).toBe(false);
        });

        test('regex match should handle invalid patterns gracefully', async () => {
            expect(await service.matchesTrigger('test', '[invalid(', 'regex')).toBe(false);
            expect(await service.matchesTrigger('HELLO', '^hello$', 'regex')).toBe(true);
        });

        test.each([
            ['HELLO', '^hello$', 'regex', true],
            ['123', '\\D+', 'regex', false],
            ['ABC', '\\D+', 'regex', true],
            ['K', 'k', 'regex', false],
            ['FILE[1].TXT', 'file[1].*', 'wildcard', true],
            ['hello\n', 'hello', 'wildcard', false],
            ['a\nb', 'a*b', 'wildcard', false],
            ['😀', '?', 'wildcard', false],
            ['😀', '??', 'wildcard', true],
            ['hello', 'hello', 'unknown', false]
        ])('matching preserves %p against %p in %s mode', async (content, trigger, mode, expected) => {
            expect(await service.matchesTrigger(content, trigger, mode)).toBe(expected);
        });

        test.each([
            ['regex', '(a+)+$'],
            ['wildcard', '*a'.repeat(30) + 'b']
        ])('%s matching times out without blocking its caller', async (matchType, trigger) => {
            expect(await isolatedMatch('a'.repeat(100) + '!', trigger, matchType)).toEqual({
                finished: true, matched: false, heartbeat: true, recovered: true
            });
        });

        test.each(['exit', 'error', 'startup'])('a worker %s fails closed and the next match recovers', async fault => {
            expect(await isolatedMatch('hello', '^hello$', 'regex', fault)).toEqual(expect.objectContaining({
                finished: true, matched: false, recovered: true
            }));
        });

        test('a full matcher backlog rejects overflow without affecting another service', async () => {
            const AutoResponderService = require('../src/services/autoResponderService');
            const other = new AutoResponderService({});
            serviceInstances.push(other);
            const pending = Array.from({ length: 32 }, () => service.matchesTrigger('hello', '^hello$', 'regex'));
            await expect(service.matchesTrigger('hello', '^hello$', 'regex')).resolves.toBe(false);
            await expect(other.matchesTrigger('hello', 'hello*', 'wildcard')).resolves.toBe(true);
            expect(await Promise.all(pending)).toEqual(Array(32).fill(true));
        });

        test('shutdown settles active and queued matches and refuses further matching', async () => {
            const pending = Array.from({ length: 4 }, () => service.matchesTrigger('hello', '^hello$', 'regex'));
            await service.cleanup();
            expect(await Promise.all(pending)).toEqual([false, false, false, false]);
            await expect(service.matchesTrigger('hello', 'hello', 'exact')).resolves.toBe(false);
            await expect(service.matchesTrigger('hello', '^hello$', 'regex')).resolves.toBe(false);
            await service.cleanup();
        });
    });

    describe('Response Parsing', () => {
        let service;

        beforeEach(() => {
            const AutoResponderService = require('../src/services/autoResponderService');
            service = new AutoResponderService({});
            serviceInstances.push(service);
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
            serviceInstances.push(service);
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
    function findGroup(command, name) {
        return command.data.options.find(opt => opt.name === name);
    }

    function findSubcommand(command, groupName, subcommandName) {
        const group = findGroup(command, groupName);
        return group.options.find(opt => opt.name === subcommandName);
    }

    test('/autorespond command should have all required subcommands', () => {
        const autoRespondCmd = require('../src/commands/administration/autorespond');
        const groups = autoRespondCmd.data.options;

        expect(groups.map(opt => opt.name)).toEqual(['manage', 'browse']);
        expect(findGroup(autoRespondCmd, 'manage').options.map(opt => opt.name)).toEqual(['add', 'edit', 'remove', 'toggle']);
        expect(findGroup(autoRespondCmd, 'browse').options.map(opt => opt.name)).toEqual(['list']);
    });

    test('/autorespond add should have match type choices', () => {
        const autoRespondCmd = require('../src/commands/administration/autorespond');
        const addSubcommand = findSubcommand(autoRespondCmd, 'manage', 'add');
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
        const addSubcommand = findSubcommand(autoRespondCmd, 'manage', 'add');
        const responseOption = addSubcommand.options.find(opt => opt.name === 'response');

        expect(responseOption.max_length).toBe(2000); // Discord's message limit
    });
});
