const fs = require('fs');
const os = require('os');
const path = require('path');

describe('economy games and progression', () => {
    let tempDir;
    let database;
    let service;
    let now;
    let draws;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-economy-progression-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        const { EconomyService } = require('../src/services/economyService');
        now = Date.UTC(2026, 0, 1, 12);
        draws = [];
        let id = 0;
        service = new EconomyService({
            sqlite: database.sqlite,
            now: () => now,
            randomUUID: () => `id-${++id}`,
            randomInt: (minimum) => draws.length ? draws.shift() : minimum,
            randomBytes: () => Buffer.from('progression'),
            setTimeout: () => ({ unref() {} })
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

    test('orders the committed guild leaderboard with a stable tie break', () => {
        expect(service.leaderboard({ guildId: 'guild1' }).rows.map(row => row.userId)).toEqual(['user1', 'user2']);
        service.transfer({ guildId: 'guild1', userId: 'user2', targetId: 'user1', amount: 1 });
        expect(service.leaderboard({ guildId: 'guild1' }).rows.map(row => row.userId)).toEqual(['user1', 'user2']);
        expect(service.leaderboard({ guildId: 'guild1', offset: 25 }).rows).toEqual([]);
    });
});
