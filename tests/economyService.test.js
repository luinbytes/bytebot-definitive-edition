const fs = require('fs');
const os = require('os');
const path = require('path');

describe('economy service', () => {
    let tempDir;
    let database;
    let service;
    let now;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-economy-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        const { EconomyService } = require('../src/services/economyService');
        now = Date.UTC(2026, 0, 1, 12);
        let transaction = 0;
        service = new EconomyService({
            sqlite: database.sqlite, now: () => now, randomUUID: () => `tx-${++transaction}`,
            randomInt: minimum => minimum, randomBytes: () => Buffer.from('abcde'),
            setTimeout: () => ({ unref() {} })
        });
    });

    afterEach(() => {
        database?.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('opens one account in the selected guild without leaking it to another guild', () => {
        service.enable('guild1', 'admin1');
        service.enable('guild2', 'admin2');

        expect(service.open({ guildId: 'guild1', userId: 'user1' })).toEqual({
            scopeType: 'guild', scopeId: 'guild1', userId: 'user1', wallet: 0, bank: 0, total: 0
        });
        expect(service.balance({ guildId: 'guild1', userId: 'user1' })).toEqual({
            scopeType: 'guild', scopeId: 'guild1', userId: 'user1', wallet: 0, bank: 0, total: 0, rank: 1
        });
        expect(service.balance({ guildId: 'guild2', userId: 'user1' })).toBeNull();
        expect(() => service.open({ guildId: 'guild1', userId: 'user1' })).toThrow('already have');
    });

    test('keeps global mode separate while materializing exact opening circulation', () => {
        service.enable('guild1', 'admin1');
        service.enable('guild2', 'admin2');
        service.configure('guild1', 'admin1', { startingBalance: 100 });

        expect(service.open({ guildId: 'guild1', userId: 'user1' }).wallet).toBe(100);
        expect(service.circulation({ guildId: 'guild1', userId: 'user1' })).toEqual({
            scopeType: 'guild', scopeId: 'guild1', circulation: 100,
            minted: 100n, destroyed: 0n, accounts: 1
        });
        expect(service.applyPreset('guild1', 'admin1', 'standard')).toMatchObject({
            enabled: 1, currency_name: 'coins', currency_emoji: '🪙', starting_balance: 0,
            daily_cap: 50000, preset: 'standard'
        });
        expect(service.balance({ guildId: 'guild1', userId: 'user1', scope: 'guild' }).wallet).toBe(100);

        expect(service.setMode('user1', 'global')).toBe('global');
        expect(service.open({ guildId: 'guild2', userId: 'user1' })).toEqual({
            scopeType: 'global', scopeId: 'global', userId: 'user1', wallet: 0, bank: 0, total: 0
        });
        expect(service.balance({ guildId: 'guild1', userId: 'user1', scope: 'guild' }).wallet).toBe(100);
        expect(service.balance({ guildId: 'guild1', userId: 'user1' }).scopeType).toBe('global');
    });

    test('moves, mints, and burns balances atomically with paired ledger entries', () => {
        service.enable('guild1', 'admin1');
        service.configure('guild1', 'admin1', { startingBalance: 100 });
        service.open({ guildId: 'guild1', userId: 'user1' });
        service.open({ guildId: 'guild1', userId: 'user2' });

        expect(service.deposit({ guildId: 'guild1', userId: 'user1', amount: 60 })).toMatchObject({ wallet: 40, bank: 60 });
        expect(service.withdraw({ guildId: 'guild1', userId: 'user1', amount: 10 })).toMatchObject({ wallet: 50, bank: 50 });
        const transfer = service.transfer({ guildId: 'guild1', userId: 'user1', targetId: 'user2', amount: 25 });
        expect(transfer).toMatchObject({ sender: { wallet: 25 }, target: { wallet: 125 } });
        expect(service.history({ guildId: 'guild1', userId: 'user1' }).slice(-1)[0]).toMatchObject({
            transactionId: transfer.transactionId, walletDelta: -25, kind: 'transfer'
        });
        expect(service.history({ guildId: 'guild1', userId: 'user2' }).slice(-1)[0]).toMatchObject({
            transactionId: transfer.transactionId, walletDelta: 25, kind: 'transfer'
        });

        service.grant({ guildId: 'guild1', actorId: 'admin1', targetId: 'user1', amount: 100, reason: 'Event prize' });
        service.remove({ guildId: 'guild1', actorId: 'admin1', targetId: 'user1', amount: 170, reason: 'Correction' });
        expect(service.balance({ guildId: 'guild1', userId: 'user1' })).toMatchObject({ wallet: 0, bank: 5, total: 5 });
        expect(service.circulation({ guildId: 'guild1', userId: 'user1' })).toMatchObject({
            circulation: 130, minted: 300n, destroyed: 170n
        });
        expect(service.reconcileTotals({ scopeType: 'guild', scopeId: 'guild1' })).toEqual({ minted: 300n, destroyed: 170n });

        expect(() => service.transfer({ guildId: 'guild1', userId: 'user1', targetId: 'user2', amount: 6 }))
            .toThrow('wallet');
        expect(service.balance({ guildId: 'guild1', userId: 'user2' }).wallet).toBe(125);
    });

    test('applies the universal payout multiplier, shared daily cap, age gates, and job cooldown', () => {
        service.enable('guild1', 'admin1');
        service.configure('guild1', 'admin1', { dailyCap: 800 });
        service.open({ guildId: 'guild1', userId: 'user1' });
        service.addJob({ guildId: 'guild1', actorId: 'admin1', name: 'helper', minimum: 100, maximum: 101, cooldownSeconds: 3600 });
        const ages = { guildCreatedAt: now - 21600000, memberJoinedAt: now - 21600000 };

        expect(service.daily({ guildId: 'guild1', userId: 'user1', ...ages })).toMatchObject({ amount: 750, wallet: 750 });
        expect(() => service.daily({ guildId: 'guild1', userId: 'user1', ...ages })).toThrow('daily reward');
        service.setMode('user1', 'global');
        service.open({ guildId: 'guild1', userId: 'user1' });
        expect(() => service.daily({ guildId: 'guild1', userId: 'user1', ...ages })).toThrow('daily reward');
        service.setMode('user1', 'guild');
        expect(service.work({ guildId: 'guild1', userId: 'user1', job: 'helper', ...ages }))
            .toMatchObject({ amount: 50, baseAmount: 100, wallet: 800, job: 'helper' });
        expect(() => service.work({ guildId: 'guild1', userId: 'user1', job: 'helper', ...ages })).toThrow('cooldown');

        now += 86400000;
        expect(service.work({ guildId: 'guild1', userId: 'user1', job: 'helper', ...ages }))
            .toMatchObject({ amount: 150, baseAmount: 100, wallet: 950 });
        expect(service.circulation({ guildId: 'guild1', userId: 'user1' }).minted).toBe(950n);
        expect(service.listJobs('guild1').map(job => job.name)).toEqual(['worker', 'helper']);
        service.enable('guild2', 'admin2');
        expect(service.listJobs('guild2').map(job => job.name)).toEqual(['worker']);

        expect(() => service.work({
            guildId: 'guild1', userId: 'user1', job: 'helper',
            guildCreatedAt: now - 1000, memberJoinedAt: now - 21600000
        })).toThrow('server must be at least 6 hours old');
    });

    test('keeps global earnings on fixed defaults outside guild administrator control', () => {
        service.enable('guild1', 'admin1');
        service.configure('guild1', 'admin1', { dailyCap: 1 });
        service.addJob({ guildId: 'guild1', actorId: 'admin1', name: 'rich', minimum: 1000, maximum: 1001, cooldownSeconds: 60 });
        service.setMode('user1', 'global');
        service.open({ guildId: 'guild2', userId: 'user1' });
        const ages = { guildCreatedAt: now - 21600000, memberJoinedAt: now - 21600000 };

        expect(() => service.work({ guildId: 'guild1', userId: 'user1', job: 'rich', ...ages }))
            .toThrow('global economy only uses');
        expect(service.work({ guildId: 'guild2', userId: 'user1', ...ages }))
            .toMatchObject({ amount: 150, baseAmount: 100, wallet: 150, job: 'worker' });
    });

    test('delivers guild shop roles idempotently and reverses only a proven failed delivery', async () => {
        service.enable('guild1', 'admin1');
        service.configure('guild1', 'admin1', { startingBalance: 100 });
        service.open({ guildId: 'guild1', userId: 'user1' });
        const item = service.addShopItem({ guildId: 'guild1', actorId: 'admin1', roleId: 'role1', roleName: 'VIP', price: 40 });
        const failed = service.addShopItem({ guildId: 'guild1', actorId: 'admin1', roleId: 'role2', roleName: 'Gold', price: 30 });
        const roles = new Map();
        const member = { id: 'user1', roles: { cache: roles, add: jest.fn(async role => roles.set(role.id, role)) } };
        const role1 = { id: 'role1', name: 'VIP', editable: true, managed: false, permissions: { has: () => false } };
        const role2 = { id: 'role2', name: 'Gold', editable: true, managed: false, permissions: { has: () => false } };
        const guild = {
            id: 'guild1', roles: { everyone: { id: 'guild1' }, cache: new Map([[role1.id, role1], [role2.id, role2]]) },
            members: { me: { permissions: { has: () => true } }, fetch: jest.fn(async () => member) }
        };

        service.setMode('user1', 'global');
        await expect(service.buyShopItem({ guild, userId: 'user1', itemId: item.id, member }))
            .rejects.toThrow('guild mode');
        service.setMode('user1', 'guild');
        await expect(service.buyShopItem({ guild, userId: 'user1', itemId: item.id, member }))
            .resolves.toMatchObject({ status: 'delivered', price: 40, roleId: 'role1' });
        expect(service.balance({ guildId: 'guild1', userId: 'user1' }).wallet).toBe(60);
        await expect(service.buyShopItem({ guild, userId: 'user1', itemId: item.id, member })).rejects.toThrow('already have');

        member.roles.add.mockRejectedValueOnce(new Error('Discord unavailable')).mockRejectedValueOnce(new Error('Still unavailable'));
        await expect(service.buyShopItem({ guild, userId: 'user1', itemId: failed.id, member })).rejects.toThrow('reversed');
        expect(service.balance({ guildId: 'guild1', userId: 'user1' }).wallet).toBe(60);
        expect(service.listShopItems('guild1')).toEqual([
            expect.objectContaining({ id: item.id, roleId: 'role1', price: 40 }),
            expect.objectContaining({ id: failed.id, roleId: 'role2', price: 30 })
        ]);
    });

    test('keeps a shop debit when Discord times out after assigning the role', async () => {
        service.enable('guild1', 'admin1');
        service.configure('guild1', 'admin1', { startingBalance: 100 });
        service.open({ guildId: 'guild1', userId: 'user1' });
        const item = service.addShopItem({ guildId: 'guild1', actorId: 'admin1', roleId: 'role1', roleName: 'VIP', price: 40 });
        const role = { id: 'role1', editable: true, managed: false, permissions: { has: () => false } };
        const roles = new Map();
        const member = {
            roles: {
                cache: roles,
                add: jest.fn(async assigned => {
                    roles.set(assigned.id, assigned);
                    throw new Error('Discord timed out');
                })
            }
        };
        const guild = {
            id: 'guild1', roles: { everyone: { id: 'guild1' }, cache: new Map([[role.id, role]]) },
            members: { me: { permissions: { has: () => true } }, fetch: jest.fn(async () => member) }
        };

        await expect(service.buyShopItem({ guild, userId: 'user1', itemId: item.id, member }))
            .resolves.toMatchObject({ status: 'delivered', price: 40 });
        expect(service.balance({ guildId: 'guild1', userId: 'user1' }).wallet).toBe(60);
    });

    test('rejects a 31st earning guild without paying it', () => {
        const ages = { guildCreatedAt: now - 21600000, memberJoinedAt: now - 21600000 };
        service.enable('guild1', 'admin1');
        service.setMode('user1', 'global');
        service.open({ guildId: 'guild1', userId: 'user1' });

        for (let index = 1; index <= 31; index++) {
            const guildId = `guild${index}`;
            const action = () => service.work({ guildId, userId: 'user1', ...ages });
            if (index <= 30) expect(action()).toMatchObject({ amount: 150 });
            else expect(action).toThrow('at most 30 servers');
        }

        expect(service.balance({ guildId: 'guild1', userId: 'user1' }).wallet).toBe(4500);
    });

    test('binds destructive operations to a single-use exact-plan confirmation', () => {
        service.enable('guild1', 'admin1');
        service.configure('guild1', 'admin1', { startingBalance: 100 });
        service.open({ guildId: 'guild1', userId: 'user1' });
        const values = { action: 'destroy', guildId: 'guild1', actorId: 'admin1', targetId: 'user1', amount: 40, reason: 'Correction' };
        const preview = service.issueConfirmation(values);

        expect(service.destroy({ ...values, confirmationCode: preview.confirmationCode })).toMatchObject({ wallet: 60, bank: 0 });
        expect(() => service.destroy({ ...values, confirmationCode: preview.confirmationCode })).toThrow('confirmation');

        const staleReset = service.issueConfirmation({
            action: 'reset', guildId: 'guild1', actorId: 'admin1', targetId: 'user1', reason: 'Fresh start'
        });
        service.grant({ guildId: 'guild1', actorId: 'admin1', targetId: 'user1', amount: 10, reason: 'Plan changed' });
        expect(() => service.reset({
            guildId: 'guild1', actorId: 'admin1', targetId: 'user1', reason: 'Fresh start',
            confirmationCode: staleReset.confirmationCode
        })).toThrow('plan changed');

        const reset = service.issueConfirmation({
            action: 'reset', guildId: 'guild1', actorId: 'admin1', targetId: 'user1', reason: 'Fresh start'
        });
        expect(service.reset({
            guildId: 'guild1', actorId: 'admin1', targetId: 'user1', reason: 'Fresh start',
            confirmationCode: reset.confirmationCode
        })).toMatchObject({ removed: 70 });
        expect(service.balance({ guildId: 'guild1', userId: 'user1' })).toBeNull();
        expect(service.circulation({ guildId: 'guild1', userId: 'user1' })).toMatchObject({
            circulation: 0, minted: 110n, destroyed: 110n
        });

        const disable = service.issueConfirmation({ action: 'disable', guildId: 'guild1', actorId: 'admin1', reason: 'Season ended' });
        expect(service.disable({
            guildId: 'guild1', actorId: 'admin1', reason: 'Season ended', confirmationCode: disable.confirmationCode
        }).enabled).toBe(0);
        expect(() => service.balance({ guildId: 'guild1', userId: 'user1' })).toThrow('not enabled');
    });
});
