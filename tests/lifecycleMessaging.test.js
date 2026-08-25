const fs = require('fs');
const os = require('os');
const path = require('path');
const { PermissionFlagsBits, SystemChannelFlagsBitField } = require('discord.js');

describe('lifecycle messaging', () => {
    let tempDir;
    let database;
    let lifecycle;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-lifecycle-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        lifecycle = require('../src/services/lifecycleMessageService');
    });

    afterEach(() => {
        database.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function guild() {
        const channel = { id: 'channel1', send: jest.fn().mockResolvedValue({ delete: jest.fn().mockResolvedValue({}) }) };
        const value = {
            id: 'guild1', name: 'Guild', memberCount: 42, premiumSubscriptionCount: 3, premiumTier: 1,
            channels: { fetch: jest.fn().mockResolvedValue(channel) },
            members: { me: {
                id: 'bot1', permissions: { has: jest.fn().mockReturnValue(true) },
                permissionsIn: jest.fn().mockReturnValue({ has: jest.fn().mockReturnValue(true) })
            } },
            systemChannelFlags: new SystemChannelFlagsBitField(),
            setSystemChannel: jest.fn().mockResolvedValue({}),
            setSystemChannelFlags: jest.fn().mockResolvedValue({})
        };
        return { value, channel };
    }

    function member(server, options = {}) {
        return {
            id: 'user1', guild: server, displayName: options.displayName || 'Display', joinedAt: new Date('2026-01-01T00:00:00Z'),
            premiumSince: options.premiumSince || null,
            user: {
                id: 'user1', username: 'User', tag: 'User', createdAt: new Date('2020-01-01T00:00:00Z'),
                displayAvatarURL: jest.fn().mockReturnValue('https://example.com/avatar.png')
            }
        };
    }

    test('validates variables and bounds optional deletion before storage', () => {
        expect(() => lifecycle.setConfig('guild1', 'goodbye', { template: 'Bye {unknown}' })).toThrow('Unknown template variable');
        expect(() => lifecycle.setConfig('guild1', 'goodbye', { template: 'Bye @everyone' })).toThrow('cannot contain literal');
        expect(() => lifecycle.setConfig('guild1', 'goodbye', { deleteAfterSeconds: 31 })).toThrow('between 1 and 30');
        expect(lifecycle.setConfig('guild1', 'goodbye', {
            channelId: 'channel1', template: 'Bye {{user.name}} from {guild.name}', enabled: true, format: 'text', deleteAfterSeconds: 5
        })).toEqual(expect.objectContaining({ template: 'Bye {{user.name}} from {guild.name}', delete_after_seconds: 5 }));
        expect(() => lifecycle.validateTemplate('{user.created_at_timestamp} {user.nick} {guild.owner_id} {channel.is_thread}'))
            .not.toThrow();
    });

    test('real and test sends use the same renderer with explicit mention safety', async () => {
        const { value: server, channel } = guild();
        const target = member(server);
        lifecycle.setConfig(server.id, 'welcome', {
            channelId: channel.id, template: 'Welcome {user} to {server}, member {memberNumber}', enabled: true, format: 'text'
        });

        const real = await lifecycle.sendLifecycleMessage('welcome', target);
        const preview = await lifecycle.sendLifecycleMessage('welcome', target, { test: true });

        expect(real.status).toBe('sent');
        expect(preview.status).toBe('sent');
        expect(channel.send).toHaveBeenCalledTimes(2);
        expect(channel.send.mock.calls[0][0]).toEqual(expect.objectContaining({
            content: expect.stringContaining('<@user1>'),
            allowedMentions: { parse: [], users: ['user1'], roles: [], repliedUser: false }
        }));
        expect(channel.send.mock.calls[1][0].content).toContain('[Test]');
    });

    test('welcome and goodbye support four delivery channels', () => {
        lifecycle.setConfig('guild1', 'welcome', { channelId: 'primary', enabled: true });
        ['second', 'third', 'fourth'].forEach(id => lifecycle.addLifecycleChannel('guild1', 'welcome', id));
        expect(lifecycle.listLifecycleChannels('guild1', 'welcome')).toEqual(['primary', 'fourth', 'second', 'third']);
        expect(() => lifecycle.addLifecycleChannel('guild1', 'welcome', 'fifth')).toThrow('At most 4');
        lifecycle.resetConfig('guild1', 'welcome');
        expect(lifecycle.listLifecycleChannels('guild1', 'welcome')).toEqual([]);
    });

    test('Join DMs use a persistent 750-per-hour reservation and release failures', async () => {
        const { value: server } = guild();
        const target = member(server);
        target.send = jest.fn().mockRejectedValue(new Error('closed'));
        lifecycle.setConfig(server.id, 'join_dm', { enabled: true, template: 'Welcome {displayname}', format: 'text' });
        expect((await lifecycle.sendJoinDm(target)).status).toBe('failed');
        expect(database.sqlite.prepare('SELECT COUNT(*) count FROM join_dm_deliveries').get().count).toBe(0);

        const insert = database.sqlite.prepare("INSERT INTO join_dm_deliveries (guild_id, user_id, sent_at) VALUES ('guild1', ?, ?)");
        database.sqlite.transaction(() => {
            for (let index = 0; index < 750; index++) insert.run(`user-${index}`, Date.now());
        })();
        expect((await lifecycle.sendJoinDm(target)).status).toBe('limited');
        expect(target.send).toHaveBeenCalledTimes(1);
    });

    test('supports the documented Greed embed script fields and link buttons', () => {
        const payload = lifecycle.parseEmbedScript(
            '{embed}$v{title: Welcome}$v{description: Hello}$v{field: Member && {user.name} && true}$v{footer: Footer}$v{button: Docs && https://example.com}'
        );
        expect(payload.embeds[0].toJSON()).toEqual(expect.objectContaining({
            title: 'Welcome', description: 'Hello', fields: [{ name: 'Member', value: '{user.name}', inline: true }]
        }));
        expect(payload.components[0].toJSON().components[0]).toEqual(expect.objectContaining({ style: 5, url: 'https://example.com/' }));
        expect(() => lifecycle.parseEmbedScript(`{embed}$v${Array.from({ length: 26 }, (_, index) => `{field: ${index} && value}`).join('$v')}`))
            .toThrow('at most 25 fields');
    });

    test('legacy welcome settings migrate without deleting the original values', () => {
        database.sqlite.prepare(`
            INSERT INTO guilds (id, welcome_channel, welcome_message, welcome_enabled, welcome_use_embed)
            VALUES ('guild1', 'legacy-channel', 'Legacy {user}', 1, 0)
        `).run();

        expect(lifecycle.migrateLegacyWelcome()).toBe(1);
        expect(lifecycle.getConfig('guild1', 'welcome')).toEqual(expect.objectContaining({
            channel_id: 'legacy-channel', template: 'Legacy {user}', enabled: 1, format: 'text'
        }));
        expect(database.sqlite.prepare('SELECT welcome_channel FROM guilds WHERE id = ?').get('guild1').welcome_channel).toBe('legacy-channel');
    });

    test('boost detection sends only on a new premium subscription timestamp', () => {
        const { value: server } = guild();
        const ordinary = member(server);
        const boosted = member(server, { premiumSince: new Date('2026-01-02T00:00:00Z') });
        expect(lifecycle.isNewBoost(ordinary, boosted)).toBe(true);
        expect(lifecycle.isNewBoost(boosted, boosted)).toBe(false);
    });

    test('system controls require real Manage Guild and update Discord native settings', async () => {
        const command = require('../src/utils/lifecycleMessageCommand');
        const { value: server } = guild();
        const interaction = {
            guild: server, user: { id: 'admin1' },
            member: { permissions: { has: jest.fn(permission => permission === PermissionFlagsBits.ManageGuild) } },
            options: {
                getSubcommandGroup: jest.fn().mockReturnValue('system'), getSubcommand: jest.fn().mockReturnValue('welcome'),
                getBoolean: jest.fn().mockReturnValue(false), getChannel: jest.fn().mockReturnValue(null), getString: jest.fn().mockReturnValue(null),
                getInteger: jest.fn().mockReturnValue(null)
            },
            reply: jest.fn().mockResolvedValue({}), deferReply: jest.fn().mockResolvedValue({}), editReply: jest.fn().mockResolvedValue({})
        };
        await command.executeLifecycle(interaction);
        expect(server.setSystemChannelFlags).toHaveBeenCalled();
    });

    test('slash paths preserve pinned channel/settings/remove names and hosted aliases', () => {
        const server = require('../src/commands/administration/server').data.toJSON();
        const groups = Object.fromEntries(server.options.filter(option => option.type === 2).map(option => [option.name, option.options.map(child => child.name)]));
        expect(groups.welcome).toEqual(expect.arrayContaining(['setup', 'channel', 'channels', 'dm', 'message', 'test', 'view', 'reset']));
        expect(groups.goodbye).toEqual(expect.arrayContaining(['setup', 'channel', 'channels', 'message', 'test', 'view', 'reset']));
        expect(groups.boost).toEqual(expect.arrayContaining(['setup', 'channel', 'settings', 'remove', 'test', 'reset']));
        expect(groups.system).toEqual(['channel', 'welcome', 'boost', 'sticker']);
    });

    test('pinned channel setup activates delivery and message requires setup', async () => {
        const command = require('../src/utils/lifecycleMessageCommand');
        const { value: server, channel } = guild();
        const interaction = (subcommand, selectedChannel = null) => ({
            guild: server, user: { id: 'admin1' },
            member: { permissions: { has: jest.fn().mockReturnValue(true) } },
            options: {
                getSubcommandGroup: jest.fn().mockReturnValue('boost'), getSubcommand: jest.fn().mockReturnValue(subcommand),
                getChannel: jest.fn().mockReturnValue(selectedChannel), getString: jest.fn().mockReturnValue('Thanks {user}'),
                getInteger: jest.fn().mockReturnValue(null)
            },
            deferReply: jest.fn().mockResolvedValue({}), editReply: jest.fn().mockResolvedValue({}), reply: jest.fn().mockResolvedValue({})
        });
        await command.executeLifecycle(interaction('message'));
        expect(lifecycle.getConfig(server.id, 'boost')).toBeNull();
        await command.executeLifecycle(interaction('channel', channel));
        expect(lifecycle.getConfig(server.id, 'boost')).toEqual(expect.objectContaining({ enabled: 1, channel_id: channel.id }));
    });
});
