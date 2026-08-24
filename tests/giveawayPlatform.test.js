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
        expect(() => service.validateUrl('ftp://example.com/image.png')).toThrow('HTTP or HTTPS');
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
        expect(first.claimed).toBe(true);
        expect(first.round.winnerIds).toHaveLength(2);
        expect(new Set(first.round.winnerIds).size).toBe(2);
        expect(retry.created).toBe(false);
        expect(retry.claimed).toBe(false);
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
        const hostSend = jest.fn().mockResolvedValue({});
        const winnerSend = jest.fn().mockRejectedValue(new Error('DMs closed'));
        const client = {
            user: { id: 'bot' }, guilds: { cache: new Map([['guild1', guild]]), fetch: jest.fn() },
            users: { fetch: jest.fn(id => Promise.resolve({ send: id === 'admin' ? hostSend : winnerSend })) }
        };
        service.client = client;
        const giveaway = await service.startDiscordGiveaway({ guild, channel, user: { id: 'admin' }, member: member('admin') }, {
            duration: '10s', winnerCount: 1, prize: 'Nitro'
        });
        service.enter(giveaway.id, members.get('user1'));
        service.enter(giveaway.id, members.get('user2'));
        service.updateConfig('guild1', { dmCreator: true, dmWinners: true });

        const claimed = service.claimEnd(giveaway.id, 'bot', [...members.values()]);
        database.sqlite.prepare('UPDATE giveaway_rounds SET delivery_lease_until = 0 WHERE id = ?').run(claimed.round.id);
        const { GiveawayService } = require('../src/services/giveawayService');
        service = new GiveawayService(client, { sqlite: database.sqlite, now: () => 1000, randomInt: () => 0 });
        await service.reconcile();
        const retry = await service.endDiscordGiveaway(giveaway.id, 'admin');

        expect(retry.round.winnerIds).toEqual(claimed.round.winnerIds);
        expect(message.edit).toHaveBeenCalledTimes(1);
        expect(hostSend).toHaveBeenCalledTimes(1);
        expect(winnerSend).toHaveBeenCalledTimes(1);
        expect(database.sqlite.prepare("SELECT COUNT(*) count FROM giveaway_actions WHERE giveaway_id = ? AND action = 'winner_dm_failed'").get(giveaway.id).count).toBe(1);
        expect(database.sqlite.prepare('SELECT COUNT(*) count FROM giveaway_rounds WHERE giveaway_id = ?').get(giveaway.id).count).toBe(1);
    });

    test('marks a giveaway lost when its exact message is missing', async () => {
        const channel = { id: 'channel1', messages: { fetch: jest.fn().mockResolvedValue(null) } };
        const guild = { id: 'guild1', channels: { cache: new Map([['channel1', channel]]) },
            members: { cache: new Map(), fetch: jest.fn() } };
        service.client = { user: { id: 'bot' }, guilds: { cache: new Map([['guild1', guild]]) }, users: { fetch: jest.fn() } };
        const giveaway = service.reserveGiveaway({ guildId: 'guild1', channelId: 'channel1', hostId: 'admin',
            duration: '10s', winnerCount: 1, prize: 'Nitro' });
        service.attachMessage(giveaway.id, 'message1');

        await expect(service.endDiscordGiveaway(giveaway.id, 'admin')).rejects.toThrow('exact giveaway message');
        expect(service.getGiveaway(giveaway.id).status).toBe('lost');
    });

    test('shares one end job across overlapping callers', async () => {
        let release;
        service.finishDiscordGiveaway = jest.fn(() => new Promise(resolve => { release = resolve; }));

        const first = service.endDiscordGiveaway(1, 'admin');
        const second = service.endDiscordGiveaway(1, 'bot');
        expect(service.finishDiscordGiveaway).toHaveBeenCalledTimes(1);
        release({ giveaway: { id: 1 }, round: { winnerIds: ['user1'] } });

        await expect(Promise.all([first, second])).resolves.toEqual([
            { giveaway: { id: 1 }, round: { winnerIds: ['user1'] } },
            { giveaway: { id: 1 }, round: { winnerIds: ['user1'] } }
        ]);
    });

    test('checks edit permissions before mutation and marks missing messages lost', async () => {
        let allowed = false;
        const message = { edit: jest.fn() };
        const channel = { id: 'channel1', messages: { fetch: jest.fn()
            .mockResolvedValueOnce(message).mockResolvedValueOnce(null) } };
        const guild = { id: 'guild1', channels: { cache: new Map([['channel1', channel]]) },
            members: { me: { permissionsIn: () => ({ has: () => allowed }) } } };
        service.client = { guilds: { cache: new Map([['guild1', guild]]) } };
        const giveaway = service.reserveGiveaway({ guildId: 'guild1', channelId: 'channel1', hostId: 'admin',
            duration: '10s', winnerCount: 1, prize: 'Nitro' });
        service.attachMessage(giveaway.id, 'message1');

        await expect(service.editDiscordGiveaway(service.getGiveaway(giveaway.id), { prize: 'Changed' }, 'admin'))
            .rejects.toThrow('View Channel');
        expect(service.getGiveaway(giveaway.id).prize).toBe('Nitro');
        expect(message.edit).not.toHaveBeenCalled();
        allowed = true;
        await expect(service.editDiscordGiveaway(service.getGiveaway(giveaway.id), { prize: 'Changed' }, 'admin'))
            .rejects.toThrow('exact giveaway message');
        expect(service.getGiveaway(giveaway.id).status).toBe('lost');
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
        service.completeEnd(giveaway.id, 'admin', first.round.deliveryToken);
        const pending = service.createReroll(giveaway.id, 'admin', [...members.values()]);
        database.sqlite.prepare('UPDATE giveaway_rounds SET delivery_lease_until = 0 WHERE id = ?').run(pending.round.id);

        const result = await service.reconcile();
        const resumed = database.sqlite.prepare('SELECT * FROM giveaway_rounds WHERE id = ?').get(pending.round.id);

        expect(result.resumed).toBe(1);
        expect(resumed.announced_at).toBe(1000);
        expect(JSON.parse(resumed.winners_snapshot)).not.toEqual(first.round.winnerIds);
        expect(database.sqlite.prepare('SELECT COUNT(*) count FROM giveaway_rounds WHERE giveaway_id = ?').get(giveaway.id).count).toBe(2);
    });

    test('stops retrying a reroll whose exact message is gone', async () => {
        const members = ['user1', 'user2'].map(id => ({ id, user: { id, bot: false }, roles: { cache: new Map() } }));
        const channel = { id: 'channel1', messages: { fetch: jest.fn().mockResolvedValue(null) } };
        const guild = { id: 'guild1', channels: { cache: new Map([['channel1', channel]]) },
            members: { cache: new Map(members.map(member => [member.id, member])), fetch: jest.fn() } };
        service.client = { user: { id: 'bot' }, guilds: { cache: new Map([['guild1', guild]]) }, users: { fetch: jest.fn() } };
        const giveaway = service.reserveGiveaway({ guildId: 'guild1', channelId: 'channel1', hostId: 'admin',
            duration: '10s', winnerCount: 1, prize: 'Nitro' });
        service.attachMessage(giveaway.id, 'message1');
        for (const member of members) service.enter(giveaway.id, member);
        const first = service.claimEnd(giveaway.id, 'admin', members);
        service.completeEnd(giveaway.id, 'admin', first.round.deliveryToken);
        const pending = service.createReroll(giveaway.id, 'admin', members);
        database.sqlite.prepare('UPDATE giveaway_rounds SET delivery_lease_until = 0 WHERE id = ?').run(pending.round.id);

        await service.reconcile();

        expect(service.getGiveaway(giveaway.id).status).toBe('lost');
        expect(service.dueRerolls()).toHaveLength(0);
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
