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
}

module.exports = LevelAnalyticsService;
module.exports.levelForXp = levelForXp;
