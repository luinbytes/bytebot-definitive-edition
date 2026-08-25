const fs = require('node:fs');
const path = require('node:path');
const { spawn: spawnProcess, spawnSync } = require('node:child_process');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { eq } = require('drizzle-orm');
const { musicConfig } = require('../database/schema');
const embeds = require('../utils/embeds');
const logger = require('../utils/logger');

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_TRACK_BYTES = 64 * 1024 * 1024;
const MAX_TRACKS = 500;
const MAX_PLAYLISTS = 100;
const MAX_QUEUE = 25;
const AUDIO_EXTENSIONS = new Set(['.aac', '.flac', '.m4a', '.mp3', '.ogg', '.opus', '.wav', '.webm']);
const PRESET_FILTERS = {
    soft: 'volume=0.75,lowpass=f=12000',
    '8d': 'apulsator=hz=0.09',
    chipmunk: 'asetrate=48000*1.25,aresample=48000,atempo=0.8',
    boost: 'volume=1.5',
    vaporwave: 'asetrate=48000*0.8,aresample=48000,atempo=1.25',
    vibrato: 'vibrato=f=6.5:d=0.5',
    piano: 'equalizer=f=1000:t=q:w=1:g=3,equalizer=f=3000:t=q:w=1:g=2',
    metal: 'acompressor=threshold=0.25:ratio=4:attack=5:release=50,volume=1.2',
    flat: 'anull',
    karaoke: 'pan=stereo|c0=c0-c1|c1=c1-c0',
    nightcore: 'asetrate=48000*1.25,aresample=48000'
};
const PRESET_NAMES = Object.freeze(Object.keys(PRESET_FILTERS));
const AUDIO_CODECS = new Set(['aac', 'alac', 'flac', 'mp3', 'opus', 'vorbis']);

function probeAudio(file, ffprobe = process.env.FFPROBE_PATH || 'ffprobe') {
    return new Promise((resolve, reject) => {
        const child = spawnProcess(ffprobe, [
            '-v', 'error', '-select_streams', 'a:0',
            '-show_entries', 'stream=codec_name:format=duration', '-of', 'json', file
        ], { stdio: ['ignore', 'pipe', 'ignore'] });
        let output = '';
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error('Audio validation exceeded five seconds.'));
        }, 5000);
        timer.unref?.();
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', chunk => {
            output += chunk;
            if (output.length > 64 * 1024) {
                child.kill('SIGKILL');
                reject(new Error('Audio validation output exceeded 64 KiB.'));
            }
        });
        child.once('error', error => {
            clearTimeout(timer);
            reject(new Error(`FFprobe could not start: ${error.message}`));
        });
        child.once('close', code => {
            clearTimeout(timer);
            if (code !== 0) return reject(new Error('The configured file is not readable audio.'));
            try {
                const result = JSON.parse(output);
                resolve({ codec: result.streams?.[0]?.codec_name, durationSeconds: Number(result.format?.duration) });
            } catch {
                reject(new Error('FFprobe returned invalid audio metadata.'));
            }
        });
    });
}

async function stopProcess(child) {
    if (!child || child.exitCode != null) return;
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('FFmpeg did not stop within one second.')), 1000);
        timer.unref?.();
        child.once('close', () => { clearTimeout(timer); resolve(); });
        child.kill('SIGKILL');
    });
}

function boundedString(value, label, max = 200) {
    if (typeof value !== 'string' || !value.trim() || value.length > max) {
        throw new Error(`${label} must be between 1 and ${max} characters.`);
    }
    return value.trim();
}

class MusicLibrary {
    constructor(root) {
        if (!root) throw new Error('MUSIC_LIBRARY_PATH is not configured.');
        this.root = fs.realpathSync(root);
        const manifestPath = path.join(this.root, 'music.json');
        const manifestStat = fs.statSync(manifestPath);
        if (!manifestStat.isFile() || manifestStat.size > MAX_MANIFEST_BYTES) {
            throw new Error('Music manifest must be a file no larger than 1 MiB.');
        }
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (!Array.isArray(manifest.tracks) || manifest.tracks.length > MAX_TRACKS) {
            throw new Error(`Music manifest must contain at most ${MAX_TRACKS} tracks.`);
        }

        this.tracks = new Map();
        this.urls = new Map();
        for (const input of manifest.tracks) {
            const id = boundedString(input.id, 'Track ID', 100);
            if (this.tracks.has(id)) throw new Error(`Duplicate music track ID: ${id}`);
            const relativeFile = boundedString(input.file, 'Track file', 500);
            const file = fs.realpathSync(path.resolve(this.root, relativeFile));
            if (file !== this.root && !file.startsWith(`${this.root}${path.sep}`)) {
                throw new Error(`Track ${id} escapes the music library root.`);
            }
            if (!AUDIO_EXTENSIONS.has(path.extname(file).toLowerCase())) {
                throw new Error(`Track ${id} uses an unsupported audio format.`);
            }
            const stat = fs.statSync(file);
            if (!stat.isFile() || stat.size > MAX_TRACK_BYTES) {
                throw new Error(`Track ${id} must be a file no larger than 64 MiB.`);
            }
            if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0 || input.durationSeconds > 600) {
                throw new Error(`Track ${id} duration must be between 1 and 600 seconds.`);
            }
            const related = input.related ?? [];
            if (!Array.isArray(related) || related.length > MAX_QUEUE) {
                throw new Error(`Track ${id} may declare at most ${MAX_QUEUE} related tracks.`);
            }
            const track = Object.freeze({
                id,
                title: boundedString(input.title, 'Track title'),
                author: boundedString(input.author, 'Track author'),
                durationSeconds: input.durationSeconds,
                file,
                related: related.map(value => boundedString(value, 'Related track ID', 100)),
                url: input.url || null
            });
            if (track.url) {
                if (track.url.length > 2048 || new URL(track.url).protocol !== 'https:' || this.urls.has(track.url)) {
                    throw new Error(`Track ${id} has an invalid or duplicate HTTPS URL alias.`);
                }
                this.urls.set(track.url, track);
            }
            this.tracks.set(id, track);
        }

        for (const track of this.tracks.values()) {
            if (track.related.some(id => !this.tracks.has(id))) {
                throw new Error(`Track ${track.id} references an unknown related track.`);
            }
        }

        const playlists = manifest.playlists ?? {};
        if (!playlists || Array.isArray(playlists) || typeof playlists !== 'object'
            || Object.keys(playlists).length > MAX_PLAYLISTS) {
            throw new Error(`Music manifest may contain at most ${MAX_PLAYLISTS} playlists.`);
        }
        this.playlists = new Map();
        for (const [rawName, ids] of Object.entries(playlists)) {
            const name = boundedString(rawName, 'Playlist name', 100).toLowerCase();
            if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_QUEUE
                || ids.some(id => !this.tracks.has(id))) {
                throw new Error(`Playlist ${rawName} must contain 1 to ${MAX_QUEUE} known track IDs.`);
            }
            if (this.playlists.has(name)) throw new Error(`Duplicate music playlist: ${rawName}`);
            this.playlists.set(name, Object.freeze(ids.map(id => this.tracks.get(id))));
        }
    }

    resolve(input) {
        if (typeof input !== 'string' || !input.trim()) throw new Error('Music query is required.');
        const raw = input.trim();
        if (raw.startsWith('http://') || raw.startsWith('https://')) {
            const url = boundedString(raw, 'Music URL', 2048);
            return { tracks: this.urls.has(url) ? [this.urls.get(url)] : [], kind: 'track' };
        }
        const query = boundedString(raw, 'Music query');
        const normalized = query.toLowerCase();
        const playlist = this.playlists.get(normalized);
        if (playlist) return { tracks: [...playlist], kind: 'playlist' };
        const exact = this.tracks.get(query) || [...this.tracks.values()].find(track => track.id.toLowerCase() === normalized);
        const track = exact || [...this.tracks.values()].find(candidate =>
            candidate.title.toLowerCase().includes(normalized) || candidate.author.toLowerCase().includes(normalized));
        return { tracks: track ? [track] : [], kind: 'track' };
    }

    related(trackId) {
        const track = this.tracks.get(trackId);
        return track ? track.related.map(id => this.tracks.get(id)) : [];
    }

    validate(track) {
        if (!track || this.tracks.get(track.id) !== track) throw new Error('Unknown music track.');
        const file = fs.realpathSync(track.file);
        if (file !== track.file || (file !== this.root && !file.startsWith(`${this.root}${path.sep}`))) {
            throw new Error(`Track ${track.id} changed or escaped the music library root.`);
        }
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size > MAX_TRACK_BYTES) {
            throw new Error(`Track ${track.id} changed or exceeds 64 MiB.`);
        }
        if (!Number.isFinite(track.durationSeconds) || track.durationSeconds <= 0 || track.durationSeconds > 600) {
            throw new Error(`Track ${track.id} changed or exceeds 600 seconds.`);
        }
        return file;
    }
}

class MusicService {
    constructor({ library, db, voice = null, spawn = spawnProcess, probe = (track, file) => probeAudio(file) }) {
        this.library = library;
        this.db = db;
        this.voice = voice;
        this.spawn = spawn;
        this.probe = probe;
        this.players = new Map();
        this.pendingConnections = new Map();
        this.removedGuilds = new Set();
        this.generations = new Map();
        this.operations = new Map();
        this.pendingCounts = new Map();
        this.closing = false;
    }

    static checkRuntime(ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg', ffprobe = process.env.FFPROBE_PATH || 'ffprobe') {
        require.resolve('@discordjs/voice');
        require.resolve('opusscript');
        for (const [name, executable] of [['FFmpeg', ffmpeg], ['FFprobe', ffprobe]]) {
            const result = spawnSync(executable, ['-version'], { stdio: 'ignore', timeout: 5000 });
            if (result.error || result.status !== 0) {
                throw new Error(`Music requires ${name} on PATH and it must start within five seconds.`);
            }
        }
    }

    reply(interaction, embed) {
        const payload = {
            embeds: [embed], allowedMentions: { parse: [] }
        };
        if (interaction.deferred) {
            return interaction.editReply(payload);
        }
        return interaction.reply(payload);
    }

    async defer(interaction) {
        if (!interaction.deferred && !interaction.replied && interaction.deferReply) {
            await interaction.deferReply({});
        }
    }

    async execute(interaction) {
        const guildId = interaction.guild.id;
        if (this.closing || this.removedGuilds.has(guildId)) {
            return this.reply(interaction, embeds.error('Music Unavailable', 'The music service is shutting down.'));
        }
        const generation = this.generations.get(guildId) || 0;
        const pending = this.pendingCounts.get(guildId) || 0;
        if (pending >= MAX_QUEUE) return this.reply(interaction, embeds.error('Music Busy', 'Too many music requests are already pending.'));
        this.pendingCounts.set(guildId, pending + 1);
        let operation;
        try {
            const previous = this.operations.get(guildId) || Promise.resolve();
            const deferred = this.operations.has(guildId)
                ? this.defer(interaction)
                : Promise.resolve();
            operation = previous.catch(() => {}).then(() => deferred).then(() => this.executeOnce(interaction, generation));
            this.operations.set(guildId, operation);
            return await operation;
        } finally {
            if (operation && this.operations.get(guildId) === operation) this.operations.delete(guildId);
            const remaining = (this.pendingCounts.get(guildId) || 1) - 1;
            if (remaining) this.pendingCounts.set(guildId, remaining);
            else this.pendingCounts.delete(guildId);
        }
    }

    async executeOnce(interaction, generation) {
        this.assertActive(interaction.guild.id, generation);
        const group = interaction.options.getSubcommandGroup(false);
        const subcommand = interaction.options.getSubcommand();
        if (group !== 'settings') {
            if (subcommand === 'play') return this.play(interaction, generation);
            if (subcommand === 'queue') return this.queue(interaction);
            if (subcommand === 'pause') return this.pause(interaction);
            if (subcommand === 'resume') return this.resume(interaction);
            if (subcommand === 'skip') return this.skip(interaction);
            if (subcommand === 'volume') return this.volume(interaction);
            if (subcommand === 'preset') return this.preset(interaction);
            if (subcommand === 'stop') return this.stop(interaction);
            return this.reply(interaction, embeds.error('Music Error', 'There is no music playing.'));
        }
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return this.reply(interaction, embeds.error('Access Denied', 'You need Manage Server to configure music.'));
        }

        if (subcommand === 'dj') {
            const role = interaction.options.getRole('role');
            if (!role || role.guild?.id !== interaction.guild.id || !interaction.guild.roles.cache.has(role.id)) {
                return this.reply(interaction, embeds.error('Invalid Role', 'Choose a role from this server.'));
            }
            this.assertActive(interaction.guild.id, generation);
            this.db.insert(musicConfig).values({ guildId: interaction.guild.id, djRoleId: role.id })
                .onConflictDoUpdate({ target: musicConfig.guildId, set: { djRoleId: role.id } }).run();
            return this.reply(interaction, embeds.success('DJ Role Set', `${role} is now the DJ role.`));
        }

        const state = interaction.options.getString('state');
        const enabled = ['on', 'enable', 'true'].includes(state);
        if (!enabled && !['off', 'disable', 'false'].includes(state)) {
            return this.reply(interaction, embeds.error('Invalid State', 'Use on, off, enable, disable, true, or false.'));
        }
        this.assertActive(interaction.guild.id, generation);
        this.db.insert(musicConfig).values({ guildId: interaction.guild.id, autoplay: enabled })
            .onConflictDoUpdate({ target: musicConfig.guildId, set: { autoplay: enabled } }).run();
        return this.reply(interaction, embeds.success('Autoplay Updated', `Autoplay is now **${enabled ? 'enabled' : 'disabled'}**.`));
    }

    async controlledState(interaction) {
        const state = this.players.get(interaction.guild.id);
        if (!state || !state.current) {
            await this.reply(interaction, embeds.error('No Player', 'There is no music playing.'));
            return null;
        }
        if (interaction.member.voice?.channelId !== state.channelId) {
            await this.reply(interaction, embeds.error('Different Voice Channel', 'Join my voice channel to control music.'));
            return null;
        }
        const config = this.db.select().from(musicConfig).where(eq(musicConfig.guildId, interaction.guild.id)).get();
        const bypass = interaction.guild.ownerId === interaction.user.id
            || interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        if (config?.djRoleId && !bypass && !interaction.member.roles.cache.has(config.djRoleId)) {
            await this.reply(interaction, embeds.error('DJ Required', 'You need the configured DJ role to use this control.'));
            return null;
        }
        return state;
    }

    async pause(interaction) {
        const state = await this.controlledState(interaction);
        if (!state) return;
        const voice = this.voiceAdapter();
        if (state.player.state.status === voice.AudioPlayerStatus.Paused) {
            return this.reply(interaction, embeds.error('Already Paused', 'The player is already paused.'));
        }
        if (!state.player.pause()) return this.reply(interaction, embeds.error('Pause Failed', 'The player could not be paused.'));
        this.scheduleIdle(state);
        return this.reply(interaction, embeds.success('Paused', 'Paused the player.'), false);
    }

    async resume(interaction) {
        const state = await this.controlledState(interaction);
        if (!state) return;
        const voice = this.voiceAdapter();
        if (state.player.state.status !== voice.AudioPlayerStatus.Paused) {
            return this.reply(interaction, embeds.error('Not Paused', 'The player is not paused.'));
        }
        if (!state.player.unpause()) return this.reply(interaction, embeds.error('Resume Failed', 'The player could not be resumed.'));
        if (state.idleTimer) clearTimeout(state.idleTimer);
        state.idleTimer = null;
        return this.reply(interaction, embeds.success('Resumed', 'Resumed the player.'), false);
    }

    async volume(interaction) {
        const state = await this.controlledState(interaction);
        if (!state) return;
        const volume = interaction.options.getInteger('volume');
        if (volume == null) return this.reply(interaction, embeds.brand('Music Volume', `Current volume: **${state.volume}%**.`), false);
        if (!Number.isInteger(volume) || volume < 0 || volume > 200) {
            return this.reply(interaction, embeds.error('Invalid Volume', 'Volume must be between 0 and 200.'));
        }
        state.volume = volume;
        state.player.state.resource?.volume?.setVolume(volume / 100);
        return this.reply(interaction, embeds.success('Volume Set', `Set the volume to **${volume}%**.`), false);
    }

    async preset(interaction) {
        const state = await this.controlledState(interaction);
        if (!state) return;
        const name = interaction.options.getString('name');
        if (!Object.hasOwn(PRESET_FILTERS, name)) return this.reply(interaction, embeds.error('Unknown Preset', 'That audio preset is not supported.'));
        const enabled = state.preset !== name;
        state.preset = enabled ? name : null;
        const track = state.current;
        await this.defer(interaction);
        state.suppressIdle = true;
        state.player.stop(true);
        const process = state.process;
        state.process = null;
        try {
            await stopProcess(process);
            state.current = null;
            await this.startTrack(state, track);
        } catch (error) {
            this.destroy(interaction.guild.id, state);
            return this.reply(interaction, embeds.error('Preset Failed', error.message));
        } finally {
            state.suppressIdle = false;
        }
        return this.reply(interaction, embeds.success(
            enabled ? 'Preset Enabled' : 'Preset Disabled', `${enabled ? 'Enabled' : 'Disabled'} **${name}** preset. The current track restarted.`
        ), false);
    }

    async stop(interaction) {
        const state = await this.controlledState(interaction);
        if (!state) return;
        this.destroy(interaction.guild.id);
        return this.reply(interaction, embeds.success('Stopped', 'Stopped the player and disconnected.'), false);
    }

    async skip(interaction) {
        const state = await this.controlledState(interaction);
        if (!state) return;
        state.suppressIdle = true;
        state.player.stop(true);
        try {
            await this.advance(state);
        } catch (error) {
            this.destroy(interaction.guild.id, state);
            return this.reply(interaction, embeds.error('Skip Failed', error.message));
        }
        state.suppressIdle = false;
        const description = state.current
            ? `Skipped the current track. Now playing **${state.current.title}** by **${state.current.author}** (${this.duration(state.current.durationSeconds)}).`
            : 'Skipped the current track.';
        return this.reply(interaction, embeds.success('Skipped', description), false);
    }

    async queue(interaction) {
        const state = this.players.get(interaction.guild.id);
        if (!state || !state.current) return this.reply(interaction, embeds.error('No Player', 'There is no music playing.'));
        const lines = [
            '**Now Playing**',
            `**${state.current.title}** by **${state.current.author}** [${this.duration(state.current.durationSeconds)}]`,
            '',
            '**Queue**'
        ];
        if (state.queue.length === 0) lines.push('The queue is empty.');
        for (const [index, track] of state.queue.entries()) {
            const line = `${index + 1}. **${track.title}** — ${track.author} [${this.duration(track.durationSeconds)}]`;
            if ([...lines, line].join('\n').length > 3800) {
                lines.push(`…and ${state.queue.length - index} more.`);
                break;
            }
            lines.push(line);
        }
        return this.reply(interaction, embeds.brand('Music Queue', lines.join('\n')), false);
    }

    voiceAdapter() {
        if (!this.voice) this.voice = require('@discordjs/voice');
        return this.voice;
    }

    async play(interaction, generation) {
        const channel = interaction.member.voice?.channel;
        if (!channel) return this.reply(interaction, embeds.error('Not In Voice', 'You must be in a voice channel to play music.'));
        if (channel.type !== ChannelType.GuildVoice) {
            return this.reply(interaction, embeds.error('Unsupported Voice Channel', 'Music playback requires a standard server voice channel.'));
        }
        let result;
        try {
            result = this.library.resolve(interaction.options.getString('query'));
        } catch (error) {
            return this.reply(interaction, embeds.error('Invalid Query', error.message));
        }
        if (result.tracks.length === 0) return this.reply(interaction, embeds.error('No Results', 'No configured library track matches that query or URL.'));

        let state = this.players.get(interaction.guild.id);
        if (state && state.channelId !== channel.id) {
            return this.reply(interaction, embeds.error('Different Voice Channel', 'Join my current voice channel to add music.'));
        }
        const available = MAX_QUEUE - (state?.queue.length || 0);
        const queuedCount = state?.current ? result.tracks.length : Math.max(0, result.tracks.length - 1);
        if (queuedCount > available) return this.reply(interaction, embeds.error('Queue Full', `The queue can hold at most ${MAX_QUEUE} tracks.`));

        await this.defer(interaction);
        try {
            for (const track of result.tracks) {
                await this.validateTrack(track);
                this.assertActive(interaction.guild.id, generation);
            }
        } catch (error) {
            return this.reply(interaction, embeds.error('Invalid Track', error.message));
        }

        if (!state) {
            try {
                state = await this.createPlayer(interaction.guild, channel, generation);
            } catch (error) {
                return this.reply(interaction, embeds.error('Playback Failed', error.message));
            }
        }
        if (state.current) {
            state.queue.push(...result.tracks);
            const firstPosition = state.queue.length - result.tracks.length + 1;
            const description = result.tracks.length === 1
                ? `Added **${result.tracks[0].title}** by **${result.tracks[0].author}** to the queue at position ${firstPosition}.`
                : `Added **${result.tracks.length} tracks** to the queue starting at position ${firstPosition}.`;
            return this.reply(interaction, embeds.success('Queued', description), false);
        }

        const [track, ...queued] = result.tracks;
        state.queue.push(...queued);
        try {
            await this.startTrack(state, track);
        } catch (error) {
            this.destroy(interaction.guild.id, state);
            return this.reply(interaction, embeds.error('Playback Failed', error.message));
        }
        return this.reply(interaction, embeds.success(
            'Now Playing', `**${track.title}** by **${track.author}** [${this.duration(track.durationSeconds)}]`
        ), false);
    }

    async createPlayer(guild, channel, generation) {
        this.assertActive(guild.id, generation);
        const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak];
        if (!channel.permissionsFor(guild.members.me).has(required)) {
            throw new Error('I need View Channel, Connect, and Speak in your voice channel.');
        }
        if (channel.userLimit > 0 && channel.members.size >= channel.userLimit && !channel.members.has(guild.members.me.id)) {
            throw new Error('That voice channel is full.');
        }
        const voice = this.voiceAdapter();
        const connection = voice.joinVoiceChannel({
            channelId: channel.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator
        });
        this.pendingConnections.set(guild.id, connection);
        try {
            await voice.entersState(connection, voice.VoiceConnectionStatus.Ready, 15000);
        } catch {
            connection.destroy();
            throw new Error('Could not establish a voice connection within 15 seconds.');
        } finally {
            if (this.pendingConnections.get(guild.id) === connection) this.pendingConnections.delete(guild.id);
        }
        try {
            this.assertActive(guild.id, generation);
        } catch (error) {
            connection.destroy();
            throw error;
        }
        const player = voice.createAudioPlayer({ behaviors: { noSubscriber: voice.NoSubscriberBehavior.Pause } });
        if (!connection.subscribe(player)) {
            connection.destroy();
            throw new Error('Could not attach the audio player to the voice connection.');
        }
        const state = {
            guild, channelId: channel.id, connection, player, current: null, queue: [],
            volume: 100, preset: null, process: null, idleTimer: null, suppressIdle: false,
            recent: [], advancing: null, generation
        };
        player.on('error', error => {
            logger.error(`Music playback failed in guild ${guild.id}: ${error.message}`);
            this.advance(state).catch(nextError => {
                logger.error(`Music queue advance failed in guild ${guild.id}: ${nextError.message}`);
                this.destroy(guild.id, state);
            });
        });
        player.on(voice.AudioPlayerStatus.Idle, () => {
            if (!state.suppressIdle && state.current) {
                this.advance(state).catch(error => {
                    logger.error(`Music queue advance failed in guild ${guild.id}: ${error.message}`);
                    this.destroy(guild.id, state);
                });
            }
        });
        connection.on(voice.VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    voice.entersState(connection, voice.VoiceConnectionStatus.Signalling, 5000),
                    voice.entersState(connection, voice.VoiceConnectionStatus.Connecting, 5000)
                ]);
            } catch {
                this.destroy(guild.id, state);
            }
        });
        this.players.set(guild.id, state);
        return state;
    }

    async startTrack(state, track) {
        this.assertActive(state.guild.id, state.generation);
        const voice = this.voiceAdapter();
        const file = await this.validateTrack(track);
        this.assertActive(state.guild.id, state.generation);
        const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', file, '-vn', '-t', String(track.durationSeconds)];
        if (state.preset) args.push('-af', PRESET_FILTERS[state.preset]);
        args.push('-ac', '2', '-ar', '48000', '-f', 's16le', 'pipe:1');
        const child = this.spawn(process.env.FFMPEG_PATH || 'ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        state.process = child;
        child.once('close', () => {
            if (state.process === child) state.process = null;
        });
        try {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('FFmpeg did not start within 5 seconds.')), 5000);
                timer.unref?.();
                child.once('spawn', () => { clearTimeout(timer); resolve(); });
                child.once('error', error => { clearTimeout(timer); reject(new Error(`FFmpeg could not start: ${error.message}`)); });
            });
        } catch (error) {
            if (state.process === child) state.process = null;
            child.kill('SIGKILL');
            throw error;
        }
        child.stderr.resume();
        try {
            this.assertActive(state.guild.id, state.generation);
        } catch (error) {
            await stopProcess(child);
            throw error;
        }
        if (state.idleTimer) clearTimeout(state.idleTimer);
        state.idleTimer = null;
        state.current = track;
        if (state.recent.at(-1) !== track.id) state.recent.push(track.id);
        if (state.recent.length > MAX_QUEUE) state.recent.shift();
        const resource = voice.createAudioResource(child.stdout, {
            inputType: voice.StreamType.Raw, inlineVolume: true, metadata: { track }
        });
        resource.volume.setVolume(state.volume / 100);
        state.player.play(resource);
    }

    async advance(state) {
        if (state.advancing) return state.advancing;
        state.advancing = this.advanceOnce(state).finally(() => { state.advancing = null; });
        return state.advancing;
    }

    async advanceOnce(state) {
        const finished = state.current;
        const process = state.process;
        state.process = null;
        await stopProcess(process);
        state.current = null;
        let next = state.queue.shift();
        const config = this.db.select().from(musicConfig).where(eq(musicConfig.guildId, state.guild.id)).get();
        if (!next && finished && config?.autoplay) {
            next = this.library.related(finished.id).find(track => !state.recent.includes(track.id));
        }
        if (next) await this.startTrack(state, next);
        else this.scheduleIdle(state);
    }

    scheduleIdle(state) {
        if (!this.isIdle(state) || state.idleTimer) return;
        const channel = state.guild.channels.cache.get(state.channelId);
        const listeners = [...(channel?.members?.values?.() || [])].filter(member => !member.user?.bot);
        if (listeners.length > 0) return;
        state.idleTimer = setTimeout(() => {
            state.idleTimer = null;
            const current = this.players.get(state.guild.id);
            const currentChannel = state.guild.channels.cache.get(state.channelId);
            const humans = [...(currentChannel?.members?.values?.() || [])].filter(member => !member.user?.bot);
            if (current === state && this.isIdle(state) && humans.length === 0) {
                this.destroy(state.guild.id, state);
            }
        }, 5 * 60 * 1000);
        state.idleTimer.unref?.();
    }

    handleVoiceStateUpdate(oldState, newState) {
        const guild = newState.guild || oldState.guild;
        const state = guild && this.players.get(guild.id);
        if (!state || (oldState.channelId !== state.channelId && newState.channelId !== state.channelId)) return;
        const channel = guild.channels.cache.get(state.channelId);
        const listeners = [...(channel?.members?.values?.() || [])].filter(member => !member.user?.bot);
        if (listeners.length > 0 || !this.isIdle(state)) {
            if (state.idleTimer) clearTimeout(state.idleTimer);
            state.idleTimer = null;
            return;
        }
        this.scheduleIdle(state);
    }

    isIdle(state) {
        const voice = this.voiceAdapter();
        const status = state.player.state.status;
        return status === voice.AudioPlayerStatus.Paused
            || (voice.AudioPlayerStatus.AutoPaused && status === voice.AudioPlayerStatus.AutoPaused)
            || (!state.current && state.queue.length === 0);
    }

    duration(seconds) {
        return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
    }

    async validateTrack(track) {
        const file = this.library.validate(track);
        const result = await this.probe(track, file);
        const codec = result?.codec;
        const actual = result?.durationSeconds;
        if ((!AUDIO_CODECS.has(codec) && !codec?.startsWith('pcm_')) || !Number.isFinite(actual) || actual <= 0) {
            throw new Error(`Track ${track.id} is not supported audio.`);
        }
        if (actual > 600 || Math.abs(actual - track.durationSeconds) > 2) {
            throw new Error(`Track ${track.id} duration does not match its manifest or exceeds 600 seconds.`);
        }
        return file;
    }

    assertActive(guildId, generation) {
        if (this.closing || this.removedGuilds.has(guildId) || (this.generations.get(guildId) || 0) !== generation) {
            throw new Error('Music playback was cancelled.');
        }
    }

    destroy(guildId, expectedState = null) {
        const state = this.players.get(guildId);
        if (expectedState && state !== expectedState) return;
        this.pendingConnections.get(guildId)?.destroy();
        this.pendingConnections.delete(guildId);
        if (!state) return;
        if (state.idleTimer) clearTimeout(state.idleTimer);
        state.process?.kill('SIGKILL');
        state.suppressIdle = true;
        state.player.stop(true);
        state.connection.destroy();
        this.players.delete(guildId);
    }

    async purgeGuild(guildId) {
        this.generations.set(guildId, (this.generations.get(guildId) || 0) + 1);
        this.removedGuilds.add(guildId);
        this.destroy(guildId);
        const operation = this.operations.get(guildId);
        if (operation) await Promise.race([
            operation.catch(() => {}),
            new Promise(resolve => { const timer = setTimeout(resolve, 5000); timer.unref?.(); })
        ]);
        this.destroy(guildId);
    }

    reactivateGuild(guildId) {
        this.generations.set(guildId, (this.generations.get(guildId) || 0) + 1);
        this.removedGuilds.delete(guildId);
    }

    async cleanup() {
        this.closing = true;
        for (const guildId of [...this.players.keys()]) this.destroy(guildId);
        for (const guildId of [...this.pendingConnections.keys()]) this.destroy(guildId);
        await Promise.race([
            Promise.allSettled([...this.operations.values()]),
            new Promise(resolve => { const timer = setTimeout(resolve, 5000); timer.unref?.(); })
        ]);
        for (const guildId of [...this.players.keys()]) this.destroy(guildId);
    }
}

module.exports = { MAX_QUEUE, PRESET_NAMES, MusicLibrary, MusicService };
