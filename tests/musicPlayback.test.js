const { ApplicationCommandOptionType, ChannelType } = require('discord.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { PermissionFlagsBits } = require('discord.js');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

function fakeVoice() {
    const player = new EventEmitter();
    player.state = { status: 'idle' };
    player.play = jest.fn(resource => { player.state = { status: 'playing', resource }; });
    player.pause = jest.fn(() => { player.state.status = 'paused'; return true; });
    player.unpause = jest.fn(() => { player.state.status = 'playing'; return true; });
    player.stop = jest.fn(() => { player.state.status = 'idle'; return true; });
    const connection = new EventEmitter();
    connection.subscribe = jest.fn(() => ({}));
    connection.destroy = jest.fn();
    const volume = { setVolume: jest.fn() };
    return {
        adapter: {
            AudioPlayerStatus: { Idle: 'idle', Playing: 'playing', Paused: 'paused' },
            NoSubscriberBehavior: { Pause: 'pause' }, StreamType: { Raw: 'raw' },
            VoiceConnectionStatus: { Ready: 'ready', Disconnected: 'disconnected', Connecting: 'connecting', Signalling: 'signalling' },
            createAudioPlayer: jest.fn(() => player),
            createAudioResource: jest.fn((stream, options) => ({ playStream: stream, metadata: options.metadata, volume })),
            joinVoiceChannel: jest.fn(() => connection), entersState: jest.fn(async () => connection)
        },
        player, connection, volume
    };
}

function fakeSpawn() {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = jest.fn();
    process.nextTick(() => child.emit('spawn'));
    return child;
}

function option(command, name) {
    return command.options.find(item => item.name === name);
}

describe('music playback', () => {
    let libraryRoot;

    beforeEach(() => {
        libraryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-music-'));
        fs.writeFileSync(path.join(libraryRoot, 'one.mp3'), 'one');
        fs.writeFileSync(path.join(libraryRoot, 'two.ogg'), 'two');
        fs.writeFileSync(path.join(libraryRoot, 'music.json'), JSON.stringify({
            tracks: [
                { id: 'one', title: 'First Song', author: 'Artist', durationSeconds: 120,
                    file: 'one.mp3', url: 'https://music.example/one', related: ['two'] },
                { id: 'two', title: 'Second Song', author: 'Artist', durationSeconds: 90, file: 'two.ogg' }
            ],
            playlists: { favourites: ['one', 'two'] }
        }));
    });

    afterEach(() => fs.rmSync(libraryRoot, { recursive: true, force: true }));

    test('registers the frozen music hub and public bounds', () => {
        const command = require('../src/commands/music/music').data.toJSON();

        expect(command).toMatchObject({ name: 'music', dm_permission: false });
        expect(command.options.map(item => item.name)).toEqual([
            'play', 'queue', 'pause', 'resume', 'skip', 'stop', 'volume', 'preset', 'settings'
        ]);
        expect(option(option(command, 'play'), 'query')).toMatchObject({
            type: ApplicationCommandOptionType.String, required: true, max_length: 2048
        });
        expect(option(option(command, 'volume'), 'volume')).toMatchObject({ min_value: 0, max_value: 200 });
        expect(option(option(command, 'preset'), 'name').choices.map(choice => choice.value)).toEqual([
            'soft', '8d', 'chipmunk', 'boost', 'vaporwave', 'vibrato',
            'piano', 'metal', 'flat', 'karaoke', 'nightcore'
        ]);
        expect(option(command, 'settings').options.map(item => item.name)).toEqual(['dj', 'autoplay']);
    });

    test('resolves bounded local tracks, exact URL aliases, playlists, and related tracks', () => {
        const { MusicLibrary } = require('../src/services/musicService');
        const library = new MusicLibrary(libraryRoot);

        expect(library.resolve('first').tracks.map(track => track.id)).toEqual(['one']);
        expect(library.resolve('https://music.example/one').tracks.map(track => track.id)).toEqual(['one']);
        expect(library.resolve('favourites').tracks.map(track => track.id)).toEqual(['one', 'two']);
        expect(library.related('one').map(track => track.id)).toEqual(['two']);
        expect(library.resolve('https://unknown.example/song').tracks).toEqual([]);
        expect(library.resolve(`https://unknown.example/${'x'.repeat(300)}`).tracks).toEqual([]);
        expect(() => library.resolve('x'.repeat(201))).toThrow('200');
    });

    test('rejects library files that escape the configured root', () => {
        const { MusicLibrary } = require('../src/services/musicService');
        const outside = `${libraryRoot}-outside.mp3`;
        fs.writeFileSync(outside, 'outside');
        fs.writeFileSync(path.join(libraryRoot, 'music.json'), JSON.stringify({ tracks: [{
            id: 'escape', title: 'Escape', author: 'Artist', durationSeconds: 1,
            file: `../${path.basename(outside)}`
        }] }));

        expect(() => new MusicLibrary(libraryRoot)).toThrow('escapes');
        fs.rmSync(outside);
    });

    test('revalidates a library file immediately before playback', () => {
        const { MusicLibrary } = require('../src/services/musicService');
        const library = new MusicLibrary(libraryRoot);
        const track = library.resolve('one').tracks[0];
        const outside = `${libraryRoot}-swapped.mp3`;
        fs.writeFileSync(outside, 'outside');
        fs.rmSync(track.file);
        fs.symlinkSync(outside, track.file);

        expect(() => library.validate(track)).toThrow('changed');
        fs.rmSync(outside);
    });

    test('persists DJ and universal autoplay settings only for Manage Server members', async () => {
        const { MusicLibrary, MusicService } = require('../src/services/musicService');
        const sqlite = new Database(':memory:');
        sqlite.exec(`CREATE TABLE music_config (
            guild_id TEXT PRIMARY KEY,
            dj_role_id TEXT,
            autoplay INTEGER NOT NULL DEFAULT 0
        )`);
        const service = new MusicService({ library: new MusicLibrary(libraryRoot), sqlite });
        const reply = jest.fn();
        const interaction = {
            guild: { id: 'guild1', roles: { cache: new Map([['dj1', { id: 'dj1' }]]) } },
            member: { permissions: { has: permission => permission === PermissionFlagsBits.ManageGuild } },
            options: {
                getSubcommandGroup: () => 'settings', getSubcommand: () => 'dj',
                getRole: () => ({ id: 'dj1', guild: { id: 'guild1' } }), getString: () => null
            },
            reply
        };

        await service.execute(interaction);
        interaction.options.getSubcommand = () => 'autoplay';
        interaction.options.getString = () => 'enable';
        await service.execute(interaction);

        expect(sqlite.prepare('SELECT * FROM music_config').get()).toEqual({
            guild_id: 'guild1', dj_role_id: 'dj1', autoplay: 1
        });
        expect(reply).toHaveBeenCalledTimes(2);
        sqlite.close();
    });

    test('plays a real library track and queues the next track inside one guild', async () => {
        const { MusicLibrary, MusicService } = require('../src/services/musicService');
        const sqlite = new Database(':memory:');
        sqlite.exec('CREATE TABLE music_config (guild_id TEXT PRIMARY KEY, dj_role_id TEXT, autoplay INTEGER NOT NULL DEFAULT 0)');
        const voice = fakeVoice();
        const spawn = jest.fn(fakeSpawn);
        const channel = {
            id: 'voice1', guild: null, type: ChannelType.GuildVoice, userLimit: 0,
            members: new Map([['user1', { user: { bot: false } }]]),
            permissionsFor: () => ({ has: () => true })
        };
        const guild = {
            id: 'guild1', voiceAdapterCreator: {}, ownerId: 'owner',
            members: { me: { id: 'bot1' } }, channels: { cache: new Map([['voice1', channel]]) }
        };
        channel.guild = guild;
        const interaction = query => ({
            guild, user: { id: 'user1' }, member: { voice: { channel, channelId: channel.id }, roles: { cache: new Map() }, permissions: { has: () => false } },
            channelId: 'text1', options: {
                getSubcommandGroup: () => null, getSubcommand: () => 'play', getString: () => query
            }, reply: jest.fn()
        });
        const service = new MusicService({ library: new MusicLibrary(libraryRoot), sqlite, voice: voice.adapter, spawn });
        const first = interaction('one');
        const second = interaction('two');
        const oversized = interaction('x'.repeat(201));

        await Promise.all([service.execute(first), service.execute(second)]);
        await service.execute(oversized);
        channel.type = ChannelType.GuildStageVoice;
        const stage = interaction('one');
        await service.execute(stage);
        channel.type = ChannelType.GuildVoice;
        for (let index = 0; index < 24; index++) await service.execute(interaction('two'));
        const full = interaction('two');
        await service.execute(full);

        expect(voice.adapter.joinVoiceChannel).toHaveBeenCalledTimes(1);
        expect(spawn).toHaveBeenCalledTimes(1);
        expect(voice.player.play).toHaveBeenCalledTimes(1);
        expect(first.reply.mock.calls[0][0].embeds[0].data.description).toContain('First Song');
        expect(second.reply.mock.calls[0][0].embeds[0].data.description).toContain('position 1');
        expect(oversized.reply.mock.calls[0][0].embeds[0].data.description).toContain('200');
        expect(stage.reply.mock.calls[0][0].embeds[0].data.description).toContain('standard server voice');
        expect(full.reply.mock.calls[0][0].embeds[0].data.description).toContain('25');
        await service.cleanup();
        sqlite.close();
    });

    test('enforces the configured DJ role across playback controls', async () => {
        const { MusicLibrary, MusicService } = require('../src/services/musicService');
        const sqlite = new Database(':memory:');
        sqlite.exec(`CREATE TABLE music_config (guild_id TEXT PRIMARY KEY, dj_role_id TEXT, autoplay INTEGER NOT NULL DEFAULT 0);
            INSERT INTO music_config VALUES ('guild1', 'dj1', 0)`);
        const voice = fakeVoice();
        const spawn = jest.fn(fakeSpawn);
        const channel = { id: 'voice1', type: ChannelType.GuildVoice, userLimit: 0, members: new Map(), permissionsFor: () => ({ has: () => true }) };
        const guild = { id: 'guild1', voiceAdapterCreator: {}, ownerId: 'owner', members: { me: { id: 'bot1' } }, channels: { cache: new Map([['voice1', channel]]) } };
        channel.guild = guild;
        const roles = new Map();
        const interaction = (subcommand, value = null) => ({
            guild, user: { id: 'user1' }, member: { voice: { channel, channelId: channel.id }, roles: { cache: roles }, permissions: { has: () => false } },
            channelId: 'text1', options: {
                getSubcommandGroup: () => null, getSubcommand: () => subcommand,
                getString: name => name === 'query' ? value : (name === 'name' ? value : null),
                getInteger: () => value
            }, reply: jest.fn()
        });
        channel.members.set('user1', interaction('play').member);
        const service = new MusicService({ library: new MusicLibrary(libraryRoot), sqlite, voice: voice.adapter, spawn });
        await service.execute(interaction('play', 'one'));
        await service.execute(interaction('play', 'two'));

        const denied = interaction('pause');
        await service.execute(denied);
        expect(voice.player.pause).not.toHaveBeenCalled();
        expect(denied.reply.mock.calls[0][0].embeds[0].data.description).toContain('DJ role');

        roles.set('dj1', {});
        await service.execute(interaction('pause'));
        await service.execute(interaction('resume'));
        await service.execute(interaction('volume', 150));
        const skipped = interaction('skip');
        await service.execute(skipped);
        await service.execute(interaction('preset', '8d'));
        await service.execute(interaction('stop'));

        expect(voice.player.pause).toHaveBeenCalledTimes(1);
        expect(voice.player.unpause).toHaveBeenCalledTimes(1);
        expect(voice.volume.setVolume).toHaveBeenLastCalledWith(1.5);
        expect(skipped.reply.mock.calls[0][0].embeds[0].data.description).toContain('Second Song');
        expect(spawn).toHaveBeenCalledTimes(3);
        expect(spawn.mock.calls[2][1]).toEqual(expect.arrayContaining(['-af', expect.stringContaining('apulsator')]));
        expect(voice.connection.destroy).toHaveBeenCalledTimes(1);
        sqlite.close();
    });

    test('autoplay advances only to curated related tracks and exposes the queue state', async () => {
        const { MusicLibrary, MusicService } = require('../src/services/musicService');
        const sqlite = new Database(':memory:');
        sqlite.exec(`CREATE TABLE music_config (guild_id TEXT PRIMARY KEY, dj_role_id TEXT, autoplay INTEGER NOT NULL DEFAULT 0);
            INSERT INTO music_config VALUES ('guild1', NULL, 1)`);
        const voice = fakeVoice();
        const channel = { id: 'voice1', type: ChannelType.GuildVoice, userLimit: 0, members: new Map(), permissionsFor: () => ({ has: () => true }) };
        const guild = { id: 'guild1', voiceAdapterCreator: {}, ownerId: 'owner', members: { me: { id: 'bot1' } }, channels: { cache: new Map([['voice1', channel]]) } };
        const member = { user: { bot: false }, voice: { channel, channelId: channel.id }, roles: { cache: new Map() }, permissions: { has: () => false } };
        channel.members.set('user1', member);
        const interaction = (subcommand, query = null) => ({
            guild, user: { id: 'user1' }, member, channelId: 'text1',
            options: { getSubcommandGroup: () => null, getSubcommand: () => subcommand, getString: () => query },
            reply: jest.fn()
        });
        const spawn = jest.fn(fakeSpawn);
        const service = new MusicService({ library: new MusicLibrary(libraryRoot), sqlite, voice: voice.adapter, spawn });
        await service.execute(interaction('play', 'one'));

        voice.player.emit('idle');
        await new Promise(resolve => setImmediate(resolve));
        const queue = interaction('queue');
        await service.execute(queue);

        expect(spawn).toHaveBeenCalledTimes(2);
        expect(queue.reply.mock.calls[0][0].embeds[0].data.description).toContain('Second Song');
        await service.cleanup();
        sqlite.close();
    });

    test('disconnects five minutes after playback is idle and the voice channel empties', async () => {
        const { MusicLibrary, MusicService } = require('../src/services/musicService');
        const sqlite = new Database(':memory:');
        sqlite.exec('CREATE TABLE music_config (guild_id TEXT PRIMARY KEY, dj_role_id TEXT, autoplay INTEGER NOT NULL DEFAULT 0)');
        const voice = fakeVoice();
        const channel = { id: 'voice1', type: ChannelType.GuildVoice, userLimit: 0, members: new Map(), permissionsFor: () => ({ has: () => true }) };
        const guild = { id: 'guild1', voiceAdapterCreator: {}, ownerId: 'owner', members: { me: { id: 'bot1' } }, channels: { cache: new Map([['voice1', channel]]) } };
        const member = { user: { bot: false }, voice: { channel, channelId: channel.id }, roles: { cache: new Map() }, permissions: { has: () => false } };
        channel.members.set('user1', member);
        const play = {
            guild, user: { id: 'user1' }, member, channelId: 'text1',
            options: { getSubcommandGroup: () => null, getSubcommand: () => 'play', getString: () => 'two' }, reply: jest.fn()
        };
        const service = new MusicService({ library: new MusicLibrary(libraryRoot), sqlite, voice: voice.adapter, spawn: fakeSpawn });
        await service.execute(play);
        voice.player.emit('idle');
        await new Promise(resolve => setImmediate(resolve));

        jest.useFakeTimers();
        channel.members.clear();
        service.handleVoiceStateUpdate({ guild, channelId: 'voice1' }, { guild, channelId: null });
        jest.advanceTimersByTime(5 * 60 * 1000 - 1);
        expect(voice.connection.destroy).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(voice.connection.destroy).toHaveBeenCalledTimes(1);
        jest.useRealTimers();
        sqlite.close();
    });

    test('keeps players and queues isolated between guilds', async () => {
        const { MusicLibrary, MusicService } = require('../src/services/musicService');
        const sqlite = new Database(':memory:');
        sqlite.exec('CREATE TABLE music_config (guild_id TEXT PRIMARY KEY, dj_role_id TEXT, autoplay INTEGER NOT NULL DEFAULT 0)');
        const firstVoice = fakeVoice();
        const secondVoice = fakeVoice();
        const voiceByGuild = new Map([['guild1', firstVoice], ['guild2', secondVoice]]);
        let creatingFor;
        const adapter = {
            ...firstVoice.adapter,
            joinVoiceChannel: jest.fn(options => { creatingFor = options.guildId; return voiceByGuild.get(options.guildId).connection; }),
            createAudioPlayer: jest.fn(() => voiceByGuild.get(creatingFor).player),
            createAudioResource: jest.fn((stream, options) => ({
                playStream: stream, metadata: options.metadata, volume: { setVolume: jest.fn() }
            })),
            entersState: jest.fn(async connection => connection)
        };
        const makeInteraction = guildId => {
            const channel = { id: `voice-${guildId}`, type: ChannelType.GuildVoice, userLimit: 0, members: new Map(), permissionsFor: () => ({ has: () => true }) };
            const guild = { id: guildId, voiceAdapterCreator: {}, ownerId: 'owner', members: { me: { id: 'bot1' } }, channels: { cache: new Map([[channel.id, channel]]) } };
            const member = { user: { bot: false }, voice: { channel, channelId: channel.id }, roles: { cache: new Map() }, permissions: { has: () => false } };
            channel.guild = guild;
            channel.members.set('user1', member);
            return { guild, user: { id: 'user1' }, member, channelId: 'text1', options: {
                getSubcommandGroup: () => null, getSubcommand: () => 'play', getString: () => 'one'
            }, reply: jest.fn() };
        };
        const service = new MusicService({ library: new MusicLibrary(libraryRoot), sqlite, voice: adapter, spawn: fakeSpawn });

        await service.execute(makeInteraction('guild1'));
        await service.execute(makeInteraction('guild2'));

        expect(adapter.joinVoiceChannel).toHaveBeenCalledTimes(2);
        expect(firstVoice.player.play).toHaveBeenCalledTimes(1);
        expect(secondVoice.player.play).toHaveBeenCalledTimes(1);
        await service.cleanup();
        sqlite.close();
    });
});
