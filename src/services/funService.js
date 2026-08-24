const axios = require('axios');
const { randomInt, randomUUID } = require('crypto');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    PermissionFlagsBits
} = require('discord.js');
const embeds = require('../utils/embeds');

const ROLEPLAY_ACTIONS = Object.freeze([
    'slap', 'hug', 'kiss', 'pat', 'tickle', 'feed', 'punch', 'highfive', 'bite', 'shoot',
    'wave', 'happy', 'peck', 'lurk', 'sleep', 'wink', 'yawn', 'nom', 'yeet', 'think',
    'bored', 'blush', 'stare', 'nod', 'handhold', 'smug', 'shrug', 'poke', 'smile',
    'facepalm', 'cuddle', 'baka', 'angry', 'run', 'nope', 'handshake', 'cry', 'pout',
    'thumbsup', 'laugh'
]);
const POLICY_EXCLUDED_ROLEPLAY = Object.freeze(['fuck', 'spank', 'nutkick']);
const VAPE_FLAVORS = Object.freeze(['mint', 'berry', 'mango', 'vanilla', 'watermelon']);
const SNIPE_LIMIT = 10;
const SNIPE_TTL_MS = 15 * 60 * 1000;
const BLUNT_ACTIVE_MS = 5 * 60 * 1000;
const BLUNT_COOLDOWN_MS = 10 * 60 * 1000;
const ROLEPLAY_GUILD_LIMIT = 20;
const ROLEPLAY_GUILD_WINDOW_MS = 10 * 1000;
const USER_AGENT = 'ByteBot (https://github.com/luinbytes/bytebot-definitive-edition)';
const WORDS = Object.freeze([
    'adventure', 'airplane', 'another', 'beautiful', 'because', 'birthday', 'building', 'careful',
    'channel', 'computer', 'country', 'discord', 'elephant', 'everyone', 'favorite', 'festival',
    'friendly', 'garden', 'happiness', 'important', 'journey', 'keyboard', 'language', 'mountain',
    'notebook', 'orange', 'picture', 'question', 'rainbow', 'sandwich', 'together', 'umbrella',
    'vacation', 'weather', 'window', 'wonderful'
]);
const FLAGS = Object.freeze([
    { country: 'France', emoji: '🇫🇷', difficulty: 'easy' },
    { country: 'Japan', emoji: '🇯🇵', difficulty: 'easy' },
    { country: 'Canada', emoji: '🇨🇦', difficulty: 'easy' },
    { country: 'Brazil', emoji: '🇧🇷', difficulty: 'easy' },
    { country: 'Germany', emoji: '🇩🇪', difficulty: 'easy' },
    { country: 'Ireland', emoji: '🇮🇪', difficulty: 'medium' },
    { country: 'Romania', emoji: '🇷🇴', difficulty: 'medium' },
    { country: 'Argentina', emoji: '🇦🇷', difficulty: 'medium' },
    { country: 'Thailand', emoji: '🇹🇭', difficulty: 'medium' },
    { country: 'Estonia', emoji: '🇪🇪', difficulty: 'hard' },
    { country: 'Seychelles', emoji: '🇸🇨', difficulty: 'hard' },
    { country: 'Kyrgyzstan', emoji: '🇰🇬', difficulty: 'hard' },
    { country: 'Mozambique', emoji: '🇲🇿', difficulty: 'hard' }
]);
const WYR_QUESTIONS = Object.freeze([
    'Would you rather explore the ocean or explore space?',
    'Would you rather always have perfect timing or always find the best seat?',
    'Would you rather speak every language or play every instrument?',
    'Would you rather live beside a forest or beside the sea?',
    'Would you rather revisit one great day or preview one future day?'
]);

class FunService {
    constructor({
        sqlite,
        now = Date.now,
        http = axios,
        randomInt: draw = randomInt,
        randomUUID: uuid = randomUUID,
        setTimeout: schedule = setTimeout,
        clearTimeout: cancel = clearTimeout,
        setInterval: repeat = setInterval,
        clearInterval: stopRepeating = clearInterval
    } = {}) {
        if (!sqlite) throw new Error('FunService requires sqlite');
        this.sqlite = sqlite;
        this.now = now;
        this.http = http;
        this.randomInt = draw;
        this.randomUUID = uuid;
        this.setTimeout = schedule;
        this.clearTimeout = cancel;
        this.clearInterval = stopRepeating;
        this.snipes = new Map();
        this.sessions = new Map();
        this.roleplayGuildWindows = new Map();
        this.snipePruner = repeat(() => {
            for (const channelId of this.snipes.keys()) this._pruneChannel(channelId);
        }, 60000);
        this.snipePruner?.unref?.();
        this.statements = {
            protection: sqlite.prepare('SELECT 1 FROM snipe_protections WHERE user_id = ?'),
            protect: sqlite.prepare(`
                INSERT INTO snipe_protections (user_id, updated_at) VALUES (?, ?)
                ON CONFLICT(user_id) DO UPDATE SET updated_at = excluded.updated_at
            `),
            unprotect: sqlite.prepare('DELETE FROM snipe_protections WHERE user_id = ?'),
            roleplayDisabled: sqlite.prepare('SELECT 1 FROM roleplay_disabled WHERE guild_id = ? AND action = ?'),
            disableRoleplay: sqlite.prepare(`
                INSERT INTO roleplay_disabled (guild_id, action, updated_by, updated_at) VALUES (?, ?, ?, ?)
                ON CONFLICT(guild_id, action) DO UPDATE SET updated_by = excluded.updated_by, updated_at = excluded.updated_at
            `),
            enableRoleplay: sqlite.prepare('DELETE FROM roleplay_disabled WHERE guild_id = ? AND action = ?'),
            incrementRoleplay: sqlite.prepare(`
                INSERT INTO roleplay_counts (guild_id, actor_id, target_id, action, count, updated_at)
                VALUES (?, ?, ?, ?, 1, ?)
                ON CONFLICT(guild_id, actor_id, target_id, action)
                DO UPDATE SET count = count + 1, updated_at = excluded.updated_at
                RETURNING count
            `),
            blunt: sqlite.prepare('SELECT * FROM fun_blunts WHERE user_id = ?'),
            saveBlunt: sqlite.prepare(`
                INSERT INTO fun_blunts (user_id, sparked_at, last_sparked_at, taps, updated_at)
                VALUES (@userId, @sparkedAt, @lastSparkedAt, @taps, @updatedAt)
                ON CONFLICT(user_id) DO UPDATE SET sparked_at = excluded.sparked_at,
                    last_sparked_at = excluded.last_sparked_at, taps = excluded.taps, updated_at = excluded.updated_at
            `),
            vape: sqlite.prepare('SELECT * FROM fun_vapes WHERE guild_id = ?'),
            saveVape: sqlite.prepare(`
                INSERT INTO fun_vapes (guild_id, holder_id, flavor, hits, updated_at)
                VALUES (@guildId, @holderId, @flavor, @hits, @updatedAt)
                ON CONFLICT(guild_id) DO UPDATE SET holder_id = excluded.holder_id,
                    flavor = excluded.flavor, hits = excluded.hits, updated_at = excluded.updated_at
            `)
        };
    }

    isSnipeProtected(userId) {
        return Boolean(userId && this.statements.protection.get(userId));
    }

    getSnipeProtection(userId) {
        return this.isSnipeProtected(userId);
    }

    setSnipeProtection(userId, enabled) {
        if (!userId) throw new Error('A user is required');
        if (enabled) this.statements.protect.run(userId, this.now());
        else this.statements.unprotect.run(userId);
        if (enabled) this._removeMemberSnipes(userId);
        return enabled;
    }

    captureDeleted(message) {
        if (!this._canCaptureMessage(message) || !message.content?.trim()) return false;
        return this._pushSnipe(message.channelId, 'deleted', this._messageEntry(message));
    }

    captureEdited(oldMessage, newMessage) {
        if (!this._canCaptureMessage(oldMessage) || !newMessage?.guild
            || !oldMessage.content?.trim() || oldMessage.content === newMessage.content) return false;
        return this._pushSnipe(oldMessage.channelId, 'edited', this._messageEntry(oldMessage));
    }

    captureReaction(reaction, user) {
        const message = reaction?.message;
        if (!user || user.bot || !this._canCaptureMessage(message)
            || this.isSnipeProtected(user.id)) return false;
        return this._pushSnipe(message.channelId, 'reaction', {
            ...this._messageEntry(message),
            actorId: user.id,
            actorName: user.globalName || user.username || 'Unknown member',
            emoji: String(reaction.emoji),
            messageUrl: message.url || null
        });
    }

    getSnipe(channelId, kind, index = 1) {
        if (!['deleted', 'edited', 'reaction'].includes(kind)
            || !Number.isInteger(index) || index < 1) return null;
        this._pruneChannel(channelId);
        return this.snipes.get(channelId)?.[kind]?.[index - 1] || null;
    }

    getSnipeCount(channelId, kind) {
        this._pruneChannel(channelId);
        return this.snipes.get(channelId)?.[kind]?.length || 0;
    }

    clearSnipes(channelId) {
        return this.snipes.delete(channelId);
    }

    isRoleplayEnabled(guildId, action) {
        this._assertRoleplayAction(action);
        return !this.statements.roleplayDisabled.get(guildId, action);
    }

    toggleRoleplay(guildId, action, actorId) {
        this._assertRoleplayAction(action);
        const enabled = this.isRoleplayEnabled(guildId, action);
        if (enabled) this.statements.disableRoleplay.run(guildId, action, actorId, this.now());
        else this.statements.enableRoleplay.run(guildId, action);
        return !enabled;
    }

    listRoleplay(guildId) {
        return ROLEPLAY_ACTIONS.map(action => ({ action, enabled: this.isRoleplayEnabled(guildId, action) }));
    }

    recordRoleplay(guildId, actorId, targetId, action) {
        this._assertRoleplayAction(action);
        return this.statements.incrementRoleplay.get(guildId, actorId, targetId, action, this.now()).count;
    }

    consumeRoleplayQuota(guildId) {
        const now = this.now();
        let window = this.roleplayGuildWindows.get(guildId);
        if (!window || now - window.startedAt >= ROLEPLAY_GUILD_WINDOW_MS) {
            window = { startedAt: now, count: 0 };
            this.roleplayGuildWindows.set(guildId, window);
        }
        if (window.count >= ROLEPLAY_GUILD_LIMIT) return false;
        window.count += 1;
        return true;
    }

    async fetchRoleplay(action) {
        this._assertRoleplayAction(action);
        const response = await this.http.get(`https://nekos.best/api/v2/${action}?amount=1`, {
            timeout: 5000,
            maxContentLength: 65536,
            maxRedirects: 0,
            headers: { 'User-Agent': USER_AGENT }
        });
        const result = response?.data?.results?.[0];
        let media;
        try {
            media = new URL(result?.url);
        } catch {
            throw new Error('Roleplay provider returned invalid media');
        }
        const safePath = new RegExp(`^/api/v2/${action}/[0-9a-f-]{36}\\.gif$`, 'i');
        if (media.protocol !== 'https:' || media.hostname !== 'nekos.best' || !safePath.test(media.pathname)) {
            throw new Error('Roleplay provider returned invalid media');
        }
        const anime = typeof result.anime_name === 'string' ? result.anime_name.trim().slice(0, 80) : '';
        return { url: media.href, credit: anime ? `NEKOSBEST • ${anime}` : 'NEKOSBEST' };
    }

    sparkBlunt(userId) {
        const now = this.now();
        const current = this.statements.blunt.get(userId);
        if (current?.sparked_at && now - current.sparked_at < BLUNT_ACTIVE_MS) {
            throw new Error('The blunt is already sparked');
        }
        if (current?.last_sparked_at && now - current.last_sparked_at < BLUNT_COOLDOWN_MS) {
            throw new Error(`Wait ${BLUNT_COOLDOWN_MS - (now - current.last_sparked_at)}`);
        }
        const state = {
            userId,
            sparkedAt: now,
            lastSparkedAt: now,
            taps: current?.taps || 0,
            updatedAt: now
        };
        this.statements.saveBlunt.run(state);
        return state;
    }

    smokeBlunt(userId) {
        const now = this.now();
        const current = this.statements.blunt.get(userId);
        if (!current?.sparked_at) throw new Error('You need to spark the blunt first');
        if (now - current.sparked_at >= BLUNT_ACTIVE_MS) {
            this.statements.saveBlunt.run({
                userId, sparkedAt: null, lastSparkedAt: current.last_sparked_at,
                taps: current.taps, updatedAt: now
            });
            throw new Error('Your blunt has gone out');
        }
        const state = {
            userId,
            sparkedAt: current.sparked_at,
            lastSparkedAt: current.last_sparked_at,
            taps: current.taps + 1,
            updatedAt: now
        };
        this.statements.saveBlunt.run(state);
        return state;
    }

    bluntTaps(userId) {
        return this.statements.blunt.get(userId)?.taps || 0;
    }

    stealVape(guildId, userId) {
        const current = this.statements.vape.get(guildId);
        if (current?.holder_id === userId) throw new Error('You already have the vape');
        const state = {
            guildId,
            holderId: userId,
            flavor: current?.flavor || VAPE_FLAVORS[0],
            hits: current?.hits || 0,
            updatedAt: this.now(),
            stolenFrom: current?.holder_id || null
        };
        this.statements.saveVape.run(state);
        return state;
    }

    setVapeFlavor(guildId, userId, flavor) {
        if (!VAPE_FLAVORS.includes(flavor)) throw new Error(`Choose one of: ${VAPE_FLAVORS.join(', ')}`);
        const current = this.statements.vape.get(guildId);
        if (!current || current.holder_id !== userId) throw new Error('You are not the current vape holder');
        const state = {
            guildId, holderId: userId, flavor, hits: current.hits, updatedAt: this.now()
        };
        this.statements.saveVape.run(state);
        return state;
    }

    hitVape(guildId, userId) {
        const current = this.statements.vape.get(guildId);
        if (!current) throw new Error('There is no vape to hit right now');
        if (current.holder_id !== userId) throw new Error('You are not the current vape holder');
        const state = {
            guildId, holderId: userId, flavor: current.flavor,
            hits: current.hits + 1, updatedAt: this.now()
        };
        this.statements.saveVape.run(state);
        return state;
    }

    vapeHits(guildId) {
        return this.statements.vape.get(guildId)?.hits || 0;
    }

    randomWouldYouRather() {
        return WYR_QUESTIONS[this._draw(WYR_QUESTIONS.length)];
    }

    async startTicTacToe(interaction, opponent) {
        if (!opponent || opponent.bot) throw new Error('You cannot play against a bot');
        if (opponent.id === interaction.user.id) throw new Error('You cannot play against yourself');
        this._assertChannelFree(interaction.channelId);
        const session = {
            id: this.randomUUID(),
            kind: 'ttt',
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            players: [interaction.user.id, opponent.id],
            turn: 0,
            board: Array(9).fill(null),
            expiresAt: this.now() + 5 * 60 * 1000
        };
        this.sessions.set(session.channelId, session);
        let message;
        try {
            message = await interaction.reply({
                embeds: [this._ticTacToeEmbed(session)],
                components: this._ticTacToeComponents(session),
                allowedMentions: { users: session.players, roles: [], repliedUser: false },
                fetchReply: true
            });
        } catch (error) {
            this._endSession(session);
            throw error;
        }
        session.message = message;
        this._setSessionTimer(session, 5 * 60 * 1000, async () => {
            await session.message?.edit?.({
                embeds: [embeds.warn('Tic Tac Toe Ended', 'The game expired after five minutes of inactivity.')],
                components: []
            }).catch(() => null);
            this._endSession(session);
        });
        return session;
    }

    async startLobby(interaction, kind) {
        if (!['blacktea', 'flags'].includes(kind)) throw new Error('Unknown game');
        this._assertChannelFree(interaction.channelId);
        const session = {
            id: this.randomUUID(),
            kind,
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            channel: interaction.channel,
            phase: 'lobby',
            players: new Set([interaction.user.id])
        };
        this.sessions.set(session.channelId, session);
        const join = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`fun:join:${session.id}`).setLabel('Join').setEmoji('✅').setStyle(ButtonStyle.Success)
        );
        const description = kind === 'blacktea'
            ? 'Join within **30 seconds**. You start with **2 lives** and have **10 seconds** to enter a unique word containing the shown three letters.'
            : 'Join within **30 seconds**. You start with **3 lives** and have **10–7 seconds** to identify each flag.';
        try {
            session.message = await interaction.reply({
                embeds: [embeds.brand(kind === 'blacktea' ? 'BlackTea' : 'Guess the Flags', description)],
                components: [join],
                fetchReply: true
            });
        } catch (error) {
            this._endSession(session);
            throw error;
        }
        this._setSessionTimer(session, 30000, () => this._beginLobby(session));
        return session;
    }

    async startSingleFlag(interaction, difficulty) {
        if (!['easy', 'medium', 'hard'].includes(difficulty)) throw new Error('Choose easy, medium, or hard');
        this._assertChannelFree(interaction.channelId);
        const candidates = FLAGS.filter(flag => flag.difficulty === difficulty);
        const flag = candidates[this._draw(candidates.length)];
        const session = {
            id: this.randomUUID(), kind: 'flag', guildId: interaction.guildId,
            channelId: interaction.channelId, players: [interaction.user.id], answer: flag.country,
            difficulty
        };
        this.sessions.set(session.channelId, session);
        try {
            session.message = await interaction.reply({
                embeds: [embeds.brand('Guess the Flag!', `**Difficulty:** ${difficulty}\n\n# ${flag.emoji}\n\nYou have **30 seconds**. Type the country in chat.`)],
                fetchReply: true
            });
        } catch (error) {
            this._endSession(session);
            throw error;
        }
        this._setSessionTimer(session, 30000, async () => {
            await session.message?.edit?.({ embeds: [embeds.warn('Time’s Up', `The answer was **${flag.country}**.`)] }).catch(() => null);
            this._endSession(session);
        });
        return session;
    }

    async handleInteraction(interaction) {
        const parts = String(interaction.customId || '').split(':');
        if (parts[0] !== 'fun') return false;
        const session = Array.from(this.sessions.values()).find(candidate => candidate.id === parts[2]);
        if (!session) return this._componentError(interaction, 'That game has expired.');
        if ((interaction.guildId && interaction.guildId !== session.guildId)
            || (interaction.channelId && interaction.channelId !== session.channelId)) {
            return this._componentError(interaction, 'That game belongs to another channel.');
        }
        if (parts[1] === 'join') {
            if (session.phase !== 'lobby') return this._componentError(interaction, 'That lobby has closed.');
            if (session.players.size >= 20 && !session.players.has(interaction.user.id)) {
                return this._componentError(interaction, 'This lobby is full.');
            }
            session.players.add(interaction.user.id);
            await interaction.reply({ content: `You joined ${session.kind === 'blacktea' ? 'BlackTea' : 'Guess the Flags'}.`, flags: [MessageFlags.Ephemeral] });
            return true;
        }
        if (parts[1] === 'ttt') return this._handleTicTacToe(interaction, session, Number(parts[3]));
        return false;
    }

    async handleMessage(message) {
        const session = this.sessions.get(message.channelId);
        if (!session || message.author?.bot) return false;
        const answer = String(message.content || '').trim().toLowerCase();
        if (session.kind === 'flag') {
            if (message.author.id !== session.players[0] || answer !== session.answer.toLowerCase()) return false;
            this._endSession(session);
            await message.reply({ embeds: [embeds.success('Correct', `The answer was **${session.answer}**.`)], allowedMentions: { parse: [], repliedUser: false } });
            return true;
        }
        if (session.phase !== 'turn' || message.author.id !== session.currentPlayer) return false;
        if (session.kind === 'blacktea') {
            if (!WORDS.includes(answer) || !answer.includes(session.prompt) || session.used.has(answer)) return false;
            session.used.add(answer);
            await message.react?.('✅').catch(() => null);
        } else if (answer !== session.answer.toLowerCase()) {
            return false;
        } else {
            await message.reply({ embeds: [embeds.success('Correct', `The flag was **${session.answer}**.`)] });
        }
        this.clearTimeout(session.timer);
        await this._advanceMultiplayer(session);
        return true;
    }

    async endGame(interaction) {
        const session = this.sessions.get(interaction.channelId);
        if (!session) throw new Error('No BlackTea or flags game is active in this channel');
        const players = session.players instanceof Set ? session.players : new Set(session.players);
        const canEnd = players.has(interaction.user.id)
            || interaction.member?.permissions?.has(PermissionFlagsBits.ManageMessages);
        if (!canEnd) throw new Error('Only a participant or member with Manage Messages can end this game');
        this._endSession(session);
        return interaction.reply({ embeds: [embeds.success('Game Ended', 'The active game was ended.')], components: [] });
    }

    isGameParticipant(channelId, userId) {
        const session = this.sessions.get(channelId);
        if (!session) return false;
        return session.players instanceof Set ? session.players.has(userId) : session.players.includes(userId);
    }

    purgeGuild(guildId) {
        this.sqlite.prepare('DELETE FROM roleplay_disabled WHERE guild_id = ?').run(guildId);
        this.sqlite.prepare('DELETE FROM roleplay_counts WHERE guild_id = ?').run(guildId);
        this.sqlite.prepare('DELETE FROM fun_vapes WHERE guild_id = ?').run(guildId);
        this.roleplayGuildWindows.delete(guildId);
        for (const [channelId, bucket] of this.snipes) {
            if (Object.values(bucket).some(entries => entries.some(entry => entry.guildId === guildId))) {
                this.snipes.delete(channelId);
            }
        }
        for (const session of this.sessions.values()) {
            if (session.guildId === guildId) this._endSession(session);
        }
    }

    cleanup() {
        this.snipes.clear();
        this.roleplayGuildWindows.clear();
        this.clearInterval(this.snipePruner);
        for (const session of this.sessions.values()) this.clearTimeout(session.timer);
        this.sessions.clear();
    }

    _draw(maximum) {
        return this.randomInt(0, maximum);
    }

    _assertChannelFree(channelId) {
        if (this.sessions.has(channelId)) throw new Error('A game is already running in this channel');
    }

    _setSessionTimer(session, delay, callback) {
        this.clearTimeout(session.timer);
        session.timer = this.setTimeout(() => Promise.resolve(callback()).catch(() => this._endSession(session)), delay);
        session.timer?.unref?.();
    }

    _endSession(session) {
        this.clearTimeout(session.timer);
        if (this.sessions.get(session.channelId)?.id === session.id) this.sessions.delete(session.channelId);
    }

    _ticTacToeEmbed(session, result) {
        const header = `<@${session.players[0]}> vs <@${session.players[1]}>`;
        return embeds.brand('Tic Tac Toe', result || `${header}\n\nIt is <@${session.players[session.turn]}>’s turn.`);
    }

    _ticTacToeComponents(session, disabled = false) {
        return [0, 1, 2].map(row => new ActionRowBuilder().addComponents(
            [0, 1, 2].map(column => {
                const cell = row * 3 + column;
                const mark = session.board[cell];
                return new ButtonBuilder()
                    .setCustomId(`fun:ttt:${session.id}:${cell}`)
                    .setLabel(mark || '·')
                    .setStyle(mark === 'X' ? ButtonStyle.Primary : mark === 'O' ? ButtonStyle.Danger : ButtonStyle.Secondary)
                    .setDisabled(disabled || Boolean(mark));
            })
        ));
    }

    async _handleTicTacToe(interaction, session, cell) {
        const playerIndex = session.players.indexOf(interaction.user.id);
        if (playerIndex < 0) return this._componentError(interaction, 'You are not part of this game.');
        if (playerIndex !== session.turn) return this._componentError(interaction, 'It is not your turn.');
        if (!Number.isInteger(cell) || cell < 0 || cell > 8 || session.board[cell]) {
            return this._componentError(interaction, 'That cell is already taken.');
        }
        session.board[cell] = playerIndex === 0 ? 'X' : 'O';
        const wins = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
        const won = wins.some(line => line.every(index => session.board[index] === session.board[cell]));
        const tied = !won && session.board.every(Boolean);
        if (won || tied) {
            const result = won ? `<@${interaction.user.id}> won!` : 'It is a tie!';
            this._endSession(session);
            await interaction.update({
                embeds: [this._ticTacToeEmbed(session, result)],
                components: this._ticTacToeComponents(session, true),
                allowedMentions: { users: session.players, roles: [], repliedUser: false }
            });
            return true;
        }
        session.turn = 1 - session.turn;
        this._setSessionTimer(session, 5 * 60 * 1000, async () => {
            await session.message?.edit?.({ embeds: [embeds.warn('Tic Tac Toe Ended', 'The game expired after five minutes of inactivity.')], components: [] }).catch(() => null);
            this._endSession(session);
        });
        await interaction.update({
            embeds: [this._ticTacToeEmbed(session)],
            components: this._ticTacToeComponents(session),
            allowedMentions: { users: session.players, roles: [], repliedUser: false }
        });
        return true;
    }

    async _beginLobby(session) {
        if (this.sessions.get(session.channelId)?.id !== session.id) return;
        if (session.players.size < 2) {
            await session.message?.edit?.({ embeds: [embeds.warn('Game Cancelled', 'Not enough players joined.')], components: [] }).catch(() => null);
            this._endSession(session);
            return;
        }
        session.phase = 'turn';
        session.order = Array.from(session.players);
        session.lives = new Map(session.order.map(userId => [userId, session.kind === 'blacktea' ? 2 : 3]));
        session.used = new Set();
        session.turnIndex = 0;
        session.round = 0;
        await session.message?.edit?.({ embeds: [embeds.brand('Game Started', `${session.order.length} players joined.`)], components: [] }).catch(() => null);
        await this._promptMultiplayer(session);
    }

    async _promptMultiplayer(session) {
        session.currentPlayer = session.order[session.turnIndex];
        let seconds = 10;
        if (session.kind === 'blacktea') {
            const word = WORDS[this._draw(WORDS.length)];
            const start = this._draw(word.length - 2);
            session.prompt = word.slice(start, start + 3);
        } else {
            const difficulty = session.round < 3 ? 'easy' : session.round < 6 ? 'medium' : 'hard';
            const candidates = FLAGS.filter(flag => flag.difficulty === difficulty);
            const flag = candidates[this._draw(candidates.length)];
            session.answer = flag.country;
            session.flag = flag.emoji;
            seconds = difficulty === 'easy' ? 10 : difficulty === 'medium' ? 8 : 7;
        }
        const prompt = session.kind === 'blacktea'
            ? `<@${session.currentPlayer}> enter a word containing **${session.prompt.toUpperCase()}**. You have **10 seconds**.`
            : `<@${session.currentPlayer}> identify ${session.flag}. You have **${seconds} seconds**.`;
        await session.channel?.send?.({ embeds: [embeds.brand(session.kind === 'blacktea' ? 'BlackTea' : 'Guess the Flag', prompt)], allowedMentions: { users: [session.currentPlayer], roles: [], repliedUser: false } });
        this._setSessionTimer(session, seconds * 1000, () => this._loseLife(session, 'timeout'));
    }

    async _loseLife(session, reason) {
        if (this.sessions.get(session.channelId)?.id !== session.id) return;
        const remaining = Math.max(0, session.lives.get(session.currentPlayer) - 1);
        session.lives.set(session.currentPlayer, remaining);
        const answer = session.kind === 'flags' ? ` The flag was **${session.answer}**.` : '';
        await session.channel?.send?.({
            embeds: [embeds.warn(remaining ? 'Life Lost' : 'Player Eliminated', `<@${session.currentPlayer}> ${reason}.${answer} **${remaining}** lives remain.`)],
            allowedMentions: { users: [session.currentPlayer], roles: [], repliedUser: false }
        });
        await this._advanceMultiplayer(session);
    }

    async _advanceMultiplayer(session) {
        const alive = session.order.filter(userId => session.lives.get(userId) > 0);
        if (alive.length <= 1) {
            const winner = alive[0];
            await session.channel?.send?.({ embeds: [embeds.success('Game Over', winner ? `<@${winner}> won!` : 'Nobody won.')], allowedMentions: winner ? { users: [winner], roles: [], repliedUser: false } : { parse: [] } });
            this._endSession(session);
            return;
        }
        do session.turnIndex = (session.turnIndex + 1) % session.order.length;
        while (session.lives.get(session.order[session.turnIndex]) <= 0);
        session.round += 1;
        await this._promptMultiplayer(session);
    }

    async _componentError(interaction, message) {
        await interaction.reply({ embeds: [embeds.error('Game Unavailable', message)], flags: [MessageFlags.Ephemeral] });
        return true;
    }

    _assertRoleplayAction(action) {
        if (!ROLEPLAY_ACTIONS.includes(action)) throw new Error('That roleplay action is unavailable');
    }

    _canCaptureMessage(message) {
        return Boolean(message?.id && message.guild && message.channelId && !message.partial
            && !message.author?.bot && !message.webhookId && !message.system
            && !this.isSnipeProtected(message.author?.id));
    }

    _messageEntry(message) {
        return {
            guildId: message.guild.id,
            messageId: message.id,
            authorId: message.author.id,
            authorName: String(message.member?.displayName || message.author.globalName || message.author.username || 'Unknown member').slice(0, 80),
            avatarUrl: message.author.displayAvatarURL?.() || null,
            content: String(message.content).slice(0, 2000),
            occurredAt: this.now()
        };
    }

    _pushSnipe(channelId, kind, entry) {
        this._pruneChannel(channelId);
        const bucket = this.snipes.get(channelId) || { deleted: [], edited: [], reaction: [] };
        bucket[kind].unshift(entry);
        bucket[kind].length = Math.min(bucket[kind].length, SNIPE_LIMIT);
        this.snipes.set(channelId, bucket);
        return true;
    }

    _pruneChannel(channelId) {
        const bucket = this.snipes.get(channelId);
        if (!bucket) return;
        const cutoff = this.now() - SNIPE_TTL_MS;
        for (const kind of Object.keys(bucket)) {
            bucket[kind] = bucket[kind].filter(entry => entry.occurredAt >= cutoff
                && !this.isSnipeProtected(entry.authorId)
                && !this.isSnipeProtected(entry.actorId));
        }
        if (!Object.values(bucket).some(entries => entries.length)) this.snipes.delete(channelId);
    }

    _removeMemberSnipes(userId) {
        for (const [channelId, bucket] of this.snipes) {
            for (const kind of Object.keys(bucket)) {
                bucket[kind] = bucket[kind].filter(entry => entry.authorId !== userId && entry.actorId !== userId);
            }
            if (!Object.values(bucket).some(entries => entries.length)) this.snipes.delete(channelId);
        }
    }
}

module.exports = {
    FunService,
    ROLEPLAY_ACTIONS,
    POLICY_EXCLUDED_ROLEPLAY,
    VAPE_FLAVORS,
    SNIPE_LIMIT,
    SNIPE_TTL_MS
};
