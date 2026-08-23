const fs = require('fs');
const os = require('os');
const path = require('path');
const { PermissionFlagsBits } = require('discord.js');

function actor(granted) {
    const permissions = new Set(granted);
    return {
        id: 'mod1', user: { id: 'mod1', tag: 'Moderator' },
        roles: { cache: new Map(), highest: { position: 10 } },
        permissions: { has: jest.fn(permission => Array.isArray(permission)
            ? permission.every(value => permissions.has(value))
            : permissions.has(permission)) }
    };
}

function interaction({ guild, member, group, subcommand, values = {}, channel = guild.channels.cache.get('channel1') }) {
    return {
        id: 'interaction1', commandName: 'mod', guild, channel, channelId: channel.id,
        member, user: member.user, deferred: false, replied: false,
        options: {
            getSubcommandGroup: jest.fn().mockReturnValue(group),
            getSubcommand: jest.fn().mockReturnValue(subcommand),
            getString: jest.fn(name => values[name] ?? null),
            getInteger: jest.fn(name => values[name] ?? null),
            getBoolean: jest.fn(name => values[name] ?? null),
            getMember: jest.fn(name => values[name] ?? null),
            getUser: jest.fn(name => values[name]?.user || values[name] || null),
            getRole: jest.fn(name => values[name] ?? null),
            getChannel: jest.fn(name => values[name] ?? null),
            getAttachment: jest.fn(name => values[name] ?? null)
        },
        deferReply: jest.fn(function defer() { this.deferred = true; }),
        editReply: jest.fn(), reply: jest.fn()
    };
}

function role(id, position = 2, dangerous = false) {
    return {
        id, name: id, position, managed: false,
        permissions: { has: jest.fn(permission => dangerous && permission === PermissionFlagsBits.Administrator) },
        colors: { primaryColor: 0, secondaryColor: null, tertiaryColor: null },
        setColors: jest.fn(), setHoist: jest.fn(), setMentionable: jest.fn(), setName: jest.fn(), setIcon: jest.fn(), delete: jest.fn(),
        toString: () => `<@&${id}>`
    };
}

function member(guild, id = 'user1', bot = false) {
    const result = {
        id, guild, user: { id, tag: id, bot }, nickname: null,
        roles: { cache: new Map(), highest: { position: 1 } },
        setNickname: jest.fn(async nickname => { result.nickname = nickname; }),
        toString: () => `<@${id}>`
    };
    result.roles.add = jest.fn(async added => result.roles.cache.set(added.id, added));
    result.roles.remove = jest.fn(async removed => result.roles.cache.delete(removed.id));
    return result;
}

describe('channel and role moderation parity', () => {
    let tempDir;
    let database;
    let mod;
    let guild;
    let channel;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-channel-role-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        mod = require('../src/commands/moderation/mod');
        channel = {
            id: 'channel1', toString: () => '<#channel1>',
            isTextBased: () => true, isThread: () => false,
            permissionOverwrites: { cache: new Map(), edit: jest.fn() },
            messages: { fetch: jest.fn() }, bulkDelete: jest.fn(),
            setRateLimitPerUser: jest.fn(), setTopic: jest.fn(), setNSFW: jest.fn()
        };
        guild = {
            id: 'guild1', ownerId: 'owner1', channels: { cache: new Map([[channel.id, channel]]) },
            roles: { cache: new Map(), create: jest.fn() },
            members: {
                me: {
                    id: 'bot1', roles: { highest: { position: 20 } },
                    permissions: { has: jest.fn().mockReturnValue(true) }
                },
                fetch: jest.fn()
            }
        };
    });

    afterEach(() => {
        jest.restoreAllMocks();
        database.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('Manage Messages alone can run a filtered purge through the public hub', async () => {
        const botMessage = { id: '200', author: { id: 'bot2', bot: true }, attachments: new Map(), embeds: [], createdTimestamp: Date.now() };
        const humanMessage = { id: '199', author: { id: 'user1', bot: false }, attachments: new Map(), embeds: [], createdTimestamp: Date.now() };
        channel.messages.fetch.mockResolvedValueOnce(new Map([[botMessage.id, botMessage], [humanMessage.id, humanMessage]]));
        channel.bulkDelete.mockResolvedValue(new Map());
        const moderator = actor([PermissionFlagsBits.ManageMessages]);
        const command = interaction({
            guild, member: moderator, group: 'channel', subcommand: 'purge',
            values: { filter: 'bots', amount: 10 }
        });

        await mod.execute(command, {});

        expect(command.reply).not.toHaveBeenCalled();
        expect(channel.bulkDelete).toHaveBeenCalledWith([botMessage], true);
        expect(database.sqlite.prepare("SELECT action FROM moderation_cases").get().action).toBe('PURGE');
    });

    test('cleanup removes bot messages and configured-prefix invocations', async () => {
        database.sqlite.prepare("INSERT INTO guilds (id, prefix) VALUES ('guild1', '?')").run();
        const botMessage = { id: '201', content: 'response', author: { id: 'bot2', bot: true }, createdTimestamp: Date.now() };
        const invocation = { id: '200', content: '?help', author: { id: 'user1', bot: false }, createdTimestamp: Date.now() };
        const chat = { id: '199', content: 'hello', author: { id: 'user2', bot: false }, createdTimestamp: Date.now() };
        channel.messages.fetch.mockResolvedValueOnce(new Map([[botMessage.id, botMessage], [invocation.id, invocation], [chat.id, chat]]));
        const command = interaction({ guild, member: actor([PermissionFlagsBits.ManageMessages]), group: 'channel', subcommand: 'cleanup', values: { amount: 20 } });

        await mod.execute(command, {});

        expect(channel.bulkDelete).toHaveBeenCalledWith([botMessage, invocation], true);
    });

    test('selfpurge requires Manage Messages and only deletes the caller messages', async () => {
        const ownMessage = { id: '200', author: { id: 'user1', bot: false }, createdTimestamp: Date.now() };
        const otherMessage = { id: '199', author: { id: 'user2', bot: false }, createdTimestamp: Date.now() };
        channel.messages.fetch.mockResolvedValueOnce(new Map([[ownMessage.id, ownMessage], [otherMessage.id, otherMessage]]));
        const denied = interaction({ guild, member: actor([]), group: 'channel', subcommand: 'selfpurge', values: { amount: 50 } });
        await mod.execute(denied, {});
        expect(denied.reply).toHaveBeenCalled();
        expect(channel.bulkDelete).not.toHaveBeenCalled();

        const caller = actor([PermissionFlagsBits.ManageMessages]);
        caller.id = 'user1';
        caller.user.id = 'user1';
        const command = interaction({ guild, member: caller, group: 'channel', subcommand: 'selfpurge', values: { amount: 50 } });

        await mod.execute(command, {});

        expect(channel.bulkDelete).toHaveBeenCalledWith([ownMessage], true);
        expect(command.editReply.mock.calls[0][0].embeds[0].data.title).toContain('Self Purge Complete');
    });

    test('reaction purge skips messages without reactions', async () => {
        const reacted = { id: '200', author: { id: 'user1' }, reactions: { cache: new Map([['x', {}]]), removeAll: jest.fn() } };
        const plain = { id: '199', author: { id: 'user2' }, reactions: { cache: new Map(), removeAll: jest.fn() } };
        channel.messages.fetch.mockResolvedValueOnce(new Map([[reacted.id, reacted], [plain.id, plain]]));
        const command = interaction({ guild, member: actor([PermissionFlagsBits.ManageMessages]), group: 'channel', subcommand: 'purge', values: { filter: 'reactions', amount: 10 } });

        await mod.execute(command, {});

        expect(reacted.reactions.removeAll).toHaveBeenCalled();
        expect(plain.reactions.removeAll).not.toHaveBeenCalled();
    });

    test('message-boundary purge rejects an ID from another channel', async () => {
        channel.messages.fetch.mockResolvedValueOnce({ id: '200', channelId: 'other-channel' });
        const command = interaction({ guild, member: actor([PermissionFlagsBits.ManageMessages]), group: 'channel', subcommand: 'purge', values: { filter: 'after', amount: 10, start_id: '200' } });

        await mod.execute(command, {});

        expect(command.editReply.mock.calls[0][0].embeds[0].data.description).toContain('not from this channel');
        expect(channel.bulkDelete).not.toHaveBeenCalled();
    });

    test('lockdown restores the exact prior Send Messages overwrite and respects ignores', async () => {
        const lockRole = role('lock-role');
        guild.roles.cache.set(lockRole.id, lockRole);
        const moderator = actor([PermissionFlagsBits.ManageChannels]);
        await mod.execute(interaction({ guild, member: moderator, group: 'channel', subcommand: 'lockdown-role', values: { role: lockRole } }), {});
        expect(database.sqlite.prepare("SELECT status FROM moderation_cases WHERE action = 'LOCKDOWN_ROLE'").get().status).toBe('completed');
        channel.permissionOverwrites.cache.set(lockRole.id, {
            allow: { has: permission => permission === PermissionFlagsBits.SendMessages },
            deny: { has: () => false }
        });

        await mod.execute(interaction({ guild, member: moderator, group: 'channel', subcommand: 'lockdown' }), {});
        await mod.execute(interaction({ guild, member: moderator, group: 'channel', subcommand: 'unlockdown' }), {});

        expect(channel.permissionOverwrites.edit).toHaveBeenNthCalledWith(1, lockRole.id, { SendMessages: false }, expect.any(Object));
        expect(channel.permissionOverwrites.edit).toHaveBeenNthCalledWith(2, lockRole.id, { SendMessages: true }, expect.any(Object));
        expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM lockdown_states').get().count).toBe(0);

        await mod.execute(interaction({ guild, member: moderator, group: 'channel', subcommand: 'lockdown-ignore', values: { channel } }), {});
        expect(database.sqlite.prepare("SELECT status FROM moderation_cases WHERE action = 'LOCKDOWN_IGNORE'").get().status).toBe('completed');
        const ignored = interaction({ guild, member: moderator, group: 'channel', subcommand: 'lockdown' });
        await mod.execute(ignored, {});
        expect(ignored.editReply.mock.calls[0][0].embeds[0].data.description).toContain('ignored');
    });

    test('a failed lockdown remains pending and a retry activates the same durable state', async () => {
        const lockRole = role('lock-role');
        const moderator = actor([PermissionFlagsBits.ManageChannels]);
        await mod.execute(interaction({ guild, member: moderator, group: 'channel', subcommand: 'lockdown-role', values: { role: lockRole } }), {});
        channel.permissionOverwrites.edit.mockRejectedValueOnce(new Error('Discord unavailable')).mockResolvedValueOnce();

        await mod.execute(interaction({ guild, member: moderator, group: 'channel', subcommand: 'lockdown' }), {});
        expect(database.sqlite.prepare('SELECT state FROM lockdown_states').get().state).toBe('pending');
        await mod.execute(interaction({ guild, member: moderator, group: 'channel', subcommand: 'lockdown' }), {});

        expect(database.sqlite.prepare('SELECT state FROM lockdown_states').get().state).toBe('active');
        expect(channel.permissionOverwrites.edit).toHaveBeenCalledTimes(2);
    });

    test('server lockdown fails explicitly rather than silently truncating an oversized set', async () => {
        const channels = Array.from({ length: 501 }, (_, index) => [`channel-${index}`, {
            id: `channel-${index}`, isTextBased: () => true, isThread: () => false
        }]);
        guild.channels.cache = new Map(channels);
        const command = interaction({ guild, member: actor([PermissionFlagsBits.ManageChannels]), group: 'channel', subcommand: 'lockdown-all', values: { confirm: true }, channel: channels[0][1] });

        await mod.execute(command, {});

        expect(command.editReply.mock.calls[0][0].embeds[0].data.description).toContain('capped at 500');
    });

    test('slowmode, topic, and NSFW channel mutations use Discord bounds and audit reasons', async () => {
        const moderator = actor([PermissionFlagsBits.ManageChannels]);
        channel.setTopic.mockImplementation(() => {
            expect(database.sqlite.prepare("SELECT status FROM moderation_cases WHERE action = 'TOPIC'").get().status).toBe('pending');
        });
        await mod.execute(interaction({ guild, member: moderator, group: 'channel', subcommand: 'slowmode', values: { duration: '6h', reason: 'traffic' } }), {});
        await mod.execute(interaction({ guild, member: moderator, group: 'channel', subcommand: 'slowmode', values: { duration: '0s', reason: 'open' } }), {});
        await mod.execute(interaction({ guild, member: moderator, group: 'channel', subcommand: 'topic', values: { text: 'Rules', reason: 'refresh' } }), {});
        await mod.execute(interaction({ guild, member: moderator, group: 'channel', subcommand: 'nsfw', values: { enabled: true, reason: 'classification' } }), {});
        expect(channel.setRateLimitPerUser).toHaveBeenCalledWith(21600, 'traffic');
        expect(channel.setRateLimitPerUser).toHaveBeenCalledWith(0, 'open');
        expect(channel.setTopic).toHaveBeenCalledWith('Rules', 'refresh');
        expect(channel.setNSFW).toHaveBeenCalledWith(true, 'classification');
    });

    test('role removal snapshots roles, restore is denyperm-aware, and dangerous mass grants fail', async () => {
        const memberRole = role('member-role');
        const removedRole = role('removed-role');
        const dangerousRole = role('dangerous-role', 2, true);
        [memberRole, removedRole, dangerousRole].forEach(item => guild.roles.cache.set(item.id, item));
        const target = member(guild);
        target.roles.cache.set(memberRole.id, memberRole);
        target.roles.cache.set(removedRole.id, removedRole);
        guild.members.fetch.mockResolvedValue(new Map([[target.id, target]]));
        const moderator = actor([PermissionFlagsBits.ManageRoles]);

        await mod.execute(interaction({ guild, member: moderator, group: 'role', subcommand: 'remove', values: { target, role: removedRole, reason: 'temporary' } }), {});
        await mod.execute(interaction({ guild, member: moderator, group: 'role', subcommand: 'remove', values: { target, role: memberRole, reason: 'temporary' } }), {});
        await mod.execute(interaction({ guild, member: moderator, group: 'role', subcommand: 'restore', values: { target, reason: 'restore' } }), {});
        expect(target.roles.add).toHaveBeenCalledWith(memberRole, 'restore');
        expect(target.roles.add).toHaveBeenCalledWith(removedRole, 'restore');

        const bulk = interaction({ guild, member: moderator, group: 'role', subcommand: 'bulk', values: {
            action: 'add', scope: 'all', role: dangerousRole, confirm: true
        } });
        await mod.execute(bulk, {});
        expect(bulk.editReply.mock.calls[0][0].embeds[0].data.description).toContain('cannot be assigned');
    });

    test('Manage Roles staff can use the bot bulk scope without Administrator', async () => {
        const botRole = role('bot-role');
        guild.roles.cache.set(botRole.id, botRole);
        const target = member(guild, 'bot-user', true);
        guild.members.fetch.mockResolvedValue(new Map([[target.id, target]]));
        const command = interaction({ guild, member: actor([PermissionFlagsBits.ManageRoles]), group: 'role', subcommand: 'bulk', values: {
            action: 'add', scope: 'bots', role: botRole, confirm: true
        } });

        await mod.execute(command, {});

        expect(target.roles.add).toHaveBeenCalledWith(botRole, expect.any(String));
    });

    test('has bulk scope can read a managed higher role as its selector', async () => {
        const addedRole = role('added-role');
        const selector = role('integration-role', 100);
        selector.managed = true;
        guild.roles.cache.set(addedRole.id, addedRole);
        guild.roles.cache.set(selector.id, selector);
        const target = member(guild);
        target.roles.cache.set(selector.id, selector);
        guild.members.fetch.mockResolvedValue(new Map([[target.id, target]]));
        const command = interaction({ guild, member: actor([PermissionFlagsBits.ManageRoles]), group: 'role', subcommand: 'bulk', values: {
            action: 'add', scope: 'has', target_role: selector, role: addedRole, confirm: true
        } });

        await mod.execute(command, {});

        expect(target.roles.add).toHaveBeenCalledWith(addedRole, expect.any(String));
    });

    test('single role cases carry enough metadata for action-specific case undo', async () => {
        const assignedRole = role('assigned-role');
        guild.roles.cache.set(assignedRole.id, assignedRole);
        const target = member(guild);
        target.roles.cache.set(assignedRole.id, assignedRole);
        guild.members.fetch.mockResolvedValue(target);
        const moderator = actor([PermissionFlagsBits.ManageRoles]);
        await mod.execute(interaction({ guild, member: moderator, group: 'role', subcommand: 'remove', values: { target, role: assignedRole, reason: 'temporary' } }), {});
        const moderationCase = database.sqlite.prepare("SELECT case_number FROM moderation_cases WHERE action = 'ROLE_REMOVE'").get();

        await mod.execute(interaction({ guild, member: moderator, group: 'case', subcommand: 'undo', values: { number: moderationCase.case_number, reason: 'restore' } }), {});

        expect(target.roles.add).toHaveBeenCalledWith(assignedRole, 'restore');
    });

    test('case undo revalidates a role that became dangerous after removal', async () => {
        const assignedRole = role('assigned-role');
        guild.roles.cache.set(assignedRole.id, assignedRole);
        const target = member(guild);
        target.roles.cache.set(assignedRole.id, assignedRole);
        guild.members.fetch.mockResolvedValue(target);
        const moderator = actor([PermissionFlagsBits.ManageRoles]);
        await mod.execute(interaction({ guild, member: moderator, group: 'role', subcommand: 'remove', values: { target, role: assignedRole } }), {});
        const moderationCase = database.sqlite.prepare("SELECT case_number FROM moderation_cases WHERE action = 'ROLE_REMOVE'").get();
        assignedRole.permissions.has.mockImplementation(permission => permission === PermissionFlagsBits.Administrator);
        const undo = interaction({ guild, member: moderator, group: 'case', subcommand: 'undo', values: { number: moderationCase.case_number, reason: 'restore' } });

        await mod.execute(undo, {});

        expect(undo.editReply.mock.calls[0][0].embeds[0].data.description).toContain('cannot be assigned');
        expect(target.roles.add).not.toHaveBeenCalled();
    });

    test('role color accepts decimal values and role icon accepts Discord CDN URLs', async () => {
        const managedRole = role('managed-role');
        guild.roles.cache.set(managedRole.id, managedRole);
        const moderator = actor([PermissionFlagsBits.ManageRoles]);
        jest.spyOn(global, 'fetch').mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
            headers: { 'content-type': 'image/png' }
        }));

        await mod.execute(interaction({ guild, member: moderator, group: 'role', subcommand: 'color', values: { role: managedRole, color: '16711680', tier: 1 } }), {});
        await mod.execute(interaction({ guild, member: moderator, group: 'role', subcommand: 'icon', values: { role: managedRole, url: 'https://cdn.discordapp.com/icons/guild/icon.png' } }), {});

        expect(managedRole.setColors).toHaveBeenCalledWith(expect.objectContaining({ primaryColor: 16711680 }), expect.any(String));
        expect(managedRole.setIcon).toHaveBeenCalledWith(Buffer.from([1, 2, 3]), expect.any(String));

        global.fetch.mockResolvedValueOnce(new Response(new Uint8Array(262145), {
            headers: { 'content-type': 'image/png' }
        }));
        const oversized = interaction({ guild, member: moderator, group: 'role', subcommand: 'icon', values: { role: managedRole, url: 'https://cdn.discordapp.com/icons/guild/large.png' } });
        await mod.execute(oversized, {});
        expect(oversized.editReply.mock.calls[0][0].embeds[0].data.description).toContain('256 KiB');
        expect(managedRole.setIcon).toHaveBeenCalledTimes(1);
    });

    test('forced nicknames persist, reapply on member updates, and cancel cleanly', async () => {
        const target = member(guild);
        const moderator = actor([PermissionFlagsBits.ManageNicknames]);
        const force = interaction({ guild, member: moderator, group: 'user', subcommand: 'nickname-force', values: { target, name: 'Locked', reason: 'policy' } });
        await mod.execute(force, {});
        expect(target.setNickname).toHaveBeenCalledWith('Locked', 'policy');

        const event = require('../src/events/guildMemberUpdate');
        const changed = member(guild);
        changed.nickname = 'Changed';
        await event.execute({ nickname: 'Locked' }, changed);
        expect(changed.setNickname).toHaveBeenCalledWith('Locked', 'ByteBot forced nickname enforcement');

        await mod.execute(interaction({ guild, member: moderator, group: 'user', subcommand: 'nickname-unforce', values: { target } }), {});
        expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM forced_nicknames').get().count).toBe(0);
    });

    test('failed forced nickname changes roll back enforcement state and retain a failed case', async () => {
        const target = member(guild);
        target.setNickname.mockRejectedValueOnce(new Error('Discord rejected nickname'));
        const command = interaction({ guild, member: actor([PermissionFlagsBits.ManageNicknames]), group: 'user', subcommand: 'nickname-force', values: { target, name: 'Locked' } });

        await mod.execute(command, {});

        expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM forced_nicknames').get().count).toBe(0);
        expect(database.sqlite.prepare("SELECT status FROM moderation_cases WHERE action = 'NICKNAME_FORCE'").get().status).toBe('failed');
    });

    test('concurrent forced nickname updates serialize per member', async () => {
        const target = member(guild);
        const moderator = actor([PermissionFlagsBits.ManageNicknames]);
        let releaseFirst;
        target.setNickname.mockImplementationOnce(() => new Promise(resolve => { releaseFirst = resolve; })).mockResolvedValueOnce();
        const first = mod.execute(interaction({ guild, member: moderator, group: 'user', subcommand: 'nickname-force', values: { target, name: 'First' } }), {});
        await new Promise(resolve => setImmediate(resolve));
        const second = mod.execute(interaction({ guild, member: moderator, group: 'user', subcommand: 'nickname-force', values: { target, name: 'Second' } }), {});
        await new Promise(resolve => setImmediate(resolve));
        expect(target.setNickname).toHaveBeenCalledTimes(1);

        releaseFirst();
        await Promise.all([first, second]);

        expect(database.sqlite.prepare('SELECT nickname FROM forced_nicknames').get().nickname).toBe('Second');
    });
});
