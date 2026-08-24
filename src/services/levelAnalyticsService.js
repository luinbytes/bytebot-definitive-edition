const { MessageFlags, PermissionFlagsBits } = require('discord.js');

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

    reconcileVoiceState(oldState, newState) {
        const guild = newState?.guild || oldState?.guild;
        if (!guild?.id) return { settledSeconds: 0, xpAwarded: 0 };
        const now = this.now();
        const day = new Date(now).toISOString().slice(0, 10);
        const states = [...(guild.voiceStates?.cache?.values?.() || [])]
            .filter(state => state.channelId && !state.member?.user?.bot);

        return this.sqlite.transaction(() => {
            this.sqlite.prepare(`INSERT OR IGNORE INTO level_configs (guild_id, updated_at) VALUES (?, ?)`)
                .run(guild.id, now);
            const config = this.sqlite.prepare(`SELECT * FROM level_configs WHERE guild_id = ?`).get(guild.id);
            const peers = new Map();
            for (const state of states) peers.set(state.channelId, (peers.get(state.channelId) || 0) + 1);
            const desired = new Map(states.map(state => [state.member.id, {
                state,
                eligible: Boolean(config.voice_enabled && !state.mute && !state.deaf
                    && (!config.antiafk_enabled || peers.get(state.channelId) > 1))
            }]));
            let settledSeconds = 0;
            let xpAwarded = 0;

            const sessions = this.sqlite.prepare(`
                SELECT * FROM level_voice_sessions WHERE guild_id = ?
            `).all(guild.id);
            for (const session of sessions) {
                let remainder = session.remainder_seconds;
                let sessionAwarded = session.awarded_xp;
                if (session.eligible_since != null) {
                    const seconds = Math.max(0, Math.floor((now - session.last_observed_at) / 1000));
                    if (seconds) {
                        settledSeconds += seconds;
                        this.sqlite.prepare(`
                            INSERT INTO activity_logs
                                (user_id, guild_id, activity_date, voice_seconds, updated_at)
                            VALUES (?, ?, ?, ?, ?)
                            ON CONFLICT(user_id, guild_id, activity_date) DO UPDATE SET
                                voice_seconds = voice_seconds + excluded.voice_seconds,
                                updated_at = excluded.updated_at
                        `).run(session.user_id, guild.id, day, seconds, now);
                        this.sqlite.prepare(`
                            UPDATE activity_logs SET voice_minutes = CAST(voice_seconds / 60 AS INTEGER)
                            WHERE user_id = ? AND guild_id = ? AND activity_date = ?
                        `).run(session.user_id, guild.id, day);
                        this.sqlite.prepare(`
                            INSERT INTO server_daily_metrics
                                (guild_id, activity_date, voice_seconds, updated_at)
                            VALUES (?, ?, ?, ?)
                            ON CONFLICT(guild_id, activity_date) DO UPDATE SET
                                voice_seconds = voice_seconds + excluded.voice_seconds,
                                updated_at = excluded.updated_at
                        `).run(guild.id, day, seconds, now);

                        const active = desired.get(session.user_id)?.state;
                        const observedMember = active?.member
                            || (oldState?.member?.id === session.user_id ? oldState.member : null);
                        const roles = roleIds(observedMember);
                        const targets = [['channel', session.channel_id], ...roles.map(id => ['role', id])];
                        let targetMultiplier = 1;
                        for (const [type, id] of targets) {
                            const boost = this.sqlite.prepare(`
                                SELECT multiplier FROM level_boosts
                                WHERE guild_id = ? AND target_type = ? AND target_id = ?
                            `).get(guild.id, type, id);
                            if (boost) targetMultiplier = Math.max(targetMultiplier, boost.multiplier);
                        }
                        const total = remainder + seconds;
                        const completeMinutes = Math.floor(total / 60);
                        remainder = total % 60;
                        const calculated = Math.floor(completeMinutes * config.voice_xp_per_minute
                            * Math.min(10, config.base_multiplier * targetMultiplier));
                        const award = Math.min(calculated, Math.max(0, config.voice_session_xp_cap - sessionAwarded));
                        sessionAwarded += award;
                        xpAwarded += award;

                        this.sqlite.prepare(`
                            INSERT OR IGNORE INTO member_levels
                                (guild_id, user_id, xp, level, text_xp, voice_xp,
                                 manual_adjustment, level_floor, message_count, voice_seconds, updated_at)
                            VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0, 0, ?)
                        `).run(guild.id, session.user_id, now);
                        const member = this.sqlite.prepare(`
                            SELECT * FROM member_levels WHERE guild_id = ? AND user_id = ?
                        `).get(guild.id, session.user_id);
                        const voiceXp = member.voice_xp + award;
                        const xp = Math.max(0, member.text_xp + voiceXp + member.manual_adjustment);
                        const level = Math.max(member.level_floor, levelForXp(xp));
                        this.sqlite.prepare(`
                            UPDATE member_levels SET xp = ?, level = ?, voice_xp = ?,
                                voice_seconds = voice_seconds + ?, updated_at = ?
                            WHERE guild_id = ? AND user_id = ?
                        `).run(xp, level, voiceXp, seconds, now, guild.id, session.user_id);
                    }
                }

                const next = desired.get(session.user_id);
                if (!next) {
                    this.sqlite.prepare(`
                        DELETE FROM level_voice_sessions WHERE guild_id = ? AND user_id = ?
                    `).run(guild.id, session.user_id);
                    continue;
                }
                if (next.state.channelId !== session.channel_id) {
                    remainder = 0;
                    sessionAwarded = 0;
                }
                this.sqlite.prepare(`
                    UPDATE level_voice_sessions SET channel_id = ?, eligible_since = ?,
                        last_observed_at = ?, remainder_seconds = ?, awarded_xp = ?
                    WHERE guild_id = ? AND user_id = ?
                `).run(next.state.channelId, next.eligible ? now : null, now, remainder,
                    sessionAwarded, guild.id, session.user_id);
                desired.delete(session.user_id);
            }

            const insert = this.sqlite.prepare(`
                INSERT INTO level_voice_sessions
                    (guild_id, user_id, channel_id, eligible_since, last_observed_at)
                VALUES (?, ?, ?, ?, ?)
            `);
            for (const [userId, next] of desired) {
                insert.run(guild.id, userId, next.state.channelId, next.eligible ? now : null, now);
            }
            return { settledSeconds, xpAwarded };
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

    async execute(interaction) {
        const group = interaction.options.getSubcommandGroup(false);
        const action = interaction.options.getSubcommand();
        if (group === 'config') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                throw new Error('You need Manage Server to configure levels.');
            }
            if (action === 'rate') {
                const multiplier = interaction.options.getNumber('multiplier', true);
                if (!Number.isFinite(multiplier) || multiplier < 0 || multiplier > 10) {
                    throw new Error('Multiplier must be between 0 and 10.');
                }
                const now = this.now();
                this.sqlite.prepare(`
                    INSERT INTO level_configs (guild_id, base_multiplier, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(guild_id) DO UPDATE SET
                        base_multiplier = excluded.base_multiplier,
                        updated_at = excluded.updated_at
                `).run(interaction.guildId, multiplier, now);
                return interaction.reply({
                    content: `XP gain multiplier has been set to **${multiplier}x**.`,
                    flags: [MessageFlags.Ephemeral],
                    allowedMentions: { parse: [] }
                });
            }
        }
        throw new Error('That levels action is not available yet.');
    }
}

module.exports = LevelAnalyticsService;
module.exports.levelForXp = levelForXp;
