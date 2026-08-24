const crypto = require('crypto');
const { sqlite } = require('../database');

const MIN_DURATION = 10000;
const MAX_DURATION = 30 * 86400000;

function parseDuration(value) {
    const match = /^\s*(\d+)\s*([smhdw])\s*$/i.exec(String(value || ''));
    if (!match) throw new Error('Invalid duration. Use formats like 10s, 30m, 1h, 1d, or 1w.');
    const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[match[2].toLowerCase()];
    const duration = Number(match[1]) * unit;
    if (duration < MIN_DURATION) throw new Error('Duration must be at least 10 seconds.');
    if (duration > MAX_DURATION) throw new Error('Duration cannot exceed 30 days.');
    return duration;
}

function parseJson(value, fallback) {
    try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function rowToGiveaway(row) {
    if (!row) return null;
    return {
        id: row.id, guildId: row.guild_id, channelId: row.channel_id, messageId: row.message_id,
        hostId: row.host_id, prize: row.prize, description: row.description,
        requiredRoleId: row.required_role_id, imageUrl: row.image_url, thumbnailUrl: row.thumbnail_url,
        winnerCount: row.winner_count, minLevel: row.min_level, maxLevel: row.max_level,
        templateSnapshot: row.template_snapshot, status: row.status, endsAt: row.ends_at,
        createdAt: row.created_at, updatedAt: row.updated_at, endedAt: row.ended_at
    };
}

function rowToRound(row) {
    if (!row) return null;
    return {
        id: row.id, giveawayId: row.giveaway_id, roundNumber: row.round_number,
        candidates: parseJson(row.candidates_snapshot, []), exclusions: parseJson(row.exclusions_snapshot, []),
        winnerIds: parseJson(row.winners_snapshot, []), actorId: row.actor_id,
        createdAt: row.created_at, announcedAt: row.announced_at
    };
}

function roleIds(member) {
    return member?.roles?.cache ? [...member.roles.cache.keys()] : [];
}

class GiveawayService {
    constructor(client, options = {}) {
        this.client = client;
        this.sqlite = options.sqlite || sqlite;
        this.now = options.now || Date.now;
        this.randomInt = options.randomInt || crypto.randomInt;
        this.interval = null;
        this.running = false;
    }

    cleanup() {
        if (this.interval) clearInterval(this.interval);
        this.interval = null;
    }

    ensureConfig(guildId) {
        this.sqlite.prepare(`INSERT INTO giveaway_configs (guild_id, updated_at) VALUES (?, ?)
            ON CONFLICT (guild_id) DO NOTHING`).run(guildId, this.now());
        return this.sqlite.prepare('SELECT * FROM giveaway_configs WHERE guild_id = ?').get(guildId);
    }

    updateConfig(guildId, values) {
        const allowed = { dmCreator: 'dm_creator', dmWinners: 'dm_winners', template: 'template' };
        const entries = Object.entries(values).filter(([key]) => allowed[key]);
        if (!entries.length) return this.ensureConfig(guildId);
        this.ensureConfig(guildId);
        this.sqlite.prepare(`UPDATE giveaway_configs SET ${entries.map(([key]) => `${allowed[key]} = ?`).join(', ')}, updated_at = ? WHERE guild_id = ?`)
            .run(...entries.map(([, value]) => value), this.now(), guildId);
        return this.ensureConfig(guildId);
    }

    savePreset(guildId, name, script, actorId) {
        const key = String(name || '').trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(key)) throw new Error('Preset names must be 1-32 lowercase letters, digits, underscores, or hyphens.');
        if (!String(script || '').trim()) throw new Error('Preset scripts cannot be empty.');
        const now = this.now();
        this.sqlite.prepare(`INSERT INTO giveaway_presets (guild_id, name, script, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (guild_id, name) DO UPDATE SET script = excluded.script, updated_at = excluded.updated_at`)
            .run(guildId, key, script.trim(), actorId, now, now);
        return this.sqlite.prepare('SELECT * FROM giveaway_presets WHERE guild_id = ? AND name = ?').get(guildId, key);
    }

    listPresets(guildId) {
        return this.sqlite.prepare('SELECT * FROM giveaway_presets WHERE guild_id = ? ORDER BY name').all(guildId);
    }

    deletePreset(guildId, name) {
        return Boolean(this.sqlite.prepare('DELETE FROM giveaway_presets WHERE guild_id = ? AND name = ? COLLATE NOCASE').run(guildId, name).changes);
    }

    toggleBlacklist(guildId, roleId, actorId) {
        const removed = this.sqlite.prepare('DELETE FROM giveaway_blacklist WHERE guild_id = ? AND role_id = ?').run(guildId, roleId);
        if (removed.changes) return false;
        this.sqlite.prepare('INSERT INTO giveaway_blacklist (guild_id, role_id, created_by, created_at) VALUES (?, ?, ?, ?)')
            .run(guildId, roleId, actorId, this.now());
        return true;
    }

    setRoleLimit(guildId, roleId, maximum, actorId) {
        if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100) throw new Error('Maximum entries must be between 1 and 100.');
        this.sqlite.prepare(`INSERT INTO giveaway_role_limits (guild_id, role_id, max_entries, created_by, updated_at)
            VALUES (?, ?, ?, ?, ?) ON CONFLICT (guild_id, role_id) DO UPDATE SET max_entries = excluded.max_entries,
            created_by = excluded.created_by, updated_at = excluded.updated_at`).run(guildId, roleId, maximum, actorId, this.now());
    }

    setMemberLevel(guildId, userId, level, xp = 0) {
        if (!Number.isInteger(level) || level < 0 || level > 1000) throw new Error('Level must be between 0 and 1000.');
        this.sqlite.prepare(`INSERT INTO member_levels (guild_id, user_id, xp, level, updated_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (guild_id, user_id) DO UPDATE SET xp = excluded.xp, level = excluded.level, updated_at = excluded.updated_at`)
            .run(guildId, userId, xp, level, this.now());
    }

    reserveGiveaway(values) {
        const prize = String(values.prize || '').trim();
        if (!prize || prize.length > 256) throw new Error('Prize must be 1-256 characters.');
        if (!Number.isInteger(values.winnerCount) || values.winnerCount < 1 || values.winnerCount > 50) {
            throw new Error('Number of winners must be between 1 and 50.');
        }
        const durationMs = typeof values.duration === 'number' ? values.duration : parseDuration(values.duration);
        if (durationMs < MIN_DURATION || durationMs > MAX_DURATION) throw new Error('Duration must be between 10 seconds and 30 days.');
        const min = values.minLevel ?? null;
        const max = values.maxLevel ?? null;
        if (min !== null && (!Number.isInteger(min) || min < 0 || min > 1000)) throw new Error('Minimum level must be between 0 and 1000.');
        if (max !== null && (!Number.isInteger(max) || max < 0 || max > 1000)) throw new Error('Maximum level must be between 0 and 1000.');
        if (min !== null && max !== null && min > max) throw new Error('Minimum level cannot exceed maximum level.');
        const now = this.now();
        const row = this.sqlite.prepare(`INSERT INTO giveaways
            (guild_id, channel_id, host_id, prize, description, required_role_id, image_url, thumbnail_url,
             winner_count, min_level, max_level, template_snapshot, ends_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`).get(
            values.guildId, values.channelId, values.hostId, prize, values.description || null,
            values.requiredRoleId || null, values.imageUrl || null, values.thumbnailUrl || null,
            values.winnerCount, min, max, values.templateSnapshot || null, now + durationMs, now, now
        );
        this.recordAction(row.id, values.hostId, 'reserved');
        return rowToGiveaway(row);
    }

    attachMessage(id, messageId) {
        return this.sqlite.transaction(() => {
            const row = this.sqlite.prepare(`UPDATE giveaways SET message_id = ?, status = 'active', updated_at = ?
                WHERE id = ? AND status = 'pending' RETURNING *`).get(messageId, this.now(), id);
            if (!row) throw new Error('Giveaway is no longer pending.');
            this.recordAction(id, row.host_id, 'started', messageId);
            return rowToGiveaway(row);
        }).immediate();
    }

    getGiveaway(id) {
        return rowToGiveaway(this.sqlite.prepare('SELECT * FROM giveaways WHERE id = ?').get(id));
    }

    getByMessage(guildId, messageId) {
        return rowToGiveaway(this.sqlite.prepare('SELECT * FROM giveaways WHERE guild_id = ? AND message_id = ?').get(guildId, messageId));
    }

    levelOf(guildId, userId) {
        return this.sqlite.prepare('SELECT level FROM member_levels WHERE guild_id = ? AND user_id = ?').get(guildId, userId)?.level || 0;
    }

    eligibility(giveaway, member) {
        if (!member || member.user?.bot) throw new Error('Bots cannot enter giveaways.');
        const roles = roleIds(member);
        if (this.sqlite.prepare(`SELECT 1 FROM giveaway_blacklist WHERE guild_id = ? AND role_id IN (${roles.map(() => '?').join(',') || "''"}) LIMIT 1`)
            .get(giveaway.guildId, ...roles)) throw new Error('One of your roles is blacklisted from giveaways.');
        if (giveaway.requiredRoleId && !roles.includes(giveaway.requiredRoleId)) throw new Error('You need the required role to enter this giveaway.');
        const level = this.levelOf(giveaway.guildId, member.id);
        if (giveaway.minLevel !== null && level < giveaway.minLevel) throw new Error(`You need to be at least level ${giveaway.minLevel} to enter.`);
        if (giveaway.maxLevel !== null && level > giveaway.maxLevel) throw new Error(`You must be at or below level ${giveaway.maxLevel} to enter.`);
        const limits = roles.length ? this.sqlite.prepare(`SELECT max_entries FROM giveaway_role_limits
            WHERE guild_id = ? AND role_id IN (${roles.map(() => '?').join(',')})`).all(giveaway.guildId, ...roles) : [];
        return { level, maximum: Math.max(1, ...limits.map(row => row.max_entries)) };
    }

    enter(id, member) {
        return this.sqlite.transaction(() => {
            const giveaway = this.getGiveaway(id);
            if (!giveaway || giveaway.status !== 'active' || giveaway.endsAt <= this.now()) throw new Error('This giveaway has ended.');
            const { maximum } = this.eligibility(giveaway, member);
            const current = this.sqlite.prepare('SELECT * FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?').get(id, member.id);
            if ((current?.entries || 0) >= maximum) throw new Error('You have reached your maximum number of entries.');
            const now = this.now();
            this.sqlite.prepare(`INSERT INTO giveaway_entries (giveaway_id, user_id, entries, created_at, updated_at)
                VALUES (?, ?, 1, ?, ?) ON CONFLICT (giveaway_id, user_id) DO UPDATE SET entries = entries + 1, updated_at = excluded.updated_at`)
                .run(id, member.id, now, now);
            const entries = (current?.entries || 0) + 1;
            this.recordAction(id, member.id, 'entered', String(entries));
            return { entries, maximum };
        }).immediate();
    }

    candidates(giveaway, members, priorWinnerIds = []) {
        const byId = new Map(members.map(member => [member.id, member]));
        const prior = new Set(priorWinnerIds);
        const candidates = [];
        const exclusions = [];
        for (const entry of this.sqlite.prepare('SELECT * FROM giveaway_entries WHERE giveaway_id = ? ORDER BY user_id').all(giveaway.id)) {
            const member = byId.get(entry.user_id);
            if (prior.has(entry.user_id)) {
                exclusions.push({ userId: entry.user_id, reason: 'previous_winner' });
                continue;
            }
            try {
                this.eligibility(giveaway, member);
                candidates.push({ userId: entry.user_id, entries: entry.entries });
            } catch (error) {
                exclusions.push({ userId: entry.user_id, reason: error.message });
            }
        }
        return { candidates, exclusions };
    }

    draw(candidates, count) {
        const pool = candidates.map(candidate => ({ ...candidate }));
        const winners = [];
        while (pool.length && winners.length < count) {
            const total = pool.reduce((sum, candidate) => sum + candidate.entries, 0);
            let draw = this.randomInt(total);
            const index = pool.findIndex(candidate => (draw -= candidate.entries) < 0);
            winners.push(pool.splice(index, 1)[0].userId);
        }
        return winners;
    }

    claimEnd(id, actorId, members) {
        return this.sqlite.transaction(() => {
            const giveaway = this.getGiveaway(id);
            if (!giveaway) throw new Error('Giveaway not found.');
            const existing = this.sqlite.prepare('SELECT * FROM giveaway_rounds WHERE giveaway_id = ? AND round_number = 1').get(id);
            if (existing) return { giveaway, round: rowToRound(existing), created: false };
            if (giveaway.status !== 'active') throw new Error('That giveaway is not active.');
            const claimed = this.sqlite.prepare(`UPDATE giveaways SET status = 'ending', updated_at = ?
                WHERE id = ? AND status = 'active' RETURNING *`).get(this.now(), id);
            if (!claimed) throw new Error('That giveaway is already ending.');
            const { candidates, exclusions } = this.candidates(giveaway, members);
            const winners = this.draw(candidates, giveaway.winnerCount);
            const round = this.sqlite.prepare(`INSERT INTO giveaway_rounds
                (giveaway_id, round_number, candidates_snapshot, exclusions_snapshot, winners_snapshot, actor_id, created_at)
                VALUES (?, 1, ?, ?, ?, ?, ?) RETURNING *`).get(id, JSON.stringify(candidates), JSON.stringify(exclusions),
                JSON.stringify(winners), actorId, this.now());
            this.recordAction(id, actorId, 'ending', JSON.stringify(winners));
            return { giveaway: rowToGiveaway(claimed), round: rowToRound(round), created: true };
        }).immediate();
    }

    recordAction(giveawayId, actorId, action, detail = null) {
        this.sqlite.prepare('INSERT INTO giveaway_actions (giveaway_id, actor_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(giveawayId, actorId, action, detail, this.now());
    }
}

module.exports = { GiveawayService, parseDuration, rowToGiveaway, rowToRound };
