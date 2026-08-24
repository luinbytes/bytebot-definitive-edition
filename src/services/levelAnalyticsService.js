const crypto = require('crypto');
const sharp = require('sharp');
const {
    ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder,
    MessageFlags, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle
} = require('discord.js');
const { ServerPresentationService } = require('./serverPresentationService');
const config = require('../utils/config');
const embeds = require('../utils/embeds');

const MAX_LEVEL = 999;

function levelForXp(xp) {
    return Math.min(MAX_LEVEL, Math.floor(Math.sqrt(Math.max(0, xp) / 100)));
}

function roleIds(member) {
    return [...(member?.roles?.cache?.keys?.() || [])];
}

function xml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
}

function utcSegments(start, seconds) {
    const segments = [];
    let cursor = start;
    let remaining = seconds;
    while (remaining > 0) {
        const date = new Date(cursor);
        const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
        const available = Math.max(1, Math.floor((midnight - cursor) / 1000));
        const length = Math.min(remaining, available);
        segments.push({ day: date.toISOString().slice(0, 10), seconds: length });
        cursor += length * 1000;
        remaining -= length;
    }
    return segments;
}

class LevelAnalyticsService {
    constructor({ sqlite, client = null, images = null, now = Date.now }) {
        this.sqlite = sqlite;
        this.client = client;
        this.now = now;
        this.images = images || new ServerPresentationService({ sqlite });
        this.confirmations = new Map();
    }

    response(title, description, extra = {}) {
        return { embeds: [embeds.brand(title, description)], allowedMentions: { parse: [] }, ...extra };
    }

    assertRoleMutationAuthority(interaction) {
        const rewards = this.sqlite.prepare(`SELECT role_id FROM level_role_rewards WHERE guild_id = ?`)
            .all(interaction.guildId);
        if (!rewards.length) return;
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            throw new Error('You need Manage Roles because this XP change can update reward roles.');
        }
        const bot = interaction.guild.members.me;
        if (!bot.permissions.has(PermissionFlagsBits.ManageRoles)) {
            throw new Error('I need Manage Roles because this XP change can update reward roles.');
        }
        for (const reward of rewards) {
            const role = interaction.guild.roles.cache.get(reward.role_id);
            if (!role || role.managed) continue;
            if (interaction.member.roles.highest.comparePositionTo(role) <= 0) {
                throw new Error('Your highest role must be above every reward role this XP change can update.');
            }
            if (bot.roles.highest.comparePositionTo(role) <= 0) {
                throw new Error('My highest role must be above every reward role this XP change can update.');
            }
        }
    }

    async acknowledge(interaction, flags = []) {
        if (!interaction.deferReply || interaction.deferred || interaction.replied) return false;
        await interaction.deferReply({ flags });
        return true;
    }

    send(interaction, payload, acknowledged = false) {
        return acknowledged ? interaction.editReply(payload) : interaction.reply(payload);
    }

    async acknowledgeUpdate(interaction) {
        if (!interaction.deferUpdate || interaction.deferred || interaction.replied) return false;
        await interaction.deferUpdate();
        return true;
    }

    update(interaction, payload, acknowledged = false) {
        return acknowledged ? interaction.editReply(payload) : interaction.update(payload);
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
            if (level !== current.level) this.enqueueRoleReconcile(guildId, userId, now);

            return {
                accepted: true,
                duplicate: false,
                xpAwarded,
                level,
                previousLevel: current.level,
                roleReconcile: level !== current.level
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
            const memberCount = this.sqlite.prepare(`
                SELECT COUNT(*) AS count FROM member_presence WHERE guild_id = ? AND present = 1
            `).get(guildId).count;
            this.sqlite.prepare(`
                INSERT INTO server_daily_metrics
                    (guild_id, activity_date, joins, leaves, member_count, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(guild_id, activity_date) DO UPDATE SET
                    joins = joins + excluded.joins,
                    leaves = leaves + excluded.leaves,
                    member_count = excluded.member_count,
                    updated_at = excluded.updated_at
            `).run(guildId, day, joined, left, memberCount, now);
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

    snapshotGuild(guild) {
        return this.reconcileGuild(guild);
    }

    reconcileVoiceState(oldState, newState) {
        const guild = newState?.guild || oldState?.guild;
        if (!guild?.id) return { settledSeconds: 0, xpAwarded: 0 };
        const now = this.now();
        const states = [...(guild.voiceStates?.cache?.values?.() || [])]
            .filter(state => state.channelId && !state.member?.user?.bot);

        return this.sqlite.transaction(() => {
            this.sqlite.prepare(`INSERT OR IGNORE INTO level_configs (guild_id, updated_at) VALUES (?, ?)`)
                .run(guild.id, now);
            const config = this.sqlite.prepare(`SELECT * FROM level_configs WHERE guild_id = ?`).get(guild.id);
            const peers = new Map();
            for (const state of states) peers.set(state.channelId, (peers.get(state.channelId) || 0) + 1);
            const desired = new Map(states.map(state => {
                const roles = roleIds(state.member);
                const ignoredChannel = this.sqlite.prepare(`
                    SELECT 1 FROM level_ignores WHERE guild_id = ? AND target_type = 'channel' AND target_id = ?
                `).get(guild.id, state.channelId);
                const ignoredRole = roles.length && this.sqlite.prepare(`
                    SELECT 1 FROM level_ignores WHERE guild_id = ? AND target_type = 'role'
                      AND target_id IN (${roles.map(() => '?').join(',')}) LIMIT 1
                `).get(guild.id, ...roles);
                return [state.member.id, {
                    state,
                    eligible: Boolean(config.voice_enabled && !state.mute && !state.deaf
                        && !ignoredChannel && !ignoredRole
                        && (!config.antiafk_enabled || peers.get(state.channelId) > 1))
                }];
            }));
            let settledSeconds = 0;
            let xpAwarded = 0;
            const roleReconcileUserIds = [];

            const sessions = this.sqlite.prepare(`
                SELECT * FROM level_voice_sessions WHERE guild_id = ?
            `).all(guild.id);
            for (const session of sessions) {
                let remainder = session.remainder_seconds;
                let sessionAwarded = session.awarded_xp;
                let eligibleSeconds = session.eligible_seconds;
                let xpSecondsConsumed = session.xp_seconds_consumed;
                if (session.eligible_since != null) {
                    const seconds = Math.max(0, Math.floor((now - session.last_observed_at) / 1000));
                    if (seconds) {
                        settledSeconds += seconds;
                        eligibleSeconds += seconds;
                        for (const segment of utcSegments(session.last_observed_at, seconds)) {
                            this.sqlite.prepare(`
                                INSERT INTO activity_logs
                                    (user_id, guild_id, activity_date, voice_seconds, updated_at)
                                VALUES (?, ?, ?, ?, ?)
                                ON CONFLICT(user_id, guild_id, activity_date) DO UPDATE SET
                                    voice_seconds = voice_seconds + excluded.voice_seconds,
                                    updated_at = excluded.updated_at
                            `).run(session.user_id, guild.id, segment.day, segment.seconds, now);
                            this.sqlite.prepare(`
                                UPDATE activity_logs SET voice_minutes = CAST(voice_seconds / 60 AS INTEGER)
                                WHERE user_id = ? AND guild_id = ? AND activity_date = ?
                            `).run(session.user_id, guild.id, segment.day);
                            this.sqlite.prepare(`
                                INSERT INTO server_daily_metrics
                                    (guild_id, activity_date, voice_seconds, updated_at)
                                VALUES (?, ?, ?, ?)
                                ON CONFLICT(guild_id, activity_date) DO UPDATE SET
                                    voice_seconds = voice_seconds + excluded.voice_seconds,
                                    updated_at = excluded.updated_at
                            `).run(guild.id, segment.day, segment.seconds, now);
                        }

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
                        const earnedSeconds = eligibleSeconds >= config.voice_min_seconds
                            ? Math.floor(eligibleSeconds / 60) * 60
                            : 0;
                        const newXpSeconds = Math.max(0, earnedSeconds - xpSecondsConsumed);
                        const completeMinutes = newXpSeconds / 60;
                        xpSecondsConsumed += newXpSeconds;
                        remainder = eligibleSeconds % 60;
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
                        if (level !== member.level) {
                            roleReconcileUserIds.push(session.user_id);
                            this.enqueueRoleReconcile(guild.id, session.user_id, now);
                        }
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
                    eligibleSeconds = 0;
                    xpSecondsConsumed = 0;
                }
                this.sqlite.prepare(`
                    UPDATE level_voice_sessions SET channel_id = ?, eligible_since = ?,
                        last_observed_at = ?, remainder_seconds = ?, awarded_xp = ?,
                        eligible_seconds = ?, xp_seconds_consumed = ?
                    WHERE guild_id = ? AND user_id = ?
                `).run(next.state.channelId, next.eligible ? now : null, now, remainder,
                    sessionAwarded, eligibleSeconds, xpSecondsConsumed, guild.id, session.user_id);
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
            return { settledSeconds, xpAwarded, roleReconcileUserIds };
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

    memberRow(guildId, userId) {
        return this.sqlite.prepare(`
            SELECT * FROM member_levels WHERE guild_id = ? AND user_id = ?
        `).get(guildId, userId) || {
            user_id: userId, xp: 0, level: 0, text_xp: 0, voice_xp: 0,
            message_count: 0, voice_seconds: 0
        };
    }

    memberRank(guildId, row) {
        return this.sqlite.prepare(`
            SELECT COUNT(*) + 1 AS rank FROM member_levels
            WHERE guild_id = ? AND (xp > ? OR (xp = ? AND user_id < ?))
        `).get(guildId, row.xp, row.xp, row.user_id).rank;
    }

    async rankCard(user, member, guild) {
        const row = this.memberRow(guild.id, user.id);
        const prefs = this.sqlite.prepare(`SELECT * FROM level_rank_cards WHERE user_id = ?`).get(user.id) || {};
        const accent = /^#[0-9a-f]{6}$/i.test(prefs.accent || '') ? prefs.accent : config.brand.color;
        const width = prefs.layout === 'compact' ? 760 : 900;
        const height = prefs.layout === 'compact' ? 220 : 280;
        const nextXp = row.level >= MAX_LEVEL ? row.xp : 100 * (row.level + 1) ** 2;
        const previousXp = 100 * row.level ** 2;
        const progress = nextXp === previousXp ? 1 : Math.max(0, Math.min(1, (row.xp - previousXp) / (nextXp - previousXp)));
        let image = prefs.background_data
            ? sharp(prefs.background_data, { limitInputPixels: 40_000_000 }).resize(width, height, { fit: 'cover' })
            : sharp({ create: { width, height, channels: 4, background: '#17191f' } });
        const avatarSize = prefs.layout === 'compact' ? 130 : 170;
        const avatarX = 35;
        const avatarY = Math.floor((height - avatarSize) / 2);
        const textX = avatarX + avatarSize + 35;
        const barWidth = width - textX - 45;
        const border = Math.max(0, Math.min(20, prefs.avatar_border ?? 4));
        const overlay = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="#0b0c10" fill-opacity="0.68"/>
            <circle cx="${avatarX + avatarSize / 2}" cy="${avatarY + avatarSize / 2}" r="${avatarSize / 2 + border / 2}" fill="none" stroke="${accent}" stroke-width="${border}"/>
            <text x="${textX}" y="70" fill="white" font-size="32" font-family="sans-serif" font-weight="700">${xml(member?.displayName || user.username || user.id)}</text>
            <text x="${textX}" y="112" fill="${accent}" font-size="24" font-family="sans-serif">Rank #${this.memberRank(guild.id, row)} · Level ${row.level}</text>
            <text x="${textX}" y="150" fill="#d8dbe2" font-size="20" font-family="sans-serif">${row.xp} / ${nextXp} XP</text>
            <rect x="${textX}" y="172" width="${barWidth}" height="18" rx="9" fill="#30343d"/>
            <rect x="${textX}" y="172" width="${Math.round(barWidth * progress)}" height="18" rx="9" fill="${accent}"/>
            <text x="${textX}" y="${height - 28}" fill="#b8bdc9" font-size="16" font-family="sans-serif">Text ${row.text_xp} XP · Voice ${row.voice_xp} XP</text>
        </svg>`);
        const composites = [{ input: overlay }];
        const avatarUrl = user.displayAvatarURL?.({ extension: 'png', size: 256 });
        if (avatarUrl) {
            const avatar = await this.images.image(avatarUrl);
            const mask = Buffer.from(`<svg width="${avatarSize}" height="${avatarSize}"><circle cx="${avatarSize / 2}" cy="${avatarSize / 2}" r="${avatarSize / 2}" fill="white"/></svg>`);
            const rounded = await sharp(avatar).resize(avatarSize, avatarSize).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
            composites.unshift({ input: rounded, left: avatarX, top: avatarY });
        }
        const png = await image.composite(composites).png().toBuffer();
        return { files: [new AttachmentBuilder(png, { name: `rank-${user.id}.png` })], allowedMentions: { parse: [] } };
    }

    liveBoardPayload(guildId, metric) {
        const column = metric === 'voice' ? 'voice_xp' : 'text_xp';
        const rows = this.sqlite.prepare(`
            SELECT user_id, ${column} AS score, xp FROM member_levels WHERE guild_id = ?
            ORDER BY ${column} DESC, xp DESC, user_id ASC LIMIT 10
        `).all(guildId);
        return {
            embeds: [embeds.brand(`Live ${metric} XP leaderboard`, rows.length
                ? rows.map((row, index) => `**${index + 1}.** <@${row.user_id}> — **${row.score}** XP`).join('\n')
                : 'No one has earned any XP yet.')], allowedMentions: { parse: [] }
        };
    }

    liveBoardToken(guildId, channelId, metric) {
        return crypto.createHash('sha256').update(`${guildId}:${channelId}:${metric}`).digest('hex').slice(0, 24);
    }

    async deliverLiveBoard(board, channel) {
        const token = board.create_token || this.liveBoardToken(board.guild_id, board.channel_id, board.metric);
        if (!board.create_token) this.sqlite.prepare(`
            UPDATE level_live_boards SET create_token = ?
            WHERE guild_id = ? AND channel_id = ? AND metric = ? AND create_token IS NULL
        `).run(token, board.guild_id, board.channel_id, board.metric);
        let message = null;
        if (board.message_id) {
            try {
                message = await channel.messages.fetch(board.message_id);
            } catch (error) {
                if (error?.code !== 10008) throw error;
            }
        }
        const payload = this.liveBoardPayload(board.guild_id, board.metric);
        if (message) {
            await message.edit(payload);
        } else {
            const now = this.now();
            if (board.create_status === 'creating' && now - (board.create_started_at || 0) > 5 * 60 * 1000) {
                throw new Error('board creation outcome is uncertain; administrator recovery is required');
            }
            if (board.create_status !== 'creating') this.sqlite.prepare(`
                UPDATE level_live_boards SET create_status = 'creating', create_started_at = ?, updated_at = ?
                WHERE guild_id = ? AND channel_id = ? AND metric = ? AND create_status = 'active'
            `).run(now, now, board.guild_id, board.channel_id, board.metric);
            try {
                message = await channel.send({ ...payload, nonce: token, enforceNonce: true });
            } catch (error) {
                const status = Number(error?.status || error?.httpStatus);
                if (status >= 400 && status < 500) this.sqlite.prepare(`
                    UPDATE level_live_boards SET create_status = 'active', create_started_at = NULL, updated_at = ?
                    WHERE guild_id = ? AND channel_id = ? AND metric = ?
                `).run(this.now(), board.guild_id, board.channel_id, board.metric);
                throw error;
            }
        }
        this.sqlite.prepare(`
            UPDATE level_live_boards SET message_id = ?, create_status = 'active', create_started_at = NULL,
                revision = revision + 1, updated_at = ?
            WHERE guild_id = ? AND channel_id = ? AND metric = ?
        `).run(message.id, this.now(), board.guild_id, board.channel_id, board.metric);
        return message;
    }

    async refreshLiveBoards() {
        if (!this.client) return { updated: 0, failures: [] };
        let updated = 0;
        const failures = [];
        for (const board of this.sqlite.prepare(`SELECT * FROM level_live_boards ORDER BY guild_id, channel_id, metric`).all()) {
            try {
                const guild = this.client.guilds.cache.get(board.guild_id);
                const channel = guild?.channels.cache.get(board.channel_id)
                    || await guild?.channels.fetch(board.channel_id).catch(() => null);
                if (!channel?.send || !channel.messages?.fetch) throw new Error('channel unavailable');
                await this.deliverLiveBoard(board, channel);
                updated += 1;
            } catch (error) {
                failures.push({ guildId: board.guild_id, channelId: board.channel_id, metric: board.metric, error: error.message });
            }
        }
        return { updated, failures };
    }

    pruneAnalytics(limit = 1000) {
        const cutoffAt = this.now() - 1095 * 86400000;
        const cutoffDate = new Date(cutoffAt).toISOString().slice(0, 10);
        return this.sqlite.transaction(() => ({
            daily: this.sqlite.prepare(`DELETE FROM server_daily_metrics WHERE rowid IN (
                SELECT rowid FROM server_daily_metrics WHERE activity_date < ? LIMIT ?
            )`).run(cutoffDate, limit).changes,
            activity: this.sqlite.prepare(`DELETE FROM activity_logs WHERE rowid IN (
                SELECT rowid FROM activity_logs WHERE activity_date < ? LIMIT ?
            )`).run(cutoffDate, limit).changes,
            dedupe: this.sqlite.prepare(`DELETE FROM analytics_events WHERE rowid IN (
                SELECT rowid FROM analytics_events WHERE occurred_at < ? LIMIT ?
            )`).run(cutoffAt, limit).changes
        }))();
    }

    enqueueRoleReconcile(guildId, userId, now = this.now()) {
        this.sqlite.prepare(`
            INSERT INTO level_role_jobs (guild_id, user_id, attempts, next_attempt_at, updated_at)
            VALUES (?, ?, 0, ?, ?)
            ON CONFLICT(guild_id, user_id) DO UPDATE SET
                attempts = 0, generation = level_role_jobs.generation + 1,
                claim_token = NULL, claim_expires_at = NULL,
                next_attempt_at = excluded.next_attempt_at, updated_at = excluded.updated_at
        `).run(guildId, userId, now, now);
    }

    async processRoleJobs(limit = 50) {
        if (!this.client) return { processed: 0, failures: [] };
        const rows = this.sqlite.prepare(`
            SELECT * FROM level_role_jobs WHERE next_attempt_at <= ?
            ORDER BY next_attempt_at, guild_id, user_id LIMIT ?
        `).all(this.now(), limit);
        const failures = [];
        for (const row of rows) {
            const token = crypto.randomBytes(12).toString('hex');
            const claimedAt = this.now();
            const claimed = this.sqlite.prepare(`
                UPDATE level_role_jobs SET claim_token = ?, claim_expires_at = ?
                WHERE guild_id = ? AND user_id = ? AND generation = ?
                  AND (claim_token IS NULL OR claim_expires_at <= ?)
            `).run(token, claimedAt + 5 * 60 * 1000, row.guild_id, row.user_id, row.generation, claimedAt);
            if (!claimed.changes) continue;
            try {
                const guild = this.client.guilds.cache.get(row.guild_id);
                if (!guild) throw new Error('guild unavailable');
                let member = guild.members.cache.get(row.user_id);
                if (!member) {
                    try {
                        member = await guild.members.fetch(row.user_id);
                    } catch (error) {
                        if (error?.code !== 10007) throw error;
                    }
                }
                if (member) await this.reconcileMemberRoles(member);
                this.sqlite.prepare(`
                    DELETE FROM level_role_jobs
                    WHERE guild_id = ? AND user_id = ? AND generation = ? AND claim_token = ?
                `).run(row.guild_id, row.user_id, row.generation, token);
            } catch (error) {
                const attempts = row.attempts + 1;
                const retryAt = this.now() + Math.min(3_600_000, 1000 * 2 ** Math.min(attempts, 12));
                this.sqlite.prepare(`
                    UPDATE level_role_jobs SET attempts = ?, next_attempt_at = ?, updated_at = ?,
                        claim_token = NULL, claim_expires_at = NULL
                    WHERE guild_id = ? AND user_id = ? AND generation = ? AND claim_token = ?
                `).run(attempts, retryAt, this.now(), row.guild_id, row.user_id, row.generation, token);
                failures.push({ guildId: row.guild_id, userId: row.user_id, error: error.message });
            }
        }
        return { processed: rows.length - failures.length, failures };
    }

    async reconcileMemberRoles(member) {
        if (!member || member.user?.bot) return false;
        const bot = member.guild.members.me;
        if (!bot?.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('Manage Roles is unavailable');
        const config = this.sqlite.prepare(`SELECT stack_roles FROM level_configs WHERE guild_id = ?`).get(member.guild.id);
        const rewards = this.sqlite.prepare(`
            SELECT level, role_id FROM level_role_rewards WHERE guild_id = ? ORDER BY level
        `).all(member.guild.id).filter(reward => {
            const role = member.guild.roles.cache.get(reward.role_id);
            return role && !role.managed && bot.roles.highest.comparePositionTo(role) > 0;
        });
        if (!rewards.length) return false;
        const level = this.memberRow(member.guild.id, member.id).level;
        const earned = rewards.filter(reward => reward.level <= level);
        const wanted = new Set((config?.stack_roles ? earned : earned.slice(-1)).map(reward => reward.role_id));
        const configured = new Set(rewards.map(reward => reward.role_id));
        const add = [...wanted].filter(id => !member.roles.cache.has(id));
        const remove = [...configured].filter(id => !wanted.has(id) && member.roles.cache.has(id));
        if (add.length) await member.roles.add(add, 'Level reward reconciliation');
        if (remove.length) await member.roles.remove(remove, 'Level reward reconciliation');
        return Boolean(add.length || remove.length);
    }

    async removeRewardRole(guild, roleId) {
        const role = guild.roles.cache.get(roleId);
        const bot = guild.members.me;
        if (!role || role.managed || !bot.permissions.has(PermissionFlagsBits.ManageRoles)
            || bot.roles.highest.comparePositionTo(role) <= 0) {
            throw new Error('That reward role is no longer manageable by the bot.');
        }
        const members = await guild.members.fetch();
        const affected = [...members.values()].filter(member => !member.user.bot && member.roles.cache.has(roleId));
        const removed = [];
        try {
            for (const member of affected) {
                await member.roles.remove(roleId, 'Level reward removed');
                removed.push(member);
            }
        } catch (error) {
            for (const member of removed) await member.roles.add(roleId, 'Restore failed level reward removal').catch(() => null);
            throw error;
        }
        return affected;
    }

    async announceLevel(message, result) {
        if (!result?.accepted || result.level <= result.previousLevel) return false;
        const config = this.sqlite.prepare(`SELECT * FROM level_configs WHERE guild_id = ?`).get(message.guild.id);
        if (!config?.message_enabled || !config.award_channel_id || !config.award_message
            || !this.client?.richContentService) return false;
        const row = this.memberRow(message.guild.id, message.author.id);
        const payload = this.client.richContentService.renderLevel(config.award_message, {
            guild: message.guild, member: message.member, user: message.author,
            level: {
                current: row.level,
                next: Math.min(MAX_LEVEL, row.level + 1),
                rank: this.memberRank(message.guild.id, row),
                xp: row.xp,
                nextXp: row.level >= MAX_LEVEL ? row.xp : 100 * (row.level + 1) ** 2
            }
        });
        if (config.dm_enabled) {
            await message.member.send(payload);
            return true;
        }
        const channel = message.guild.channels.cache.get(config.award_channel_id)
            || await message.guild.channels.fetch(config.award_channel_id).catch(() => null);
        if (!channel?.send) throw new Error('The configured level-up channel is unavailable.');
        await channel.send(payload);
        return true;
    }

    setupPayload(guildId, actorId, page = 'main') {
        const config = this.sqlite.prepare(`SELECT * FROM level_configs WHERE guild_id = ?`).get(guildId);
        const id = action => `levels:setup:${action}:${actorId}`;
        const back = new ButtonBuilder().setCustomId(id('main')).setLabel('Back').setStyle(ButtonStyle.Secondary);
        if (page === 'settings') return {
            embeds: [embeds.brand('Level Setup', 'More Settings')],
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(id('dm')).setLabel(`DM: ${config.dm_enabled ? 'ON' : 'OFF'}`).setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(id('antiafk')).setLabel(`Anti-AFK: ${config.antiafk_enabled ? 'ON' : 'OFF'}`).setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(id('message')).setLabel('Award Message').setStyle(ButtonStyle.Primary),
                    back,
                    new ButtonBuilder().setCustomId(id('rules')).setLabel('XP Rules').setStyle(ButtonStyle.Secondary)
                ),
                new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder().setCustomId(id('channel')).setPlaceholder('Choose the award channel').setChannelTypes(0)
                ),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(id('message-disable')).setLabel('Disable Award Message').setStyle(ButtonStyle.Danger)
                )
            ], allowedMentions: { parse: [] }
        };
        if (page === 'roles') return {
            embeds: [embeds.brand('Level Setup', 'Level Roles')],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(id('role-add')).setLabel('Add Reward').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(id('role-remove')).setLabel('Remove Reward').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(id('sync')).setLabel('Sync Roles').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(id('stack')).setLabel(`Stack: ${config.stack_roles ? 'ON' : 'OFF'}`).setStyle(ButtonStyle.Secondary), back
            )], allowedMentions: { parse: [] }
        };
        return {
            embeds: [embeds.brand('Level Setup', 'Text and voice XP can be configured independently. Changes save automatically.')],
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(id('text')).setLabel(`Text: ${config.text_enabled ? 'ON' : 'OFF'}`).setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(id('voice')).setLabel(`Voice: ${config.voice_enabled ? 'ON' : 'OFF'}`).setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(id('roles')).setLabel('Level Roles').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(id('settings')).setLabel('More Settings').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(id('reset')).setLabel('Reset All XP').setStyle(ButtonStyle.Danger)
                ),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(id('cancel')).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                )
            ], allowedMentions: { parse: [] }
        };
    }

    async handleInteraction(interaction) {
        if (interaction.customId.startsWith('levels:confirm:') || interaction.customId.startsWith('levels:cancel:')) {
            const [, decision, token] = interaction.customId.split(':');
            const confirmation = this.confirmations.get(token);
            this.confirmations.delete(token);
            if (!confirmation || confirmation.expiresAt < this.now()
                || confirmation.guildId !== interaction.guildId || confirmation.actorId !== interaction.user.id) {
                throw new Error('That confirmation has expired or is not yours.');
            }
            const acknowledged = await this.acknowledgeUpdate(interaction);
            await this.assertRbac(interaction, 'reset', confirmation.scope === 'all' ? 'all' : 'user');
            if (decision === 'cancel') return this.update(interaction, this.response('Level Reset', 'Reset cancelled.', { components: [] }), acknowledged);
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) throw new Error('You need Manage Server to reset XP.');
            this.assertRoleMutationAuthority(interaction);
            this.sqlite.transaction(() => {
                if (confirmation.scope === 'all') {
                    const users = this.sqlite.prepare(`SELECT user_id FROM member_levels WHERE guild_id = ?`)
                        .all(interaction.guildId);
                    for (const { user_id } of users) this.enqueueRoleReconcile(interaction.guildId, user_id);
                    this.sqlite.prepare(`DELETE FROM member_levels WHERE guild_id = ?`).run(interaction.guildId);
                    this.sqlite.prepare(`DELETE FROM level_voice_sessions WHERE guild_id = ?`).run(interaction.guildId);
                } else {
                    this.enqueueRoleReconcile(interaction.guildId, confirmation.userId);
                    this.sqlite.prepare(`DELETE FROM member_levels WHERE guild_id = ? AND user_id = ?`)
                        .run(interaction.guildId, confirmation.userId);
                    this.sqlite.prepare(`DELETE FROM level_voice_sessions WHERE guild_id = ? AND user_id = ?`)
                        .run(interaction.guildId, confirmation.userId);
                }
            })();
            const members = confirmation.scope === 'all'
                ? await interaction.guild.members.fetch()
                : [await interaction.guild.members.fetch(confirmation.userId).catch(() => null)];
            for (const member of members.values()) if (member && !member.user.bot) await this.reconcileMemberRoles(member);
            return this.update(interaction, this.response('Level Reset', confirmation.scope === 'all'
                ? 'All XP has been reset for this server' : `XP has been reset for <@${confirmation.userId}>`, { components: [] }), acknowledged);
        }
        const [, area, action, actorId] = interaction.customId.split(':');
        if (area !== 'setup' || actorId !== interaction.user.id || !interaction.guildId) {
            throw new Error('That levels control is not available to you.');
        }
        await this.assertRbac(interaction, null, 'setup');
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            throw new Error('You need Manage Server to use level setup.');
        }
        this.sqlite.prepare(`INSERT OR IGNORE INTO level_configs (guild_id, updated_at) VALUES (?, ?)`)
            .run(interaction.guildId, this.now());
        if (interaction.isModalSubmit()) {
            const acknowledged = action === 'role-remove'
                ? await this.acknowledge(interaction, [MessageFlags.Ephemeral])
                : false;
            if (action === 'message') {
                const script = interaction.fields.getTextInputValue('script');
                if ([...script].length > 2000) throw new Error('Message must be 2000 characters or less.');
                this.client.richContentService.renderLevel(script, {
                    guild: interaction.guild, member: interaction.member, user: interaction.user,
                    level: { current: 1, next: 2, rank: 1, xp: 100, nextXp: 400 }
                });
                this.sqlite.prepare(`UPDATE level_configs SET award_message = ?, message_enabled = 1, updated_at = ? WHERE guild_id = ?`)
                    .run(script, this.now(), interaction.guildId);
            } else if (action === 'rules') {
                const rate = Number(interaction.fields.getTextInputValue('rate'));
                const voiceXp = Number(interaction.fields.getTextInputValue('voice_xp'));
                const voiceMin = Number(interaction.fields.getTextInputValue('voice_min'));
                const voiceCap = Number(interaction.fields.getTextInputValue('voice_cap'));
                if (!Number.isFinite(rate) || rate < 0 || rate > 10
                    || !Number.isInteger(voiceXp) || voiceXp < 0 || voiceXp > 1000
                    || !Number.isInteger(voiceMin) || voiceMin < 1 || voiceMin > 3600
                    || !Number.isInteger(voiceCap) || voiceCap < 0 || voiceCap > 1_000_000) {
                    throw new Error('Use rate 0–10, voice XP 0–1000, minimum 1–3600 seconds, and cap 0–1000000.');
                }
                this.sqlite.prepare(`
                    UPDATE level_configs SET base_multiplier = ?, voice_xp_per_minute = ?,
                        voice_min_seconds = ?, voice_session_xp_cap = ?, updated_at = ? WHERE guild_id = ?
                `).run(rate, voiceXp, voiceMin, voiceCap, this.now(), interaction.guildId);
            } else if (action === 'role-add' || action === 'role-remove') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('You need Manage Roles.');
                const role = interaction.guild.roles.cache.get(interaction.fields.getTextInputValue('role'));
                const level = Number(interaction.fields.getTextInputValue('level'));
                if (!role || !Number.isInteger(level) || level < 1 || level > MAX_LEVEL) throw new Error('Use a valid role ID and level from 1 to 999.');
                const bot = interaction.guild.members.me;
                if (!bot.permissions.has(PermissionFlagsBits.ManageRoles) || role.managed
                    || bot.roles.highest.comparePositionTo(role) <= 0
                    || interaction.member.roles.highest.comparePositionTo(role) <= 0) throw new Error('That role is above the manageable hierarchy.');
                if (action === 'role-remove') {
                    const configured = this.sqlite.prepare(`SELECT 1 FROM level_role_rewards WHERE guild_id = ? AND level = ? AND role_id = ?`)
                        .get(interaction.guildId, level, role.id);
                    const affected = configured ? await this.removeRewardRole(interaction.guild, role.id) : [];
                    this.sqlite.prepare(`DELETE FROM level_role_rewards WHERE guild_id = ? AND level = ? AND role_id = ?`)
                        .run(interaction.guildId, level, role.id);
                    for (const member of affected) await this.reconcileMemberRoles(member);
                } else {
                    const count = this.sqlite.prepare(`SELECT COUNT(*) AS count FROM level_role_rewards WHERE guild_id = ?`).get(interaction.guildId).count;
                    const prior = this.sqlite.prepare(`SELECT role_id FROM level_role_rewards WHERE guild_id = ? AND level = ?`).get(interaction.guildId, level);
                    if (count >= 50 && !prior) throw new Error('A server can configure at most 50 level rewards.');
                    if (prior && prior.role_id !== role.id) throw new Error('Remove the existing reward for that level first.');
                    this.sqlite.prepare(`INSERT INTO level_role_rewards (guild_id, level, role_id, created_at) VALUES (?, ?, ?, ?)
                        ON CONFLICT(guild_id, level) DO UPDATE SET role_id = excluded.role_id`)
                        .run(interaction.guildId, level, role.id, this.now());
                }
            }
            return this.send(interaction, this.response('Level Setup', 'Level setup updated.', {
                ...(!acknowledged && { flags: [MessageFlags.Ephemeral] })
            }), acknowledged);
        }
        if (interaction.isChannelSelectMenu()) {
            const channel = interaction.channels.first();
            const permissions = interaction.guild.members.me.permissionsIn(channel);
            if (!permissions.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
                throw new Error('I need View Channel, Send Messages, and Embed Links there.');
            }
            this.sqlite.prepare(`UPDATE level_configs SET award_channel_id = ?, updated_at = ? WHERE guild_id = ?`)
                .run(channel.id, this.now(), interaction.guildId);
            return interaction.update(this.setupPayload(interaction.guildId, actorId, 'settings'));
        }
        if (['message', 'rules', 'role-add', 'role-remove'].includes(action)) {
            const current = this.sqlite.prepare(`SELECT * FROM level_configs WHERE guild_id = ?`).get(interaction.guildId);
            const modal = new ModalBuilder().setCustomId(`levels:setup:${action}:${actorId}`)
                .setTitle(action === 'message' ? 'Custom Level Up Message'
                    : action === 'rules' ? 'XP Rules'
                        : action === 'role-add' ? 'Add Level Reward' : 'Remove Level Reward');
            if (action === 'message') modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('script').setLabel('Message').setStyle(TextInputStyle.Paragraph).setMaxLength(2000).setRequired(true)
            ));
            else if (action === 'rules') modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rate').setLabel('Server XP multiplier (0–10)').setStyle(TextInputStyle.Short).setValue(String(current.base_multiplier)).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('voice_xp').setLabel('XP per Minute').setStyle(TextInputStyle.Short).setValue(String(current.voice_xp_per_minute)).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('voice_min').setLabel('Min Voice Time (seconds)').setStyle(TextInputStyle.Short).setValue(String(current.voice_min_seconds)).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('voice_cap').setLabel('Max XP per Session').setStyle(TextInputStyle.Short).setValue(String(current.voice_session_xp_cap)).setRequired(true))
            );
            else modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('role').setLabel('Role ID').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('level').setLabel('Level').setStyle(TextInputStyle.Short).setRequired(true))
            );
            return interaction.showModal(modal);
        }
        if (['text', 'voice', 'dm', 'antiafk', 'stack'].includes(action)) {
            const column = { text: 'text_enabled', voice: 'voice_enabled', dm: 'dm_enabled', antiafk: 'antiafk_enabled', stack: 'stack_roles' }[action];
            this.sqlite.prepare(`UPDATE level_configs SET ${column} = NOT ${column}, updated_at = ? WHERE guild_id = ?`)
                .run(this.now(), interaction.guildId);
            return interaction.update(this.setupPayload(interaction.guildId, actorId, ['dm', 'antiafk'].includes(action) ? 'settings' : action === 'stack' ? 'roles' : 'main'));
        }
        if (action === 'sync') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('You need Manage Roles.');
            const acknowledged = await this.acknowledgeUpdate(interaction);
            const members = await interaction.guild.members.fetch();
            for (const member of members.values()) if (!member.user.bot) await this.reconcileMemberRoles(member);
            return this.update(interaction, this.setupPayload(interaction.guildId, actorId, 'roles'), acknowledged);
        }
        if (action === 'message-disable') {
            this.sqlite.prepare(`UPDATE level_configs SET message_enabled = 0, updated_at = ? WHERE guild_id = ?`)
                .run(this.now(), interaction.guildId);
            return interaction.update(this.setupPayload(interaction.guildId, actorId, 'settings'));
        }
        if (action === 'reset') return this.beginReset(interaction, 'all');
        if (action === 'cancel') return interaction.update(this.response('Level Setup', 'Level setup closed.', { components: [] }));
        return interaction.update(this.setupPayload(interaction.guildId, actorId, action));
    }

    async assertRbac(interaction, group, subcommand) {
        const command = this.client?.commands?.get?.('levels');
        if (!command) return;
        const { checkUserPermissions } = require('../utils/permissions');
        const { allowed } = await checkUserPermissions({
            guild: interaction.guild, member: interaction.member, user: interaction.user,
            channel: interaction.channel, channelId: interaction.channelId, commandName: 'levels',
            options: {
                getSubcommandGroup: () => group,
                getSubcommand: () => subcommand
            }
        }, command);
        if (!allowed) throw new Error('This levels action is disabled for you here.');
    }

    beginReset(interaction, scope, userId = null) {
        for (const [key, value] of this.confirmations) {
            if (value.expiresAt < this.now()
                || (value.guildId === interaction.guildId && value.actorId === interaction.user.id && value.scope === scope)) {
                this.confirmations.delete(key);
            }
        }
        const token = crypto.randomBytes(8).toString('hex');
        this.confirmations.set(token, {
            guildId: interaction.guildId, actorId: interaction.user.id, scope, userId,
            expiresAt: this.now() + 10 * 60 * 1000
        });
        const warning = scope === 'all'
            ? '**WARNING:** This will delete **ALL** text and voice XP data for this server. This action **cannot be undone**.\n\nAre you sure you want to continue?'
            : `Reset all XP for <@${userId}>?`;
        return interaction.reply(this.response('Confirm Level Reset', warning, {
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`levels:confirm:${token}`).setLabel(scope === 'all' ? 'Yes, Reset All XP' : 'Confirm Reset').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`levels:cancel:${token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
            )], flags: [MessageFlags.Ephemeral]
        }));
    }

    async execute(interaction) {
        const group = interaction.options.getSubcommandGroup(false);
        const action = interaction.options.getSubcommand();
        if (!group && ['rank', 'leaderboard', 'roles'].includes(action)) {
            const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
            if (action === 'rank') required.push(PermissionFlagsBits.AttachFiles);
            if (interaction.appPermissions && !interaction.appPermissions.has(required)) {
                throw new Error('I need View Channel, Send Messages, Embed Links, and file access for that level view.');
            }
            const privateReply = interaction.options.getBoolean?.('private') ?? false;
            if (action === 'rank') {
                const acknowledged = await this.acknowledge(interaction, privateReply ? [MessageFlags.Ephemeral] : []);
                const user = interaction.options.getUser?.('member') || interaction.user;
                const member = interaction.guild.members.cache.get(user.id)
                    || await interaction.guild.members.fetch(user.id).catch(() => null);
                return this.send(interaction, {
                    ...await this.rankCard(user, member, interaction.guild),
                    ...(!acknowledged && { flags: privateReply ? [MessageFlags.Ephemeral] : [] })
                }, acknowledged);
            }
            const page = interaction.options.getInteger?.('page') || 1;
            if (action === 'leaderboard') {
                const metric = interaction.options.getString?.('metric') || 'total';
                const column = { total: 'xp', text: 'text_xp', voice: 'voice_xp' }[metric];
                const rows = this.sqlite.prepare(`
                    SELECT user_id, ${column} AS score FROM member_levels WHERE guild_id = ?
                    ORDER BY ${column} DESC, user_id ASC LIMIT 10 OFFSET ?
                `).all(interaction.guildId, (page - 1) * 10);
                const content = rows.length
                    ? rows.map((row, index) => `**${(page - 1) * 10 + index + 1}.** <@${row.user_id}> — **${row.score}** ${metric} XP`).join('\n')
                    : 'No one has earned any XP yet.';
                return interaction.reply(this.response('Level Leaderboard', content, { flags: privateReply ? [MessageFlags.Ephemeral] : [] }));
            }
            const rewards = this.sqlite.prepare(`
                SELECT level, role_id FROM level_role_rewards WHERE guild_id = ?
                ORDER BY level LIMIT 10 OFFSET ?
            `).all(interaction.guildId, (page - 1) * 10);
            const content = rewards.length
                ? rewards.map(reward => `Level **${reward.level}** — <@&${reward.role_id}>`).join('\n')
                : 'No level role rewards have been configured.';
            return interaction.reply(this.response('Level Roles', content, { flags: privateReply ? [MessageFlags.Ephemeral] : [] }));
        }
        if (!group && action === 'setup') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                throw new Error('You need Manage Server to use level setup.');
            }
            this.sqlite.prepare(`INSERT OR IGNORE INTO level_configs (guild_id, updated_at) VALUES (?, ?)`)
                .run(interaction.guildId, this.now());
            return interaction.reply({
                ...this.setupPayload(interaction.guildId, interaction.user.id),
                flags: [MessageFlags.Ephemeral]
            });
        }
        if (group === 'config') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                throw new Error('You need Manage Server to configure levels.');
            }
            const switches = {
                text: ['text_enabled', 'Text XP'],
                voice: ['voice_enabled', 'Voice XP'],
                dm: ['dm_enabled', 'Level-up DMs'],
                antiafk: ['antiafk_enabled', 'Voice anti-AFK']
            };
            if (switches[action]) {
                const enabled = interaction.options.getBoolean('enabled', true);
                const now = this.now();
                this.sqlite.prepare(`INSERT OR IGNORE INTO level_configs (guild_id, updated_at) VALUES (?, ?)`)
                    .run(interaction.guildId, now);
                const [column, label] = switches[action];
                this.sqlite.prepare(`UPDATE level_configs SET ${column} = ?, updated_at = ? WHERE guild_id = ?`)
                    .run(enabled ? 1 : 0, now, interaction.guildId);
                return interaction.reply(this.response('Level Configuration', `${label} is now **${enabled ? 'enabled' : 'disabled'}**.`, {
                    flags: [MessageFlags.Ephemeral]
                }));
            }
            if (action === 'channel') {
                const channel = interaction.options.getChannel('channel', true);
                const botPermissions = interaction.guild.members.me.permissionsIn(channel);
                if (!botPermissions.has([
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.EmbedLinks
                ])) throw new Error('I need View Channel, Send Messages, and Embed Links in the award channel.');
                const now = this.now();
                this.sqlite.prepare(`
                    INSERT INTO level_configs (guild_id, award_channel_id, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(guild_id) DO UPDATE SET
                        award_channel_id = excluded.award_channel_id,
                        updated_at = excluded.updated_at
                `).run(interaction.guildId, channel.id, now);
                return interaction.reply(this.response('Level Configuration', `Level-up channel set to <#${channel.id}>.`, {
                    flags: [MessageFlags.Ephemeral]
                }));
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
                return interaction.reply(this.response('Level Configuration', `XP gain multiplier has been set to **${multiplier}x**.`, {
                    flags: [MessageFlags.Ephemeral]
                }));
            }
        }
        if (group === 'boost') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                throw new Error('You need Manage Server to configure XP multipliers.');
            }
            if (action === 'list') {
                const rows = this.sqlite.prepare(`
                    SELECT target_type, target_id, multiplier FROM level_boosts
                    WHERE guild_id = ? ORDER BY target_type, target_id
                `).all(interaction.guildId);
                const content = rows.length
                    ? rows.map(row => `${row.target_type === 'role' ? `<@&${row.target_id}>` : `<#${row.target_id}>`} — **${row.multiplier}x**`).join('\n')
                    : 'No XP multipliers are configured.';
                return interaction.reply(this.response('XP Multipliers', content, { flags: [MessageFlags.Ephemeral] }));
            }
            const role = interaction.options.getRole('role');
            const channel = interaction.options.getChannel('channel');
            if (Boolean(role) === Boolean(channel)) throw new Error('Choose exactly one role or channel.');
            const type = role ? 'role' : 'channel';
            const target = role || channel;
            if (action === 'remove') {
                this.sqlite.prepare(`
                    DELETE FROM level_boosts WHERE guild_id = ? AND target_type = ? AND target_id = ?
                `).run(interaction.guildId, type, target.id);
                return interaction.reply(this.response('XP Multiplier Removed', `Removed the XP multiplier from ${type === 'role' ? `<@&${target.id}>` : `<#${target.id}>`}.`, {
                    flags: [MessageFlags.Ephemeral]
                }));
            }
            const multiplier = interaction.options.getNumber('multiplier', true);
            if (!Number.isFinite(multiplier) || multiplier < 0 || multiplier > 10) {
                throw new Error('Multiplier must be between 0 and 10.');
            }
            this.sqlite.prepare(`
                INSERT INTO level_boosts (guild_id, target_type, target_id, multiplier, created_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(guild_id, target_type, target_id) DO UPDATE SET multiplier = excluded.multiplier
            `).run(interaction.guildId, type, target.id, multiplier, this.now());
            return interaction.reply(this.response('XP Multiplier Set', `Set ${type === 'role' ? `<@&${target.id}>` : `<#${target.id}>`} to **${multiplier}x** XP.`, {
                flags: [MessageFlags.Ephemeral]
            }));
        }
        if (group === 'live') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                throw new Error('You need Manage Server to create a live leaderboard.');
            }
            if (action === 'recover') {
                const recovery = interaction.options.getString('action', true);
                const cutoff = this.now() - 5 * 60 * 1000;
                if (recovery === 'list') {
                    const rows = this.sqlite.prepare(`
                        SELECT channel_id, metric FROM level_live_boards
                        WHERE guild_id = ? AND create_status = 'creating' AND create_started_at <= ?
                        ORDER BY channel_id, metric
                    `).all(interaction.guildId, cutoff);
                    return interaction.reply(this.response('Uncertain Live Boards', rows.length
                        ? rows.map(row => {
                            const channel = interaction.guild.channels.cache.get(row.channel_id);
                            const visible = channel && interaction.member.permissionsIn?.(channel).has(PermissionFlagsBits.ViewChannel);
                            return `${visible ? `<#${row.channel_id}>` : '*inaccessible channel*'} · **${row.metric}**`;
                        }).join('\n')
                        : 'No live boards need recovery.', { flags: [MessageFlags.Ephemeral] }));
                }
                const channel = interaction.options.getChannel('channel');
                const metric = interaction.options.getString('metric');
                if (!channel || !metric || interaction.options.getBoolean('confirm') !== true) {
                    throw new Error('Choose a channel and metric, then confirm this recovery action.');
                }
                const board = this.sqlite.prepare(`
                    SELECT * FROM level_live_boards
                    WHERE guild_id = ? AND channel_id = ? AND metric = ?
                      AND create_status = 'creating' AND create_started_at <= ?
                `).get(interaction.guildId, channel.id, metric, cutoff);
                if (!board) throw new Error('That live board does not need recovery.');
                if (recovery === 'abandon') {
                    this.sqlite.prepare(`
                        DELETE FROM level_live_boards WHERE guild_id = ? AND channel_id = ? AND metric = ?
                    `).run(interaction.guildId, channel.id, metric);
                    return interaction.reply(this.response('Live Board Abandoned', `Removed the **${metric}** board in <#${channel.id}>.`, {
                        flags: [MessageFlags.Ephemeral]
                    }));
                }
                const permissions = interaction.guild.members.me.permissionsIn(channel);
                if (!permissions.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
                    throw new Error('I need View Channel, Send Messages, and Embed Links there.');
                }
                const acknowledged = await this.acknowledge(interaction, [MessageFlags.Ephemeral]);
                this.sqlite.prepare(`
                    UPDATE level_live_boards SET message_id = NULL, create_status = 'active',
                        create_started_at = NULL, updated_at = ?
                    WHERE guild_id = ? AND channel_id = ? AND metric = ?
                `).run(this.now(), interaction.guildId, channel.id, metric);
                await this.deliverLiveBoard({ ...board, message_id: null, create_status: 'active' }, channel);
                return this.send(interaction, this.response('Live Board Recovered', `Created a replacement **${metric}** board in <#${channel.id}>.`), acknowledged);
            }
            const channel = interaction.options.getChannel('channel') || interaction.channel;
            const permissions = interaction.guild.members.me.permissionsIn(channel);
            if (!permissions.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
                throw new Error('I need View Channel, Send Messages, and Embed Links there.');
            }
            const acknowledged = await this.acknowledge(interaction, [MessageFlags.Ephemeral]);
            const token = this.liveBoardToken(interaction.guildId, channel.id, action);
            this.sqlite.prepare(`
                INSERT OR IGNORE INTO level_live_boards
                    (guild_id, channel_id, metric, create_token, create_status, create_started_at, revision, updated_at)
                VALUES (?, ?, ?, ?, 'creating', ?, 0, ?)
            `).run(interaction.guildId, channel.id, action, token, this.now(), this.now());
            const existing = this.sqlite.prepare(`
                SELECT * FROM level_live_boards
                WHERE guild_id = ? AND channel_id = ? AND metric = ?
            `).get(interaction.guildId, channel.id, action);
            await this.deliverLiveBoard(existing, channel);
            return this.send(interaction, this.response('Live Leaderboard', `Live ${action} XP leaderboard created in <#${channel.id}>.`, {
                ...(!acknowledged && { flags: [MessageFlags.Ephemeral] })
            }), acknowledged);
        }
        if (group === 'reward') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)
                || !interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
                throw new Error('You need Manage Server and Manage Roles to manage level rewards.');
            }
            const bot = interaction.guild.members.me;
            if (!bot.permissions.has(PermissionFlagsBits.ManageRoles)) {
                throw new Error('I need Manage Roles to manage level rewards.');
            }
            if (action === 'stack') {
                const enabled = interaction.options.getString('mode', true) === 'on';
                this.sqlite.prepare(`INSERT OR IGNORE INTO level_configs (guild_id, updated_at) VALUES (?, ?)`)
                    .run(interaction.guildId, this.now());
                this.sqlite.prepare(`UPDATE level_configs SET stack_roles = ?, updated_at = ? WHERE guild_id = ?`)
                    .run(enabled ? 1 : 0, this.now(), interaction.guildId);
                return interaction.reply(this.response('Level Roles', `Stacking of level roles has been **${enabled ? 'enabled' : 'disabled'}**.`, {
                    flags: [MessageFlags.Ephemeral]
                }));
            }
            if (action === 'sync') {
                const acknowledged = await this.acknowledge(interaction, [MessageFlags.Ephemeral]);
                const members = await interaction.guild.members.fetch();
                let count = 0;
                for (const member of members.values()) {
                    if (!member.user.bot) {
                        await this.reconcileMemberRoles(member);
                        count += 1;
                    }
                }
                return this.send(interaction, this.response('Level Roles Synced', `Synced level roles for **${count}** members.`, {
                    ...(!acknowledged && { flags: [MessageFlags.Ephemeral] })
                }), acknowledged);
            }
            const role = interaction.options.getRole('role', true);
            const level = interaction.options.getInteger('level', true);
            if (role.managed || role.id === interaction.guild.id
                || bot.roles.highest.comparePositionTo(role) <= 0
                || interaction.member.roles?.highest?.comparePositionTo(role) <= 0) {
                throw new Error('That role must be below both your highest role and mine.');
            }
            if (action === 'add') {
                const count = this.sqlite.prepare(`SELECT COUNT(*) AS count FROM level_role_rewards WHERE guild_id = ?`)
                    .get(interaction.guildId).count;
                const existing = this.sqlite.prepare(`SELECT role_id FROM level_role_rewards WHERE guild_id = ? AND level = ?`)
                    .get(interaction.guildId, level);
                if (!existing && count >= 50) throw new Error('A server can configure at most 50 level rewards.');
                if (existing && existing.role_id !== role.id) throw new Error('Remove the existing reward for that level first.');
                this.sqlite.prepare(`
                    INSERT INTO level_role_rewards (guild_id, level, role_id, created_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(guild_id, level) DO UPDATE SET role_id = excluded.role_id
                `).run(interaction.guildId, level, role.id, this.now());
                return interaction.reply(this.response('Level Reward Added', `Added <@&${role.id}> as reward for level **${level}**.`, {
                    flags: [MessageFlags.Ephemeral]
                }));
            }
            const acknowledged = await this.acknowledge(interaction, [MessageFlags.Ephemeral]);
            const configured = this.sqlite.prepare(`SELECT 1 FROM level_role_rewards WHERE guild_id = ? AND level = ? AND role_id = ?`)
                .get(interaction.guildId, level, role.id);
            const affected = configured ? await this.removeRewardRole(interaction.guild, role.id) : [];
            this.sqlite.prepare(`DELETE FROM level_role_rewards WHERE guild_id = ? AND level = ? AND role_id = ?`)
                .run(interaction.guildId, level, role.id);
            for (const member of affected) await this.reconcileMemberRoles(member);
            return this.send(interaction, this.response('Level Reward Removed', `Removed level role configuration for level **${level}**.`, {
                ...(!acknowledged && { flags: [MessageFlags.Ephemeral] })
            }), acknowledged);
        }
        if (group === 'ignore') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                throw new Error('You need Manage Server to configure XP exclusions.');
            }
            if (action === 'list') {
                const rows = this.sqlite.prepare(`
                    SELECT target_type, target_id FROM level_ignores
                    WHERE guild_id = ? ORDER BY target_type, target_id
                `).all(interaction.guildId);
                const content = rows.length
                    ? rows.map(row => row.target_type === 'role' ? `<@&${row.target_id}>` : `<#${row.target_id}>`).join('\n')
                    : 'No XP exclusions are configured.';
                return interaction.reply(this.response('XP Exclusions', content, { flags: [MessageFlags.Ephemeral] }));
            }
            const target = action === 'role'
                ? interaction.options.getRole('role', true)
                : interaction.options.getChannel('channel', true);
            const existing = this.sqlite.prepare(`
                SELECT 1 FROM level_ignores WHERE guild_id = ? AND target_type = ? AND target_id = ?
            `).get(interaction.guildId, action, target.id);
            if (existing) {
                this.sqlite.prepare(`
                    DELETE FROM level_ignores WHERE guild_id = ? AND target_type = ? AND target_id = ?
                `).run(interaction.guildId, action, target.id);
            } else {
                this.sqlite.prepare(`
                    INSERT INTO level_ignores (guild_id, target_type, target_id, created_at)
                    VALUES (?, ?, ?, ?)
                `).run(interaction.guildId, action, target.id, this.now());
            }
            const mention = action === 'role' ? `<@&${target.id}>` : `<#${target.id}>`;
            return interaction.reply(this.response('XP Exclusion Updated', `${mention} is ${existing ? 'no longer' : 'now'} ignored for XP.`, {
                flags: [MessageFlags.Ephemeral]
            }));
        }
        if (group === 'message') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                throw new Error('You need Manage Server to configure level-up messages.');
            }
            const config = this.sqlite.prepare(`SELECT * FROM level_configs WHERE guild_id = ?`).get(interaction.guildId);
            if (action === 'view') {
                const content = !config?.message_enabled
                    ? 'Level up messages are currently **disabled** for this server.'
                    : `Current level up message:\n>>> ${config.award_message}`;
                return interaction.reply(this.response('Level-up Message', content, { flags: [MessageFlags.Ephemeral] }));
            }
            if (action === 'disable') {
                this.sqlite.prepare(`INSERT OR IGNORE INTO level_configs (guild_id, updated_at) VALUES (?, ?)`)
                    .run(interaction.guildId, this.now());
                this.sqlite.prepare(`UPDATE level_configs SET message_enabled = 0, updated_at = ? WHERE guild_id = ?`)
                    .run(this.now(), interaction.guildId);
                return interaction.reply(this.response('Level-up Message', 'Level up messages are currently **disabled** for this server.', {
                    flags: [MessageFlags.Ephemeral]
                }));
            }
            const script = interaction.options.getString('script', true);
            if ([...script].length > 2000) throw new Error('Message must be 2000 characters or less.');
            if (!this.client?.richContentService) throw new Error('Rich content service is unavailable.');
            this.client.richContentService.renderLevel(script, {
                guild: interaction.guild, member: interaction.member, user: interaction.user,
                level: { current: 1, next: 2, rank: 1, xp: 100, nextXp: 400 }
            });
            this.sqlite.prepare(`
                INSERT INTO level_configs (guild_id, award_message, message_enabled, updated_at)
                VALUES (?, ?, 1, ?)
                ON CONFLICT(guild_id) DO UPDATE SET award_message = excluded.award_message,
                    message_enabled = 1, updated_at = excluded.updated_at
            `).run(interaction.guildId, script, this.now());
            return interaction.reply(this.response('Level-up Message', 'Custom level up message has been set.', {
                flags: [MessageFlags.Ephemeral]
            }));
        }
        if (group === 'rankcard') {
            if (action === 'view') {
                if (interaction.appPermissions && !interaction.appPermissions.has(PermissionFlagsBits.AttachFiles)) {
                    throw new Error('I need Attach Files to render rank cards.');
                }
                const acknowledged = await this.acknowledge(interaction, [MessageFlags.Ephemeral]);
                const user = interaction.options.getUser('member') || interaction.user;
                const member = interaction.guild.members.cache.get(user.id)
                    || await interaction.guild.members.fetch(user.id).catch(() => null);
                return this.send(interaction, await this.rankCard(user, member, interaction.guild), acknowledged);
            }
            if (action === 'color') {
                const input = interaction.options.getString('color', true);
                const accent = input.toLowerCase() === 'reset' ? null : input.toUpperCase();
                if (accent && !/^#[0-9A-F]{6}$/.test(accent)) throw new Error('Use a six-digit hex color or reset.');
                this.sqlite.prepare(`
                    INSERT INTO level_rank_cards (user_id, accent, updated_at) VALUES (?, ?, ?)
                    ON CONFLICT(user_id) DO UPDATE SET accent = excluded.accent, updated_at = excluded.updated_at
                `).run(interaction.user.id, accent, this.now());
                return interaction.reply(this.response('Rank Card Accent', accent
                    ? `Rank card accent set to **${accent}**.` : 'Rank card accent reset to the ByteBot default.', {
                    flags: [MessageFlags.Ephemeral]
                }));
            }
            const attachment = interaction.options.getAttachment('background');
            const backgroundUrl = interaction.options.getString('background_url');
            if (attachment && backgroundUrl) throw new Error('Choose one background source.');
            const layout = interaction.options.getString('layout');
            const avatarBorder = interaction.options.getInteger('avatar_border');
            if (!attachment && !backgroundUrl && layout == null && avatarBorder == null) {
                throw new Error('Choose at least one rank-card setting.');
            }
            let background;
            let mime;
            const source = attachment || backgroundUrl;
            const acknowledged = source
                ? await this.acknowledge(interaction, [MessageFlags.Ephemeral])
                : false;
            if (source) {
                const url = new URL(typeof source === 'string' ? source : source.url);
                if (url.protocol !== 'https:') throw new Error('Rank-card backgrounds must use HTTPS.');
                if (attachment?.size > 5 * 1024 * 1024) throw new Error('Rank-card backgrounds cannot exceed 5 MiB.');
                background = await this.images.image(source);
                if (background.length > 5 * 1024 * 1024) throw new Error('Rank-card backgrounds cannot exceed 5 MiB.');
                const metadata = await sharp(background, { limitInputPixels: 40_000_000 }).metadata();
                mime = `image/${metadata.format === 'jpeg' ? 'jpeg' : metadata.format}`;
            }
            const current = this.sqlite.prepare(`SELECT * FROM level_rank_cards WHERE user_id = ?`).get(interaction.user.id);
            this.sqlite.prepare(`
                INSERT INTO level_rank_cards
                    (user_id, layout, background_data, background_mime, avatar_border, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    layout = excluded.layout,
                    background_data = excluded.background_data,
                    background_mime = excluded.background_mime,
                    avatar_border = excluded.avatar_border,
                    updated_at = excluded.updated_at
            `).run(interaction.user.id, layout || current?.layout || 'classic',
                background ?? current?.background_data ?? null,
                mime ?? current?.background_mime ?? null,
                avatarBorder ?? current?.avatar_border ?? 4, this.now());
            return this.send(interaction, this.response('Rank Card Style', 'Rank card style updated.', {
                ...(!acknowledged && { flags: [MessageFlags.Ephemeral] })
            }), acknowledged);
        }
        if (group === 'reset') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                throw new Error('You need Manage Server to reset XP.');
            }
            this.assertRoleMutationAuthority(interaction);
            if (action === 'all') return this.beginReset(interaction, 'all');
            const acknowledged = await this.acknowledge(interaction, [MessageFlags.Ephemeral]);
            const user = interaction.options.getUser('member', true);
            this.sqlite.transaction(() => {
                this.enqueueRoleReconcile(interaction.guildId, user.id);
                this.sqlite.prepare(`DELETE FROM member_levels WHERE guild_id = ? AND user_id = ?`)
                    .run(interaction.guildId, user.id);
                this.sqlite.prepare(`DELETE FROM level_voice_sessions WHERE guild_id = ? AND user_id = ?`)
                    .run(interaction.guildId, user.id);
            })();
            const member = interaction.guild.members.cache.get(user.id)
                || await interaction.guild.members.fetch(user.id).catch(() => null);
            if (member) await this.reconcileMemberRoles(member);
            return this.send(interaction, this.response('Level Reset', `XP has been reset for <@${user.id}>`, {
                ...(!acknowledged && { flags: [MessageFlags.Ephemeral] })
            }), acknowledged);
        }
        if (group === 'admin') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                throw new Error('You need Manage Server to manage member XP.');
            }
            this.assertRoleMutationAuthority(interaction);
            const acknowledged = await this.acknowledge(interaction, [MessageFlags.Ephemeral]);
            const user = interaction.options.getUser('member', true);
            const now = this.now();
            this.sqlite.prepare(`
                INSERT OR IGNORE INTO member_levels
                    (guild_id, user_id, xp, level, text_xp, voice_xp,
                     manual_adjustment, level_floor, message_count, voice_seconds, updated_at)
                VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0, 0, ?)
            `).run(interaction.guildId, user.id, now);
            const current = this.sqlite.prepare(`
                SELECT * FROM member_levels WHERE guild_id = ? AND user_id = ?
            `).get(interaction.guildId, user.id);
            let total;
            let floor = current.level_floor;
            let content;
            if (action === 'award') {
                const amount = interaction.options.getInteger('amount', true);
                if (amount <= 0) throw new Error('Amount must be greater than zero.');
                total = current.xp + amount;
                content = `Awarded **${amount}** XP to <@${user.id}>. New total XP: **${total}**.`;
            } else if (action === 'removexp') {
                const amount = interaction.options.getInteger('amount', true);
                if (amount <= 0) throw new Error('Amount must be greater than zero.');
                total = Math.max(0, current.xp - amount);
                content = `Removed **${amount}** XP from <@${user.id}>. New total XP: **${total}**.`;
            } else if (action === 'setxp') {
                total = interaction.options.getInteger('xp', true);
                if (total < 0) throw new Error('Amount must be zero or greater.');
                floor = 0;
                content = `Set total XP for <@${user.id}> to **${total}**.`;
            } else if (action === 'setlevel') {
                const level = interaction.options.getInteger('level', true);
                if (level < 1 || level > 999) throw new Error('Level must be between 1 and 999.');
                total = 100 * level * level;
                floor = level;
                content = `Set level for <@${user.id}> to **${level}**.`;
            }
            if (total == null) throw new Error('Unknown XP management action.');
            const manual = total - current.text_xp - current.voice_xp;
            const level = Math.max(floor, levelForXp(total));
            this.sqlite.transaction(() => {
                this.sqlite.prepare(`
                    UPDATE member_levels SET xp = ?, level = ?, manual_adjustment = ?,
                        level_floor = ?, updated_at = ?
                    WHERE guild_id = ? AND user_id = ?
                `).run(total, level, manual, floor, now, interaction.guildId, user.id);
                this.enqueueRoleReconcile(interaction.guildId, user.id, now);
            })();
            const member = interaction.guild?.members?.fetch
                ? await interaction.guild.members.fetch(user.id).catch(() => null)
                : null;
            if (member) await this.reconcileMemberRoles(member);
            return this.send(interaction, this.response('Member XP Updated', content, {
                ...(!acknowledged && { flags: [MessageFlags.Ephemeral] })
            }), acknowledged);
        }
        throw new Error('That levels action is not available yet.');
    }
}

module.exports = LevelAnalyticsService;
module.exports.levelForXp = levelForXp;
module.exports.utcSegments = utcSegments;
