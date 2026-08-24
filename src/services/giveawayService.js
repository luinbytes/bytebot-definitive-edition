const crypto = require('crypto');
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits
} = require('discord.js');
const { sqlite } = require('../database');
const logger = require('../utils/logger');
const { renderScript } = require('./richContentService');

const MIN_DURATION = 10000;
const MAX_DURATION = 30 * 86400000;
const SAFE_MENTIONS = { parse: [], repliedUser: false };

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
        this.endJobs = new Map();
    }

    cleanup() {
        if (this.interval) clearInterval(this.interval);
        this.interval = null;
    }

    start() {
        if (this.interval) return;
        this.interval = setInterval(() => this.runDue().catch(error => logger.error(`Giveaway scheduler failed: ${error.message}`)), 30000);
        this.interval.unref?.();
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
            .run(...entries.map(([, value]) => typeof value === 'boolean' ? Number(value) : value), this.now(), guildId);
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

    validateUrl(value) {
        if (!value) return null;
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Giveaway images must use HTTP or HTTPS.');
        return url.toString();
    }

    templatePayload(giveaway, context = {}) {
        const entries = this.sqlite.prepare('SELECT COALESCE(SUM(entries), 0) count FROM giveaway_entries WHERE giveaway_id = ?').get(giveaway.id).count;
        const variables = {
            'giveaway.prize': giveaway.prize,
            'giveaway.ends_at': `<t:${Math.floor(giveaway.endsAt / 1000)}:R>`,
            'giveaway.role': giveaway.requiredRoleId ? `<@&${giveaway.requiredRoleId}>` : 'None',
            'giveaway.winners': String(giveaway.winnerCount),
            'giveaway.description': giveaway.description || '',
            'giveaway.entries': String(entries),
            'giveaway.host': `<@${giveaway.hostId}>`
        };
        if (giveaway.templateSnapshot) {
            let script = giveaway.templateSnapshot;
            for (const [name, value] of Object.entries(variables)) script = script.replaceAll(`{${name}}`, value);
            const payload = renderScript(script, context);
            if (payload.flags || payload.components?.length) {
                throw new Error('Giveaway templates support content and embeds; entry controls are generated by ByteBot.');
            }
            return payload;
        }
        const embed = new EmbedBuilder().setTitle(`🎉 ${giveaway.prize}`)
            .setDescription(giveaway.description || 'Click **Enter** for a chance to win.')
            .addFields(
                { name: 'Ends', value: variables['giveaway.ends_at'], inline: true },
                { name: 'Winners', value: String(giveaway.winnerCount), inline: true },
                { name: 'Entries', value: String(entries), inline: true }
            ).setFooter({ text: `ByteBot giveaway:${giveaway.id} · hosted by ${giveaway.hostId}` });
        if (giveaway.requiredRoleId) embed.addFields({ name: 'Required role', value: variables['giveaway.role'] });
        if (giveaway.minLevel !== null || giveaway.maxLevel !== null) {
            embed.addFields({ name: 'Level', value: `${giveaway.minLevel ?? 0}–${giveaway.maxLevel ?? 1000}` });
        }
        if (giveaway.imageUrl) embed.setImage(giveaway.imageUrl);
        if (giveaway.thumbnailUrl) embed.setThumbnail(giveaway.thumbnailUrl);
        return { embeds: [embed], allowedMentions: SAFE_MENTIONS };
    }

    messagePayload(giveaway, context = {}, round = null) {
        const appearance = this.templatePayload(giveaway, context);
        const winnerText = round
            ? (round.winnerIds.length ? `Winners: ${round.winnerIds.map(id => `<@${id}>`).join(', ')}` : 'No eligible entries were available.')
            : null;
        const content = [appearance.content, winnerText].filter(Boolean).join('\n').slice(0, 2000) || undefined;
        const controls = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`giveaway:enter:${giveaway.id}`).setLabel('Enter').setStyle(ButtonStyle.Primary).setDisabled(Boolean(round)),
            new ButtonBuilder().setCustomId(`giveaway:view:${giveaway.id}`).setLabel('View entries').setStyle(ButtonStyle.Secondary)
        );
        return { ...appearance, content, components: [controls], allowedMentions: round
            ? { parse: [], users: round.winnerIds, repliedUser: false }
            : SAFE_MENTIONS };
    }

    failPending(id, actorId, detail) {
        const row = this.sqlite.prepare(`UPDATE giveaways SET status = 'lost', updated_at = ? WHERE id = ? AND status = 'pending' RETURNING *`)
            .get(this.now(), id);
        if (row) this.recordAction(id, actorId, 'start_failed', detail);
        return rowToGiveaway(row);
    }

    async startDiscordGiveaway(interaction, values) {
        const channel = interaction.channel;
        const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory];
        if (!interaction.guild.members.me.permissionsIn(channel).has(required)) {
            throw new Error('I need View Channel, Send Messages, Embed Links, and Read Message History here.');
        }
        const config = this.ensureConfig(interaction.guild.id);
        const preset = values.preset && this.sqlite.prepare('SELECT * FROM giveaway_presets WHERE guild_id = ? AND name = ? COLLATE NOCASE')
            .get(interaction.guild.id, values.preset);
        if (values.preset && !preset) throw new Error('Giveaway preset not found.');
        const giveaway = this.reserveGiveaway({
            ...values, guildId: interaction.guild.id, channelId: channel.id, hostId: interaction.user.id,
            imageUrl: this.validateUrl(values.imageUrl), thumbnailUrl: this.validateUrl(values.thumbnailUrl),
            templateSnapshot: preset?.script || config.template
        });
        let message;
        try {
            message = await channel.send(this.messagePayload(giveaway, { guild: interaction.guild, channel, user: interaction.user, member: interaction.member }));
            return this.attachMessage(giveaway.id, message.id);
        } catch (error) {
            if (message) await message.edit({ components: [] }).catch(() => null);
            this.failPending(giveaway.id, interaction.user.id, error.message);
            throw error;
        }
    }

    async membersFor(giveaway) {
        const ids = this.sqlite.prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?').all(giveaway.id).map(row => row.user_id);
        const guild = this.client.guilds.cache.get(giveaway.guildId) || await this.client.guilds.fetch(giveaway.guildId).catch(() => null);
        if (!guild) return [];
        const members = [];
        for (const id of ids) {
            const member = guild.members.cache.get(id) || await guild.members.fetch(id).catch(() => null);
            if (member) members.push(member);
        }
        return members;
    }

    async resourceFor(giveaway) {
        const guild = this.client?.guilds.cache.get(giveaway.guildId) || await this.client?.guilds.fetch(giveaway.guildId).catch(() => null);
        const channel = guild?.channels.cache.get(giveaway.channelId) || await guild?.channels.fetch?.(giveaway.channelId).catch(() => null);
        const message = channel && giveaway.messageId ? await channel.messages.fetch(giveaway.messageId).catch(() => null) : null;
        return { guild, channel, message };
    }

    completeEnd(id, actorId) {
        return this.sqlite.transaction(() => {
            const now = this.now();
            const row = this.sqlite.prepare(`UPDATE giveaways SET status = 'ended', ended_at = ?, updated_at = ?
                WHERE id = ? AND status = 'ending' RETURNING *`).get(now, now, id);
            if (!row) return this.getGiveaway(id);
            this.sqlite.prepare('UPDATE giveaway_rounds SET announced_at = ? WHERE giveaway_id = ? AND round_number = 1 AND announced_at IS NULL')
                .run(now, id);
            this.recordAction(id, actorId, 'ended');
            return rowToGiveaway(row);
        }).immediate();
    }

    async notifyResult(giveaway, round, guild) {
        const config = this.ensureConfig(giveaway.guildId);
        if (config.dm_creator) {
            const host = await this.client.users.fetch(giveaway.hostId).catch(() => null);
            if (host) await host.send({ content: round.winnerIds.length
                ? `Your giveaway for **${giveaway.prize}** in **${guild?.name || 'a server'}** ended. Winners: ${round.winnerIds.map(id => `<@${id}>`).join(', ')}`
                : `Your giveaway for **${giveaway.prize}** ended with no eligible entries.`, allowedMentions: SAFE_MENTIONS })
                .catch(error => this.recordAction(giveaway.id, this.client.user.id, 'creator_dm_failed', error.message));
        }
        if (config.dm_winners) {
            for (const id of round.winnerIds) {
                const user = await this.client.users.fetch(id).catch(() => null);
                if (user) await user.send({ content: `🎉 You won **${giveaway.prize}** in **${guild?.name || 'a server'}**!`, allowedMentions: SAFE_MENTIONS })
                    .catch(error => this.recordAction(giveaway.id, this.client.user.id, 'winner_dm_failed', `${id}:${error.message}`));
            }
        }
    }

    async finishDiscordGiveaway(id, actorId) {
        const before = this.getGiveaway(id);
        if (!before) throw new Error('Giveaway not found.');
        if (before.status === 'ended') {
            const round = rowToRound(this.sqlite.prepare('SELECT * FROM giveaway_rounds WHERE giveaway_id = ? AND round_number = 1').get(id));
            return { giveaway: before, round };
        }
        const members = await this.membersFor(before);
        const claimed = this.claimEnd(id, actorId, members);
        const giveaway = this.getGiveaway(id);
        const { guild, channel, message } = await this.resourceFor(giveaway);
        if (!message) {
            this.sqlite.prepare("UPDATE giveaways SET status = 'lost', updated_at = ? WHERE id = ? AND status = 'ending'").run(this.now(), id);
            this.recordAction(id, actorId, 'message_lost');
            throw new Error('The exact giveaway message is no longer available.');
        }
        await message.edit(this.messagePayload(giveaway, { guild, channel }, claimed.round));
        const ended = this.completeEnd(id, actorId);
        await this.notifyResult(giveaway, claimed.round, guild);
        return { giveaway: ended, round: claimed.round };
    }

    async endDiscordGiveaway(id, actorId) {
        if (this.endJobs.has(id)) return this.endJobs.get(id);
        const job = this.finishDiscordGiveaway(id, actorId);
        this.endJobs.set(id, job);
        try { return await job; } finally {
            if (this.endJobs.get(id) === job) this.endJobs.delete(id);
        }
    }

    createReroll(id, actorId, members) {
        return this.sqlite.transaction(() => {
            const giveaway = this.getGiveaway(id);
            if (!giveaway || giveaway.status !== 'ended') throw new Error('That giveaway has not ended yet.');
            const rounds = this.sqlite.prepare('SELECT * FROM giveaway_rounds WHERE giveaway_id = ? ORDER BY round_number').all(id);
            const prior = rounds.flatMap(row => parseJson(row.winners_snapshot, []));
            const { candidates, exclusions } = this.candidates(giveaway, members, prior);
            const winners = this.draw(candidates, giveaway.winnerCount);
            if (!winners.length) throw new Error('There are no unused eligible entries to reroll from.');
            const roundNumber = rounds.length + 1;
            const row = this.sqlite.prepare(`INSERT INTO giveaway_rounds
                (giveaway_id, round_number, candidates_snapshot, exclusions_snapshot, winners_snapshot, actor_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`).get(id, roundNumber, JSON.stringify(candidates), JSON.stringify(exclusions),
                JSON.stringify(winners), actorId, this.now());
            this.recordAction(id, actorId, 'rerolled', JSON.stringify(winners));
            return rowToRound(row);
        }).immediate();
    }

    async rerollDiscordGiveaway(id, actorId) {
        const giveaway = this.getGiveaway(id);
        if (!giveaway) throw new Error('Giveaway not found.');
        const pending = this.sqlite.prepare(`SELECT * FROM giveaway_rounds
            WHERE giveaway_id = ? AND round_number > 1 AND announced_at IS NULL ORDER BY round_number DESC LIMIT 1`).get(id);
        const round = rowToRound(pending) || this.createReroll(id, actorId, await this.membersFor(giveaway));
        const { guild, channel, message } = await this.resourceFor(giveaway);
        if (!message) throw new Error('The exact giveaway message is no longer available.');
        await message.edit(this.messagePayload(giveaway, { guild, channel }, round));
        this.sqlite.prepare('UPDATE giveaway_rounds SET announced_at = ? WHERE id = ?').run(this.now(), round.id);
        await this.notifyResult(giveaway, round, guild);
        return round;
    }

    updateGiveaway(id, changes, actorId) {
        const columns = {
            prize: 'prize', description: 'description', imageUrl: 'image_url', thumbnailUrl: 'thumbnail_url',
            winnerCount: 'winner_count', minLevel: 'min_level', maxLevel: 'max_level', endsAt: 'ends_at'
        };
        const entries = Object.entries(changes).filter(([key]) => columns[key]);
        return this.sqlite.transaction(() => {
            const current = this.getGiveaway(id);
            if (!current || current.status !== 'active') throw new Error('Only active giveaways can be edited.');
            const next = { ...current, ...changes };
            if (!next.prize || next.prize.length > 256) throw new Error('Prize must be 1-256 characters.');
            if (!Number.isInteger(next.winnerCount) || next.winnerCount < 1 || next.winnerCount > 50) throw new Error('Number of winners must be between 1 and 50.');
            if (next.minLevel !== null && (next.minLevel < 0 || next.minLevel > 1000)) throw new Error('Minimum level must be between 0 and 1000.');
            if (next.maxLevel !== null && (next.maxLevel < 0 || next.maxLevel > 1000)) throw new Error('Maximum level must be between 0 and 1000.');
            if (next.minLevel !== null && next.maxLevel !== null && next.minLevel > next.maxLevel) throw new Error('Minimum level cannot exceed maximum level.');
            const row = this.sqlite.prepare(`UPDATE giveaways SET ${entries.map(([key]) => `${columns[key]} = ?`).join(', ')}, updated_at = ?
                WHERE id = ? AND status = 'active' RETURNING *`).get(...entries.map(([, value]) => value), this.now(), id);
            this.recordAction(id, actorId, 'edited', JSON.stringify(changes));
            return rowToGiveaway(row);
        }).immediate();
    }

    async editDiscordGiveaway(giveaway, changes, actorId) {
        if (changes.imageUrl !== undefined) changes.imageUrl = this.validateUrl(changes.imageUrl);
        if (changes.thumbnailUrl !== undefined) changes.thumbnailUrl = this.validateUrl(changes.thumbnailUrl);
        const { guild, channel, message } = await this.resourceFor(giveaway);
        if (!message) {
            this.sqlite.prepare("UPDATE giveaways SET status = 'lost', updated_at = ? WHERE id = ? AND status = 'active'").run(this.now(), giveaway.id);
            this.recordAction(giveaway.id, actorId, 'message_lost');
            throw new Error('The exact giveaway message is no longer available.');
        }
        const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory];
        if (!guild.members.me.permissionsIn(channel).has(required)) {
            throw new Error('I need View Channel, Send Messages, Embed Links, and Read Message History there.');
        }
        const updated = this.updateGiveaway(giveaway.id, changes, actorId);
        await message.edit(this.messagePayload(updated, { guild, channel }));
        return updated;
    }

    validateTemplate(guildId, script, interaction) {
        return this.templatePayload({ id: 0, guildId, prize: 'Prize', winnerCount: 1, hostId: interaction.user.id,
            endsAt: this.now() + 3600000, requiredRoleId: null, description: null, minLevel: null, maxLevel: null,
            imageUrl: null, thumbnailUrl: null, templateSnapshot: script }, { guild: interaction.guild, channel: interaction.channel });
    }

    option(interaction, method, name) {
        try { return interaction.options[method](name); } catch { return null; }
    }

    async handleCommand(interaction) {
        try {
            const group = interaction.options.getSubcommandGroup(false);
            const action = interaction.options.getSubcommand();
            const guildId = interaction.guild.id;
            if (action === 'start' && !group) {
                const giveaway = await this.startDiscordGiveaway(interaction, {
                    duration: this.option(interaction, 'getString', 'duration'), winnerCount: this.option(interaction, 'getInteger', 'winners'),
                    prize: this.option(interaction, 'getString', 'prize'), requiredRoleId: this.option(interaction, 'getRole', 'role')?.id,
                    description: this.option(interaction, 'getString', 'description'), preset: this.option(interaction, 'getString', 'preset'),
                    imageUrl: this.option(interaction, 'getString', 'image'), thumbnailUrl: this.option(interaction, 'getString', 'thumbnail')
                });
                return interaction.editReply({ content: `Giveaway started: ${giveaway.messageId}`, allowedMentions: SAFE_MENTIONS });
            }
            if (action === 'blacklist' && !group) {
                const role = this.option(interaction, 'getRole', 'role');
                const enabled = this.toggleBlacklist(guildId, role.id, interaction.user.id);
                return interaction.editReply({ content: `${role} ${enabled ? 'added to' : 'removed from'} the giveaway blacklist.`, allowedMentions: SAFE_MENTIONS });
            }
            if (action === 'setmax' && !group) {
                const role = this.option(interaction, 'getRole', 'role');
                const maximum = this.option(interaction, 'getInteger', 'entries');
                this.setRoleLimit(guildId, role.id, maximum, interaction.user.id);
                return interaction.editReply({ content: `${role} can now enter up to **${maximum}** times.`, allowedMentions: SAFE_MENTIONS });
            }
            if (['dmcreator', 'dmwinners'].includes(action) && !group) {
                const enabled = this.option(interaction, 'getBoolean', 'enabled');
                this.updateConfig(guildId, { [action === 'dmcreator' ? 'dmCreator' : 'dmWinners']: enabled });
                return interaction.editReply({ content: `${action === 'dmcreator' ? 'Host' : 'Winner'} DMs ${enabled ? 'enabled' : 'disabled'}.` });
            }
            if (action === 'template' && !group) {
                const script = this.option(interaction, 'getString', 'script');
                if (script) this.validateTemplate(guildId, script, interaction);
                this.updateConfig(guildId, { template: script || null });
                return interaction.editReply({ content: script ? 'Giveaway template updated.' : 'Giveaway template cleared.' });
            }
            if (action === 'variables' && !group) return interaction.editReply({ content: '`{giveaway.prize}` `{giveaway.ends_at}` `{giveaway.role}` `{giveaway.winners}` `{giveaway.description}` `{giveaway.entries}` `{giveaway.host}`' });
            if (group === 'preset') {
                const name = this.option(interaction, 'getString', 'name');
                if (action === 'save') {
                    const script = this.option(interaction, 'getString', 'script');
                    this.validateTemplate(guildId, script, interaction);
                    this.savePreset(guildId, name, script, interaction.user.id);
                    return interaction.editReply({ content: `Preset **${name.toLowerCase()}** saved.` });
                }
                if (action === 'list') {
                    const rows = this.listPresets(guildId).slice(0, 25);
                    return interaction.editReply({ content: rows.length ? rows.map(row => `**${row.name}**`).join('\n') : 'No giveaway presets are saved.' });
                }
                return interaction.editReply({ content: this.deletePreset(guildId, name) ? `Preset **${name}** deleted.` : 'Preset not found.' });
            }
            const messageId = this.option(interaction, 'getString', 'message_id');
            const giveaway = this.getByMessage(guildId, messageId);
            if (!giveaway) throw new Error('Giveaway not found in this server.');
            if (action === 'end' && !group) {
                const result = await this.endDiscordGiveaway(giveaway.id, interaction.user.id);
                return interaction.editReply({ content: `Giveaway ended with ${result.round.winnerIds.length} winner(s).` });
            }
            if (action === 'reroll' && !group) {
                const round = await this.rerollDiscordGiveaway(giveaway.id, interaction.user.id);
                return interaction.editReply({ content: `Rerolled ${round.winnerIds.length} winner(s).` });
            }
            let changes;
            if (action === 'prize') changes = { prize: this.option(interaction, 'getString', 'prize') };
            if (action === 'duration') changes = { endsAt: this.now() + parseDuration(this.option(interaction, 'getString', 'duration')) };
            if (action === 'winners') changes = { winnerCount: this.option(interaction, 'getInteger', 'winners') };
            if (action === 'description') changes = { description: this.option(interaction, 'getString', 'description') };
            if (action === 'image') changes = { imageUrl: this.option(interaction, 'getString', 'image') };
            if (action === 'thumbnail') changes = { thumbnailUrl: this.option(interaction, 'getString', 'thumbnail') };
            if (action === 'minlevel') changes = { minLevel: this.option(interaction, 'getInteger', 'level') };
            if (action === 'maxlevel') changes = { maxLevel: this.option(interaction, 'getInteger', 'level') };
            if (!changes) throw new Error('Unknown giveaway action.');
            await this.editDiscordGiveaway(giveaway, changes, interaction.user.id);
            return interaction.editReply({ content: `Giveaway ${action} updated.` });
        } catch (error) {
            return interaction.editReply({ content: `❌ ${error.message}`, allowedMentions: SAFE_MENTIONS });
        }
    }

    autocomplete(interaction) {
        const query = interaction.options.getFocused().toLowerCase();
        return interaction.respond(this.listPresets(interaction.guild.id).filter(row => row.name.includes(query)).slice(0, 25)
            .map(row => ({ name: row.name, value: row.name })));
    }

    async handleInteraction(interaction) {
        try {
            const [, action, rawId] = interaction.customId.split(':');
            const giveaway = this.getGiveaway(Number(rawId));
            if (!giveaway || giveaway.guildId !== interaction.guild.id || giveaway.channelId !== interaction.channel.id
                || giveaway.messageId !== interaction.message.id) throw new Error('This giveaway control is stale.');
            if (action === 'view') {
                const entries = this.sqlite.prepare('SELECT * FROM giveaway_entries WHERE giveaway_id = ? ORDER BY entries DESC, user_id LIMIT 25').all(giveaway.id);
                return interaction.reply({ content: entries.length ? entries.map(row => `<@${row.user_id}> · ${row.entries}`).join('\n') : 'No participants yet.',
                    flags: [MessageFlags.Ephemeral], allowedMentions: SAFE_MENTIONS });
            }
            const result = this.enter(giveaway.id, interaction.member);
            await interaction.reply({ content: `You entered the giveaway! Entry **${result.entries}/${result.maximum}**.`, flags: [MessageFlags.Ephemeral] });
            return interaction.message.edit(this.messagePayload(this.getGiveaway(giveaway.id), { guild: interaction.guild, channel: interaction.channel }))
                .catch(error => logger.warn(`Giveaway ${giveaway.id} entry count refresh failed: ${error.message}`));
        } catch (error) {
            const payload = { content: `❌ ${error.message}`, flags: [MessageFlags.Ephemeral], allowedMentions: SAFE_MENTIONS };
            return interaction.replied || interaction.deferred ? interaction.followUp(payload) : interaction.reply(payload);
        }
    }

    async reconcile() {
        if (!this.client) return { adopted: 0, lost: 0, resumed: 0 };
        let adopted = 0;
        let lost = 0;
        let resumed = 0;
        const rows = this.sqlite.prepare("SELECT * FROM giveaways WHERE status IN ('pending', 'active', 'ending') ORDER BY id").all();
        for (const row of rows) {
            let giveaway = rowToGiveaway(row);
            const { channel, message } = await this.resourceFor(giveaway);
            if (giveaway.status === 'pending' && channel) {
                const recent = await channel.messages.fetch({ limit: 25 }).catch(() => new Map());
                const matches = [...recent.values()].filter(item => item.components?.some(group => group.components?.some(component => component.customId === `giveaway:enter:${giveaway.id}`)));
                if (matches.length === 1) {
                    giveaway = this.attachMessage(giveaway.id, matches[0].id);
                    adopted++;
                } else {
                    this.failPending(giveaway.id, this.client.user.id, matches.length ? 'ambiguous message markers' : 'message missing');
                    lost++;
                    continue;
                }
            } else if (!message) {
                this.sqlite.prepare("UPDATE giveaways SET status = 'lost', updated_at = ? WHERE id = ?").run(this.now(), giveaway.id);
                this.recordAction(giveaway.id, this.client.user.id, 'message_lost');
                lost++;
                continue;
            }
            if (giveaway.status === 'ending') {
                await this.endDiscordGiveaway(giveaway.id, this.client.user.id).catch(error => logger.warn(`Giveaway ${giveaway.id} resume failed: ${error.message}`));
                resumed++;
            }
        }
        return { adopted, lost, resumed };
    }

    async runDue() {
        if (!this.client || this.running) return;
        this.running = true;
        try {
            const rows = this.sqlite.prepare("SELECT id FROM giveaways WHERE status = 'active' AND ends_at <= ? ORDER BY ends_at LIMIT 25").all(this.now());
            for (const row of rows) await this.endDiscordGiveaway(row.id, this.client.user.id)
                .catch(error => logger.warn(`Giveaway ${row.id} deadline failed: ${error.message}`));
        } finally {
            this.running = false;
        }
    }

    purgeGuild(guildId) {
        this.sqlite.transaction(() => {
            const ids = this.sqlite.prepare('SELECT id FROM giveaways WHERE guild_id = ?').all(guildId).map(row => row.id);
            for (const id of ids) {
                this.sqlite.prepare('DELETE FROM giveaway_actions WHERE giveaway_id = ?').run(id);
                this.sqlite.prepare('DELETE FROM giveaway_rounds WHERE giveaway_id = ?').run(id);
                this.sqlite.prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ?').run(id);
            }
            this.sqlite.prepare('DELETE FROM giveaways WHERE guild_id = ?').run(guildId);
            for (const table of ['giveaway_presets', 'giveaway_blacklist', 'giveaway_role_limits', 'giveaway_configs', 'member_levels']) {
                this.sqlite.prepare(`DELETE FROM ${table} WHERE guild_id = ?`).run(guildId);
            }
        }).immediate();
    }

    recordAction(giveawayId, actorId, action, detail = null) {
        this.sqlite.prepare('INSERT INTO giveaway_actions (giveaway_id, actor_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(giveawayId, actorId, action, detail, this.now());
    }
}

module.exports = { GiveawayService, parseDuration, rowToGiveaway, rowToRound };
