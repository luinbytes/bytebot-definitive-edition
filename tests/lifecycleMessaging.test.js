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
            channelId: channel.id, template: 'Welcome {user} ({user.mention}) to {server}, member {memberNumber}', enabled: true, format: 'text'
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
        expect(channel.send.mock.calls[1][0].content).toBe(channel.send.mock.calls[0][0].content);
    });

    test('welcome and goodbye support four delivery channels', () => {
        lifecycle.setConfig('guild1', 'welcome', { channelId: 'primary', enabled: true });
        ['second', 'third', 'fourth'].forEach(id => lifecycle.addLifecycleChannel('guild1', 'welcome', id));
        expect(lifecycle.listLifecycleChannels('guild1', 'welcome')).toEqual(['primary', 'fourth', 'second', 'third']);
        expect(() => lifecycle.addLifecycleChannel('guild1', 'welcome', 'fifth')).toThrow('At most 4');
        lifecycle.resetConfig('guild1', 'welcome');
        expect(lifecycle.listLifecycleChannels('guild1', 'welcome')).toEqual([]);
    });

    test('the aggregate four-channel cap cannot be bypassed by assigning the primary last', () => {
        const insert = database.sqlite.prepare("INSERT INTO lifecycle_message_channels (guild_id, type, channel_id) VALUES ('guild1', 'welcome', ?)");
        ['one', 'two', 'three', 'four'].forEach(id => insert.run(id));
        expect(() => lifecycle.setConfig('guild1', 'welcome', { channelId: 'primary' })).toThrow('At most 4');
    });

    test('promoting an extra channel removes its duplicate destination row', () => {
        lifecycle.setConfig('guild1', 'welcome', { channelId: 'primary' });
        lifecycle.addLifecycleChannel('guild1', 'welcome', 'extra');
        lifecycle.setLifecycleChannelTemplate('guild1', 'welcome', 'extra', 'Promoted custom');
        lifecycle.setConfig('guild1', 'welcome', { channelId: 'extra' });

        expect(lifecycle.listLifecycleChannels('guild1', 'welcome')).toEqual(['extra']);
        expect(lifecycle.getConfig('guild1', 'welcome').template).toBe('Promoted custom');
        expect(database.sqlite.prepare(`SELECT COUNT(*) count FROM lifecycle_message_channels
            WHERE guild_id = 'guild1' AND type = 'welcome' AND channel_id = 'extra'`).get().count).toBe(0);
    });

    test('first add becomes primary and channel templates override or fall back', async () => {
        const primary = { id: 'primary', name: 'primary', send: jest.fn().mockResolvedValue({ delete: jest.fn() }) };
        const extra = { id: 'extra', name: 'extra', send: jest.fn().mockResolvedValue({ delete: jest.fn() }) };
        const { value: server } = guild();
        server.channels.fetch = jest.fn(id => Promise.resolve({ primary, extra }[id]));
        lifecycle.addLifecycleChannel(server.id, 'welcome', primary.id);
        lifecycle.addLifecycleChannel(server.id, 'welcome', extra.id);
        lifecycle.setConfig(server.id, 'welcome', { enabled: true, template: 'Fallback {user}', format: 'text' });
        lifecycle.setLifecycleChannelTemplate(server.id, 'welcome', extra.id, 'Custom {channel.name}');

        expect(lifecycle.getConfig(server.id, 'welcome').channel_id).toBe(primary.id);
        expect((await lifecycle.sendLifecycleMessage('welcome', member(server))).status).toBe('sent');
        expect(primary.send.mock.calls[0][0].content).toBe('Fallback User');
        expect(extra.send.mock.calls[0][0].content).toBe('Custom extra');
        expect(lifecycle.lifecycleChannelUsesCustomTemplate(server.id, 'welcome', extra.id)).toBe(true);
    });

    test('renders current conditionals, lowercase functions, variables, and timestamp suffixes', () => {
        const { value: server } = guild();
        const target = member(server);
        target.user.bot = false;
        target.user.discriminator = '1234';
        target.user.tag = null;
        target.joinedTimestamp = target.joinedAt.getTime();
        server.premiumTier = 0;
        server.members.cache = new Map([
            ['older', { id: 'older', joinedTimestamp: target.joinedTimestamp - 1 }],
            [target.id, target]
        ]);
        expect(lifecycle.renderTemplate(
            '{if {user.join_position} < 100}{lower(user.name)} {user.tag} joined {user.join_position_suffix} at {user.created_at:R} on {guild.boost_tier}{else}full{/if}', target
        )).toBe('user User#1234 joined 2nd at <t:1577836800:R> on No Level');
        server.members.cache.delete(target.id);
        expect(lifecycle.renderTemplate('{user.join_position}|{channel.topic}', target, { id: 'channel1' }))
            .toBe('N/A|N/A');
    });

    test('expands saved custom scripts through the bounded rich-content service', async () => {
        const { value: server, channel } = guild();
        server.client = { richContentService: { expandCustom: jest.fn().mockReturnValue('Expanded {user}') } };
        lifecycle.setConfig(server.id, 'welcome', { channelId: channel.id, enabled: true, format: 'text', template: '{cscript:greeting}' });

        expect((await lifecycle.sendLifecycleMessage('welcome', member(server))).status).toBe('sent');
        expect(server.client.richContentService.expandCustom).toHaveBeenCalledWith('{cscript:greeting}', server.id);
        expect(channel.send.mock.calls[0][0].content).toBe('Expanded User');
    });

    test('accepts Components V2 and reserves two components for Join DM Server Info', async () => {
        const { value: server } = guild();
        const rich = require('../src/services/richContentService');
        server.client = { richContentService: { expandCustom: script => script, render: rich.renderScript } };
        const target = member(server);
        target.send = jest.fn().mockResolvedValue({ id: 'dm1' });
        expect(() => lifecycle.validateTemplate('{cv2}{text: Welcome {user}}')).not.toThrow();
        lifecycle.setConfig(server.id, 'join_dm', { enabled: true, template: `{cv2}${'{text: x}'.repeat(38)}` });
        expect((await lifecycle.sendJoinDm(target)).status).toBe('sent');
        lifecycle.setConfig(server.id, 'join_dm', { template: `{cv2}${'{text: x}'.repeat(39)}` });
        expect((await lifecycle.sendJoinDm(target)).status).toBe('failed');
    });

    test('binds Join DM custom-script buttons to their source guild', async () => {
        const { value: server } = guild();
        const rich = require('../src/services/richContentService');
        server.client = { richContentService: {
            expandCustom: script => script,
            render: (script, context) => rich.renderScript(script, { ...context, customScripts: new Set(['rules']) })
        } };
        const target = member(server);
        target.send = jest.fn().mockResolvedValue({ id: 'dm1' });
        lifecycle.setConfig(server.id, 'join_dm', {
            enabled: true, template: '{cv2}{button: label: Rules && custom: rules}'
        });

        expect((await lifecycle.sendJoinDm(target)).status).toBe('sent');
        expect(target.send.mock.calls[0][0].components[0].toJSON().components[0].custom_id)
            .toBe('rich:custom:guild1:rules');
    });

    test('a render failure in one destination does not block later channels', async () => {
        const broken = { id: 'broken', send: jest.fn() };
        const healthy = { id: 'healthy', send: jest.fn().mockResolvedValue({ delete: jest.fn() }) };
        const { value: server } = guild();
        server.channels.fetch = jest.fn(id => Promise.resolve({ broken, healthy }[id]));
        server.client = { richContentService: {
            expandCustom: (script, guildId) => script.includes('missing') ? (() => { throw new Error(`Missing script in ${guildId}`); })() : script
        } };
        lifecycle.setConfig(server.id, 'welcome', { channelId: broken.id, enabled: true, template: '{cscript:missing}', format: 'text' });
        lifecycle.addLifecycleChannel(server.id, 'welcome', healthy.id);
        lifecycle.setLifecycleChannelTemplate(server.id, 'welcome', healthy.id, 'Healthy {user}');

        expect((await lifecycle.sendLifecycleMessage('welcome', member(server))).status).toBe('sent');
        expect(broken.send).not.toHaveBeenCalled();
        expect(healthy.send).toHaveBeenCalledTimes(1);
    });

    test('welcome and goodbye suppress bots and welcome pauses after 20 human joins per minute', async () => {
        const { value: server, channel } = guild();
        lifecycle.setConfig(server.id, 'welcome', { channelId: channel.id, enabled: true, format: 'text' });
        const bot = member(server);
        bot.user.bot = true;
        expect((await lifecycle.sendLifecycleMessage('welcome', bot)).status).toBe('bot');
        const human = member(server);
        for (let index = 0; index < 20; index++) expect((await lifecycle.sendLifecycleMessage('welcome', human)).status).toBe('sent');
        expect((await lifecycle.sendLifecycleMessage('welcome', human)).status).toBe('limited');
        expect(channel.send).toHaveBeenCalledTimes(20);
    });

    test('Join DMs attach Server Info, enforce both rolling limits, and release failures', async () => {
        const { value: server } = guild();
        const target = member(server);
        target.send = jest.fn().mockRejectedValue(new Error('closed'));
        lifecycle.setConfig(server.id, 'join_dm', { enabled: true, template: 'Welcome {displayname}', format: 'text' });
        expect((await lifecycle.sendJoinDm(target)).status).toBe('failed');
        expect(database.sqlite.prepare('SELECT COUNT(*) count FROM join_dm_deliveries').get().count).toBe(0);

        target.send.mockResolvedValue({ id: 'dm1' });
        expect((await lifecycle.sendJoinDm(target)).status).toBe('sent');
        expect(target.send.mock.calls[1][0].components[0].toJSON().components[0].custom_id).toBe('join_dm:info:guild1:user1');

        const insert = database.sqlite.prepare("INSERT INTO join_dm_deliveries (guild_id, user_id, sent_at) VALUES ('guild1', ?, ?)");
        database.sqlite.transaction(() => {
            for (let index = 0; index < 39; index++) insert.run(`minute-${index}`, Date.now());
        })();
        expect((await lifecycle.sendJoinDm(target)).status).toBe('limited');
        database.sqlite.prepare('DELETE FROM join_dm_deliveries').run();
        database.sqlite.transaction(() => {
            for (let index = 0; index < 750; index++) insert.run(`hour-${index}`, Date.now() - 120000);
        })();
        expect((await lifecycle.sendJoinDm(target)).status).toBe('limited');
        expect(target.send).toHaveBeenCalledTimes(2);
        lifecycle.resetConfig(server.id, 'join_dm');
        expect(database.sqlite.prepare('SELECT COUNT(*) count FROM join_dm_deliveries').get().count).toBe(0);
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
        expect(groups.welcome).toEqual(expect.arrayContaining(['setup', 'channel', 'channels', 'dm', 'message', 'test', 'preview', 'view', 'reset']));
        expect(groups.goodbye).toEqual(expect.arrayContaining(['setup', 'channel', 'channels', 'message', 'test', 'preview', 'view', 'reset']));
        const dm = server.options.find(option => option.name === 'welcome').options.find(option => option.name === 'dm');
        expect(dm.options.find(option => option.name === 'action').choices.map(choice => choice.value))
            .toEqual(['enable', 'disable', 'toggle', 'message', 'config', 'view', 'settings', 'show', 'test', 'preview', 'reset', 'clear']);
        expect(groups.boost).toEqual(expect.arrayContaining(['setup', 'channel', 'settings', 'remove', 'test', 'preview', 'reset']));
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

    test('Welcome reset leaves separately managed Join DM state intact', async () => {
        const command = require('../src/utils/lifecycleMessageCommand');
        const { value: server } = guild();
        lifecycle.setConfig(server.id, 'welcome', { channelId: 'channel1', enabled: true });
        lifecycle.setConfig(server.id, 'join_dm', { enabled: true, template: 'Direct' });
        database.sqlite.prepare("INSERT INTO join_dm_deliveries (guild_id, user_id, sent_at) VALUES ('guild1', 'user1', ?)").run(Date.now());
        const interaction = {
            guild: server, user: { id: 'admin1' },
            member: { permissions: { has: jest.fn().mockReturnValue(true) } },
            options: {
                getSubcommandGroup: () => 'welcome', getSubcommand: () => 'reset',
                getChannel: () => null, getString: () => null, getInteger: () => null
            },
            deferReply: jest.fn(), editReply: jest.fn(), reply: jest.fn()
        };

        await command.executeLifecycle(interaction);

        expect(lifecycle.getConfig(server.id, 'join_dm')).toEqual(expect.objectContaining({ enabled: 1, template: 'Direct' }));
        expect(database.sqlite.prepare('SELECT COUNT(*) count FROM join_dm_deliveries').get().count).toBe(1);
    });

    test('Boost view renders the exact configured message while settings remains configuration-only', async () => {
        const command = require('../src/utils/lifecycleMessageCommand');
        const { value: server, channel } = guild();
        lifecycle.setConfig(server.id, 'boost', { channelId: channel.id, enabled: true, template: 'Boost {user}', format: 'text' });
        const target = member(server);
        target.permissions = { has: jest.fn().mockReturnValue(true) };
        const interaction = {
            guild: server, user: target.user, member: target,
            options: {
                getSubcommandGroup: () => 'boost', getSubcommand: () => 'view',
                getChannel: () => null, getString: () => null, getInteger: () => null
            },
            deferReply: jest.fn(), editReply: jest.fn(), reply: jest.fn()
        };

        await command.executeLifecycle(interaction);

        expect(channel.send.mock.calls[0][0].content).toBe('Boost User');
        expect(interaction.editReply.mock.calls[0][0].embeds[0].data.title).toContain('Preview Sent');
    });
});
