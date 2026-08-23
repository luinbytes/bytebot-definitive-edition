const { AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const { randomUUID } = require('crypto');
const { sqlite } = require('../database');
const { executeMemberAction, executeUserAction } = require('./moderationService');
const { safeChannelSend } = require('../utils/discordApiUtil');
const embeds = require('../utils/embeds');
const logger = require('../utils/logger');

const MODULES = [
    'guildupdate', 'webhooks', 'vanityurl', 'integrationcreate', 'integrationupdate', 'integrationdelete',
    'botadd', 'kick', 'ban', 'memberprune',
    'rolecreate', 'roleupdate', 'roledelete',
    'channelcreate', 'channelupdate', 'channeldelete',
    'emojicreate', 'emojiupdate', 'emojidelete',
    'stickercreate', 'stickerupdate', 'stickerdelete',
    'soundboardcreate', 'soundboardupdate', 'soundboarddelete',
    'invitecreate', 'invitedelete'
];
const PUNISHMENTS = ['ban', 'kick', 'timeout', 'strip', 'stripstaff', 'jail'];
const SEEN_RETENTION_MS = 7 * 86400000;
const APPLY_LEASE_MS = 30000;
const AUDIT_MODULES = new Map([
    [AuditLogEvent.WebhookCreate, 'webhooks'], [AuditLogEvent.WebhookUpdate, 'webhooks'], [AuditLogEvent.WebhookDelete, 'webhooks'],
    [AuditLogEvent.IntegrationCreate, 'integrationcreate'], [AuditLogEvent.IntegrationUpdate, 'integrationupdate'], [AuditLogEvent.IntegrationDelete, 'integrationdelete'],
    [AuditLogEvent.BotAdd, 'botadd'], [AuditLogEvent.MemberKick, 'kick'], [AuditLogEvent.MemberBanAdd, 'ban'], [AuditLogEvent.MemberPrune, 'memberprune'],
    [AuditLogEvent.RoleCreate, 'rolecreate'], [AuditLogEvent.RoleUpdate, 'roleupdate'], [AuditLogEvent.RoleDelete, 'roledelete'],
    [AuditLogEvent.ChannelCreate, 'channelcreate'], [AuditLogEvent.ChannelUpdate, 'channelupdate'], [AuditLogEvent.ChannelDelete, 'channeldelete'],
    [AuditLogEvent.EmojiCreate, 'emojicreate'], [AuditLogEvent.EmojiUpdate, 'emojiupdate'], [AuditLogEvent.EmojiDelete, 'emojidelete'],
    [AuditLogEvent.StickerCreate, 'stickercreate'], [AuditLogEvent.StickerUpdate, 'stickerupdate'], [AuditLogEvent.StickerDelete, 'stickerdelete'],
    [AuditLogEvent.SoundboardSoundCreate, 'soundboardcreate'], [AuditLogEvent.SoundboardSoundUpdate, 'soundboardupdate'], [AuditLogEvent.SoundboardSoundDelete, 'soundboarddelete'],
    [AuditLogEvent.InviteCreate, 'invitecreate'], [AuditLogEvent.InviteDelete, 'invitedelete']
]);

function moduleForAuditEntry(entry) {
    if (entry.action !== AuditLogEvent.GuildUpdate) return AUDIT_MODULES.get(entry.action) || null;
    return entry.changes?.some(change => change.key === 'vanity_url_code') ? 'vanityurl' : 'guildupdate';
}

function ensureConfig(guildId) {
    sqlite.prepare('INSERT INTO antinuke_config (guild_id) VALUES (?) ON CONFLICT DO NOTHING').run(guildId);
    return sqlite.prepare('SELECT * FROM antinuke_config WHERE guild_id = ?').get(guildId);
}

function isTrustedManager(guild, userId, botOwnerIds = []) {
    return userId === guild.ownerId || botOwnerIds.includes(userId)
        || Boolean(sqlite.prepare('SELECT 1 FROM antinuke_admins WHERE guild_id = ? AND user_id = ?').get(guild.id, userId));
}

function upsertModule(guildId, module, changes) {
    if (!MODULES.includes(module)) throw new Error('Unknown antinuke module.');
    if (changes.enabled != null && ![0, 1, false, true].includes(changes.enabled)) throw new Error('Invalid module status.');
    if (changes.threshold != null && (!Number.isInteger(changes.threshold) || changes.threshold < 1 || changes.threshold > 127)) {
        throw new Error('AntiNuke thresholds must be between 1 and 127.');
    }
    if (changes.punishment != null && !PUNISHMENTS.includes(changes.punishment)) throw new Error('Unknown AntiNuke punishment.');
    sqlite.prepare(`
        INSERT INTO antinuke_modules (guild_id, module) VALUES (?, ?) ON CONFLICT DO NOTHING
    `).run(guildId, module);
    const assignments = [];
    const values = [];
    for (const [column, value] of Object.entries(changes)) {
        if (!['enabled', 'threshold', 'punishment'].includes(column)) continue;
        assignments.push(`${column} = ?`);
        values.push(value);
    }
    if (assignments.length) {
        sqlite.prepare(`UPDATE antinuke_modules SET ${assignments.join(', ')} WHERE guild_id = ? AND module = ?`)
            .run(...values, guildId, module);
    }
    return sqlite.prepare('SELECT * FROM antinuke_modules WHERE guild_id = ? AND module = ?').get(guildId, module);
}

function claimIncident({ guildId, actorId, module, auditEntryId, occurredAt, windowSeconds, threshold, punishment }) {
    return sqlite.transaction(() => {
        const inserted = sqlite.prepare(`
            INSERT INTO antinuke_actions (guild_id, actor_id, module, audit_entry_id, occurred_at)
            VALUES (?, ?, ?, ?, ?) ON CONFLICT (guild_id, audit_entry_id) DO NOTHING
        `).run(guildId, actorId, module, auditEntryId, occurredAt);
        if (!inserted.changes) return null;
        sqlite.prepare('DELETE FROM antinuke_actions WHERE guild_id = ? AND occurred_at < ?')
            .run(guildId, Date.now() - SEEN_RETENTION_MS);
        const { count } = sqlite.prepare(`
            SELECT COUNT(*) AS count FROM antinuke_actions
            WHERE guild_id = ? AND actor_id = ? AND module = ? AND consumed = 0 AND occurred_at BETWEEN ? AND ?
        `).get(guildId, actorId, module, occurredAt - windowSeconds * 1000, occurredAt);
        if (count < threshold) return null;
        if (sqlite.prepare(`
            SELECT 1 FROM antinuke_incidents
            WHERE guild_id = ? AND actor_id = ? AND module = ? AND status IN ('pending', 'applying')
        `).get(guildId, actorId, module)) return null;
        const incident = sqlite.prepare(`
            INSERT INTO antinuke_incidents
                (guild_id, actor_id, module, action_count, punishment, status, audit_entry_id, created_at)
            VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
        `).run(guildId, actorId, module, count, punishment, auditEntryId, occurredAt);
        sqlite.prepare(`
            UPDATE antinuke_actions SET consumed = 1
            WHERE guild_id = ? AND actor_id = ? AND module = ? AND consumed = 0 AND occurred_at BETWEEN ? AND ?
        `).run(guildId, actorId, module, occurredAt - windowSeconds * 1000, occurredAt);
        return { id: Number(incident.lastInsertRowid), count };
    })();
}

async function applyPunishment(guild, actorId, punishment, reason) {
    const executor = guild.members.me;
    if (punishment === 'ban') {
        return executeUserAction({ guild, executor, targetId: actorId, action: 'BAN', reason });
    }
    const target = await guild.members.fetch(actorId);
    const action = { kick: 'KICK', timeout: 'TIMEOUT', strip: 'STRIP', stripstaff: 'STAFFSTRIP', jail: 'JAIL' }[punishment];
    return executeMemberAction({
        guild, executor, target, action, reason,
        durationMs: punishment === 'timeout' ? 5 * 60000 : undefined,
        automated: true
    });
}

async function logIncident(guild, config, incident) {
    if (!config.log_channel_id) return;
    const channel = guild.channels.cache.get(config.log_channel_id)
        || await guild.channels.fetch(config.log_channel_id).catch(() => null);
    if (!channel) return;
    await safeChannelSend(channel, {
        embeds: [embeds.error('AntiNuke Incident',
            `Actor: <@${incident.actorId}>\nModule: **${incident.module}**\nActions: **${incident.count}**\nPunishment: **${incident.punishment}**\nStatus: **${incident.status}**${incident.error ? `\nError: ${incident.error.slice(0, 1000)}` : ''}`)],
        allowedMentions: { parse: [] }
    }, { logContext: 'antinuke-incident' });
}

async function completeIncident(guild, config, incident) {
    const now = Date.now();
    const token = randomUUID();
    const claimed = sqlite.prepare(`
        UPDATE antinuke_incidents SET status = 'applying', applying_at = ?, applying_token = ?
        WHERE id = ? AND (
            status = 'pending' OR
            (status = 'applying' AND (applying_at IS NULL OR applying_at <= ?))
        )
    `).run(now, token, incident.id, now - APPLY_LEASE_MS);
    if (!claimed.changes) return null;
    const heartbeat = setInterval(() => {
        try {
            sqlite.prepare(`
                UPDATE antinuke_incidents SET applying_at = ?
                WHERE id = ? AND status = 'applying' AND applying_token = ?
            `).run(Date.now(), incident.id, token);
        } catch (error) {
            logger.error(`AntiNuke lease heartbeat failed for incident ${incident.id}: ${error.message}`);
        }
    }, APPLY_LEASE_MS / 3);
    heartbeat.unref?.();
    const reason = `AntiNuke ${incident.module} threshold (${incident.count})`;
    let status = 'punished';
    let error = null;
    try {
        await applyPunishment(guild, incident.actorId, incident.punishment, reason);
    } catch (punishmentError) {
        error = `${incident.punishment} failed: ${punishmentError.message}`;
        if (incident.punishment === 'strip') {
            status = 'containment_failed';
        } else {
            try {
                await applyPunishment(guild, incident.actorId, 'strip', `${reason}; fallback containment`);
                status = 'fallback_strip';
            } catch (fallbackError) {
                status = 'containment_failed';
                error += `; strip failed: ${fallbackError.message}`;
            }
        }
    }
    clearInterval(heartbeat);
    const finalized = sqlite.prepare(`
        UPDATE antinuke_incidents
        SET status = ?, applying_at = NULL, applying_token = NULL, error = ?
        WHERE id = ? AND applying_token = ?
    `).run(status, error, incident.id, token);
    if (!finalized.changes) return null;
    const completed = { ...incident, status, error };
    await logIncident(guild, config || {}, completed);
    return completed;
}

async function recoverPendingIncidents(client) {
    let recovered = 0;
    const failures = [];
    let afterId = 0;
    while (true) {
        const rows = sqlite.prepare(`
            SELECT * FROM antinuke_incidents
            WHERE status IN ('pending', 'applying') AND id > ? ORDER BY id LIMIT 100
        `).all(afterId);
        if (!rows.length) break;
        for (const row of rows) {
            afterId = row.id;
            try {
                const guild = client.guilds.cache.get(row.guild_id) || await client.guilds.fetch(row.guild_id);
                const config = sqlite.prepare('SELECT * FROM antinuke_config WHERE guild_id = ?').get(row.guild_id);
                const completed = await completeIncident(guild, config, {
                    id: row.id,
                    actorId: row.actor_id,
                    module: row.module,
                    count: row.action_count,
                    punishment: row.punishment
                });
                if (completed) recovered++;
            } catch (error) {
                failures.push(`#${row.id}: ${error.message}`);
            }
        }
        await new Promise(resolve => setImmediate(resolve));
    }
    const { count: remaining } = sqlite.prepare(`
        SELECT COUNT(*) AS count FROM antinuke_incidents WHERE status IN ('pending', 'applying')
    `).get();
    const nextLease = remaining ? sqlite.prepare(`
        SELECT MIN(CASE WHEN status = 'applying' THEN COALESCE(applying_at, 0) + ? ELSE 0 END) AS value
        FROM antinuke_incidents WHERE status IN ('pending', 'applying')
    `).get(APPLY_LEASE_MS).value : null;
    return {
        recovered,
        remaining,
        retryAfterMs: nextLease == null ? null : Math.max(0, nextLease - Date.now()),
        failures
    };
}

async function evaluateAuditEntry(entry, guild) {
    const module = moduleForAuditEntry(entry);
    const actorId = entry.executorId || entry.executor?.id;
    if (!module || !actorId || actorId === guild.members.me.id || actorId === guild.ownerId) return null;
    const config = sqlite.prepare('SELECT * FROM antinuke_config WHERE guild_id = ? AND enabled = 1').get(guild.id);
    if (!config || !guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;
    if (sqlite.prepare('SELECT 1 FROM antinuke_whitelist WHERE guild_id = ? AND user_id = ?').get(guild.id, actorId)) return null;
    const settings = sqlite.prepare('SELECT * FROM antinuke_modules WHERE guild_id = ? AND module = ? AND enabled = 1')
        .get(guild.id, module);
    if (!settings) return null;
    const punishment = settings.punishment || config.punishment;
    const claimed = claimIncident({
        guildId: guild.id, actorId, module, auditEntryId: entry.id,
        occurredAt: entry.createdTimestamp || Date.now(), windowSeconds: config.window_seconds,
        threshold: settings.threshold, punishment
    });
    if (!claimed) return null;
    return completeIncident(guild, config, {
        id: claimed.id, actorId, module, count: claimed.count, punishment
    });
}

module.exports = {
    MODULES, PUNISHMENTS, moduleForAuditEntry, ensureConfig, isTrustedManager, upsertModule,
    claimIncident, evaluateAuditEntry, recoverPendingIncidents
};
