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
            'config', 'circulation', 'enable', 'preset', 'grant', 'remove', 'reset', 'destroy', 'disable'
        ]);
        expect(groups).toEqual({ job: ['list', 'add', 'remove'], shop: ['list', 'buy', 'add', 'remove'] });
        expect(json.options).toHaveLength(19);
        expect(PermissionFlagsBits.ManageGuild).toBeDefined();
    });

    test('keeps balance public while requiring real Manage Server for config mutation', async () => {
        jest.resetModules();
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-economy-command-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        const database = require('../src/database');
        await database.runMigrations();
        const { EconomyService } = require('../src/services/economyService');
        const service = new EconomyService({ sqlite: database.sqlite, now: () => Date.UTC(2026, 0, 1, 12) });
        const command = require('../src/commands/economy/economy');
        service.enable('guild1', 'admin1');
        service.configure('guild1', 'admin1', { startingBalance: 100 });
        service.open({ guildId: 'guild1', userId: 'user1' });
        service.open({ guildId: 'guild1', userId: 'user2' });

        const interaction = (subcommand, values = {}, canManage = false) => ({
            guildId: 'guild1', guild: { id: 'guild1', createdTimestamp: Date.UTC(2025, 0, 1) },
            user: { id: 'user1', bot: false }, member: {
                id: 'user1', joinedTimestamp: Date.UTC(2025, 0, 1),
                permissions: { has: permission => canManage && permission === PermissionFlagsBits.ManageGuild }
            },
            options: {
                getSubcommandGroup: () => null, getSubcommand: () => subcommand,
                getString: name => values[name] ?? null, getInteger: name => values[name] ?? null,
                getBoolean: name => values[name] ?? null, getUser: name => values[name] ?? null,
                getMember: name => values[`${name}GuildMember`] ?? null,
                getRole: name => values[name] ?? null
            },
            reply: jest.fn(async payload => payload)
        });

        const balance = interaction('balance');
        await command.execute(balance, { economyService: service });
        expect(balance.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Wallet: **100') }));

        const external = interaction('transfer', {
            member: { id: 'user2', bot: false, username: 'outside' }, amount: 1
        });
        await command.execute(external, { economyService: service });
        expect(external.reply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('non-bot server member')
        }));
        expect(service.balance({ guildId: 'guild1', userId: 'user1' }).wallet).toBe(100);

        const denied = interaction('config', { currency_name: 'credits' });
        await command.execute(denied, { economyService: service });
        expect(denied.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Manage Server') }));
        expect(service.config('guild1').currency_name).toBe('coins');

        database.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });
});
