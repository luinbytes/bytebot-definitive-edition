const { PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('economy command', () => {
    test('registers the complete core surface while keeping member paths public', () => {
        const command = require('../src/commands/economy/economy');
        const json = command.data.toJSON();
        const direct = json.options.filter(option => option.type === 1).map(option => option.name);
        const groups = Object.fromEntries(json.options.filter(option => option.type === 2)
            .map(group => [group.name, group.options.map(option => option.name)]));

        expect(json.name).toBe('economy');
        expect(json.default_member_permissions).toBeUndefined();
        expect(command.permissions).toEqual([]);
        expect(direct).toEqual([
            'open', 'balance', 'mode', 'deposit', 'withdraw', 'daily', 'work', 'transfer',
            'config', 'circulation', 'enable', 'preset', 'grant', 'remove', 'reset', 'destroy', 'disable',
            'crime', 'rob', 'leaderboard'
        ]);
        expect(groups).toEqual({
            job: ['list', 'add', 'remove'],
            shop: ['list', 'buy', 'add', 'remove'],
            game: ['coinflip', 'dice', 'gamble', 'roulette', 'highlow', 'slots', 'plinko', 'bombs', 'ladder', 'crash', 'scratch', 'blackjack'],
            gang: ['create', 'disband', 'info', 'invite', 'leave', 'promote', 'transfer', 'setbanner'],
            lab: ['buy', 'status', 'upgrade', 'ampoules', 'collect']
        });
        expect(json.options).toHaveLength(25);
        expect(PermissionFlagsBits.ManageGuild).toBeDefined();
    });

    test('keeps balance public while requiring real Manage Server for config mutation', async () => {
        jest.resetModules();
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-economy-command-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        const database = require('../src/database');
        await database.runMigrations();
        const { EconomyService } = require('../src/services/economyService');
        const service = new EconomyService({
            sqlite: database.sqlite, now: () => Date.UTC(2026, 0, 1, 12),
            randomInt: minimum => minimum, randomBytes: () => Buffer.from('economy-command')
        });
        const command = require('../src/commands/economy/economy');
        service.enable('guild1', 'admin1');
        service.configure('guild1', 'admin1', { startingBalance: 100 });
        service.open({ guildId: 'guild1', userId: 'user1' });
        service.open({ guildId: 'guild1', userId: 'user2' });

        const interaction = (subcommand, values = {}, canManage = false) => ({
            id: values.id || `interaction-${subcommand}`,
            guildId: 'guild1', guild: { id: 'guild1', createdTimestamp: Date.UTC(2025, 0, 1) },
            user: { id: 'user1', bot: false }, member: {
                id: 'user1', joinedTimestamp: Date.UTC(2025, 0, 1),
                permissions: { has: permission => canManage && permission === PermissionFlagsBits.ManageGuild }
            },
            options: {
                getSubcommandGroup: () => values.group || null, getSubcommand: () => subcommand,
                getString: name => values[name] ?? null, getInteger: name => values[name] ?? null,
                getBoolean: name => values[name] ?? null, getUser: name => values[name] ?? null,
                getMember: name => values[`${name}GuildMember`] ?? null,
                getRole: name => values[name] ?? null
            },
            reply: jest.fn(async payload => payload)
        });

        const balance = interaction('balance');
        await command.execute(balance, { economyService: service });
        expect(balance.reply.mock.calls[0][0].embeds[0].data.description).toContain('Wallet: **100');

        service.setMode('user1', 'global');
        service.open({ guildId: 'guild1', userId: 'user1' });
        service.setMode('user2', 'global');
        service.open({ guildId: 'guild1', userId: 'user2' });
        const privateBalance = interaction('balance', {
            member: { id: 'user2', bot: false, username: 'other' }, memberGuildMember: { id: 'user2' }, scope: 'global'
        });
        await command.execute(privateBalance, { economyService: service });
        expect(privateBalance.reply.mock.calls[0][0].embeds[0].data.description)
            .toContain('only view your own global balance');
        service.setMode('user1', 'guild');

        const external = interaction('transfer', {
            member: { id: 'user2', bot: false, username: 'outside' }, amount: 1
        });
        await command.execute(external, { economyService: service });
        expect(external.reply.mock.calls[0][0].embeds[0].data.description).toContain('non-bot server member');
        expect(service.balance({ guildId: 'guild1', userId: 'user1' }).wallet).toBe(100);

        const denied = interaction('config', { currency_name: 'credits' });
        await command.execute(denied, { economyService: service });
        expect(denied.reply.mock.calls[0][0].embeds[0].data.description).toContain('Manage Server');
        expect(service.config('guild1').currency_name).toBe('coins');

        const game = interaction('ladder', { group: 'game', amount: 10 });
        await command.execute(game, { economyService: service });
        expect(game.reply.mock.calls[0][0].embeds[0].data.description).toContain('ByteBot-owned rules');
        expect(game.reply.mock.calls[0][0].components).toHaveLength(1);
        expect(service.balance({ guildId: 'guild1', userId: 'user1' }).wallet).toBe(90);

        database.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });
});
