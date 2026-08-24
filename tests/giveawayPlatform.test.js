const fs = require('fs');
const os = require('os');
const path = require('path');
const { PermissionFlagsBits } = require('discord.js');

describe('giveaway platform', () => {
    let tempDir;
    let database;
    let service;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-giveaways-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        const { GiveawayService } = require('../src/services/giveawayService');
        service = new GiveawayService(null, { sqlite: database.sqlite, now: () => 1000, randomInt: () => 0 });
    });

    afterEach(() => {
        service?.cleanup();
        database.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('registers the complete evidenced giveaway tree with Manage Server defaults', () => {
        const json = require('../src/commands/administration/giveaway').data.toJSON();
        const groups = Object.fromEntries(json.options.filter(option => option.type === 2)
            .map(group => [group.name, group.options.map(option => option.name)]));
        const direct = json.options.filter(option => option.type === 1).map(option => option.name);

        expect(json.default_member_permissions).toBe(PermissionFlagsBits.ManageGuild.toString());
        expect(direct).toEqual(['start', 'end', 'reroll', 'blacklist', 'setmax', 'dmcreator', 'dmwinners', 'template', 'variables']);
        expect(groups).toEqual({
            edit: ['prize', 'duration', 'winners', 'description', 'image', 'thumbnail', 'minlevel', 'maxlevel'],
            preset: ['save', 'list', 'delete']
        });
    });

    test('migrations enforce guild-scoped presets, roles, levels, entries, and winner rounds', () => {
        database.sqlite.prepare(`INSERT INTO giveaway_presets
            (guild_id, name, script, created_by, created_at, updated_at) VALUES ('guild1', 'nitro', 'x', 'admin', 1, 1)`).run();
        expect(() => database.sqlite.prepare(`INSERT INTO giveaway_presets
            (guild_id, name, script, created_by, created_at, updated_at) VALUES ('guild1', 'nitro', 'y', 'admin', 1, 1)`).run()).toThrow();

        service.toggleBlacklist('guild1', 'blocked', 'admin');
        service.setRoleLimit('guild1', 'weighted', 3, 'admin');
        service.setMemberLevel('guild1', 'eligible', 10);
        const giveaway = service.reserveGiveaway({ guildId: 'guild1', channelId: 'channel1', hostId: 'admin',
            duration: '10s', winnerCount: 1, prize: 'Nitro' });
        service.attachMessage(giveaway.id, 'message1');
        expect(service.getByMessage('guild1', 'message1').prize).toBe('Nitro');
    });

    test('parses only the public duration range', () => {
        const { parseDuration } = require('../src/services/giveawayService');
        expect(parseDuration('10s')).toBe(10000);
        expect(parseDuration('1h')).toBe(3600000);
        expect(parseDuration('1w')).toBe(604800000);
        expect(() => parseDuration('9s')).toThrow('at least 10 seconds');
        expect(() => parseDuration('31d')).toThrow('30 days');
        expect(() => parseDuration('later')).toThrow('formats like');
    });

    test('rechecks role blacklist, required role, level, and maximum entries on every click', () => {
        service.toggleBlacklist('guild1', 'blocked', 'admin');
        service.setRoleLimit('guild1', 'weighted', 2, 'admin');
        service.setMemberLevel('guild1', 'user1', 5);
        const giveaway = service.reserveGiveaway({ guildId: 'guild1', channelId: 'channel1', hostId: 'admin',
            duration: '10s', winnerCount: 1, prize: 'Nitro', requiredRoleId: 'required', minLevel: 5, maxLevel: 10 });
        service.attachMessage(giveaway.id, 'message1');
        const member = (id, roles) => ({ id, user: { id, bot: false }, roles: { cache: new Map(roles.map(role => [role, {}])) } });

        expect(service.enter(giveaway.id, member('user1', ['required', 'weighted']))).toMatchObject({ entries: 1, maximum: 2 });
        expect(service.enter(giveaway.id, member('user1', ['required', 'weighted']))).toMatchObject({ entries: 2, maximum: 2 });
        expect(() => service.enter(giveaway.id, member('user1', ['required', 'weighted']))).toThrow('maximum');
        expect(() => service.enter(giveaway.id, member('blocked1', ['required', 'blocked']))).toThrow('blacklisted');
        expect(() => service.enter(giveaway.id, member('missing', []))).toThrow('required role');
    });

    test('creates one immutable first winner round and unique weighted winners', () => {
        const giveaway = service.reserveGiveaway({ guildId: 'guild1', channelId: 'channel1', hostId: 'admin',
            duration: '10s', winnerCount: 2, prize: 'Nitro' });
        service.attachMessage(giveaway.id, 'message1');
        const member = id => ({ id, user: { id, bot: false }, roles: { cache: new Map() } });
        for (const id of ['user1', 'user2', 'user3']) service.enter(giveaway.id, member(id));

        const first = service.claimEnd(giveaway.id, 'admin', ['user1', 'user2', 'user3'].map(member));
        const retry = service.claimEnd(giveaway.id, 'admin', ['user1', 'user2', 'user3'].map(member));

        expect(first.created).toBe(true);
        expect(first.round.winnerIds).toHaveLength(2);
        expect(new Set(first.round.winnerIds).size).toBe(2);
        expect(retry.created).toBe(false);
        expect(retry.round.winnerIds).toEqual(first.round.winnerIds);
        expect(database.sqlite.prepare('SELECT COUNT(*) count FROM giveaway_rounds WHERE giveaway_id = ?').get(giveaway.id).count).toBe(1);
    });

    test('ends through Discord once and keeps the persisted winner on retries', async () => {
        const message = { id: 'message1', edit: jest.fn().mockResolvedValue({}) };
        const channel = { id: 'channel1', send: jest.fn().mockResolvedValue(message), messages: { fetch: jest.fn().mockResolvedValue(message) } };
        const member = id => ({ id, user: { id, bot: false }, roles: { cache: new Map() } });
        const members = new Map([['user1', member('user1')], ['user2', member('user2')]]);
        const guild = {
            id: 'guild1', name: 'Guild', channels: { cache: new Map([['channel1', channel]]), fetch: jest.fn() },
            members: { cache: members, fetch: jest.fn(id => members.get(id)), me: { permissionsIn: () => ({ has: () => true }) } }
        };
        service.client = {
            user: { id: 'bot' }, guilds: { cache: new Map([['guild1', guild]]), fetch: jest.fn() },
            users: { fetch: jest.fn().mockResolvedValue({ send: jest.fn().mockResolvedValue({}) }) }
        };
        const giveaway = await service.startDiscordGiveaway({ guild, channel, user: { id: 'admin' }, member: member('admin') }, {
            duration: '10s', winnerCount: 1, prize: 'Nitro'
        });
        service.enter(giveaway.id, members.get('user1'));
        service.enter(giveaway.id, members.get('user2'));
        service.updateConfig('guild1', { dmCreator: true, dmWinners: true });

        const first = await service.endDiscordGiveaway(giveaway.id, 'admin');
        const retry = await service.endDiscordGiveaway(giveaway.id, 'admin');

        expect(retry.round.winnerIds).toEqual(first.round.winnerIds);
        expect(message.edit).toHaveBeenCalledTimes(1);
        expect(service.client.users.fetch).toHaveBeenCalledTimes(2);
        expect(database.sqlite.prepare('SELECT COUNT(*) count FROM giveaway_rounds WHERE giveaway_id = ?').get(giveaway.id).count).toBe(1);
    });

    test('resumes an unannounced reroll without choosing another winner', async () => {
        const member = id => ({ id, user: { id, bot: false }, roles: { cache: new Map() } });
        const members = new Map([['user1', member('user1')], ['user2', member('user2')]]);
        const message = { edit: jest.fn().mockResolvedValue({}) };
        const channel = { id: 'channel1', messages: { fetch: jest.fn().mockResolvedValue(message) } };
        const guild = { id: 'guild1', channels: { cache: new Map([['channel1', channel]]) }, members: { cache: members, fetch: jest.fn() } };
        service.client = { user: { id: 'bot' }, guilds: { cache: new Map([['guild1', guild]]) }, users: { fetch: jest.fn() } };
        const giveaway = service.reserveGiveaway({ guildId: 'guild1', channelId: 'channel1', hostId: 'admin',
            duration: '10s', winnerCount: 1, prize: 'Nitro' });
        service.attachMessage(giveaway.id, 'message1');
        for (const value of members.values()) service.enter(giveaway.id, value);
        const first = service.claimEnd(giveaway.id, 'admin', [...members.values()]);
        service.completeEnd(giveaway.id, 'admin');
        const pending = service.createReroll(giveaway.id, 'admin', [...members.values()]);

        const resumed = await service.rerollDiscordGiveaway(giveaway.id, 'admin');

        expect(resumed.id).toBe(pending.id);
        expect(resumed.winnerIds).not.toEqual(first.round.winnerIds);
        expect(database.sqlite.prepare('SELECT COUNT(*) count FROM giveaway_rounds WHERE giveaway_id = ?').get(giveaway.id).count).toBe(2);
    });

    test('rejects bot entrants and scripted controls', () => {
        const giveaway = service.reserveGiveaway({ guildId: 'guild1', channelId: 'channel1', hostId: 'admin',
            duration: '10s', winnerCount: 1, prize: 'Nitro' });
        service.attachMessage(giveaway.id, 'message1');
        expect(() => service.enter(giveaway.id, { id: 'bot', user: { bot: true }, roles: { cache: new Map() } })).toThrow('Bots cannot');
        expect(() => service.templatePayload({ ...giveaway, templateSnapshot: '{embed}$v{title: Test}$v{button: label: Fake && custom: fake}' }))
            .toThrow('entry controls are generated by ByteBot');
    });
});
