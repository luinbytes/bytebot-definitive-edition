const fs = require('fs');
const os = require('os');
const path = require('path');
const { ChannelType, PermissionFlagsBits } = require('discord.js');

function interaction(guild, subcommand) {
    return {
        guild,
        guildId: guild.id,
        user: { id: 'admin-1' },
        member: { permissions: { has: permission => permission === PermissionFlagsBits.Administrator } },
        options: {
            getSubcommandGroup: () => null,
            getSubcommand: () => subcommand
        },
        editReply: jest.fn(async payload => payload)
    };
}

function memberInteraction(guild, member, subcommand, values = {}) {
    return {
        guild, guildId: guild.id, member, user: member.user,
        options: {
            getSubcommandGroup: () => null,
            getSubcommand: () => subcommand,
            getInteger: name => values[name] ?? null,
            getString: name => values[name] ?? null,
            getBoolean: name => values[name] ?? null,
            getUser: name => values[name] ?? null,
            getMember: name => values[name] ?? null,
            getRole: name => values[name] ?? null,
            getChannel: name => values[name] ?? null
        },
        editReply: jest.fn(async payload => payload)
    };
}

function adminInteraction(guild, subcommand, values = {}, group = null) {
    const member = {
        id: 'admin-1', user: { id: 'admin-1' },
        permissions: { has: permission => permission === PermissionFlagsBits.Administrator },
        roles: { cache: new Map() }, voice: {}
    };
    const result = memberInteraction(guild, member, subcommand, values);
    result.options.getSubcommandGroup = () => group;
    return result;
}

function componentInteraction(guild, member, action) {
    return {
        guild, guildId: guild.id, member, user: member.user,
        customId: `voicemaster:temporary-1:${action}`,
        message: { id: 'controls-1' },
        isButton: () => true,
        isModalSubmit: () => false,
        reply: jest.fn(async payload => payload),
        deferReply: jest.fn(async () => {}),
        editReply: jest.fn(async payload => payload),
        showModal: jest.fn(async () => {})
    };
}

describe('VoiceMaster lifecycle', () => {
    let tempDir;
    let database;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-voicemaster-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
    });

    afterEach(() => {
        database.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('setup is durable and a repeated setup cannot create duplicate resources', async () => {
        const channels = new Map();
        const join = {
            id: 'join-1', type: ChannelType.GuildVoice,
            send: jest.fn(async () => ({ id: `interface-${join.send.mock.calls.length}` }))
        };
        const category = { id: 'category-1', type: ChannelType.GuildCategory };
        const create = jest.fn(async values => {
            const channel = values.type === ChannelType.GuildCategory ? category : join;
            channels.set(channel.id, channel);
            return channel;
        });
        const guild = {
            id: 'guild-1', name: 'Guild',
            members: { me: { id: 'bot-1', permissions: { has: () => true } } },
            roles: { everyone: { id: 'guild-1' } },
            channels: { cache: channels, create, fetch: jest.fn(async id => channels.get(id) || null) }
        };
        const { VoiceMasterService } = require('../src/services/voiceMasterService');
        const service = new VoiceMasterService({ sqlite: database.sqlite });

        await service.execute(interaction(guild, 'setup'));
        const restarted = new VoiceMasterService({ sqlite: database.sqlite });
        await restarted.execute(interaction(guild, 'sendinterface'));
        await restarted.execute(interaction(guild, 'setup'));

        expect(create.mock.calls.map(([values]) => [values.name, values.type])).toEqual([
            ['VoiceMaster', ChannelType.GuildCategory],
            ['Join to Create', ChannelType.GuildVoice]
        ]);
        expect(join.send).toHaveBeenCalledTimes(2);
    });

    test('concurrent setup calls reserve one generation before Discord resources are created', async () => {
        const channels = new Map();
        let releaseCategory;
        const categoryGate = new Promise(resolve => { releaseCategory = resolve; });
        const category = { id: 'category-1', type: ChannelType.GuildCategory, delete: jest.fn() };
        const join = {
            id: 'join-1', type: ChannelType.GuildVoice, delete: jest.fn(),
            send: jest.fn(async () => ({ id: 'interface-1' }))
        };
        const create = jest.fn(async values => {
            if (values.type === ChannelType.GuildCategory) await categoryGate;
            const channel = values.type === ChannelType.GuildCategory ? category : join;
            channels.set(channel.id, channel);
            return channel;
        });
        const guild = {
            id: 'guild-1', members: { me: { id: 'bot-1', permissions: { has: () => true } } },
            channels: { cache: channels, create, fetch: jest.fn(async id => channels.get(id) || null) }
        };
        const { VoiceMasterService } = require('../src/services/voiceMasterService');
        const service = new VoiceMasterService({ sqlite: database.sqlite });

        const first = service.execute(interaction(guild, 'setup'));
        await Promise.resolve();
        await service.execute(interaction(guild, 'setup'));
        releaseCategory();
        await first;

        expect(create).toHaveBeenCalledTimes(2);
        expect(service.config(guild.id)).toMatchObject({ state: 'active', generation: 1 });
    });

    test('reset cancels an in-flight creation before it can persist or move the member', async () => {
        const channels = new Map();
        let releaseTemporary;
        let temporaryStarted;
        const started = new Promise(resolve => { temporaryStarted = resolve; });
        const gate = new Promise(resolve => { releaseTemporary = resolve; });
        const category = { id: 'category-1', type: ChannelType.GuildCategory, delete: jest.fn() };
        const join = {
            id: 'join-1', type: ChannelType.GuildVoice, delete: jest.fn(),
            send: jest.fn(async () => ({ id: 'interface-1' }))
        };
        const temporary = {
            id: 'temporary-1', type: ChannelType.GuildVoice, members: new Map(),
            send: jest.fn(async () => ({ id: 'controls-1' })), delete: jest.fn(async () => {})
        };
        const create = jest.fn(async values => {
            if (values.type === ChannelType.GuildCategory) return category;
            if (values.name === 'Join to Create') return join;
            temporaryStarted();
            await gate;
            channels.set(temporary.id, temporary);
            return temporary;
        });
        channels.set(category.id, category);
        channels.set(join.id, join);
        const voiceStates = new Map([['member-1', { channelId: 'join-1' }]]);
        const member = {
            id: 'member-1', displayName: 'Member', user: { id: 'member-1', bot: false, username: 'Member' },
            voice: { channelId: 'join-1', setChannel: jest.fn() }
        };
        const guild = {
            id: 'guild-1', voiceStates: { cache: voiceStates },
            members: { me: { id: 'bot-1', permissions: { has: () => true } } },
            channels: { cache: channels, create, fetch: jest.fn(async id => channels.get(id) || null) }
        };
        const { VoiceMasterService } = require('../src/services/voiceMasterService');
        const service = new VoiceMasterService({ sqlite: database.sqlite });
        await service.execute(interaction(guild, 'setup'));

        const creating = service.handleVoiceState({ channelId: null }, { guild, member, channelId: join.id });
        await started;
        await service.execute(interaction(guild, 'reset'));
        releaseTemporary();
        await creating;

        expect(temporary.delete).toHaveBeenCalledTimes(1);
        expect(member.voice.setChannel).not.toHaveBeenCalled();
        expect(database.sqlite.prepare('SELECT COUNT(*) count FROM bytepods WHERE source_channel_id IS NOT NULL').get().count).toBe(0);
    });

    test('duplicate join events and a restart reuse one durably reserved channel', async () => {
        const channels = new Map();
        const category = { id: 'category-1', type: ChannelType.GuildCategory, delete: jest.fn() };
        const join = { id: 'join-1', type: ChannelType.GuildVoice, send: jest.fn(async () => ({ id: 'interface-1' })), delete: jest.fn() };
        const temporary = {
            id: 'temporary-1', type: ChannelType.GuildVoice, members: new Map(),
            send: jest.fn(async () => ({ id: 'controls-1' })), delete: jest.fn()
        };
        const create = jest.fn(async values => {
            const channel = values.type === ChannelType.GuildCategory
                ? category
                : values.name === 'Join to Create' ? join : temporary;
            channels.set(channel.id, channel);
            return channel;
        });
        const voiceStates = new Map();
        const member = {
            id: 'member-1', user: { id: 'member-1', bot: false, username: 'Member' },
            displayName: 'Member',
            voice: {
                channelId: 'join-1',
                setChannel: jest.fn(async channel => {
                    member.voice.channelId = channel.id;
                    voiceStates.set(member.id, { channelId: channel.id });
                    channel.members.set(member.id, member);
                })
            }
        };
        voiceStates.set(member.id, { channelId: 'join-1' });
        const guild = {
            id: 'guild-1', name: 'Guild', maximumBitrate: 96000,
            members: { me: { id: 'bot-1', permissions: { has: () => true } } },
            roles: { everyone: { id: 'guild-1' } }, voiceStates: { cache: voiceStates },
            channels: { cache: channels, create, fetch: jest.fn(async id => channels.get(id) || null) }
        };
        const { VoiceMasterService } = require('../src/services/voiceMasterService');
        const service = new VoiceMasterService({ sqlite: database.sqlite });
        await service.execute(interaction(guild, 'setup'));
        const event = { member, guild, channelId: 'join-1', channel: join, client: {} };

        await Promise.all([
            service.handleVoiceState({ channelId: null }, event),
            service.handleVoiceState({ channelId: null }, event)
        ]);
        member.voice.channelId = 'join-1';
        voiceStates.set(member.id, { channelId: 'join-1' });
        await new VoiceMasterService({ sqlite: database.sqlite }).handleVoiceState({ channelId: null }, event);

        expect(create).toHaveBeenCalledTimes(3);
        expect(member.voice.setChannel).toHaveBeenCalledTimes(2);
        expect(member.voice.setChannel).toHaveBeenLastCalledWith(temporary);
    });

    test('empty cleanup deletes only the exact persisted owned channel once', async () => {
        const channels = new Map();
        const category = { id: 'category-1', type: ChannelType.GuildCategory, delete: jest.fn() };
        const join = { id: 'join-1', type: ChannelType.GuildVoice, send: jest.fn(async () => ({ id: 'interface-1' })), delete: jest.fn() };
        const temporary = {
            id: 'temporary-1', type: ChannelType.GuildVoice, members: new Map(),
            send: jest.fn(async () => ({ id: 'controls-1' })), delete: jest.fn(async () => channels.delete('temporary-1'))
        };
        const create = jest.fn(async values => {
            const channel = values.type === ChannelType.GuildCategory
                ? category
                : values.name === 'Join to Create' ? join : temporary;
            channels.set(channel.id, channel);
            return channel;
        });
        const voiceStates = new Map();
        const member = {
            id: 'member-1', user: { id: 'member-1', bot: false, username: 'Member' }, displayName: 'Member',
            voice: { channelId: 'join-1', setChannel: jest.fn(async channel => {
                member.voice.channelId = channel.id;
                voiceStates.set(member.id, { channelId: channel.id });
                channel.members.set(member.id, member);
            }) }
        };
        voiceStates.set(member.id, { channelId: 'join-1' });
        const guild = {
            id: 'guild-1', name: 'Guild',
            members: { me: { id: 'bot-1', permissions: { has: () => true } } },
            roles: { everyone: { id: 'guild-1' } }, voiceStates: { cache: voiceStates },
            channels: { cache: channels, create, fetch: jest.fn(async id => channels.get(id) || null) }
        };
        const { VoiceMasterService } = require('../src/services/voiceMasterService');
        const service = new VoiceMasterService({ sqlite: database.sqlite, delay: async () => {} });
        await service.execute(interaction(guild, 'setup'));
        await service.handleVoiceState(
            { channelId: null },
            { member, guild, channelId: 'join-1', channel: join, client: {} }
        );
        temporary.members.delete(member.id);
        member.voice.channelId = null;
        voiceStates.set(member.id, { channelId: null });
        const leave = { member, guild, channelId: null, channel: null, client: {} };

        await Promise.all([
            service.handleVoiceState({ channelId: 'temporary-1', channel: temporary }, leave),
            service.handleVoiceState({ channelId: 'temporary-1', channel: temporary }, leave)
        ]);

        expect(temporary.delete).toHaveBeenCalledTimes(1);
        expect(join.delete).not.toHaveBeenCalled();
    });

    test('only the persisted owner can mutate current-channel settings', async () => {
        const channels = new Map();
        const restPut = jest.fn(async () => {});
        const category = { id: 'category-1', type: ChannelType.GuildCategory, delete: jest.fn() };
        const join = { id: 'join-1', type: ChannelType.GuildVoice, send: jest.fn(async () => ({ id: 'interface-1' })), delete: jest.fn() };
        const overwrites = { edit: jest.fn(async () => {}) };
        const temporary = {
            id: 'temporary-1', type: ChannelType.GuildVoice, name: "Member's channel", members: new Map(),
            client: { rest: { put: restPut } },
            bitrate: 64000, rtcRegion: null, userLimit: 0, permissionOverwrites: overwrites,
            send: jest.fn(async () => ({ id: 'controls-1' })), delete: jest.fn(),
            setUserLimit: jest.fn(async value => { temporary.userLimit = value; }),
            setName: jest.fn(async value => { temporary.name = value; }),
            setBitrate: jest.fn(async value => { temporary.bitrate = value; }),
            setRTCRegion: jest.fn(async value => { temporary.rtcRegion = value; })
        };
        const create = jest.fn(async values => {
            const channel = values.type === ChannelType.GuildCategory
                ? category
                : values.name === 'Join to Create' ? join : temporary;
            channels.set(channel.id, channel);
            return channel;
        });
        const voiceStates = new Map();
        const owner = {
            id: 'member-1', user: { id: 'member-1', bot: false, username: 'Member' }, displayName: 'Member',
            permissions: { has: () => false }, roles: { cache: new Map() },
            voice: { channelId: 'join-1', channel: join, setChannel: jest.fn(async channel => {
                owner.voice.channelId = channel.id;
                owner.voice.channel = channel;
                voiceStates.set(owner.id, { channelId: channel.id });
                channel.members.set(owner.id, owner);
            }) }
        };
        const outsider = {
            id: 'member-2', user: { id: 'member-2', bot: false, username: 'Other' },
            permissions: { has: () => false }, roles: { cache: new Map() },
            voice: { channelId: 'temporary-1', channel: temporary }
        };
        const target = {
            id: 'target-1', user: { id: 'target-1', bot: false, username: 'Target' },
            voice: {
                channelId: 'other-voice', channel: { id: 'other-voice' },
                setChannel: jest.fn(async channel => { target.voice.channelId = channel.id; target.voice.channel = channel; }),
                disconnect: jest.fn(async () => { target.voice.channelId = null; target.voice.channel = null; })
            }
        };
        voiceStates.set(owner.id, { channelId: 'join-1' });
        const guild = {
            id: 'guild-1', name: 'Guild', maximumBitrate: 96000,
            members: {
                me: { id: 'bot-1', permissions: { has: () => true } },
                fetch: jest.fn(async id => id === target.id ? target : null)
            },
            roles: { everyone: { id: 'guild-1' } }, voiceStates: { cache: voiceStates },
            channels: { cache: channels, create, fetch: jest.fn(async id => channels.get(id) || null) },
            fetchVoiceRegions: jest.fn(async () => new Map([['eu-west', { id: 'eu-west', deprecated: false }]]))
        };
        const { VoiceMasterService } = require('../src/services/voiceMasterService');
        const service = new VoiceMasterService({ sqlite: database.sqlite });
        await service.execute(interaction(guild, 'setup'));
        await service.handleVoiceState(
            { channelId: null },
            { member: owner, guild, channelId: 'join-1', channel: join, client: {} }
        );

        const lockInteraction = memberInteraction(guild, owner, 'lock');
        await service.execute(lockInteraction);
        await service.execute(memberInteraction(guild, owner, 'hide'));
        await service.execute(memberInteraction(guild, owner, 'limit', { limit: 12 }));
        await service.execute(memberInteraction(guild, owner, 'rename', { name: 'Focus Room' }));
        await service.execute(memberInteraction(guild, owner, 'bitrate', { bitrate: 80000 }));
        await service.execute(memberInteraction(guild, owner, 'region', { region: 'eu-west' }));
        await service.execute(memberInteraction(guild, owner, 'status', { status: 'Working' }));
        await service.execute(memberInteraction(guild, owner, 'permit', { user: target }));
        await service.execute(memberInteraction(guild, owner, 'drag', { user: target }));
        await service.execute(memberInteraction(guild, owner, 'reject', { user: target }));
        const increase = componentInteraction(guild, owner, 'increase');
        await service.handleInteraction(increase);
        const rename = componentInteraction(guild, owner, 'rename');
        await service.handleInteraction(rename);
        const outsiderDelete = componentInteraction(guild, outsider, 'delete');
        await service.handleInteraction(outsiderDelete);
        const stale = componentInteraction(guild, owner, 'increase');
        stale.message.id = 'old-controls';
        await service.handleInteraction(stale);
        await service.execute(memberInteraction(guild, outsider, 'delete'));

        expect(overwrites.edit).toHaveBeenCalledWith('guild-1', { Connect: false });
        expect(overwrites.edit).toHaveBeenCalledWith('guild-1', { ViewChannel: false });
        expect([temporary.userLimit, temporary.name, temporary.bitrate, temporary.rtcRegion]).toEqual([
            13, 'Focus Room', 80000, 'eu-west'
        ]);
        expect(overwrites.edit).toHaveBeenCalledWith('target-1', { ViewChannel: true, Connect: true });
        expect(target.voice.setChannel).toHaveBeenCalledWith(temporary);
        expect(overwrites.edit).toHaveBeenCalledWith('target-1', { Connect: false });
        expect(target.voice.disconnect).toHaveBeenCalledTimes(1);
        expect(restPut).toHaveBeenCalledWith('/channels/temporary-1/voice-status', { body: { status: 'Working' } });
        expect(rename.showModal).toHaveBeenCalledTimes(1);
        expect(stale.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('stale') }));
        expect(temporary.delete).not.toHaveBeenCalled();
    });

    test('component actions pass through the same command RBAC path as slash commands', async () => {
        const denied = { title: 'Access Denied' };
        const checkUserPermissions = jest.fn(async () => ({ allowed: false, error: denied }));
        jest.doMock('../src/utils/permissions', () => ({ checkUserPermissions }));
        const event = require('../src/events/interactionCreate');
        const handleInteraction = jest.fn();
        const interaction = {
            id: 'component-rbac-1', customId: 'voicemaster:temporary-1:delete', guildId: 'guild-1',
            guild: { id: 'guild-1' }, channelId: 'text-1', user: { id: 'member-1' },
            member: { permissions: { has: () => false }, roles: { cache: new Map() } },
            isButton: () => true, isModalSubmit: () => false, isAutocomplete: () => false,
            isAnySelectMenu: () => false, isStringSelectMenu: () => false,
            reply: jest.fn(async payload => payload)
        };
        const client = {
            commands: new Map([['voicemaster', { data: { name: 'voicemaster' } }]]),
            voiceMasterService: { handleInteraction }
        };

        await event.execute(interaction, client);

        expect(checkUserPermissions).toHaveBeenCalledTimes(1);
        expect(checkUserPermissions.mock.calls[0][0].commandName).toBe('voicemaster');
        expect(checkUserPermissions.mock.calls[0][0].options.getSubcommand()).toBe('delete');
        expect(checkUserPermissions.mock.calls[0][1]).toBe(client.commands.get('voicemaster'));
        expect(handleInteraction).not.toHaveBeenCalled();
        expect(interaction.reply).toHaveBeenCalledWith({ embeds: [denied], flags: [expect.anything()] });
    });

    test('claim atomically transfers control after the persisted owner leaves', async () => {
        const channels = new Map();
        const category = { id: 'category-1', type: ChannelType.GuildCategory, delete: jest.fn() };
        const join = { id: 'join-1', type: ChannelType.GuildVoice, send: jest.fn(async () => ({ id: 'interface-1' })), delete: jest.fn() };
        const temporary = {
            id: 'temporary-1', type: ChannelType.GuildVoice, members: new Map(),
            permissionOverwrites: { edit: jest.fn(async () => {}) },
            send: jest.fn(async () => ({ id: 'controls-1' })), delete: jest.fn(),
            setName: jest.fn(async value => { temporary.name = value; })
        };
        const create = jest.fn(async values => {
            const channel = values.type === ChannelType.GuildCategory
                ? category
                : values.name === 'Join to Create' ? join : temporary;
            channels.set(channel.id, channel);
            return channel;
        });
        const voiceStates = new Map();
        const owner = {
            id: 'owner-1', user: { id: 'owner-1', bot: false, username: 'Owner' }, displayName: 'Owner',
            permissions: { has: () => false }, roles: { cache: new Map() },
            voice: { channelId: 'join-1', channel: join, setChannel: jest.fn(async channel => {
                owner.voice.channelId = channel.id; owner.voice.channel = channel;
                voiceStates.set(owner.id, { channelId: channel.id }); channel.members.set(owner.id, owner);
            }) }
        };
        const claimant = {
            id: 'claimant-1', user: { id: 'claimant-1', bot: false, username: 'Claimant' },
            permissions: { has: () => false }, roles: { cache: new Map() },
            voice: { channelId: 'temporary-1', channel: temporary }
        };
        voiceStates.set(owner.id, { channelId: 'join-1' });
        const guild = {
            id: 'guild-1', name: 'Guild',
            members: { me: { id: 'bot-1', permissions: { has: () => true } } },
            roles: { everyone: { id: 'guild-1' } }, voiceStates: { cache: voiceStates },
            channels: { cache: channels, create, fetch: jest.fn(async id => channels.get(id) || null) }
        };
        const { VoiceMasterService } = require('../src/services/voiceMasterService');
        const service = new VoiceMasterService({ sqlite: database.sqlite, delay: async () => {} });
        await service.execute(interaction(guild, 'setup'));
        await service.handleVoiceState({ channelId: null }, { member: owner, guild, channelId: 'join-1', channel: join, client: {} });
        temporary.members.set(claimant.id, claimant);
        temporary.members.delete(owner.id);
        owner.voice.channelId = null;
        owner.voice.channel = null;
        await service.handleVoiceState(
            { channelId: 'temporary-1', channel: temporary },
            { member: owner, guild, channelId: null, channel: null, client: {} }
        );

        await service.execute(memberInteraction(guild, claimant, 'claim'));
        await service.execute(memberInteraction(guild, claimant, 'rename', { name: 'Claimed Room' }));
        await service.execute(memberInteraction(guild, owner, 'rename', { name: 'Old Owner Room' }));

        expect(temporary.permissionOverwrites.edit).toHaveBeenCalledWith('owner-1', {
            ManageChannels: null, MoveMembers: null
        });
        expect(temporary.permissionOverwrites.edit).toHaveBeenCalledWith('claimant-1', expect.objectContaining({
            ManageChannels: true, MoveMembers: true
        }));
        expect(temporary.name).toBe('Claimed Room');
    });

    test('failed access and claim mutations restore durable state and exact overwrites', async () => {
        const { VoiceMasterService } = require('../src/services/voiceMasterService');
        const service = new VoiceMasterService({ sqlite: database.sqlite });
        const deleteOverwrite = jest.fn(async () => {});
        const accessChannel = {
            id: 'access-1', permissionOverwrites: {
                cache: new Map(), delete: deleteOverwrite,
                edit: jest.fn(async () => { throw new Error('Discord denied access edit'); })
            }
        };
        await expect(service.updateAccess(accessChannel, 'guild-1', 'target-1', 'permit', {
            ViewChannel: true, Connect: true
        })).rejects.toThrow('Discord denied access edit');
        expect(deleteOverwrite).toHaveBeenCalledWith('target-1');
        expect(database.sqlite.prepare('SELECT COUNT(*) count FROM voice_master_access').get().count).toBe(0);

        const none = { has: () => false };
        const previous = {
            id: 'owner-1', allow: { has: bit => bit === PermissionFlagsBits.ManageChannels }, deny: none
        };
        const restoreOld = jest.fn(async () => {});
        const removeNew = jest.fn(async () => {});
        const edit = jest.fn()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('Discord denied new owner'))
            .mockImplementationOnce(restoreOld);
        const channel = {
            id: 'temporary-1', type: ChannelType.GuildVoice,
            members: new Map([['claimant-1', {}]]),
            permissionOverwrites: { cache: new Map([['owner-1', previous]]), edit, delete: removeNew },
            permissionsFor: () => ({ has: () => true })
        };
        const claimant = {
            id: 'claimant-1', user: { id: 'claimant-1' },
            voice: { channelId: channel.id, channel }
        };
        const guild = { id: 'guild-1', members: { me: { permissions: { has: () => true } } } };
        database.sqlite.prepare(`INSERT INTO bytepods
            (channel_id, guild_id, owner_id, original_owner_id, owner_left_at,
             source_channel_id, state, generation, bot_owned, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'active', 3, 1, ?)`).run(
            channel.id, guild.id, 'owner-1', 'owner-1', Date.now(), 'join-1', Date.now()
        );

        await service.execute(memberInteraction(guild, claimant, 'claim'));

        expect(database.sqlite.prepare('SELECT owner_id, state, pending_owner_id FROM bytepods WHERE channel_id = ?')
            .get(channel.id)).toEqual({ owner_id: 'owner-1', state: 'active', pending_owner_id: null });
        expect(restoreOld).toHaveBeenCalled();
        expect(removeNew).toHaveBeenCalledWith('claimant-1');
    });

    test('secondary channels stay user-owned while reset removes only setup resources', async () => {
        const channels = new Map();
        const category = { id: 'category-1', type: ChannelType.GuildCategory, delete: jest.fn(async () => channels.delete('category-1')) };
        const join = {
            id: 'join-1', type: ChannelType.GuildVoice,
            send: jest.fn(async () => ({ id: 'interface-1' })),
            delete: jest.fn(async () => channels.delete('join-1'))
        };
        const secondary = {
            id: 'secondary-1', type: ChannelType.GuildVoice, delete: jest.fn(),
            send: jest.fn(async () => ({ id: 'secondary-interface-1' }))
        };
        const secondaryCategory = { id: 'category-2', type: ChannelType.GuildCategory, children: { cache: new Map() } };
        const create = jest.fn(async values => {
            const channel = values.type === ChannelType.GuildCategory ? category : join;
            channels.set(channel.id, channel);
            return channel;
        });
        channels.set(secondary.id, secondary);
        channels.set(secondaryCategory.id, secondaryCategory);
        const guild = {
            id: 'guild-1', name: 'Guild',
            members: { me: { id: 'bot-1', permissions: { has: () => true } } },
            roles: { everyone: { id: 'guild-1' } },
            channels: { cache: channels, create, fetch: jest.fn(async id => channels.get(id) || null) }
        };
        const { VoiceMasterService } = require('../src/services/voiceMasterService');
        const service = new VoiceMasterService({ sqlite: database.sqlite });
        await service.execute(adminInteraction(guild, 'setup'));
        await service.execute(adminInteraction(guild, 'add', { channel: secondary }, 'secondary'));
        expect(database.sqlite.prepare(`SELECT interface_message_id FROM voice_master_sources
            WHERE channel_id = ?`).get(secondary.id).interface_message_id).toBe('secondary-interface-1');
        await service.execute(adminInteraction(guild, 'category', {
            channel: secondary, category: secondaryCategory
        }, 'secondary'));
        secondaryCategory.children.cache = new Map(Array.from({ length: 50 }, (_, index) => [`voice-${index}`, {}]));
        const fullCategory = await service.execute(adminInteraction(guild, 'category', {
            channel: secondary, category: secondaryCategory
        }, 'secondary'));
        await service.execute(adminInteraction(guild, 'list', {}, 'secondary'));
        await service.execute(adminInteraction(guild, 'remove', { channel: secondary }, 'secondary'));
        await service.execute(adminInteraction(guild, 'reset'));
        await service.execute(adminInteraction(guild, 'reset'));

        expect(secondary.delete).not.toHaveBeenCalled();
        expect(secondary.send).toHaveBeenCalledTimes(1);
        expect(join.delete).toHaveBeenCalledTimes(1);
        expect(category.delete).toHaveBeenCalledTimes(1);
        expect(fullCategory.embeds[0].data.description).toContain('maximum of 50');
    });

    test('default settings and temporary mode drive the next created channel', async () => {
        const channels = new Map();
        const category = { id: 'category-1', type: ChannelType.GuildCategory, delete: jest.fn() };
        const join = { id: 'join-1', type: ChannelType.GuildVoice, send: jest.fn(async () => ({ id: 'interface-1' })), delete: jest.fn() };
        const temporary = {
            id: 'temporary-1', type: ChannelType.GuildVoice, members: new Map(),
            send: jest.fn(async () => ({ id: 'controls-1' })), delete: jest.fn()
        };
        let temporaryOptions;
        const create = jest.fn(async values => {
            const channel = values.type === ChannelType.GuildCategory
                ? category
                : values.name === 'Join to Create' ? join : temporary;
            if (channel === temporary) temporaryOptions = values;
            channels.set(channel.id, channel);
            return channel;
        });
        const visitorRole = { id: 'visitor-role', managed: false, editable: true };
        const joinRole = { id: 'join-role', managed: false, editable: true };
        const voiceStates = new Map();
        const owner = {
            id: 'member-1', user: { id: 'member-1', bot: false, username: 'Member' }, displayName: 'Member',
            permissions: { has: () => false },
            roles: { cache: new Map(), add: jest.fn(async () => {}), remove: jest.fn(async () => {}) },
            voice: { channelId: 'join-1', channel: join, setChannel: jest.fn(async channel => {
                owner.voice.channelId = channel.id; owner.voice.channel = channel;
                voiceStates.set(owner.id, { channelId: channel.id }); channel.members.set(owner.id, owner);
            }) }
        };
        voiceStates.set(owner.id, { channelId: 'join-1' });
        const guild = {
            id: 'guild-1', name: 'Guild', maximumBitrate: 96000,
            members: { me: { id: 'bot-1', permissions: { has: () => true } } },
            roles: { everyone: { id: 'guild-1' } }, voiceStates: { cache: voiceStates },
            channels: { cache: channels, create, fetch: jest.fn(async id => channels.get(id) || null) },
            fetchVoiceRegions: jest.fn(async () => new Map([['eu-west', { id: 'eu-west', deprecated: false }]]))
        };
        const { VoiceMasterService } = require('../src/services/voiceMasterService');
        const service = new VoiceMasterService({ sqlite: database.sqlite, delay: async () => {} });
        await service.execute(adminInteraction(guild, 'setup'));
        await service.execute(adminInteraction(guild, 'template', { template: '{owner} lounge' }));
        await service.execute(adminInteraction(guild, 'temporary', { enabled: false }));
        await service.handleVoiceState({ channelId: null }, { member: owner, guild, channelId: 'join-1', channel: join, client: {} });
        await service.execute(adminInteraction(guild, 'joinrole', { role: joinRole }));
        await service.execute(adminInteraction(guild, 'role', { role: visitorRole }, 'default'));
        await service.execute(adminInteraction(guild, 'bitrate', { bitrate: 80000 }, 'default'));
        await service.execute(adminInteraction(guild, 'region', { region: 'eu-west' }, 'default'));
        await service.execute(adminInteraction(guild, 'interface', { enabled: false }, 'default'));
        await service.execute(adminInteraction(guild, 'temporary', { enabled: true }));
        await service.handleVoiceState({ channelId: null }, { member: owner, guild, channelId: 'join-1', channel: join, client: {} });
        temporary.members.delete(owner.id);
        owner.voice.channelId = null;
        owner.voice.channel = null;
        await service.handleVoiceState(
            { channelId: 'temporary-1', channel: temporary },
            { member: owner, guild, channelId: null, channel: null, client: {} }
        );

        expect(create).toHaveBeenCalledTimes(3);
        expect(temporaryOptions).toEqual(expect.objectContaining({
            name: 'Member lounge', bitrate: 80000, rtcRegion: 'eu-west'
        }));
        expect(temporaryOptions.permissionOverwrites).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'visitor-role', allow: expect.arrayContaining([PermissionFlagsBits.Connect]) })
        ]));
        expect(temporary.send).not.toHaveBeenCalled();
        expect(owner.roles.add).toHaveBeenCalledWith('join-role', 'VoiceMaster channel joined');
        expect(owner.roles.remove).toHaveBeenCalledWith('join-role', 'VoiceMaster channel left');
    });

    test('restart reconciliation reports ambiguous and missing channels without deleting them', async () => {
        const channels = new Map();
        const category = { id: 'category-1', type: ChannelType.GuildCategory, delete: jest.fn() };
        const join = { id: 'join-1', type: ChannelType.GuildVoice, send: jest.fn(async () => ({ id: 'interface-1' })), delete: jest.fn() };
        const temporary = {
            id: 'temporary-1', type: ChannelType.GuildVoice, members: new Map(),
            send: jest.fn(async () => ({ id: 'controls-1' })), delete: jest.fn()
        };
        const create = jest.fn(async values => {
            const channel = values.type === ChannelType.GuildCategory
                ? category
                : values.name === 'Join to Create' ? join : temporary;
            channels.set(channel.id, channel);
            return channel;
        });
        const voiceStates = new Map();
        const owner = {
            id: 'member-1', user: { id: 'member-1', bot: false, username: 'Member' }, displayName: 'Member',
            roles: { add: jest.fn(async () => {}), remove: jest.fn(async () => {}) },
            voice: { channelId: 'join-1', setChannel: jest.fn(async channel => {
                owner.voice.channelId = channel.id; owner.voice.channel = channel;
                voiceStates.set(owner.id, { channelId: channel.id }); channel.members.set(owner.id, owner);
            }) }
        };
        voiceStates.set(owner.id, { channelId: 'join-1' });
        const guild = {
            id: 'guild-1', name: 'Guild',
            members: { me: { id: 'bot-1', permissions: { has: () => true } } },
            roles: { everyone: { id: 'guild-1' } }, voiceStates: { cache: voiceStates },
            channels: { cache: channels, create, fetch: jest.fn(async id => channels.get(id) || null) }
        };
        const client = { guilds: { fetch: jest.fn(async () => guild) } };
        const { VoiceMasterService } = require('../src/services/voiceMasterService');
        const service = new VoiceMasterService({ client, sqlite: database.sqlite, delay: async () => {} });
        await service.execute(adminInteraction(guild, 'setup'));
        await service.handleVoiceState({ channelId: null }, { member: owner, guild, channelId: 'join-1', channel: join, client });

        temporary.type = ChannelType.GuildText;
        temporary.members.clear();
        const ambiguous = await new VoiceMasterService({ client, sqlite: database.sqlite }).reconcile();
        channels.delete(temporary.id);
        const missing = await new VoiceMasterService({ client, sqlite: database.sqlite }).reconcile();

        expect(ambiguous.ambiguous).toBe(1);
        expect(missing.lost).toBe(1);
        expect(temporary.delete).not.toHaveBeenCalled();
    });

    test('restart recovery removes exact interrupted resources and pending creations', async () => {
        const category = { id: 'category-1', type: ChannelType.GuildCategory, delete: jest.fn(async () => {}) };
        const join = { id: 'join-1', type: ChannelType.GuildVoice, delete: jest.fn(async () => {}) };
        const temporary = { id: 'temporary-1', type: ChannelType.GuildVoice, delete: jest.fn(async () => {}) };
        const channels = new Map([[category.id, category], [join.id, join], [temporary.id, temporary]]);
        const guild = {
            id: 'guild-1',
            channels: { cache: channels, fetch: jest.fn(async id => channels.get(id) || null) }
        };
        database.sqlite.prepare(`INSERT INTO voice_master_configs
            (guild_id, state, generation, category_id, primary_channel_id, interface_message_id, updated_at)
            VALUES (?, 'creating', 4, ?, ?, ?, ?)`).run(guild.id, category.id, join.id, 'message-1', Date.now());
        database.sqlite.prepare(`INSERT INTO voice_master_creations
            (guild_id, source_channel_id, member_id, channel_id, state, generation, updated_at)
            VALUES (?, ?, ?, ?, 'pending', 2, ?)`).run(guild.id, join.id, 'member-1', temporary.id, Date.now());
        const { VoiceMasterService } = require('../src/services/voiceMasterService');
        const result = await new VoiceMasterService({
            client: { guilds: { fetch: jest.fn(async () => guild) } }, sqlite: database.sqlite
        }).reconcile();

        expect(result.failures).toEqual([]);
        expect(join.delete).toHaveBeenCalledTimes(1);
        expect(category.delete).toHaveBeenCalledTimes(1);
        expect(temporary.delete).toHaveBeenCalledTimes(1);
        expect(database.sqlite.prepare('SELECT COUNT(*) count FROM voice_master_configs').get().count).toBe(0);
        expect(database.sqlite.prepare('SELECT state, channel_id FROM voice_master_creations').get())
            .toEqual({ state: 'failed', channel_id: null });
    });

    test('owner return cancels claims and failed role removals remain retryable', async () => {
        const { VoiceMasterService } = require('../src/services/voiceMasterService');
        const service = new VoiceMasterService({ sqlite: database.sqlite });
        const guild = { id: 'guild-1' };
        const owner = { id: 'owner-1', roles: { remove: jest.fn(async () => { throw new Error('Discord unavailable'); }) } };
        database.sqlite.prepare(`INSERT INTO bytepods
            (channel_id, guild_id, owner_id, original_owner_id, owner_left_at, source_channel_id,
             state, generation, bot_owned, pending_owner_id, claim_snapshot, created_at)
            VALUES ('temporary-1', 'guild-1', 'owner-1', 'owner-1', 1, 'join-1',
                'claiming', 3, 1, 'claimant-1', '{}', 1)`).run();
        database.sqlite.prepare(`INSERT INTO voice_master_join_roles
            (guild_id, channel_id, member_id, role_id, added_by_bot, updated_at)
            VALUES ('guild-1', 'temporary-1', 'owner-1', 'join-role', 1, 1)`).run();

        await service.handleOwnerReturn(guild, owner, 'temporary-1');
        await service.removeJoinRoleAfterExit(guild, owner, 'temporary-1', null);

        expect(database.sqlite.prepare('SELECT state, generation FROM bytepods WHERE channel_id = ?')
            .get('temporary-1')).toEqual({ state: 'claim_cancelled', generation: 4 });
        expect(() => service.assertClaim('guild-1', 'temporary-1', {
            owner_id: 'owner-1', generation: 3
        }, 'claimant-1')).toThrow('owner returned');
        expect(database.sqlite.prepare('SELECT role_id FROM voice_master_join_roles WHERE channel_id = ?')
            .get('temporary-1').role_id).toBe('join-role');
    });

    test('access updates serialize per member and keep the newest durable effect', async () => {
        let releaseFirst;
        let firstStarted;
        const firstEdit = new Promise(resolve => { releaseFirst = resolve; });
        const started = new Promise(resolve => { firstStarted = resolve; });
        const edit = jest.fn()
            .mockImplementationOnce(async () => { firstStarted(); return firstEdit; })
            .mockResolvedValueOnce(undefined);
        const channel = {
            id: 'temporary-1',
            permissionOverwrites: { cache: new Map(), edit, delete: jest.fn(async () => {}) }
        };
        const { VoiceMasterService } = require('../src/services/voiceMasterService');
        const service = new VoiceMasterService({ sqlite: database.sqlite });

        const permit = service.updateAccess(channel, 'guild-1', 'member-1', 'permit', {
            ViewChannel: true, Connect: true
        });
        const reject = service.updateAccess(channel, 'guild-1', 'member-1', 'reject', { Connect: false });
        await started;
        expect(edit).toHaveBeenCalledTimes(1);
        releaseFirst();
        await Promise.all([permit, reject]);

        expect(edit.mock.calls.map(([, permissions]) => permissions)).toEqual([
            { ViewChannel: true, Connect: true }, { Connect: false }
        ]);
        expect(database.sqlite.prepare(`SELECT effect, state, generation FROM voice_master_access
            WHERE guild_id = ? AND channel_id = ? AND user_id = ?`)
            .get('guild-1', channel.id, 'member-1')).toEqual({ effect: 'reject', state: 'active', generation: 2 });
    });

    test('startup access recovery shares the live permit and reject lock', async () => {
        let releaseRecovery;
        let recoveryStarted;
        const gate = new Promise(resolve => { releaseRecovery = resolve; });
        const started = new Promise(resolve => { recoveryStarted = resolve; });
        const edit = jest.fn()
            .mockImplementationOnce(async () => { recoveryStarted(); await gate; })
            .mockResolvedValueOnce(undefined);
        const channel = {
            id: 'temporary-1', type: ChannelType.GuildVoice,
            permissionOverwrites: { cache: new Map(), edit, delete: jest.fn(async () => {}) }
        };
        const guild = {
            id: 'guild-1', channels: { cache: new Map([[channel.id, channel]]), fetch: jest.fn(async () => channel) }
        };
        database.sqlite.prepare(`INSERT INTO bytepods
            (channel_id, guild_id, owner_id, original_owner_id, source_channel_id,
             state, generation, bot_owned, created_at)
            VALUES ('temporary-1', 'guild-1', 'owner-1', 'owner-1', 'join-1', 'active', 1, 1, 1)`).run();
        database.sqlite.prepare(`INSERT INTO voice_master_access
            (guild_id, channel_id, user_id, effect, state, generation, updated_at)
            VALUES ('guild-1', 'temporary-1', 'member-1', 'permit', 'pending', 1, 1)`).run();
        const { VoiceMasterService } = require('../src/services/voiceMasterService');
        const service = new VoiceMasterService({
            client: { guilds: { fetch: jest.fn(async () => guild) } }, sqlite: database.sqlite
        });
        const result = { failures: [] };

        const recovery = service.reconcilePendingOperations(result);
        await started;
        const reject = service.updateAccess(channel, guild.id, 'member-1', 'reject', { Connect: false });
        expect(edit).toHaveBeenCalledTimes(1);
        releaseRecovery();
        await Promise.all([recovery, reject]);

        expect(result.failures).toEqual([]);
        expect(edit.mock.calls.map(([, permissions]) => permissions)).toEqual([
            { ViewChannel: true, Connect: true }, { Connect: false }
        ]);
        expect(database.sqlite.prepare('SELECT effect, state, generation FROM voice_master_access').get())
            .toEqual({ effect: 'reject', state: 'active', generation: 2 });
    });

    test('secondary reservations enforce the server limit before Discord sends', async () => {
        database.sqlite.prepare(`INSERT INTO voice_master_configs
            (guild_id, state, generation, updated_at) VALUES ('guild-1', 'active', 1, 1)`).run();
        const insert = database.sqlite.prepare(`INSERT INTO voice_master_sources
            (channel_id, guild_id, state, is_primary, owned, created_at)
            VALUES (?, 'guild-1', ?, 0, 0, 1)`);
        for (let index = 0; index < 24; index++) insert.run(`existing-${index}`, 'active');
        insert.run('deleted-secondary', 'lost');
        const first = {
            id: 'secondary-a', type: ChannelType.GuildVoice,
            send: jest.fn(async () => ({ id: 'message-a' }))
        };
        const second = {
            id: 'secondary-b', type: ChannelType.GuildVoice,
            send: jest.fn(async () => ({ id: 'message-b' }))
        };
        const guild = { id: 'guild-1', channels: { cache: new Map([[first.id, first], [second.id, second]]) } };
        const { VoiceMasterService } = require('../src/services/voiceMasterService');
        const service = new VoiceMasterService({ sqlite: database.sqlite });

        await Promise.all([
            service.execute(adminInteraction(guild, 'add', { channel: first }, 'secondary')),
            service.execute(adminInteraction(guild, 'add', { channel: second }, 'secondary'))
        ]);

        expect(first.send.mock.calls.length + second.send.mock.calls.length).toBe(1);
        expect(database.sqlite.prepare(`SELECT COUNT(*) count FROM voice_master_sources
            WHERE guild_id = ? AND is_primary = 0 AND state IN ('pending','active')`).get(guild.id).count).toBe(25);
    });

    test('preexisting join roles survive exits and reset delete events do not fail resetting config', async () => {
        const remove = jest.fn(async () => {});
        const member = { id: 'member-1', roles: { cache: new Map([['join-role', {}]]), remove } };
        const guild = { id: 'guild-1' };
        database.sqlite.prepare(`INSERT INTO voice_master_configs
            (guild_id, state, generation, join_role_id, updated_at)
            VALUES ('guild-1', 'resetting', 2, 'join-role', 1)`).run();
        database.sqlite.prepare(`INSERT INTO voice_master_sources
            (channel_id, guild_id, state, is_primary, owned, created_at)
            VALUES ('join-1', 'guild-1', 'active', 1, 1, 1)`).run();
        database.sqlite.prepare(`INSERT INTO bytepods
            (channel_id, guild_id, owner_id, original_owner_id, source_channel_id,
             state, generation, bot_owned, created_at)
            VALUES ('temporary-1', 'guild-1', 'member-1', 'member-1', 'join-1', 'active', 1, 1, 1)`).run();
        const { VoiceMasterService } = require('../src/services/voiceMasterService');
        const service = new VoiceMasterService({ sqlite: database.sqlite });

        await service.grantJoinRole(guild, member, 'temporary-1', 'join-role');
        await service.removeJoinRoleAfterExit(guild, member, 'temporary-1', null);
        service.handleChannelDelete({ guildId: guild.id, id: 'join-1' });

        expect(remove).not.toHaveBeenCalled();
        expect(database.sqlite.prepare('SELECT state FROM voice_master_configs WHERE guild_id = ?')
            .get(guild.id).state).toBe('resetting');
    });

    test('active join-role records restore a role removed outside VoiceMaster', async () => {
        const add = jest.fn(async () => {});
        const member = { id: 'member-1', roles: { cache: new Map(), add, remove: jest.fn(async () => {}) } };
        database.sqlite.prepare(`INSERT INTO voice_master_join_roles
            (guild_id, channel_id, member_id, role_id, state, added_by_bot, updated_at)
            VALUES ('guild-1', 'temporary-1', 'member-1', 'join-role', 'active', 1, 1)`).run();
        const { VoiceMasterService } = require('../src/services/voiceMasterService');

        await new VoiceMasterService({ sqlite: database.sqlite })
            .grantJoinRole({ id: 'guild-1' }, member, 'temporary-1', 'join-role');

        expect(add).toHaveBeenCalledWith('join-role', 'VoiceMaster channel joined');
        expect(database.sqlite.prepare(`SELECT state, added_by_bot FROM voice_master_join_roles
            WHERE guild_id = 'guild-1' AND channel_id = 'temporary-1' AND member_id = 'member-1'`).get())
            .toEqual({ state: 'active', added_by_bot: 1 });
    });

    test('join-role exits wait for an in-flight grant before revoking it', async () => {
        let releaseAdd;
        let addStarted;
        const gate = new Promise(resolve => { releaseAdd = resolve; });
        const started = new Promise(resolve => { addStarted = resolve; });
        const member = {
            id: 'member-1',
            roles: {
                cache: new Map(),
                add: jest.fn(async () => { addStarted(); await gate; }),
                remove: jest.fn(async () => {})
            }
        };
        database.sqlite.prepare(`INSERT INTO bytepods
            (channel_id, guild_id, owner_id, original_owner_id, source_channel_id,
             state, generation, bot_owned, created_at)
            VALUES ('temporary-1', 'guild-1', 'member-1', 'member-1', 'join-1', 'active', 1, 1, 1)`).run();
        const { VoiceMasterService } = require('../src/services/voiceMasterService');
        const service = new VoiceMasterService({ sqlite: database.sqlite });
        const guild = { id: 'guild-1' };

        const grant = service.grantJoinRole(guild, member, 'temporary-1', 'join-role');
        await started;
        const exit = service.removeJoinRoleAfterExit(guild, member, 'temporary-1', null);
        expect(member.roles.remove).not.toHaveBeenCalled();
        releaseAdd();
        await Promise.all([grant, exit]);

        expect(member.roles.remove).toHaveBeenCalledWith('join-role', 'VoiceMaster channel left');
        expect(database.sqlite.prepare('SELECT COUNT(*) count FROM voice_master_join_roles').get().count).toBe(0);
    });

    test('scheduled creation cleanup retries transient deletion without losing the channel id', async () => {
        const channel = {
            id: 'orphan-1', type: ChannelType.GuildVoice,
            delete: jest.fn().mockRejectedValueOnce(new Error('Discord unavailable')).mockResolvedValueOnce(undefined)
        };
        const guild = {
            id: 'guild-1',
            channels: { cache: new Map([[channel.id, channel]]), fetch: jest.fn(async () => channel) }
        };
        database.sqlite.prepare(`INSERT INTO voice_master_creations
            (guild_id, source_channel_id, member_id, channel_id, state, generation, updated_at)
            VALUES ('guild-1', 'join-1', 'member-1', 'orphan-1', 'pending', 1, 1)`).run();
        const { VoiceMasterService } = require('../src/services/voiceMasterService');
        const service = new VoiceMasterService({
            client: { guilds: { fetch: jest.fn(async () => guild) } }, sqlite: database.sqlite
        });

        await service.retryScheduledCleanup();
        expect(database.sqlite.prepare('SELECT state, channel_id FROM voice_master_creations').get())
            .toEqual({ state: 'pending', channel_id: 'orphan-1' });
        await service.retryScheduledCleanup();

        expect(channel.delete).toHaveBeenCalledTimes(2);
        expect(database.sqlite.prepare('SELECT state, channel_id FROM voice_master_creations').get())
            .toEqual({ state: 'failed', channel_id: null });
    });

    test('pending recovery refuses ambiguous creation and access channels', async () => {
        const edit = jest.fn(async () => {});
        const channel = {
            id: 'reused-1', guildId: 'guild-1', type: ChannelType.GuildText,
            delete: jest.fn(async () => {}), permissionOverwrites: { edit }
        };
        const guild = {
            id: 'guild-1',
            channels: { cache: new Map([[channel.id, channel]]), fetch: jest.fn(async () => channel) }
        };
        database.sqlite.prepare(`INSERT INTO voice_master_creations
            (guild_id, source_channel_id, member_id, channel_id, state, generation, updated_at)
            VALUES ('guild-1', 'join-1', 'member-1', 'reused-1', 'pending', 1, 1)`).run();
        database.sqlite.prepare(`INSERT INTO bytepods
            (channel_id, guild_id, owner_id, original_owner_id, source_channel_id,
             state, generation, bot_owned, created_at)
            VALUES ('reused-1', 'guild-1', 'owner-1', 'owner-1', 'join-1', 'active', 1, 1, 1)`).run();
        database.sqlite.prepare(`INSERT INTO voice_master_access
            (guild_id, channel_id, user_id, effect, state, generation, updated_at)
            VALUES ('guild-1', 'reused-1', 'member-1', 'permit', 'pending', 1, 1)`).run();
        const { VoiceMasterService } = require('../src/services/voiceMasterService');
        const service = new VoiceMasterService({
            client: { guilds: { fetch: jest.fn(async () => guild) } }, sqlite: database.sqlite
        });
        const result = { failures: [] };

        await service.reconcilePendingCreations(result);
        await service.reconcilePendingOperations(result);

        expect(channel.delete).not.toHaveBeenCalled();
        expect(edit).not.toHaveBeenCalled();
        expect(result.failures).toHaveLength(2);
        expect(database.sqlite.prepare('SELECT state FROM voice_master_creations').get().state).toBe('pending');
        expect(database.sqlite.prepare('SELECT state FROM voice_master_access').get().state).toBe('pending');
    });

    test('scheduled cleanup rechecks membership immediately before deletion', async () => {
        const channel = {
            id: 'temporary-1', type: ChannelType.GuildVoice, members: new Map(),
            delete: jest.fn(async () => {})
        };
        const guild = {
            id: 'guild-1', channels: { cache: new Map([[channel.id, channel]]) },
            members: { cache: new Map(), fetch: jest.fn(async () => null) }
        };
        database.sqlite.prepare(`INSERT INTO bytepods
            (channel_id, guild_id, owner_id, original_owner_id, source_channel_id,
             state, generation, cleanup_after, bot_owned, created_at)
            VALUES ('temporary-1', 'guild-1', 'owner-1', 'owner-1', 'join-1', 'active', 1, 1, 1, 1)`).run();
        const { VoiceMasterService } = require('../src/services/voiceMasterService');
        const service = new VoiceMasterService({
            client: { guilds: { fetch: jest.fn(async () => guild) } }, sqlite: database.sqlite, now: () => 10
        });
        service.revokeChannelJoinRoles = jest.fn(async () => channel.members.set('member-1', {}));

        await service.retryScheduledCleanup();

        expect(channel.delete).not.toHaveBeenCalled();
        expect(database.sqlite.prepare('SELECT state, cleanup_after FROM bytepods').get())
            .toEqual({ state: 'active', cleanup_after: null });
    });

    test('scheduled cleanup retries one exact empty owned channel', async () => {
        const channel = {
            id: 'temporary-1', type: ChannelType.GuildVoice, members: new Map(),
            delete: jest.fn(async () => {})
        };
        const guild = {
            id: 'guild-1', members: { cache: new Map(), fetch: jest.fn(async () => null) },
            channels: { cache: new Map([[channel.id, channel]]), fetch: jest.fn(async () => channel) }
        };
        database.sqlite.prepare(`INSERT INTO bytepods
            (channel_id, guild_id, owner_id, original_owner_id, source_channel_id,
             state, generation, cleanup_after, bot_owned, created_at)
            VALUES (?, ?, ?, ?, ?, 'active', 2, 1, 1, 1)`)
            .run(channel.id, guild.id, 'owner-1', 'owner-1', 'join-1');
        const { VoiceMasterService } = require('../src/services/voiceMasterService');
        const service = new VoiceMasterService({
            client: { guilds: { fetch: jest.fn(async () => guild) } }, sqlite: database.sqlite, now: () => 10
        });

        await service.retryScheduledCleanup();

        expect(channel.delete).toHaveBeenCalledTimes(1);
        expect(database.sqlite.prepare('SELECT COUNT(*) count FROM bytepods').get().count).toBe(0);
    });
});
