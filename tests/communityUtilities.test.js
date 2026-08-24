const fs = require('fs');
const os = require('os');
const path = require('path');
const { PermissionFlagsBits } = require('discord.js');

describe('community utilities', () => {
    let tempDir;
    let database;
    let service;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-community-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        const { CommunityUtilityService } = require('../src/services/communityUtilityService');
        service = new CommunityUtilityService(null, { sqlite: database.sqlite, now: () => 100000, randomInt: () => 1 });
    });

    afterEach(() => {
        service?.cleanup();
        database.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('registers the complete community slash hierarchy within Discord limits', () => {
        const server = require('../src/commands/administration/server').data.toJSON();
        const fun = require('../src/commands/fun/fun').data.toJSON();
        const confess = require('../src/commands/utility/confess').data.toJSON();
        const group = (json, name) => json.options.find(option => option.name === name);

        expect(confess).toMatchObject({ name: 'confess', dm_permission: false });
        expect(group(server, 'confessions').options.map(option => option.name)).toEqual([
            'view', 'setup', 'remove', 'category', 'blacklist', 'emojis', 'mute', 'unmute', 'report'
        ]);
        expect(group(server, 'thread').options.map(option => option.name)).toEqual([
            'add', 'remove', 'rename', 'slowmode', 'lock', 'unlock', 'archive', 'unarchive', 'solved', 'delete'
        ]);
        expect(group(server, 'community').options.map(option => option.name)).toEqual(['view', 'image-only', 'pin', 'unpin']);
        expect(group(fun, 'poll').options.map(option => option.name)).toEqual(['create', 'quick', 'end']);
        expect(fun.options.map(option => option.name)).toEqual(expect.arrayContaining(['choose', 'random-member', 'quote']));
        expect(server.options).toHaveLength(23);
        expect(fun.options.length).toBeLessThanOrEqual(25);
    });

    test('enforces poll grammar, public bounds, unique options, and secure choice', () => {
        const { parsePollDuration, parsePollOptions } = require('../src/services/communityUtilityService');
        expect(parsePollDuration('10s')).toBe(10000);
        expect(parsePollDuration('7d')).toBe(604800000);
        expect(() => parsePollDuration('9s')).toThrow('between 10 seconds and 7 days');
        expect(() => parsePollDuration('8d')).toThrow('between 10 seconds and 7 days');
        expect(parsePollOptions('red, blue')).toEqual(['red', 'blue']);
        expect(() => parsePollOptions('red, RED')).toThrow('unique');
        expect(service.choose('red, blue, green')).toBe('blue');
        expect(() => service.choose('only one')).toThrow('between 2 and 100');
    });

    test('stores confession attribution while public output remains anonymous', async () => {
        service.setConfessionConfig('guild1', 'channel1');
        const sent = { id: 'message1', react: jest.fn().mockResolvedValue({}) };
        const channel = { id: 'channel1', isTextBased: () => true, send: jest.fn().mockResolvedValue(sent) };
        const interaction = {
            guildId: 'guild1', user: { id: 'author1' }, fields: { getTextInputValue: () => 'A private confession' },
            guild: { channels: { fetch: jest.fn().mockResolvedValue(channel) } },
            deferReply: jest.fn().mockResolvedValue({}), editReply: jest.fn().mockResolvedValue({})
        };

        await service.submitConfession(interaction, 0);

        const stored = database.sqlite.prepare('SELECT * FROM confessions').get();
        const publicPayload = channel.send.mock.calls[0][0];
        expect(stored).toMatchObject({ guild_id: 'guild1', number: 1, author_id: 'author1', message_id: 'message1', status: 'published' });
        expect(JSON.stringify(publicPayload)).not.toContain('author1');
        expect(JSON.stringify(publicPayload)).toContain('Anonymous Confession #1');
        expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: 'Confession #1 was posted anonymously.' }));
    });

    test('rolls back a failed confession publish without consuming its number', async () => {
        service.setConfessionConfig('guild1', 'channel1');
        const interaction = {
            guildId: 'guild1', user: { id: 'author1' }, fields: { getTextInputValue: () => 'A private confession' },
            guild: { channels: { fetch: jest.fn().mockResolvedValue({ isTextBased: () => true, send: jest.fn().mockRejectedValue(new Error('Discord down')) }) } },
            deferReply: jest.fn().mockResolvedValue({})
        };
        await expect(service.submitConfession(interaction, 0)).rejects.toThrow('Discord down');
        expect(database.sqlite.prepare('SELECT COUNT(*) count FROM confessions').get().count).toBe(0);
        expect(service.confessionConfig('guild1').next_number).toBe(1);
    });

    test('rejects links, blocked phrases, muted authors, and cooldown replays', () => {
        service.setConfessionConfig('guild1', 'channel1');
        service.configureBlacklist('guild1', 'add', 'secret phrase', 'mod1');
        expect(() => service.validateConfessionText('guild1', 'user1', 'https://example.com')).toThrow('Links');
        expect(() => service.validateConfessionText('guild1', 'user1', 'my SECRET phrase here')).toThrow('blocked phrase');
        database.sqlite.prepare(`INSERT INTO confession_mutes (guild_id, user_id, muted_by, created_at) VALUES ('guild1','user2','mod1',1)`).run();
        expect(() => service.validateConfessionText('guild1', 'user2', 'hello')).toThrow('muted');
        database.sqlite.prepare(`INSERT INTO confessions (guild_id, number, channel_id, author_id, content, status, created_at)
            VALUES ('guild1',1,'channel1','user3','hello','published',99999)`).run();
        expect(() => service.validateConfessionText('guild1', 'user3', 'again')).toThrow('60 seconds');
    });

    test('binds poll votes to guild, channel, and message and rejects duplicates', async () => {
        const row = database.sqlite.prepare(`INSERT INTO community_polls
            (guild_id, channel_id, message_id, creator_id, question, options_json, status, created_at)
            VALUES ('guild1','channel1','message1','creator','Question?','["Yes","No"]','active',1) RETURNING id`).get();
        const interaction = {
            guildId: 'guild1', channelId: 'channel1', user: { id: 'user1', bot: false }, member: {},
            message: { id: 'message1', edit: jest.fn().mockResolvedValue({}) },
            deferReply: jest.fn().mockResolvedValue({}), editReply: jest.fn().mockResolvedValue({})
        };
        await service.vote(interaction, row.id, 0);
        await expect(service.vote(interaction, row.id, 1)).rejects.toThrow('already voted');
        expect(database.sqlite.prepare('SELECT option_index FROM community_poll_votes').get().option_index).toBe(0);
        await expect(service.vote({ ...interaction, user: { id: 'user2' }, message: { id: 'forged' } }, row.id, 0)).rejects.toThrow('stale');
    });

    test('publishes new polls with enabled controls', async () => {
        const message = { id: 'message1', url: 'https://discord.com/channels/guild1/channel1/message1' };
        const interaction = {
            guildId: 'guild1', channelId: 'channel1', user: { id: 'creator' },
            channel: { send: jest.fn().mockResolvedValue(message) },
            deferReply: jest.fn().mockResolvedValue({}), editReply: jest.fn().mockResolvedValue({})
        };

        const poll = await service.createPoll(interaction, 'Question?', ['Yes', 'No'], null);

        expect(poll.status).toBe('active');
        expect(interaction.channel.send.mock.calls[0][0].components.flatMap(component => component.components)
            .every(button => button.data.disabled === false)).toBe(true);
    });

    test('does not accept votes or render controls after a poll starts ending', async () => {
        const row = database.sqlite.prepare(`INSERT INTO community_polls
            (guild_id, channel_id, message_id, creator_id, question, options_json, status, created_at)
            VALUES ('guild1','channel1','message1','creator','Question?','["Yes","No"]','ending',1) RETURNING *`).get();
        const interaction = {
            guildId: 'guild1', channelId: 'channel1', user: { id: 'user1', bot: false }, member: {},
            message: { id: 'message1', edit: jest.fn() }
        };

        await expect(service.vote(interaction, row.id, 0)).rejects.toThrow('stale');
        expect(database.sqlite.prepare('SELECT COUNT(*) count FROM community_poll_votes').get().count).toBe(0);
        expect(service.pollPayload({ ...row, options: ['Yes', 'No'] }).components.flatMap(component => component.components)
            .every(button => button.data.disabled)).toBe(true);
    });

    test('claims and ends a timed poll once with durable results', async () => {
        const row = database.sqlite.prepare(`INSERT INTO community_polls
            (guild_id, channel_id, message_id, creator_id, question, options_json, status, ends_at, created_at)
            VALUES ('guild1','channel1','message1','creator','Question?','["Yes","No"]','active',99999,1) RETURNING id`).get();
        database.sqlite.prepare("INSERT INTO community_poll_votes VALUES (?, 'user1', 0, 1)").run(row.id);
        const message = { edit: jest.fn().mockResolvedValue({}) };
        const channel = { messages: { fetch: jest.fn().mockResolvedValue(message) } };
        service.client = { guilds: { fetch: jest.fn().mockResolvedValue({ channels: { fetch: jest.fn().mockResolvedValue(channel) } }) } };

        const ended = await service.finishPoll(row.id);
        const retry = await service.finishPoll(row.id);

        expect(ended.status).toBe('ended');
        expect(retry.status).toBe('ended');
        expect(message.edit).toHaveBeenCalledTimes(1);
        expect(message.edit.mock.calls[0][0].components.flatMap(component => component.components).every(button => button.data.disabled)).toBe(true);
    });

    test('enforces image-only after moderator and attachment exemptions', async () => {
        service.setImageOnly('guild1', 'channel1', true, 'mod1');
        const base = {
            guild: { id: 'guild1' }, channel: { id: 'channel1' }, author: { bot: false }, webhookId: null,
            attachments: new Map(), delete: jest.fn().mockResolvedValue({}),
            member: { permissionsIn: () => ({ has: () => false }) }
        };
        await expect(service.handleMessage(base)).resolves.toBe(true);
        expect(base.delete).toHaveBeenCalledTimes(1);
        await expect(service.handleMessage({ ...base, delete: jest.fn(), attachments: new Map([['file', {}]]) })).resolves.toBe(false);
        await expect(service.handleMessage({ ...base, delete: jest.fn(), member: { permissionsIn: () => ({ has: () => true }) } })).resolves.toBe(false);
        await expect(service.handleMessage({ ...base, delete: jest.fn(), system: true })).resolves.toBe(false);
    });

    test('requires source-channel visibility before resolving a message', async () => {
        const channel = { isTextBased: () => true, messages: { fetch: jest.fn() }, toString: () => '#private' };
        const interaction = {
            guildId: '1234567890123456', channel,
            guild: { channels: { fetch: jest.fn().mockResolvedValue(channel) } },
            member: { permissionsIn: () => ({ has: () => false }) }
        };

        await expect(service.resolveMessage(interaction, 'https://discord.com/channels/1234567890123456/2234567890123456/3234567890123456'))
            .rejects.toThrow('View Channel and Read Message History');
        expect(channel.messages.fetch).not.toHaveBeenCalled();
    });

    test('requires bot visibility before resolving a message', async () => {
        const channel = { isTextBased: () => true, messages: { fetch: jest.fn() }, toString: () => '#private' };
        const interaction = {
            guildId: '1234567890123456', channel,
            guild: {
                channels: { fetch: jest.fn().mockResolvedValue(channel) },
                members: { me: { permissionsIn: () => ({ has: () => false }) } }
            },
            member: { permissionsIn: () => ({ has: () => true }) }
        };

        await expect(service.resolveMessage(interaction, '3234567890123456')).rejects.toThrow('I need View Channel');
        expect(channel.messages.fetch).not.toHaveBeenCalled();
    });

    test('refreshes an incomplete member cache once before random selection', async () => {
        const cache = new Map([['bot', { user: { bot: true } }]]);
        const guild = { id: 'guild1', memberCount: 3, members: { cache, fetch: jest.fn(async () => {
            cache.set('one', { user: { bot: false }, id: 'one' });
            cache.set('two', { user: { bot: false }, id: 'two' });
            return cache;
        }) } };

        await expect(service.randomMember(guild)).resolves.toMatchObject({ id: 'two' });
        await service.randomMember(guild);
        expect(guild.members.fetch).toHaveBeenCalledTimes(1);
    });

    test('requires target-channel moderation permission to end another creator poll', async () => {
        database.sqlite.prepare(`INSERT INTO community_polls
            (guild_id, channel_id, message_id, creator_id, question, options_json, status, created_at)
            VALUES ('guild1','target','1234567890123456','creator','Question?','["Yes","No"]','active',1)`).run();
        const channel = {};
        const interaction = {
            guildId: 'guild1', user: { id: 'moderator' },
            guild: { channels: { fetch: jest.fn().mockResolvedValue(channel) } },
            member: { permissionsIn: () => ({ has: () => false }) }
        };

        await expect(service.endPoll(interaction, '1234567890123456')).rejects.toThrow('moderator in the poll channel');
    });

    test('accepts only one durable report per reporter and confession', async () => {
        database.sqlite.prepare(`INSERT INTO confessions
            (guild_id, number, channel_id, author_id, content, message_id, status, created_at)
            VALUES ('guild1',1,'channel1','author1','content','message1','published',1)`).run();
        const interaction = {
            guildId: 'guild1', user: { id: 'reporter1' },
            fields: { getTextInputValue: () => 'unsafe' },
            guild: { channels: { fetch: jest.fn() } },
            reply: jest.fn().mockResolvedValue({})
        };

        await service.submitConfessionReport(interaction, 1);
        expect(() => service.submitConfessionReport(interaction, 1)).toThrow('already reported');
        expect(database.sqlite.prepare("SELECT COUNT(*) count FROM moderation_logs WHERE action = 'CONFESSION_REPORT'").get().count).toBe(1);
    });

    test('renders bounded quote PNGs and suppresses remote non-Discord avatars', async () => {
        const attachment = await service.quoteImage({
            id: 'message1', content: '<hello> @everyone', createdTimestamp: 1000,
            author: { username: 'Alice', displayAvatarURL: () => 'https://example.com/avatar.png' },
            member: { displayName: 'Alice & Bob' }
        });
        expect(Buffer.isBuffer(attachment.attachment)).toBe(true);
        expect(attachment.attachment.subarray(1, 4).toString()).toBe('PNG');
        expect(attachment.attachment.length).toBeLessThan(8_000_000);
    });

    test('purges every private community record for a departed guild', () => {
        service.setConfessionConfig('guild1', 'channel1');
        service.configureBlacklist('guild1', 'add', 'blocked', 'mod1');
        service.setImageOnly('guild1', 'channel1', true, 'mod1');
        database.sqlite.prepare(`INSERT INTO community_polls
            (guild_id, channel_id, creator_id, question, options_json, created_at) VALUES ('guild1','channel1','user1','Q','["Y","N"]',1)`).run();
        service.purgeGuild('guild1');
        for (const table of ['confession_configs', 'confession_blacklist', 'community_polls', 'image_only_channels']) {
            expect(database.sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count).toBe(0);
        }
    });
});

describe('community administration native permissions', () => {
    test('does not let ByteBot RBAC substitute for Manage Threads', async () => {
        jest.resetModules();
        const { executeCommunityUtilityAdmin } = require('../src/utils/communityUtilityCommand');
        const thread = { isThread: () => true, setLocked: jest.fn(), guild: {}, toString: () => '#thread' };
        const reply = jest.fn().mockResolvedValue({});
        const interaction = {
            guildId: 'guild1', guild: { members: { me: { permissionsIn: () => ({ has: () => true }) } } },
            channel: thread, user: { id: 'user1', tag: 'User' }, memberPermissions: { has: () => false }, reply,
            options: { getSubcommandGroup: () => 'thread', getSubcommand: () => 'lock', getChannel: () => null, getString: () => null }
        };
        await executeCommunityUtilityAdmin(interaction, { communityUtilityService: {} });
        expect(thread.setLocked).not.toHaveBeenCalled();
        expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('real Discord Manage Threads') }));
    });

    test('applies a thread action only when caller and bot have Manage Threads', async () => {
        jest.resetModules();
        const { executeCommunityUtilityAdmin } = require('../src/utils/communityUtilityCommand');
        const thread = { name: 'help', isThread: () => true, setLocked: jest.fn().mockResolvedValue({}), toString: () => '#help' };
        const interaction = {
            guildId: 'guild1', guild: { members: { me: { permissionsIn: () => ({ has: permission => permission === PermissionFlagsBits.ManageThreads }) } } },
            channel: thread, user: { id: 'mod1', tag: 'Mod' }, member: { permissionsIn: () => ({ has: permission => permission === PermissionFlagsBits.ManageThreads }) },
            reply: jest.fn().mockResolvedValue({}),
            options: { getSubcommandGroup: () => 'thread', getSubcommand: () => 'lock', getChannel: () => null, getString: () => null }
        };
        await executeCommunityUtilityAdmin(interaction, { communityUtilityService: {} });
        expect(thread.setLocked).toHaveBeenCalledWith(true, 'Thread lock by Mod');
    });

    test('uses target-channel permissions for confession attribution', async () => {
        jest.resetModules();
        const { executeCommunityUtilityAdmin } = require('../src/utils/communityUtilityCommand');
        const service = {
            confessionByNumber: jest.fn(() => ({ number: 1, channel_id: 'private', author_id: 'author' })),
            muteConfessionAuthor: jest.fn()
        };
        const interaction = {
            guildId: 'guild1', guild: { channels: { fetch: jest.fn().mockResolvedValue({ toString: () => '#private' }) } },
            user: { id: 'mod1' }, member: { permissionsIn: () => ({ has: () => false }) }, reply: jest.fn().mockResolvedValue({}),
            options: {
                getSubcommandGroup: () => 'confessions', getSubcommand: () => 'mute', getInteger: () => 1, getString: () => null
            }
        };

        await executeCommunityUtilityAdmin(interaction, { communityUtilityService: service });

        expect(service.muteConfessionAuthor).not.toHaveBeenCalled();
        expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('in #private') }));
    });

    test('passes the audit reason inside solved thread edits', async () => {
        jest.resetModules();
        const { executeCommunityUtilityAdmin } = require('../src/utils/communityUtilityCommand');
        const thread = { name: 'help', isThread: () => true, edit: jest.fn().mockResolvedValue({}), toString: () => '#help' };
        const interaction = {
            guildId: 'guild1', guild: { members: { me: { permissionsIn: () => ({ has: () => true }) } } },
            channel: thread, user: { id: 'mod1', tag: 'Mod' }, member: { permissionsIn: () => ({ has: () => true }) },
            reply: jest.fn().mockResolvedValue({}),
            options: { getSubcommandGroup: () => 'thread', getSubcommand: () => 'solved', getChannel: () => null, getString: () => 'Resolved duplicate' }
        };

        await executeCommunityUtilityAdmin(interaction, { communityUtilityService: {} });

        expect(thread.edit).toHaveBeenCalledWith({ locked: true, archived: true, reason: 'Resolved duplicate' });
    });

    test('edits an acknowledged response when thread deletion fails', async () => {
        jest.resetModules();
        const { executeCommunityUtilityAdmin } = require('../src/utils/communityUtilityCommand');
        const thread = { name: 'help', isThread: () => true, delete: jest.fn().mockRejectedValue(new Error('Discord denied deletion')), toString: () => '#help' };
        const interaction = {
            guildId: 'guild1', guild: { members: { me: { permissionsIn: () => ({ has: () => true }) } } },
            channel: thread, user: { id: 'mod1', tag: 'Mod' }, member: { permissionsIn: () => ({ has: () => true }) },
            replied: false, editReply: jest.fn().mockResolvedValue({}),
            options: {
                getSubcommandGroup: () => 'thread', getSubcommand: () => 'delete', getChannel: () => null,
                getString: () => null, getBoolean: () => true
            }
        };
        interaction.reply = jest.fn(async () => { interaction.replied = true; });

        await executeCommunityUtilityAdmin(interaction, { communityUtilityService: {} });

        expect(interaction.reply).toHaveBeenCalledTimes(1);
        expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: 'Discord denied deletion' }));
    });
});
