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
        const category = { id: 'category-1', type: ChannelType.GuildCategory, delete: jest.fn() };
        const join = { id: 'join-1', type: ChannelType.GuildVoice, send: jest.fn(async () => ({ id: 'interface-1' })), delete: jest.fn() };
        const overwrites = { edit: jest.fn(async () => {}) };
        const temporary = {
            id: 'temporary-1', type: ChannelType.GuildVoice, name: "Member's channel", members: new Map(),
            bitrate: 64000, rtcRegion: null, userLimit: 0, permissionOverwrites: overwrites,
            send: jest.fn(async () => ({ id: 'controls-1' })), delete: jest.fn(),
            setUserLimit: jest.fn(async value => { temporary.userLimit = value; }),
            setName: jest.fn(async value => { temporary.name = value; }),
            setBitrate: jest.fn(async value => { temporary.bitrate = value; }),
            setRTCRegion: jest.fn(async value => { temporary.rtcRegion = value; }),
            setStatus: jest.fn(async value => { temporary.status = value; })
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
        voiceStates.set(owner.id, { channelId: 'join-1' });
        const guild = {
            id: 'guild-1', name: 'Guild', maximumBitrate: 96000,
            members: { me: { id: 'bot-1', permissions: { has: () => true } } },
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
        await service.execute(memberInteraction(guild, outsider, 'delete'));

        expect(overwrites.edit).toHaveBeenCalledWith('guild-1', { Connect: false });
        expect(overwrites.edit).toHaveBeenCalledWith('guild-1', { ViewChannel: false });
        expect([temporary.userLimit, temporary.name, temporary.bitrate, temporary.rtcRegion]).toEqual([
            12, 'Focus Room', 80000, 'eu-west'
        ]);
        expect(temporary.delete).not.toHaveBeenCalled();
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
});
