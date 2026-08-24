const MAX_LEVEL = 999;

function levelForXp(xp) {
    return Math.min(MAX_LEVEL, Math.floor(Math.sqrt(Math.max(0, xp) / 100)));
}

function roleIds(member) {
    return [...(member?.roles?.cache?.keys?.() || [])];
}

class LevelAnalyticsService {
    constructor({ sqlite, now = Date.now }) {
        this.sqlite = sqlite;
        this.now = now;
    }

    recordMessage(message) {
        if (!message?.guild?.id || !message?.id || !message?.author?.id
            || message.author.bot || message.webhookId || !String(message.content || '').trim()) {
            return { accepted: false, duplicate: false, xpAwarded: 0 };
        }

        const now = this.now();
        const day = new Date(now).toISOString().slice(0, 10);
        const guildId = message.guild.id;
        const userId = message.author.id;

        return this.sqlite.transaction(() => {
            const inserted = this.sqlite.prepare(`
                INSERT OR IGNORE INTO analytics_events (guild_id, event_type, event_id, occurred_at)
                VALUES (?, 'message', ?, ?)
            `).run(guildId, message.id, now);
            if (!inserted.changes) return { accepted: false, duplicate: true, xpAwarded: 0 };

            this.sqlite.prepare(`
                INSERT INTO server_daily_metrics
                    (guild_id, activity_date, message_count, updated_at)
                VALUES (?, ?, 1, ?)
                ON CONFLICT(guild_id, activity_date) DO UPDATE SET
                    message_count = message_count + 1,
                    updated_at = excluded.updated_at
            `).run(guildId, day, now);
            this.sqlite.prepare(`
                INSERT INTO activity_logs
                    (user_id, guild_id, activity_date, message_count, updated_at)
                VALUES (?, ?, ?, 1, ?)
                ON CONFLICT(user_id, guild_id, activity_date) DO UPDATE SET
                    message_count = message_count + 1,
                    updated_at = excluded.updated_at
            `).run(userId, guildId, day, now);
            this.sqlite.prepare(`
                INSERT OR IGNORE INTO level_configs (guild_id, updated_at) VALUES (?, ?)
            `).run(guildId, now);
            this.sqlite.prepare(`
                INSERT OR IGNORE INTO member_levels
                    (guild_id, user_id, xp, level, text_xp, voice_xp,
                     manual_adjustment, level_floor, message_count, voice_seconds, updated_at)
                VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0, 0, ?)
            `).run(guildId, userId, now);

            const config = this.sqlite.prepare(`SELECT * FROM level_configs WHERE guild_id = ?`).get(guildId);
            const ignoredChannel = this.sqlite.prepare(`
                SELECT 1 FROM level_ignores
                WHERE guild_id = ? AND target_type = 'channel' AND target_id = ?
            `).get(guildId, message.channelId);
            const roles = roleIds(message.member);
            const ignoredRole = roles.length && this.sqlite.prepare(`
                SELECT 1 FROM level_ignores
                WHERE guild_id = ? AND target_type = 'role'
                  AND target_id IN (${roles.map(() => '?').join(',')})
                LIMIT 1
            `).get(guildId, ...roles);
            const current = this.sqlite.prepare(`
                SELECT * FROM member_levels WHERE guild_id = ? AND user_id = ?
            `).get(guildId, userId);
            const daily = this.sqlite.prepare(`
                SELECT text_xp_awarded FROM activity_logs
                WHERE user_id = ? AND guild_id = ? AND activity_date = ?
            `).get(userId, guildId, day);
            const onCooldown = current.last_text_xp_at != null
                && now - current.last_text_xp_at < config.text_cooldown_seconds * 1000;

            let xpAwarded = 0;
            if (config.text_enabled && !ignoredChannel && !ignoredRole && !onCooldown) {
                const targets = [['channel', message.channelId], ...roles.map(id => ['role', id])];
                let targetMultiplier = 1;
                for (const [type, id] of targets) {
                    const boost = this.sqlite.prepare(`
                        SELECT multiplier FROM level_boosts
                        WHERE guild_id = ? AND target_type = ? AND target_id = ?
                    `).get(guildId, type, id);
                    if (boost) targetMultiplier = Math.max(targetMultiplier, boost.multiplier);
                }
                const calculated = Math.floor(20 * Math.min(10, config.base_multiplier * targetMultiplier));
                xpAwarded = Math.min(calculated, Math.max(0, 20_000 - daily.text_xp_awarded));
            }

            if (xpAwarded) this.sqlite.prepare(`
                UPDATE activity_logs SET text_xp_awarded = text_xp_awarded + ?
                WHERE user_id = ? AND guild_id = ? AND activity_date = ?
            `).run(xpAwarded, userId, guildId, day);

            const textXp = current.text_xp + xpAwarded;
            const xp = Math.max(0, textXp + current.voice_xp + current.manual_adjustment);
            const level = Math.max(current.level_floor, levelForXp(xp));
            this.sqlite.prepare(`
                UPDATE member_levels SET
                    xp = ?, level = ?, text_xp = ?, message_count = message_count + 1,
                    last_text_xp_at = CASE WHEN ? > 0 THEN ? ELSE last_text_xp_at END,
                    updated_at = ?
                WHERE guild_id = ? AND user_id = ?
            `).run(xp, level, textXp, xpAwarded, now, now, guildId, userId);

            return {
                accepted: true,
                duplicate: false,
                xpAwarded,
                level,
                previousLevel: current.level
            };
        })();
    }

    recordReactionChange(reaction, user, present) {
        const guildId = reaction?.message?.guild?.id;
        const messageId = reaction?.message?.id;
        const emoji = reaction?.emoji?.id || reaction?.emoji?.name;
        if (!guildId || !messageId || !emoji || !user?.id || user.bot) {
            return { accepted: false, counted: false };
        }

        const now = this.now();
        const day = new Date(now).toISOString().slice(0, 10);
        return this.sqlite.transaction(() => {
            if (!present) {
                const removed = this.sqlite.prepare(`
                    DELETE FROM reaction_placements
                    WHERE guild_id = ? AND message_id = ? AND user_id = ? AND emoji = ?
                `).run(guildId, messageId, user.id, emoji);
                return { accepted: Boolean(removed.changes), counted: false };
            }

            const inserted = this.sqlite.prepare(`
                INSERT OR IGNORE INTO reaction_placements
                    (guild_id, message_id, user_id, emoji, added_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(guildId, messageId, user.id, emoji, now);
            if (!inserted.changes) return { accepted: false, counted: false };

            this.sqlite.prepare(`
                INSERT INTO activity_logs
                    (user_id, guild_id, activity_date, reactions_given, updated_at)
                VALUES (?, ?, ?, 1, ?)
                ON CONFLICT(user_id, guild_id, activity_date) DO UPDATE SET
                    reactions_given = reactions_given + 1,
                    updated_at = excluded.updated_at
            `).run(user.id, guildId, day, now);
            this.sqlite.prepare(`
                INSERT INTO server_daily_metrics
                    (guild_id, activity_date, reaction_count, updated_at)
                VALUES (?, ?, 1, ?)
                ON CONFLICT(guild_id, activity_date) DO UPDATE SET
                    reaction_count = reaction_count + 1,
                    updated_at = excluded.updated_at
            `).run(guildId, day, now);
            return { accepted: true, counted: true };
        })();
    }

    recordMembership(member, present) {
        const guildId = member?.guild?.id;
        const userId = member?.id || member?.user?.id;
        if (!guildId || !userId || member?.user?.bot) {
            return { accepted: false, joined: 0, left: 0 };
        }

        const now = this.now();
        const day = new Date(now).toISOString().slice(0, 10);
        return this.sqlite.transaction(() => {
            const current = this.sqlite.prepare(`
                SELECT present FROM member_presence WHERE guild_id = ? AND user_id = ?
            `).get(guildId, userId);
            if (current && Boolean(current.present) === present) {
                return { accepted: false, joined: 0, left: 0 };
            }

            this.sqlite.prepare(`
                INSERT INTO member_presence (guild_id, user_id, present, last_observed_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(guild_id, user_id) DO UPDATE SET
                    present = excluded.present,
                    last_observed_at = excluded.last_observed_at
            `).run(guildId, userId, present ? 1 : 0, now);
            const joined = present ? 1 : 0;
            const left = present ? 0 : 1;
            this.sqlite.prepare(`
                INSERT INTO server_daily_metrics
                    (guild_id, activity_date, joins, leaves, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(guild_id, activity_date) DO UPDATE SET
                    joins = joins + excluded.joins,
                    leaves = leaves + excluded.leaves,
                    updated_at = excluded.updated_at
            `).run(guildId, day, joined, left, now);
            return { accepted: true, joined, left };
        })();
    }

    reconcileGuild(guild) {
        const now = this.now();
        const day = new Date(now).toISOString().slice(0, 10);
        const members = [...(guild?.members?.cache?.values?.() || [])]
            .filter(member => !member.user?.bot);
        const voiceStates = [...(guild?.voiceStates?.cache?.values?.() || [])]
            .filter(state => state.channelId && !state.member?.user?.bot && !state.mute && !state.deaf);

        return this.sqlite.transaction(() => {
            this.sqlite.prepare(`
                INSERT OR IGNORE INTO level_configs (guild_id, baseline_at, updated_at)
                VALUES (?, ?, ?)
            `).run(guild.id, now, now);
            this.sqlite.prepare(`
                UPDATE level_configs SET baseline_at = COALESCE(baseline_at, ?), updated_at = ?
                WHERE guild_id = ?
            `).run(now, now, guild.id);
            const config = this.sqlite.prepare(`SELECT antiafk_enabled FROM level_configs WHERE guild_id = ?`).get(guild.id);
            this.sqlite.prepare(`
                INSERT INTO server_daily_metrics
                    (guild_id, activity_date, member_count, baseline_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(guild_id, activity_date) DO UPDATE SET
                    member_count = excluded.member_count,
                    baseline_at = COALESCE(server_daily_metrics.baseline_at, excluded.baseline_at),
                    updated_at = excluded.updated_at
            `).run(guild.id, day, members.length, now, now);

            const currentIds = new Set(members.map(member => member.id));
            for (const row of this.sqlite.prepare(`
                SELECT user_id FROM member_presence WHERE guild_id = ? AND present = 1
            `).all(guild.id)) {
                if (!currentIds.has(row.user_id)) this.sqlite.prepare(`
                    UPDATE member_presence SET present = 0, last_observed_at = ?
                    WHERE guild_id = ? AND user_id = ?
                `).run(now, guild.id, row.user_id);
            }
            const upsertPresence = this.sqlite.prepare(`
                INSERT INTO member_presence (guild_id, user_id, present, last_observed_at)
                VALUES (?, ?, 1, ?)
                ON CONFLICT(guild_id, user_id) DO UPDATE SET present = 1, last_observed_at = excluded.last_observed_at
            `);
            for (const member of members) upsertPresence.run(guild.id, member.id, now);

            this.sqlite.prepare(`DELETE FROM level_voice_sessions WHERE guild_id = ?`).run(guild.id);
            const peers = new Map();
            for (const state of voiceStates) peers.set(state.channelId, (peers.get(state.channelId) || 0) + 1);
            const eligible = voiceStates.filter(state => !config.antiafk_enabled || peers.get(state.channelId) > 1);
            const insertVoice = this.sqlite.prepare(`
                INSERT INTO level_voice_sessions
                    (guild_id, user_id, channel_id, eligible_since, last_observed_at)
                VALUES (?, ?, ?, ?, ?)
            `);
            for (const state of eligible) insertVoice.run(guild.id, state.member.id, state.channelId, now, now);
            return { members: members.length, voiceSessions: eligible.length };
        })();
    }

    async reconcileStartup(client) {
        const results = [];
        const failures = [];
        for (const guild of client.guilds.cache.values()) {
            try {
                await guild.members.fetch();
                results.push({ guildId: guild.id, ...this.reconcileGuild(guild) });
            } catch (error) {
                failures.push({ guildId: guild.id, error: error.message });
            }
        }
        return { results, failures };
    }
}

module.exports = LevelAnalyticsService;
module.exports.levelForXp = levelForXp;
