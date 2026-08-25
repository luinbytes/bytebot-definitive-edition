const fs = require('fs');
const os = require('os');
const path = require('path');

describe('bounded fun games', () => {
    let tempDir;
    let database;
    let service;
    let timers;
    let sequence;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-fun-games-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        timers = [];
        sequence = 0;
        const { FunService } = require('../src/services/funService');
        service = new FunService({
            sqlite: database.sqlite,
            randomUUID: () => `session-${++sequence}`,
            randomInt: minimum => minimum,
            setTimeout: (callback, delay) => {
                const timer = { callback, delay, cleared: false, unref() {} };
                timers.push(timer);
                return timer;
            },
            clearTimeout: timer => { if (timer) timer.cleared = true; }
        });
    });

    afterEach(() => {
        service?.cleanup();
        database?.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('binds tic-tac-toe buttons to the two players and settles a winner', async () => {
        const reply = jest.fn(async payload => ({ edit: jest.fn(), payload }));
        await service.startTicTacToe({
            guildId: 'guild1', channelId: 'channel1', user: { id: 'p1' }, reply
        }, { id: 'p2', bot: false });
        const customId = reply.mock.calls[0][0].components[0].toJSON().components[0].custom_id;
        const update = jest.fn();
        const reject = jest.fn();

        await service.handleInteraction({ customId, user: { id: 'p2' }, update, reply: reject });
        expect(reject.mock.calls[0][0].embeds[0].data.description).toContain('turn');

        for (const [player, cell] of [['p1', 0], ['p2', 3], ['p1', 1], ['p2', 4], ['p1', 2]]) {
            await service.handleInteraction({
                customId: `fun:ttt:session-1:${cell}`, user: { id: player }, update, reply: reject
            });
        }
        expect(update.mock.calls.at(-1)[0].embeds[0].data.description).toContain('<@p1> won');
        expect(service.sessions.size).toBe(0);
    });

    test('starts one lobby per channel, joins safely, and cancels with too few players', async () => {
        const edit = jest.fn();
        const reply = jest.fn(async () => ({ edit }));
        await service.startLobby({
            guildId: 'guild1', channelId: 'channel1', user: { id: 'p1' }, channel: { send: jest.fn() }, reply
        }, 'blacktea');
        await expect(service.startLobby({
            guildId: 'guild1', channelId: 'channel1', user: { id: 'p2' }, channel: { send: jest.fn() }, reply
        }, 'flags')).rejects.toThrow('already running');

        const joinReply = jest.fn();
        await service.handleInteraction({ customId: 'fun:join:session-1', user: { id: 'p2' }, reply: joinReply });
        expect(joinReply.mock.calls[0][0].content).toContain('joined');
        expect(service.sessions.get('channel1').players.has('p2')).toBe(true);

        service.sessions.get('channel1').players.delete('p2');
        await timers[0].callback();
        expect(edit.mock.calls[0][0].embeds[0].data.description).toContain('Not enough players');
        expect(service.sessions.size).toBe(0);
    });

    test('uses bundled neutral questions and a bounded single-player flag session', async () => {
        expect(service.randomWouldYouRather()).toMatch(/^Would you rather /);
        const reply = jest.fn(async payload => ({ edit: jest.fn(), payload }));
        await service.startSingleFlag({
            guildId: 'guild1', channelId: 'channel1', user: { id: 'p1' }, reply
        }, 'easy');
        expect(reply.mock.calls[0][0].embeds[0].data.description).toContain('🇫🇷');
        const response = { guild: { id: 'guild1' }, channelId: 'channel1', author: { id: 'p1', bot: false }, content: 'France', reply: jest.fn() };
        await expect(service.handleMessage(response)).resolves.toBe(true);
        expect(response.reply.mock.calls[0][0].embeds[0].data.description).toContain('France');
        expect(service.sessions.size).toBe(0);
    });

    test('releases the channel when Discord rejects a game reply', async () => {
        await expect(service.startTicTacToe({
            guildId: 'guild1', channelId: 'channel1', user: { id: 'p1' },
            reply: jest.fn().mockRejectedValue(new Error('Missing Access'))
        }, { id: 'p2', bot: false })).rejects.toThrow('Missing Access');
        expect(service.sessions.size).toBe(0);
    });
});
