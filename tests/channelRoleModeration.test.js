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

    test('selfpurge needs no moderator permission and only deletes the caller messages', async () => {
        const ownMessage = { id: '200', author: { id: 'user1', bot: false }, createdTimestamp: Date.now() };
        const otherMessage = { id: '199', author: { id: 'user2', bot: false }, createdTimestamp: Date.now() };
        channel.messages.fetch.mockResolvedValueOnce(new Map([[ownMessage.id, ownMessage], [otherMessage.id, otherMessage]]));
        const caller = actor([]);
        caller.id = 'user1';
        caller.user.id = 'user1';
        const command = interaction({ guild, member: caller, group: 'channel', subcommand: 'selfpurge', values: { amount: 50 } });

        await mod.execute(command, {});

        expect(channel.bulkDelete).toHaveBeenCalledWith([ownMessage], true);
        expect(command.editReply.mock.calls[0][0].embeds[0].data.title).toContain('Self Purge Complete');
    });

    test('lockdown restores the exact prior Send Messages overwrite and respects ignores', async () => {
        const lockRole = role('lock-role');
        guild.roles.cache.set(lockRole.id, lockRole);
        const moderator = actor([PermissionFlagsBits.ManageChannels]);
        await mod.execute(interaction({ guild, member: moderator, group: 'channel', subcommand: 'lockdown-role', values: { role: lockRole } }), {});
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
        const ignored = interaction({ guild, member: moderator, group: 'channel', subcommand: 'lockdown' });
        await mod.execute(ignored, {});
        expect(ignored.editReply.mock.calls[0][0].embeds[0].data.description).toContain('ignored');
    });

    test('slowmode, topic, and NSFW channel mutations use Discord bounds and audit reasons', async () => {
        const moderator = actor([PermissionFlagsBits.ManageChannels]);
        await mod.execute(interaction({ guild, member: moderator, group: 'channel', subcommand: 'slowmode', values: { duration: '6h', reason: 'traffic' } }), {});
        await mod.execute(interaction({ guild, member: moderator, group: 'channel', subcommand: 'topic', values: { text: 'Rules', reason: 'refresh' } }), {});
        await mod.execute(interaction({ guild, member: moderator, group: 'channel', subcommand: 'nsfw', values: { enabled: true, reason: 'classification' } }), {});
        expect(channel.setRateLimitPerUser).toHaveBeenCalledWith(21600, 'traffic');
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
        target.roles.cache.delete(memberRole.id);
        await mod.execute(interaction({ guild, member: moderator, group: 'role', subcommand: 'restore', values: { target, reason: 'restore' } }), {});
        expect(target.roles.add).toHaveBeenCalledWith(memberRole, 'restore');
        expect(target.roles.add).toHaveBeenCalledWith(removedRole, 'restore');

        const bulk = interaction({ guild, member: moderator, group: 'role', subcommand: 'bulk', values: {
            action: 'add', scope: 'all', role: dangerousRole, confirm: true
        } });
        await mod.execute(bulk, {});
        expect(bulk.editReply.mock.calls[0][0].embeds[0].data.description).toContain('cannot be assigned');
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
});
