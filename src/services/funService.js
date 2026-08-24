const axios = require('axios');

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
const USER_AGENT = 'ByteBot (https://github.com/luinbytes/bytebot-definitive-edition)';

class FunService {
    constructor({ sqlite, now = Date.now, http = axios } = {}) {
        if (!sqlite) throw new Error('FunService requires sqlite');
        this.sqlite = sqlite;
        this.now = now;
        this.http = http;
        this.snipes = new Map();
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
        return this._pushSnipe(oldMessage.channelId, 'edited', {
            ...this._messageEntry(oldMessage),
            editedContent: String(newMessage.content || '').slice(0, 2000)
        });
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

    async fetchRoleplay(action) {
        this._assertRoleplayAction(action);
        const response = await this.http.get(`https://nekos.best/api/v2/${action}?amount=1`, {
            timeout: 5000,
            maxContentLength: 65536,
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

    purgeGuild(guildId) {
        this.sqlite.prepare('DELETE FROM roleplay_disabled WHERE guild_id = ?').run(guildId);
        this.sqlite.prepare('DELETE FROM roleplay_counts WHERE guild_id = ?').run(guildId);
        this.sqlite.prepare('DELETE FROM fun_vapes WHERE guild_id = ?').run(guildId);
        for (const [channelId, bucket] of this.snipes) {
            if (Object.values(bucket).some(entries => entries.some(entry => entry.guildId === guildId))) {
                this.snipes.delete(channelId);
            }
        }
    }

    cleanup() {
        this.snipes.clear();
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
