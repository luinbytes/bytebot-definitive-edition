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
    let RoleManager;
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
        RoleManager = require('../src/utils/discordApiUtil').RoleManager;
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
            permissions: 'banmembers, manageMessages'
        }), client);

        const list = adminInteraction('fake', { action: 'list' });
        await server.execute(list, client);
        expect(list.editReply.mock.calls[0][0].embeds[0].data.description).toContain('<@&role1>: `BanMembers`');
        expect(list.editReply.mock.calls[0][0].embeds[0].data.description).toContain('<@&role1>: `ManageMessages`');

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

        await server.execute(adminInteraction('fake', { action: 'remove', role }), client);
        const emptyList = adminInteraction('fake', { action: 'list' });
        await server.execute(emptyList, client);
        expect(emptyList.editReply.mock.calls[0][0].embeds[0].data.description).toContain('No virtual permission');
    });

    test('a matching allow rule punches through a disabled scope and can be removed', async () => {
        await server.execute(adminInteraction('disable', { command: 'fun uwuify' }), client);
        await server.execute(adminInteraction('disable', {
            command: 'fun uwuify',
            channel: { id: 'channel1', toString: () => '<#channel1>' }
        }), client);
        await server.execute(adminInteraction('allow', {
            command: 'fun uwuify',
            member: { id: 'user1', toString: () => '<@user1>' }
        }), client);

        const interaction = userId => ({
            commandName: 'fun',
            channelId: 'channel1',
            guild: { id: 'guild1' },
            user: { id: userId },
            member: {
                id: userId,
                roles: { cache: new Map() },
                permissions: { has: jest.fn().mockReturnValue(false) }
            },
            options: {
                getSubcommandGroup: jest.fn().mockReturnValue(null),
                getSubcommand: jest.fn().mockReturnValue('uwuify')
            }
        });

        expect((await checkUserPermissions(interaction('user1'), fun)).allowed).toBe(true);
        expect((await checkUserPermissions(interaction('user2'), fun)).allowed).toBe(false);

        await server.execute(adminInteraction('unrestrict', {
            command: 'fun uwuify',
            member: { id: 'user1', toString: () => '<@user1>' }
        }), client);
        expect((await checkUserPermissions(interaction('user1'), fun)).allowed).toBe(false);

        await server.execute(adminInteraction('enable', { command: 'fun uwuify' }), client);
        expect((await checkUserPermissions(interaction('user2'), fun)).allowed).toBe(true);
    });

    test('denyperm blocks assignment of roles carrying a configured permission', async () => {
        await server.execute(adminInteraction('denyperm', {
            action: 'add',
            permission: 'administrator'
        }), client);

        const list = adminInteraction('denyperm', { action: 'list' });
        await server.execute(list, client);
        expect(list.editReply.mock.calls[0][0].embeds[0].data.description).toContain('Administrator');

        const add = jest.fn();
        const member = {
            user: { tag: 'Target' },
            guild: {
                id: 'guild1',
                members: { me: { roles: { highest: { position: 10 } } } },
                roles: { cache: new Map() }
            },
            roles: { cache: new Map(), add }
        };
        const role = {
            id: 'admin-role',
            name: 'Admin',
            position: 1,
            permissions: { has: permission => permission === PermissionFlagsBits.Administrator }
        };
        const result = await RoleManager.addRole(member, role);

        expect(result.success).toBe(false);
        expect(result.error).toContain('blocked permission');
        expect(add).not.toHaveBeenCalled();

        const available = adminInteraction('denyperm', { action: 'available' });
        await server.execute(available, client);
        expect(available.editReply.mock.calls[0][0].embeds[0].data.description).toContain('Administrator');

        await server.execute(adminInteraction('denyperm', {
            action: 'remove',
            permission: 'Administrator'
        }), client);
        expect((await RoleManager.addRole(member, role)).success).toBe(true);
        expect(add).toHaveBeenCalledTimes(1);
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

        const ban = jest.fn();
        const absentReply = jest.fn();
        await modActions.handleModal({
            customId: 'modal_ban_user1',
            fields: { getTextInputValue: jest.fn().mockReturnValue('reason') },
            guild: {
                id: 'guild1',
                name: 'Guild',
                members: {
                    fetch: jest.fn().mockRejectedValue({ code: 10007 }),
                    ban
                }
            },
            member: {
                id: 'admin1',
                user: { tag: 'Admin' },
                permissions: { has: jest.fn().mockReturnValue(true) },
                roles: { highest: { position: 10 } }
            },
            deferReply: jest.fn(),
            editReply: absentReply
        }, {
            users: {
                fetch: jest.fn().mockResolvedValue({
                    id: 'user1',
                    tag: 'Target',
                    send: jest.fn().mockResolvedValue({})
                })
            }
        });

        expect(ban).not.toHaveBeenCalled();
        expect(absentReply.mock.calls[0][0].embeds[0].data.description).toContain('protected from moderation');
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

    test('large permission audits stay within Discord embed limits and report omissions', async () => {
        const insert = database.sqlite.prepare(`
            INSERT INTO fake_permissions (guild_id, role_id, permission)
            VALUES ('guild1', ?, 'Administrator')
        `);
        database.sqlite.transaction(() => {
            for (let index = 0; index < 250; index += 1) {
                insert.run(`role-${index.toString().padStart(3, '0')}-with-a-long-display-id`);
            }
        })();

        const list = adminInteraction('fake', { action: 'list' });
        await server.execute(list, client);
        const description = list.editReply.mock.calls[0][0].embeds[0].data.description;

        expect(description.length).toBeLessThanOrEqual(4096);
        expect(description).toMatch(/… and \d+ more/);
    });
});
