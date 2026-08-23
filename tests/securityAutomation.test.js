const fs = require('fs');
const os = require('os');
const path = require('path');
const { PermissionFlagsBits, UserFlagsBitField } = require('discord.js');

function permissions(...allowed) {
    return { has: jest.fn(value => allowed.includes(value) || allowed.includes('all')) };
}

function member(id, guild, options = {}) {
    const roleIds = options.roles || [];
    return {
        id,
        guild,
        joinedTimestamp: options.joinedTimestamp || Date.now(),
        user: {
            id,
            bot: Boolean(options.bot),
            avatar: options.avatar === undefined ? 'avatar' : options.avatar,
            username: options.username || id,
            createdTimestamp: options.createdTimestamp || Date.now() - 365 * 86400000,
            flags: options.verified
                ? new UserFlagsBitField(UserFlagsBitField.Flags.VerifiedBot)
                : new UserFlagsBitField()
        },
        permissions: permissions(...(options.permissions || [])),
        roles: {
            highest: { position: 1 },
            cache: new Map(roleIds.map(roleId => [roleId, { id: roleId }]))
        },
        displayName: options.displayName || options.username || id,
        nickname: options.nickname || null,
        setNickname: jest.fn().mockResolvedValue({}),
        kick: jest.fn().mockResolvedValue({}),
        ban: jest.fn().mockResolvedValue({}),
        timeout: jest.fn().mockResolvedValue({})
    };
}

function interaction(server, group, subcommand, values = {}, admin = true) {
    const actor = member('admin1', server, {
        permissions: admin ? [PermissionFlagsBits.Administrator] : []
    });
    return {
        guild: server,
        user: actor.user,
        member: actor,
        options: {
            getSubcommandGroup: jest.fn().mockReturnValue(group),
            getSubcommand: jest.fn().mockReturnValue(subcommand),
            getString: jest.fn(name => values[name] ?? null),
            getBoolean: jest.fn(name => values[name] ?? null),
            getInteger: jest.fn(name => values[name] ?? null),
            getUser: jest.fn(name => values[name] ?? null),
            getRole: jest.fn(name => values[name] ?? null),
            getChannel: jest.fn(name => values[name] ?? null)
        },
        reply: jest.fn().mockResolvedValue({})
    };
}

function guild(id = 'guild1') {
    const value = {
        id,
        ownerId: 'owner1',
        members: {
            me: null,
            fetch: jest.fn()
        },
        channels: { cache: new Map(), fetch: jest.fn().mockResolvedValue(null) }
    };
    value.members.me = member('bot1', value, {
        bot: true,
        permissions: ['all'],
        roles: []
    });
    value.members.me.roles.highest.position = 100;
    return value;
}

function message(author, content, options = {}) {
    return {
        id: options.id || `message-${Math.random()}`,
        guild: author.guild,
        guildId: author.guild.id,
        author: author.user,
        member: author,
        content,
        channelId: options.channelId || 'channel1',
        channel: {
            id: options.channelId || 'channel1',
            permissionsFor: jest.fn(() => permissions(PermissionFlagsBits.ManageMessages))
        },
        mentions: options.mentions || { users: new Map(), roles: new Map(), everyone: false },
        attachments: options.attachments || new Map(),
        embeds: options.embeds || [],
        webhookId: null,
        system: false,
        delete: jest.fn().mockResolvedValue({})
    };
}

describe('AntiRaid and advanced AutoMod', () => {
    let tempDir;
    let database;
    let antiraid;
    let automod;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-security-automation-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        antiraid = require('../src/services/antiraidService');
        automod = require('../src/services/automodService');
    });

    afterEach(async () => {
        await automod?.cleanup?.();
        database.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('publishes the complete evidenced module, filter, and punishment sets without premium gates', () => {
        expect(antiraid.MODULES).toEqual([
            'massjoin', 'defaultpfp', 'newaccounts', 'massmention', 'unverifiedbots', 'username'
        ]);
        expect(antiraid.PUNISHMENTS).toEqual(['ban', 'kick', 'timeout', 'jail']);
        expect(automod.FILTERS).toEqual([
            'spam', 'caps', 'emoji', 'massmention', 'spoilers', 'images', 'invites', 'links',
            'repetition', 'walloftext', 'keywords', 'musicfiles', 'nicknames', 'nsfw', 'malicious'
        ]);
        expect(automod.ACTIONS).toEqual([
            'delete', 'timeout', 'warn', 'kick', 'ban', 'jail', 'strip', 'stripstaff'
        ]);
        expect(fs.readFileSync(require.resolve('../src/services/antiraidService'), 'utf8')).not.toMatch(/premium|entitlement|subscription/i);
        expect(fs.readFileSync(require.resolve('../src/services/automodService'), 'utf8')).not.toMatch(/premium|entitlement|subscription/i);
    });

    test('mass-join thresholds are bounded, guild-scoped, and inactive by default', async () => {
        const firstGuild = guild('guild1');
        const secondGuild = guild('guild2');
        const first = member('user1', firstGuild);
        const second = member('user2', firstGuild);
        const outsider = member('user3', secondGuild);
        firstGuild.members.fetch.mockImplementation(id => Promise.resolve(id === first.id ? first : second));

        expect(await antiraid.handleMemberJoin(first, 1000)).toBeNull();
        antiraid.ensureConfig(firstGuild.id);
        database.sqlite.prepare("UPDATE antiraid_config SET enabled = 1 WHERE guild_id = ?").run(firstGuild.id);
        antiraid.upsertModule(firstGuild.id, 'massjoin', { enabled: 1, threshold: 2, windowSeconds: 60, punishMembers: 1 });

        expect(await antiraid.handleMemberJoin(first, 1000)).toBeNull();
        expect(await antiraid.handleMemberJoin(outsider, 1500)).toBeNull();
        const incident = await antiraid.handleMemberJoin(second, 2000);

        expect(incident).toEqual(expect.objectContaining({ module: 'massjoin', count: 2 }));
        expect(first.kick).toHaveBeenCalledTimes(1);
        expect(second.kick).toHaveBeenCalledTimes(1);
        expect(outsider.kick).not.toHaveBeenCalled();
    });

    test('join detectors cover account age, default avatars, username patterns, and unverified bots', async () => {
        const server = guild();
        antiraid.ensureConfig(server.id);
        database.sqlite.prepare("UPDATE antiraid_config SET enabled = 1 WHERE guild_id = ?").run(server.id);
        for (const moduleName of ['newaccounts', 'defaultpfp', 'username', 'unverifiedbots']) {
            antiraid.upsertModule(server.id, moduleName, { enabled: 1, threshold: 30, punishment: 'kick' });
        }
        antiraid.upsertModule(server.id, 'username', { punishment: 'ban' });
        antiraid.upsertModule(server.id, 'unverifiedbots', { punishment: 'ban' });
        database.sqlite.prepare(`
            INSERT INTO antiraid_username_patterns (guild_id, pattern) VALUES (?, 'raid')
        `).run(server.id);

        const newAccount = member('new', server, { createdTimestamp: Date.now() - 86400000 });
        const noAvatar = member('avatar', server, { avatar: null });
        const named = member('named', server, { username: 'RAID-account' });
        const unverified = member('unverified', server, { bot: true, verified: false });
        const verified = member('verified', server, { bot: true, verified: true });
        server.members.fetch.mockImplementation(id => Promise.resolve([newAccount, noAvatar, named, unverified, verified].find(item => item.id === id)));

        expect((await antiraid.handleMemberJoin(newAccount)).module).toBe('newaccounts');
        expect((await antiraid.handleMemberJoin(noAvatar)).module).toBe('defaultpfp');
        expect((await antiraid.handleMemberJoin(named)).module).toBe('username');
        expect((await antiraid.handleMemberJoin(unverified)).module).toBe('unverifiedbots');
        expect(await antiraid.handleMemberJoin(verified)).toBeNull();
        expect(named.ban).toHaveBeenCalledTimes(1);
        expect(unverified.ban).toHaveBeenCalledTimes(1);

        const overlap = member('overlap', server, { username: 'raid-new', createdTimestamp: Date.now() - 86400000 });
        const overlapIncident = await antiraid.handleMemberJoin(overlap);
        expect(overlapIncident).toEqual(expect.objectContaining({
            module: 'username', punishment: 'ban', matchedModules: ['newaccounts', 'username']
        }));
        expect(overlap.ban).toHaveBeenCalledTimes(1);
        expect(overlap.kick).not.toHaveBeenCalled();
    });

    test('failed AntiRaid punishment does not cascade into lockdown and bot messages are exempt', async () => {
        const server = guild();
        const target = member('target', server);
        target.kick.mockRejectedValue(new Error('cannot kick'));
        antiraid.ensureConfig(server.id);
        database.sqlite.prepare(`
            UPDATE antiraid_config SET enabled = 1, massmention_lockdown_seconds = 60 WHERE guild_id = ?
        `).run(server.id);
        antiraid.upsertModule(server.id, 'massmention', { enabled: 1, threshold: 1, punishment: 'kick' });
        const mention = { users: new Map([['one', {}]]), roles: new Map(), everyone: false };

        expect((await antiraid.handleMassMention(message(target, '@one', { mentions: mention }))).status).toBe('failed');
        expect(database.sqlite.prepare('SELECT lockdown_enabled FROM antiraid_config WHERE guild_id = ?').get(server.id).lockdown_enabled).toBe(0);

        const bot = member('other-bot', server, { bot: true });
        expect(await antiraid.handleMassMention(message(bot, '@one', { mentions: mention }))).toBeNull();
    });

    test('staff and explicit users or roles bypass message enforcement', async () => {
        const server = guild();
        automod.ensureConfig(server.id);
        database.sqlite.prepare("UPDATE automod_config SET enabled = 1 WHERE guild_id = ?").run(server.id);
        automod.upsertFilter(server.id, 'keywords', { enabled: 1, action: 'delete' });
        automod.addRule(server.id, 'keyword', 'blocked');
        database.sqlite.prepare("INSERT INTO automod_exemptions (guild_id, target_type, target_id) VALUES (?, 'role', 'trusted')").run(server.id);

        const admin = member('admin', server, { permissions: [PermissionFlagsBits.Administrator] });
        const trusted = member('trusted-user', server, { roles: ['trusted'] });
        const ordinary = member('ordinary', server);
        const adminMessage = message(admin, 'blocked');
        const trustedMessage = message(trusted, 'blocked');
        const ordinaryMessage = message(ordinary, 'blocked');

        expect(await automod.handleMessage(adminMessage)).toBeNull();
        expect(await automod.handleMessage(trustedMessage)).toBeNull();
        expect((await automod.handleMessage(ordinaryMessage)).filter).toBe('keywords');
        expect(ordinaryMessage.delete).toHaveBeenCalledTimes(1);

        database.sqlite.prepare("INSERT INTO automod_exemptions (guild_id, target_type, target_id) VALUES (?, 'channel', 'quiet')").run(server.id);
        expect(await automod.handleMessage(message(ordinary, 'blocked', { channelId: 'quiet' }))).toBeNull();
    });

    test('spam windows and strike escalation are bounded per guild and member', async () => {
        const server = guild();
        const target = member('target', server);
        automod.ensureConfig(server.id);
        database.sqlite.prepare(`
            UPDATE automod_config SET enabled = 1, strikes_enabled = 1, strike_decay_hours = 24, strike_cap = 10
            WHERE guild_id = ?
        `).run(server.id);
        automod.upsertFilter(server.id, 'spam', { enabled: 1, threshold: 2, action: 'delete' });
        expect(() => automod.upsertFilter(server.id, 'spam', { threshold: 101 })).toThrow('between 1 and 100');
        automod.setStrikeLevel(server.id, 2, 'timeout', 300000);

        expect(await automod.handleMessage(message(target, 'one'), 1000)).toBeNull();
        const second = message(target, 'two');
        expect((await automod.handleMessage(second, 2000)).filter).toBe('spam');
        expect(await automod.handleMessage(second, 2000)).toBeNull();
        expect(automod.getActiveStrikes(server.id, target.id, 2000).count).toBe(1);
        expect((await automod.handleMessage(message(target, 'three'), 3000)).filter).toBe('spam');
        expect(automod.getActiveStrikes(server.id, target.id, 3000).count).toBe(2);
        expect(target.timeout).toHaveBeenCalledWith(300000, expect.stringContaining('AutoMod'));
    });

    test('named regex evaluation is isolated and a timed-out batch fails closed', async () => {
        const server = guild();
        const target = member('target', server);
        automod.ensureConfig(server.id);
        database.sqlite.prepare("UPDATE automod_config SET enabled = 1 WHERE guild_id = ?").run(server.id);
        automod.upsertFilter(server.id, 'keywords', { enabled: 1, action: 'delete' });
        await automod.addRegex(server.id, 'digits', '^hello\\d+$');

        const matched = message(target, 'hello123');
        expect((await automod.handleMessage(matched)).filter).toBe('regex:digits');
        expect(matched.delete).toHaveBeenCalledTimes(1);

        await expect(automod.testRegex('(a+)+$', `${'a'.repeat(1999)}!`, 5)).resolves.toEqual({ timedOut: true, matched: false });

        const queued = Array.from({ length: 101 }, () => automod.testRegex('^a$', 'a'));
        expect((await Promise.all(queued)).filter(result => result.error === 'Regex queue is full.')).toHaveLength(1);
    });

    test.each([
        ['caps', 'THIS IS VERY LOUD', { threshold: 70 }],
        ['emoji', '😀😀', { threshold: 2 }],
        ['massmention', 'hello', { threshold: 2, mentions: { users: new Map([['1', {}], ['2', {}]]), roles: new Map(), everyone: false } }],
        ['spoilers', '||one|| ||two||', { threshold: 2 }],
        ['images', '', { threshold: 1, attachments: new Map([['1', { contentType: 'image/png', name: 'x.png' }]]) }],
        ['invites', 'join https://discord.gg/example', { threshold: 1 }],
        ['links', 'read https://example.com/page', { threshold: 1 }],
        ['walloftext', '12345', { threshold: 5 }],
        ['musicfiles', '', { threshold: 1, attachments: new Map([['1', { contentType: 'audio/mpeg', name: 'x.mp3' }]]) }]
    ])('detects the public %s filter', async (filter, content, options) => {
        const server = guild();
        const target = member(`target-${filter}`, server);
        automod.ensureConfig(server.id);
        database.sqlite.prepare("UPDATE automod_config SET enabled = 1 WHERE guild_id = ?").run(server.id);
        automod.upsertFilter(server.id, filter, { enabled: 1, threshold: options.threshold, action: 'delete' });
        const source = message(target, content, options);

        expect((await automod.handleMessage(source)).filter).toBe(filter);
        expect(source.delete).toHaveBeenCalledTimes(1);
    });

    test('keyword allowlisting, malicious domains, repetition, and nickname filtering use explicit rules', async () => {
        const server = guild();
        const target = member('target', server, { displayName: 'ordinary' });
        automod.ensureConfig(server.id);
        database.sqlite.prepare("UPDATE automod_config SET enabled = 1 WHERE guild_id = ?").run(server.id);

        automod.upsertFilter(server.id, 'keywords', { enabled: 1, action: 'delete' });
        automod.addRule(server.id, 'keyword', 'blocked');
        automod.addRule(server.id, 'allowword', 'allowed blocked phrase');
        expect(await automod.handleMessage(message(target, 'allowed blocked phrase'))).toBeNull();
        expect((await automod.handleMessage(message(target, 'this is blocked'))).filter).toBe('keywords');

        automod.upsertFilter(server.id, 'keywords', { enabled: 0 });
        automod.upsertFilter(server.id, 'malicious', { enabled: 1, action: 'delete' });
        automod.addRule(server.id, 'blacklist', 'danger.example');
        expect((await automod.handleMessage(message(target, 'https://sub.danger.example/x'))).filter).toBe('malicious');

        automod.upsertFilter(server.id, 'malicious', { enabled: 0 });
        automod.upsertFilter(server.id, 'repetition', { enabled: 1, threshold: 2, action: 'delete' });
        expect(await automod.handleMessage(message(target, 'same'), 1000)).toBeNull();
        expect((await automod.handleMessage(message(target, 'same'), 2000)).filter).toBe('repetition');

        automod.upsertFilter(server.id, 'repetition', { enabled: 0 });
        automod.upsertFilter(server.id, 'nicknames', { enabled: 1, action: 'delete' });
        automod.addRule(server.id, 'keyword', 'cat');
        expect(await automod.handleMemberUpdate(target, { ...target, displayName: 'caterpillar', nickname: 'caterpillar' })).toBeNull();
        const renamed = { ...target, displayName: 'blocked name', nickname: 'blocked name' };
        expect((await automod.handleMemberUpdate(target, renamed)).filter).toBe('nicknames');
        expect(renamed.setNickname).toHaveBeenCalledWith(null, 'AutoMod nickname filter');
    });

    test('public slash execution requires real Administrator and records configuration cases', async () => {
        const serverGuild = guild();
        const serverCommand = require('../src/commands/administration/server');
        const denied = interaction(serverGuild, 'automod', 'toggle', { enabled: true }, false);
        await serverCommand.execute(denied, {});
        expect(denied.reply.mock.calls[0][0].embeds[0].data.description).toContain('Administrator');
        expect(database.sqlite.prepare('SELECT * FROM automod_config WHERE guild_id = ?').get(serverGuild.id)).toBeUndefined();

        const allowed = interaction(serverGuild, 'automod', 'toggle', { enabled: true });
        await serverCommand.execute(allowed, {});
        expect(database.sqlite.prepare('SELECT enabled FROM automod_config WHERE guild_id = ?').get(serverGuild.id).enabled).toBe(1);
        expect(database.sqlite.prepare("SELECT status FROM moderation_cases WHERE action = 'AUTOMOD_TOGGLE'").get().status).toBe('completed');
    });

    test('native migration owns exact keyword and NSFW rules and unmigrate deletes only those ids', async () => {
        const serverGuild = guild();
        const serverCommand = require('../src/commands/administration/server');
        const keywordRule = { id: 'rule-keywords', edit: jest.fn().mockResolvedValue({}), delete: jest.fn().mockResolvedValue({}) };
        const nsfwRule = { id: 'rule-nsfw', edit: jest.fn().mockResolvedValue({}), delete: jest.fn().mockResolvedValue({}) };
        serverGuild.autoModerationRules = {
            create: jest.fn()
                .mockResolvedValueOnce(keywordRule)
                .mockResolvedValueOnce(nsfwRule),
            fetch: jest.fn(id => Promise.resolve(id === keywordRule.id ? keywordRule : id === nsfwRule.id ? nsfwRule : null))
        };
        automod.ensureConfig(serverGuild.id);
        database.sqlite.prepare('UPDATE automod_config SET enabled = 1 WHERE guild_id = ?').run(serverGuild.id);
        automod.addRule(serverGuild.id, 'keyword', 'blocked');
        automod.addRule(serverGuild.id, 'allowword', 'allowed');
        automod.upsertFilter(serverGuild.id, 'nsfw', { enabled: 1 });

        await serverCommand.execute(interaction(serverGuild, 'automod', 'migration', { action: 'migrate' }), {});
        expect(serverGuild.autoModerationRules.create).toHaveBeenCalledTimes(2);
        expect(serverGuild.autoModerationRules.create.mock.calls[0][0].triggerMetadata).toEqual({
            keywordFilter: ['blocked'], allowList: ['allowed']
        });
        expect(database.sqlite.prepare('SELECT native_rule_id, native_nsfw_rule_id FROM automod_config').get())
            .toEqual({ native_rule_id: 'rule-keywords', native_nsfw_rule_id: 'rule-nsfw' });

        const target = member('native-target', serverGuild);
        serverGuild.members.fetch.mockResolvedValue(target);
        automod.upsertFilter(serverGuild.id, 'keywords', { enabled: 1, action: 'timeout' });
        const fallback = message(target, 'blocked', { id: 'native-fallback' });
        expect((await automod.handleMessage(fallback)).filter).toBe('keywords');
        expect(await automod.handleNativeActionExecution({
            guild: serverGuild, guildId: serverGuild.id, ruleId: keywordRule.id,
            messageId: 'native-message', userId: target.id, member: target
        })).toEqual(expect.objectContaining({ filter: 'native:keywords', action: 'timeout', status: 'applied' }));
        expect(target.timeout).toHaveBeenCalledTimes(2);
        expect(await automod.handleNativeActionExecution({
            guild: serverGuild, guildId: serverGuild.id, ruleId: keywordRule.id,
            messageId: 'native-message', userId: target.id, member: target
        })).toBeNull();

        keywordRule.edit.mockClear();
        await serverCommand.execute(interaction(serverGuild, 'automod', 'filter', {
            action: 'toggle', filter: 'keywords', enabled: false
        }), {});
        expect(keywordRule.edit).toHaveBeenCalledWith({ enabled: false, reason: 'ByteBot keywords filter toggle' });
        expect(await automod.handleNativeActionExecution({
            guild: serverGuild, guildId: serverGuild.id, ruleId: keywordRule.id,
            messageId: 'native-filter-disabled', userId: target.id, member: target
        })).toBeNull();
        await serverCommand.execute(interaction(serverGuild, 'automod', 'filter', {
            action: 'toggle', filter: 'keywords', enabled: true
        }), {});

        keywordRule.edit.mockClear();
        nsfwRule.edit.mockClear();
        await serverCommand.execute(interaction(serverGuild, 'automod', 'toggle', { enabled: false }), {});
        expect(keywordRule.edit).toHaveBeenCalledWith({ enabled: false, reason: 'ByteBot AutoMod toggle' });
        expect(nsfwRule.edit).toHaveBeenCalledWith({ enabled: false, reason: 'ByteBot AutoMod toggle' });
        expect(await automod.handleNativeActionExecution({
            guild: serverGuild, guildId: serverGuild.id, ruleId: keywordRule.id,
            messageId: 'native-disabled', userId: target.id, member: target
        })).toBeNull();

        await serverCommand.execute(interaction(serverGuild, 'automod', 'migration', { action: 'unmigrate' }), {});
        expect(keywordRule.delete).toHaveBeenCalledTimes(1);
        expect(nsfwRule.delete).toHaveBeenCalledTimes(1);
        expect(database.sqlite.prepare('SELECT native_rule_id, native_nsfw_rule_id FROM automod_config').get())
            .toEqual({ native_rule_id: null, native_nsfw_rule_id: null });
    });

    test('startup reconciliation marks indeterminate pending incidents failed without repeating punishments', () => {
        database.sqlite.prepare(`
            INSERT INTO antiraid_incidents (guild_id, user_id, module, punishment, status, created_at)
            VALUES ('guild1', 'user1', 'massjoin', 'kick', 'pending', 1)
        `).run();
        database.sqlite.prepare(`
            INSERT INTO automod_incidents (guild_id, user_id, message_id, filter, action, status, created_at)
            VALUES ('guild1', 'user1', 'message1', 'spam', 'delete', 'pending', 1)
        `).run();

        expect(antiraid.recoverPendingIncidents()).toBe(1);
        expect(automod.recoverPendingIncidents()).toBe(1);
        expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM antiraid_incidents WHERE status = 'pending'").get().count).toBe(0);
        expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM automod_incidents WHERE status = 'pending'").get().count).toBe(0);
    });
});
