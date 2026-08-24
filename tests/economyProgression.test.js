const fs = require('fs');
const os = require('os');
const path = require('path');

describe('economy games and progression', () => {
    let tempDir;
    let database;
    let service;
    let now;
    let draws;
    let timers;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-economy-progression-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        const { EconomyService } = require('../src/services/economyService');
        now = Date.UTC(2026, 0, 1, 12);
        draws = [];
        timers = [];
        let id = 0;
        service = new EconomyService({
            sqlite: database.sqlite,
            now: () => now,
            randomUUID: () => `id-${++id}`,
            randomInt: (minimum) => draws.length ? draws.shift() : minimum,
            randomBytes: () => Buffer.from('progression'),
            setTimeout: (callback, delay) => {
                timers.push({ callback, delay });
                return { unref() {} };
            }
        });
        service.enable('guild1', 'admin1');
        service.configure('guild1', 'admin1', { startingBalance: 20000 });
        service.open({ guildId: 'guild1', userId: 'user1' });
        service.open({ guildId: 'guild1', userId: 'user2' });
    });

    afterEach(() => {
        database?.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('settles one-shot games once through the shared ledger and declared multiplier', () => {
        draws.push(0);
        expect(service.playGame({ guildId: 'guild1', userId: 'user1', game: 'coinflip', bet: 100, choice: 'heads' }))
            .toMatchObject({ status: 'won', bet: 100, credit: 250, net: 150 });
        expect(service.balance({ guildId: 'guild1', userId: 'user1' }).wallet).toBe(20150);
        expect(service.history({ guildId: 'guild1', userId: 'user1' }).slice(-2).map(row => [row.kind, row.walletDelta]))
            .toEqual([['game_bet', -100], ['game_settlement', 250]]);
        expect(service.circulation({ guildId: 'guild1', userId: 'user1' }))
            .toMatchObject({ minted: 40250n, destroyed: 100n, circulation: 40150 });
    });

    test('covers every public game with bounded bets and one active interactive session', () => {
        const games = [
            ['coinflip', 'heads'], ['dice'], ['gamble'], ['roulette', 'green'],
            ['highlow', 'higher'], ['slots'], ['plinko'], ['scratch']
        ];
        for (const [game, choice] of games) {
            expect(service.playGame({ guildId: 'guild1', userId: 'user1', game, bet: 10, choice }).status)
                .not.toBe('active');
        }
        expect(() => service.playGame({ guildId: 'guild1', userId: 'user1', game: 'coinflip', bet: 9, choice: 'heads' }))
            .toThrow('between 10 and 1,000,000');

        const ladder = service.playGame({ guildId: 'guild1', userId: 'user1', game: 'ladder', bet: 10 });
        expect(() => service.playGame({ guildId: 'guild1', userId: 'user1', game: 'crash', bet: 10 })).toThrow('active');
        const climbed = service.actGame({
            guildId: 'guild1', userId: 'user1', sessionId: ladder.id, nonce: ladder.nonce, action: 'climb'
        });
        expect(service.actGame({
            guildId: 'guild1', userId: 'user1', sessionId: ladder.id, nonce: ladder.nonce, action: 'cashout'
        }).status).toBe('cashed_out');
        expect(climbed.state.rung).toBe(1);

        const bombs = service.playGame({ guildId: 'guild1', userId: 'user1', game: 'bombs', bet: 10 });
        expect(service.gameComponents(bombs)[0].toJSON().components[0].options).toHaveLength(25);
        const safe = Array.from({ length: 25 }, (_, cell) => cell).find(cell => !bombs.state.bombs.includes(cell));
        service.actGame({ guildId: 'guild1', userId: 'user1', sessionId: bombs.id, nonce: bombs.nonce, action: 'reveal', value: safe });
        expect(service.actGame({ guildId: 'guild1', userId: 'user1', sessionId: bombs.id, nonce: bombs.nonce, action: 'cashout' }).status)
            .toBe('cashed_out');

        const crash = service.playGame({ guildId: 'guild1', userId: 'user1', game: 'crash', bet: 10 });
        expect(service.actGame({ guildId: 'guild1', userId: 'user1', sessionId: crash.id, nonce: crash.nonce, action: 'cashout' }).status)
            .toBe('cashed_out');

        const blackjack = service.playGame({ guildId: 'guild1', userId: 'user1', game: 'blackjack', bet: 10 });
        if (blackjack.status === 'active') {
            expect(service.actGame({
                guildId: 'guild1', userId: 'user1', sessionId: blackjack.id, nonce: blackjack.nonce, action: 'stand'
            }).status).not.toBe('active');
        }
    });

    test('binds interactive sessions to one actor and refunds an expired wager once', () => {
        const session = service.playGame({ guildId: 'guild1', userId: 'user1', game: 'ladder', bet: 100 });
        expect(session).toMatchObject({ status: 'active', game: 'ladder', bet: 100 });
        expect(() => service.actGame({ guildId: 'guild1', userId: 'user2', sessionId: session.id, nonce: session.nonce, action: 'climb' }))
            .toThrow('does not belong');
        now += 600001;
        expect(service.reconcileGameSessions()).toEqual({ refunded: 1 });
        expect(service.reconcileGameSessions()).toEqual({ refunded: 0 });
        expect(service.balance({ guildId: 'guild1', userId: 'user1' }).wallet).toBe(20000);
    });

    test('applies persisted crime and robbery outcomes without exposing bank balances', () => {
        const ages = { guildCreatedAt: now - 21600000, memberJoinedAt: now - 21600000 };
        draws.push(1, 100);
        expect(service.crime({ guildId: 'guild1', userId: 'user1', ...ages }))
            .toMatchObject({ status: 'won', amount: 150 });
        draws.push(1);
        expect(service.rob({ guildId: 'guild1', userId: 'user1', targetId: 'user2' }))
            .toMatchObject({ status: 'won', amount: 5000 });
        expect(service.balance({ guildId: 'guild1', userId: 'user1' }).wallet).toBe(25150);
        expect(service.balance({ guildId: 'guild1', userId: 'user2' }).wallet).toBe(15000);
        expect(() => service.rob({ guildId: 'guild1', userId: 'user1', targetId: 'user2' })).toThrow('cooldown');
    });

    test('keeps gang membership and ownership transitions race-safe', () => {
        const gang = service.createGang({ guildId: 'guild1', userId: 'user1', name: 'ALPHA' });
        const invite = service.inviteToGang({ guildId: 'guild1', userId: 'user1', targetId: 'user2' });
        expect(service.respondGangInvite({ guildId: 'guild1', userId: 'user2', inviteId: invite.id, nonce: invite.nonce, accept: true }))
            .toMatchObject({ status: 'accepted', gangId: gang.id });
        expect(service.respondGangInvite({ guildId: 'guild1', userId: 'user2', inviteId: invite.id, nonce: invite.nonce, accept: true }))
            .toMatchObject({ status: 'accepted', gangId: gang.id });
        expect(service.promoteGang({ guildId: 'guild1', userId: 'user1', targetId: 'user2' }).role).toBe('admin');
        expect(service.transferGang({ guildId: 'guild1', userId: 'user1', targetId: 'user2' }))
            .toMatchObject({ ownerId: 'user2' });
        expect(service.gangInfo({ guildId: 'guild1', userId: 'user1' }).members)
            .toEqual(expect.arrayContaining([
                expect.objectContaining({ userId: 'user1', role: 'admin' }),
                expect.objectContaining({ userId: 'user2', role: 'owner' })
            ]));
        expect(service.setGangBanner({
            guildId: 'guild1', userId: 'user2', url: 'https://example.com/banner.png'
        }).bannerUrl).toBe('https://example.com/banner.png');
        service.open({ guildId: 'guild1', userId: 'user3' });
        const pending = service.inviteToGang({ guildId: 'guild1', userId: 'user2', targetId: 'user3' });
        expect(service.leaveGang({ guildId: 'guild1', userId: 'user1' })).toBe(true);
        expect(service.disbandGang({ guildId: 'guild1', userId: 'user2' })).toBe(true);
        expect(database.sqlite.prepare('SELECT status, gang_id FROM economy_gang_invites WHERE id = ?').get(pending.id))
            .toEqual({ status: 'revoked', gang_id: null });
        expect(() => service.gangInfo({ guildId: 'guild1', userId: 'user2' })).toThrow('not in a gang');
    });

    test('accrues, collects, and replays laboratory operations durably', () => {
        expect(service.buyLab({ guildId: 'guild1', userId: 'user1', operationId: 'op-buy' }))
            .toMatchObject({ level: 1, ampoules: 1, wallet: 10000 });
        expect(service.buyLab({ guildId: 'guild1', userId: 'user1', operationId: 'op-buy' }))
            .toMatchObject({ level: 1, ampoules: 1, wallet: 10000 });
        now += 3600000;
        expect(service.labStatus({ guildId: 'guild1', userId: 'user1' })).toMatchObject({ stored: 100, hourly: 100 });
        expect(service.collectLab({ guildId: 'guild1', userId: 'user1', operationId: 'op-collect' }))
            .toMatchObject({ collected: 150, stored: 0 });
        expect(service.collectLab({ guildId: 'guild1', userId: 'user1', operationId: 'op-collect' }))
            .toMatchObject({ collected: 150, stored: 0 });
        expect(service.balance({ guildId: 'guild1', userId: 'user1' }).wallet).toBe(10150);
    });

    test('applies the fixed laboratory upgrade and ampoule tables atomically', () => {
        service.grant({ guildId: 'guild1', actorId: 'admin1', targetId: 'user1', amount: 20000, reason: 'Test funds' });
        service.buyLab({ guildId: 'guild1', userId: 'user1', operationId: 'op-buy' });
        expect(service.buyAmpoules({
            guildId: 'guild1', userId: 'user1', operationId: 'op-ampoules', amount: 2
        })).toMatchObject({ ampoules: 3, wallet: 26000 });
        expect(service.upgradeLab({ guildId: 'guild1', userId: 'user1', operationId: 'op-upgrade' }))
            .toMatchObject({ level: 2, storage: 2000, wallet: 16000 });
        expect(service.labStatus({ guildId: 'guild1', userId: 'user1' })).toMatchObject({ hourly: 300, nextUpgrade: 15000 });
    });

    test('orders the committed guild leaderboard with a stable tie break', () => {
        expect(service.leaderboard({ guildId: 'guild1' }).rows.map(row => row.userId)).toEqual(['user1', 'user2']);
        service.transfer({ guildId: 'guild1', userId: 'user2', targetId: 'user1', amount: 1 });
        expect(service.leaderboard({ guildId: 'guild1' }).rows.map(row => row.userId)).toEqual(['user1', 'user2']);
        expect(service.leaderboard({ guildId: 'guild1', offset: 25 }).rows).toEqual([]);
    });

    test('binds leaderboard pages to the requesting member', async () => {
        for (let index = 3; index <= 27; index++) service.open({ guildId: 'guild1', userId: `user${index}` });
        const first = service.leaderboardView('guild1', 'user1');
        const nextId = first.components[0].toJSON().components[1].custom_id;
        const update = jest.fn(async payload => payload);
        const reply = jest.fn(async payload => payload);

        await service.handleInteraction({
            customId: nextId, guildId: 'guild1', user: { id: 'user1' }, update, reply
        });
        expect(update.mock.calls[0][0].embeds[0].data.description).toContain('26.');

        await service.handleInteraction({
            customId: nextId, guildId: 'guild1', user: { id: 'user2' }, update, reply
        });
        expect(reply.mock.calls[0][0].embeds[0].data.description).toContain('does not belong');

        const oldToken = nextId.split(':')[3];
        now += 600001;
        await service.handleInteraction({
            customId: nextId, guildId: 'guild1', user: { id: 'user1' }, update, reply
        });
        expect(service.pageTokens.has(oldToken)).toBe(false);
        service.leaderboardView('guild1', 'user1');
        expect(service.pageTokens.size).toBe(1);
        now += 600001;
        timers.at(-1).callback();
        expect(service.pageTokens.size).toBe(0);
    });

    test('refunds active games and pauses laboratories while the economy is disabled', () => {
        const session = service.playGame({ guildId: 'guild1', userId: 'user1', game: 'ladder', bet: 100 });
        service.buyLab({ guildId: 'guild1', userId: 'user1', operationId: 'op-buy' });
        const preview = service.issueConfirmation({ action: 'disable', guildId: 'guild1', actorId: 'admin1', reason: 'Maintenance' });

        service.disable({ guildId: 'guild1', actorId: 'admin1', reason: 'Maintenance', confirmationCode: preview.confirmationCode });
        expect(database.sqlite.prepare('SELECT status FROM economy_game_sessions WHERE id = ?').get(session.id).status).toBe('refunded');
        now += 7200000;
        service.enable('guild1', 'admin1');
        now += 3600000;
        expect(service.labStatus({ guildId: 'guild1', userId: 'user1' }).stored).toBe(100);
    });

    test('forfeits active games on reset while preserving laboratory replay records', () => {
        const session = service.playGame({ guildId: 'guild1', userId: 'user1', game: 'ladder', bet: 100 });
        service.buyLab({ guildId: 'guild1', userId: 'user1', operationId: 'op-buy' });
        const preview = service.issueConfirmation({
            action: 'reset', guildId: 'guild1', actorId: 'admin1', targetId: 'user1', reason: 'Fresh start'
        });

        service.reset({
            guildId: 'guild1', actorId: 'admin1', targetId: 'user1', reason: 'Fresh start', confirmationCode: preview.confirmationCode
        });
        expect(database.sqlite.prepare('SELECT status FROM economy_game_sessions WHERE id = ?').get(session.id).status).toBe('forfeited');
        expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM economy_labs WHERE user_id = ?').get('user1').count).toBe(0);
        expect(database.sqlite.prepare('SELECT lab_id FROM economy_lab_operations WHERE operation_id = ?').get('op-buy').lab_id).toBeNull();
    });
});
