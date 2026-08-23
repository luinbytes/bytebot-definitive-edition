const fs = require('fs');
const os = require('os');
const path = require('path');
const { PermissionFlagsBits } = require('discord.js');

function interaction({ subcommand, action = null, member, hasManageGuild = true, roleIds = [] }) {
    return {
        commandName: 'fun',
        guild: { id: 'guild1', ownerId: 'owner1' },
        client: { user: { id: 'bot1' } },
        member: {
            roles: { cache: new Map(roleIds.map(roleId => [roleId, {}])) },
            permissions: {
                has: jest.fn(permission => Array.isArray(permission)
                    ? hasManageGuild && permission.includes(PermissionFlagsBits.ManageGuild)
                    : hasManageGuild && permission === PermissionFlagsBits.ManageGuild)
            }
        },
        options: {
            getSubcommandGroup: jest.fn().mockReturnValue('uwulock'),
            getSubcommand: jest.fn().mockReturnValue(subcommand),
            getString: jest.fn(name => name === 'action' ? action : null),
            getUser: jest.fn(name => name === 'member' ? member : null)
        },
        reply: jest.fn()
    };
}

describe('UwU Lock commands', () => {
    let tempDir;
    let database;
    let fun;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-uwulock-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        fun = require('../src/commands/fun/fun');
    });

    afterEach(() => {
        database.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('target and protection actions persist one mutually exclusive state', async () => {
        const target = { id: 'user1', bot: false };

        await fun.execute(interaction({ subcommand: 'add', member: target }));
        expect(database.sqlite.prepare(
            "SELECT state FROM uwu_lock_members WHERE guild_id = 'guild1' AND user_id = 'user1'"
        ).get().state).toBe('target');

        await fun.execute(interaction({ subcommand: 'protect', action: 'add', member: target }));
        expect(database.sqlite.prepare(
            "SELECT state FROM uwu_lock_members WHERE guild_id = 'guild1' AND user_id = 'user1'"
        ).get().state).toBe('protected');

        const rejected = interaction({ subcommand: 'add', member: target });
        await fun.execute(rejected);
        expect(database.sqlite.prepare(
            "SELECT state FROM uwu_lock_members WHERE guild_id = 'guild1' AND user_id = 'user1'"
        ).get().state).toBe('protected');
        expect(rejected.reply.mock.calls[0][0].embeds[0].data.title).toContain('Protected');
    });

    test('remove and list paths maintain targets and protected members separately', async () => {
        const target = { id: 'user1', bot: false };
        const protectedMember = { id: 'user2', bot: false };
        await fun.execute(interaction({ subcommand: 'add', member: target }));
        await fun.execute(interaction({ subcommand: 'protect', action: 'add', member: protectedMember }));

        const targetList = interaction({ subcommand: 'list' });
        await fun.execute(targetList);
        expect(targetList.reply.mock.calls[0][0].embeds[0].data.description).toContain('<@user1>');
        expect(targetList.reply.mock.calls[0][0].embeds[0].data.description).not.toContain('<@user2>');

        const protectedList = interaction({ subcommand: 'protect', action: 'list' });
        await fun.execute(protectedList);
        expect(protectedList.reply.mock.calls[0][0].embeds[0].data.description).toContain('<@user2>');

        await fun.execute(interaction({ subcommand: 'remove', member: target }));
        await fun.execute(interaction({ subcommand: 'protect', action: 'remove', member: protectedMember }));
        expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM uwu_lock_members').get().count).toBe(0);
    });

    test('/fun uwuify transforms supplied text without enabling mentions', async () => {
        const reply = jest.fn();
        await fun.execute({
            options: {
                getSubcommandGroup: jest.fn().mockReturnValue(null),
                getSubcommand: jest.fn().mockReturnValue('uwuify'),
                getString: jest.fn().mockReturnValue('Really <@123>')
            },
            reply
        });

        expect(reply).toHaveBeenCalledWith({
            content: 'Weawwy <@123>',
            allowedMentions: { parse: [], repliedUser: false }
        });
    });

    test('UwU Lock defaults to Manage Server but accepts an exact path role override', async () => {
        database.sqlite.prepare(`
            INSERT INTO command_permissions (guild_id, command_name, role_id)
            VALUES ('guild1', 'fun uwulock add', 'uwuAdmin')
        `).run();

        const allowed = interaction({
            subcommand: 'add',
            member: { id: 'user1', bot: false },
            hasManageGuild: false,
            roleIds: ['uwuAdmin']
        });
        await fun.execute(allowed);
        expect(database.sqlite.prepare(
            "SELECT state FROM uwu_lock_members WHERE guild_id = 'guild1' AND user_id = 'user1'"
        ).get().state).toBe('target');

        const denied = interaction({
            subcommand: 'add',
            member: { id: 'user2', bot: false },
            hasManageGuild: false
        });
        await fun.execute(denied);
        expect(denied.reply.mock.calls[0][0].embeds[0].data.title).toContain('Access Denied');
        expect(database.sqlite.prepare(
            "SELECT state FROM uwu_lock_members WHERE guild_id = 'guild1' AND user_id = 'user2'"
        ).get()).toBeUndefined();
    });

    test('guild owners and bots cannot become UwU Lock targets', async () => {
        const owner = interaction({ subcommand: 'add', member: { id: 'owner1', bot: false } });
        const bot = interaction({ subcommand: 'add', member: { id: 'otherBot', bot: true } });

        await fun.execute(owner);
        await fun.execute(bot);

        expect(owner.reply.mock.calls[0][0].embeds[0].data.title).toContain('Invalid Target');
        expect(bot.reply.mock.calls[0][0].embeds[0].data.title).toContain('Invalid Target');
        expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM uwu_lock_members').get().count).toBe(0);
    });
});
