const fs = require('fs');
const os = require('os');
const path = require('path');
const { Collection, PermissionFlagsBits } = require('discord.js');

function adminInteraction(subcommand, values = {}) {
    return {
        commandName: 'server',
        guild: { id: 'guild1' },
        channelId: 'admin-channel',
        user: { id: 'admin1' },
        member: {
            id: 'admin1',
            roles: { cache: new Map() },
            permissions: { has: jest.fn().mockReturnValue(true) }
        },
        options: {
            getSubcommandGroup: jest.fn().mockReturnValue('permissions'),
            getSubcommand: jest.fn().mockReturnValue(subcommand),
            getString: jest.fn(name => values[name] ?? null),
            getChannel: jest.fn(name => values[name] ?? null),
            getRole: jest.fn(name => values[name] ?? null),
            getUser: jest.fn(name => values[name] ?? null)
        },
        deferReply: jest.fn(),
        editReply: jest.fn(),
        reply: jest.fn(),
        deferred: false,
        replied: false
    };
}

describe('server command access controls', () => {
    let tempDir;
    let database;
    let server;
    let fun;
    let modActions;
    let checkUserPermissions;
    let client;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-access-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        server = require('../src/commands/administration/server');
        fun = require('../src/commands/fun/fun');
        modActions = require('../src/commands/context-menus/modactions');
        checkUserPermissions = require('../src/utils/permissions').checkUserPermissions;
        client = { commands: new Collection([['fun', fun]]) };
    });

    afterEach(() => {
        database.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('an administrator can disable and re-enable a command in one channel', async () => {
        await server.execute(adminInteraction('disable', {
            command: 'fun uwuify',
            channel: { id: 'channel1' }
        }), client);

        const memberInteraction = {
            commandName: 'fun',
            channelId: 'channel1',
            guild: { id: 'guild1' },
            user: { id: 'user1' },
            member: {
                id: 'user1',
                roles: { cache: new Map() },
                permissions: { has: jest.fn(permission => permission === PermissionFlagsBits.SendMessages) }
            },
            options: {
                getSubcommandGroup: jest.fn().mockReturnValue(null),
                getSubcommand: jest.fn().mockReturnValue('uwuify')
            }
        };

        expect((await checkUserPermissions(memberInteraction, fun)).allowed).toBe(false);

        await server.execute(adminInteraction('enable', {
            command: 'fun uwuify',
            channel: { id: 'channel1' }
        }), client);

        expect((await checkUserPermissions(memberInteraction, fun)).allowed).toBe(true);
    });

    test('allow rules form an allowlist and a matching deny wins', async () => {
        await server.execute(adminInteraction('allow', {
            command: 'fun uwuify',
            role: { id: 'role1', toString: () => '<@&role1>' }
        }), client);

        const memberInteraction = (userId, roleIds) => ({
            commandName: 'fun',
            channelId: 'channel1',
            guild: { id: 'guild1' },
            user: { id: userId },
            member: {
                id: userId,
                roles: { cache: new Map(roleIds.map(id => [id, {}])) },
                permissions: { has: jest.fn().mockReturnValue(false) }
            },
            options: {
                getSubcommandGroup: jest.fn().mockReturnValue(null),
                getSubcommand: jest.fn().mockReturnValue('uwuify')
            }
        });

        expect((await checkUserPermissions(memberInteraction('user1', []), fun)).allowed).toBe(false);
        expect((await checkUserPermissions(memberInteraction('user1', ['role1']), fun)).allowed).toBe(true);

        await server.execute(adminInteraction('deny', {
            command: 'fun uwuify',
            member: { id: 'user1', toString: () => '<@user1>' }
        }), client);

        expect((await checkUserPermissions(memberInteraction('user1', ['role1']), fun)).allowed).toBe(false);
    });

    test('fake permissions are inspectable labels and never replace Discord permissions', async () => {
        const role = { id: 'role1', toString: () => '<@&role1>' };
        await server.execute(adminInteraction('fake', {
            action: 'add',
            role,
            permission: 'banmembers'
        }), client);

        const list = adminInteraction('fake', { action: 'list' });
        await server.execute(list, client);
        expect(list.editReply.mock.calls[0][0].embeds[0].data.description).toContain('<@&role1>: `BanMembers`');

        const result = await checkUserPermissions({
            commandName: 'mod',
            channelId: 'channel1',
            guild: { id: 'guild1' },
            user: { id: 'user1' },
            member: {
                id: 'user1',
                roles: { cache: new Map([['role1', role]]) },
                permissions: { has: jest.fn().mockReturnValue(false) }
            }
        }, {
            data: { name: 'mod' },
            permissions: [PermissionFlagsBits.BanMembers]
        });

        expect(result.allowed).toBe(false);
        expect(result.error.data.title).toContain('Insufficient Permissions');
    });

    test('protected members and roles are blocked on the public moderation menu', async () => {
        const targetUser = { id: 'user1', tag: 'Target' };
        await server.execute(adminInteraction('protect', {
            action: 'add',
            member: targetUser
        }), client);

        const reply = jest.fn();
        await modActions.execute({
            targetUser,
            targetMember: {
                id: 'user1',
                user: targetUser,
                guild: { id: 'guild1', ownerId: 'owner1' },
                roles: { cache: new Map(), highest: { position: 1 } }
            },
            member: {
                id: 'admin1',
                permissions: { has: jest.fn().mockReturnValue(true) },
                roles: { highest: { position: 10 } }
            },
            reply
        }, client);

        expect(reply.mock.calls[0][0].embeds[0].data.description).toContain('protected from moderation');

        const protectedRole = { id: 'role1', toString: () => '<@&role1>' };
        await server.execute(adminInteraction('protect', {
            action: 'add',
            role: protectedRole
        }), client);
        const roleReply = jest.fn();
        await modActions.execute({
            targetUser: { id: 'user2', tag: 'RoleTarget' },
            targetMember: {
                id: 'user2',
                user: { id: 'user2', tag: 'RoleTarget' },
                guild: { id: 'guild1', ownerId: 'owner1' },
                roles: { cache: new Map([['role1', protectedRole]]), highest: { position: 1 } }
            },
            member: {
                id: 'admin1',
                permissions: { has: jest.fn().mockReturnValue(true) },
                roles: { highest: { position: 10 } }
            },
            reply: roleReply
        }, client);

        expect(roleReply.mock.calls[0][0].embeds[0].data.description).toContain('protected from moderation');
    });

    test('scoped rules are listed and command reset clears them', async () => {
        await server.execute(adminInteraction('disable', {
            command: 'fun uwuify',
            channel: { id: 'channel1', toString: () => '<#channel1>' }
        }), client);
        await server.execute(adminInteraction('deny', {
            command: 'fun uwuify',
            role: { id: 'role1', toString: () => '<@&role1>' }
        }), client);

        const list = adminInteraction('list');
        await server.execute(list, client);
        const description = list.editReply.mock.calls[0][0].embeds[0].data.description;
        expect(description).toContain('disabled in <#channel1>');
        expect(description).toContain('denied for <@&role1>');

        await server.execute(adminInteraction('reset', { command: 'fun uwuify' }), client);
        expect((await checkUserPermissions({
            commandName: 'fun',
            channelId: 'channel1',
            guild: { id: 'guild1' },
            user: { id: 'user1' },
            member: {
                id: 'user1',
                roles: { cache: new Map() },
                permissions: { has: jest.fn().mockReturnValue(false) }
            },
            options: {
                getSubcommandGroup: jest.fn().mockReturnValue(null),
                getSubcommand: jest.fn().mockReturnValue('uwuify')
            }
        }, fun)).allowed).toBe(true);
    });
});
