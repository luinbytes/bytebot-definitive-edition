const { PermissionFlagsBits, UserFlagsBitField } = require('discord.js');
const { sqlite } = require('../database');
const { executeMemberAction } = require('./moderationService');
const { lockdownAll } = require('./channelModerationService');
const logger = require('../utils/logger');

const MODULES = ['massjoin', 'defaultpfp', 'newaccounts', 'massmention', 'unverifiedbots', 'username'];
const PUNISHMENTS = ['ban', 'kick', 'timeout', 'jail'];
const MAX_WINDOW_KEYS = 10000;
const MAX_WINDOW_EVENTS = 1000;
const joinWindows = new Map();
const lockdownTimers = new Map();

function ensureConfig(guildId) {
    sqlite.prepare('INSERT INTO antiraid_config (guild_id) VALUES (?) ON CONFLICT DO NOTHING').run(guildId);
    return sqlite.prepare('SELECT * FROM antiraid_config WHERE guild_id = ?').get(guildId);
}

function upsertModule(guildId, module, changes) {
    if (!MODULES.includes(module)) throw new Error('Unknown AntiRaid module.');
    if (changes.threshold != null && (!Number.isInteger(changes.threshold) || changes.threshold < 1 || changes.threshold > 1000)) {
        throw new Error('AntiRaid thresholds must be between 1 and 1000.');
    }
    if (module === 'newaccounts' && changes.threshold > 365) throw new Error('Account age must be between 1 and 365 days.');
    if (changes.windowSeconds != null && (!Number.isInteger(changes.windowSeconds) || changes.windowSeconds < 1 || changes.windowSeconds > 3600)) {
        throw new Error('AntiRaid windows must be between 1 and 3600 seconds.');
    }
    if (changes.punishment != null && !PUNISHMENTS.includes(changes.punishment)) throw new Error('Unknown AntiRaid punishment.');
    sqlite.prepare('INSERT INTO antiraid_modules (guild_id, module) VALUES (?, ?) ON CONFLICT DO NOTHING').run(guildId, module);
    const columns = {
        enabled: 'enabled', threshold: 'threshold', windowSeconds: 'window_seconds', punishment: 'punishment',
        lockChannels: 'lock_channels', punishMembers: 'punish_members'
    };
    const updates = Object.entries(changes).filter(([key]) => columns[key]);
    if (updates.length) {
        sqlite.prepare(`UPDATE antiraid_modules SET ${updates.map(([key]) => `${columns[key]} = ?`).join(', ')} WHERE guild_id = ? AND module = ?`)
            .run(...updates.map(([, value]) => value), guildId, module);
    }
    return sqlite.prepare('SELECT * FROM antiraid_modules WHERE guild_id = ? AND module = ?').get(guildId, module);
}

function roleIds(member) {
    return [...(member.roles?.cache?.keys?.() || [])];
}

function isExempt(member) {
    if (!member?.guild || member.id === member.guild.members.me?.id || member.id === member.guild.ownerId) return true;
    if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
    const direct = sqlite.prepare(`
        SELECT 1 FROM antiraid_exemptions WHERE guild_id = ? AND target_type = 'user' AND target_id = ?
    `).get(member.guild.id, member.id);
    if (direct) return true;
    const roles = roleIds(member);
    if (!roles.length) return false;
    return Boolean(sqlite.prepare(`
        SELECT 1 FROM antiraid_exemptions
        WHERE guild_id = ? AND target_type = 'role' AND target_id IN (${roles.map(() => '?').join(',')}) LIMIT 1
    `).get(member.guild.id, ...roles));
}

function trimWindow(key, now, seconds) {
    const retained = (joinWindows.get(key) || []).filter(entry => entry.at >= now - seconds * 1000).slice(-MAX_WINDOW_EVENTS);
    if (retained.length) joinWindows.set(key, retained);
    else joinWindows.delete(key);
    return retained;
}

function addJoin(member, now, seconds) {
    const key = member.guild.id;
    if (!joinWindows.has(key) && joinWindows.size >= MAX_WINDOW_KEYS) joinWindows.delete(joinWindows.keys().next().value);
    const entries = trimWindow(key, now, seconds);
    entries.push({ id: member.id, member, at: now });
    joinWindows.set(key, entries.slice(-MAX_WINDOW_EVENTS));
    return entries;
}

async function punish(member, punishment, reason) {
    const action = { ban: 'BAN', kick: 'KICK', timeout: 'TIMEOUT', jail: 'JAIL' }[punishment];
    return executeMemberAction({
        guild: member.guild,
        executor: member.guild.members.me,
        target: member,
        action,
        reason,
        durationMs: punishment === 'timeout' ? 300000 : undefined,
        automated: true
    });
}

async function recordIncident(member, module, punishment, count = 1) {
    const createdAt = Date.now();
    const result = sqlite.prepare(`
        INSERT INTO antiraid_incidents (guild_id, user_id, module, action_count, punishment, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(member.guild.id, member.id, module, count, punishment, createdAt);
    let status = 'punished';
    let error = null;
    try {
        await punish(member, punishment, `AntiRaid ${module} detector`);
    } catch (caught) {
        status = 'failed';
        error = caught.message;
    }
    sqlite.prepare('UPDATE antiraid_incidents SET status = ?, error = ? WHERE id = ?')
        .run(status, error, Number(result.lastInsertRowid));
    return { id: Number(result.lastInsertRowid), module, punishment, count, status, error };
}

async function handleMemberJoin(member, now = Date.now()) {
    const config = sqlite.prepare('SELECT * FROM antiraid_config WHERE guild_id = ? AND enabled = 1').get(member.guild.id);
    if (!config || isExempt(member)) return null;
    const rows = sqlite.prepare('SELECT * FROM antiraid_modules WHERE guild_id = ? AND enabled = 1').all(member.guild.id);
    const modules = new Map(rows.map(row => [row.module, row]));
    const massjoin = modules.get('massjoin');
    const joins = massjoin ? addJoin(member, now, massjoin.window_seconds) : [];

    const matches = [];
    if (modules.has('newaccounts') && now - member.user.createdTimestamp < modules.get('newaccounts').threshold * 86400000) {
        matches.push(['newaccounts', modules.get('newaccounts').punishment || config.punishment]);
    }
    if (modules.has('defaultpfp') && !member.user.avatar) {
        matches.push(['defaultpfp', modules.get('defaultpfp').punishment || config.punishment]);
    }
    if (modules.has('username')) {
        const pattern = sqlite.prepare(`
            SELECT pattern, punishment FROM antiraid_username_patterns
            WHERE guild_id = ? AND instr(lower(?), lower(pattern)) > 0 ORDER BY length(pattern) DESC LIMIT 1
        `).get(member.guild.id, member.user.username);
        if (pattern) matches.push(['username', pattern.punishment || modules.get('username').punishment || config.username_punishment]);
    }
    if (modules.has('unverifiedbots') && member.user.bot
        && !member.user.flags?.has(UserFlagsBitField.Flags.VerifiedBot)) {
        matches.push(['unverifiedbots', modules.get('unverifiedbots').punishment || config.unverifiedbot_punishment]);
    }
    if (matches.length) {
        const priority = { timeout: 1, jail: 2, kick: 3, ban: 4 };
        const match = matches.reduce((strongest, candidate) => priority[candidate[1]] > priority[strongest[1]] ? candidate : strongest);
        return { ...await recordIncident(member, match[0], match[1]), matchedModules: matches.map(([module]) => module) };
    }
    if (!massjoin || joins.length < massjoin.threshold) return null;

    joinWindows.delete(member.guild.id);
    const punishment = massjoin.punishment || config.punishment;
    const targets = massjoin.punish_members ? joins.map(entry => entry.member).filter(item => !isExempt(item)) : [member];
    const results = [];
    for (const target of targets) results.push(await recordIncident(target, 'massjoin', punishment, joins.length));
    if (massjoin.lock_channels && results.some(result => result.status === 'punished')) {
        try {
            await lockdownAll({ guild: member.guild, executor: member.guild.members.me, reason: 'AntiRaid mass-join lockdown' });
            sqlite.prepare('UPDATE antiraid_config SET lockdown_enabled = 1 WHERE guild_id = ?').run(member.guild.id);
        } catch (error) {
            logger.error(`AntiRaid lockdown failed in ${member.guild.id}: ${error.message}`);
        }
    }
    return { ...results.at(-1), module: 'massjoin', count: joins.length };
}

async function handleMassMention(message) {
    if (message.author?.bot || message.webhookId) return null;
    const config = sqlite.prepare('SELECT * FROM antiraid_config WHERE guild_id = ? AND enabled = 1').get(message.guild.id);
    const module = sqlite.prepare("SELECT * FROM antiraid_modules WHERE guild_id = ? AND module = 'massmention' AND enabled = 1").get(message.guild.id);
    if (!config || !module || isExempt(message.member)) return null;
    const count = (message.mentions?.users?.size || 0) + (message.mentions?.roles?.size || 0) + Number(Boolean(message.mentions?.everyone));
    const threshold = module.threshold || config.massmention_threshold;
    if (count < threshold) return null;
    const incident = await recordIncident(message.member, 'massmention', module.punishment || config.massmention_punishment, count);
    if (incident.status === 'punished' && config.massmention_lockdown_seconds > 0 && !config.lockdown_enabled) {
        const expiresAt = Date.now() + config.massmention_lockdown_seconds * 1000;
        sqlite.prepare('UPDATE antiraid_config SET lockdown_enabled = 1, lockdown_expires_at = ? WHERE guild_id = ?')
            .run(expiresAt, message.guild.id);
        try {
            await lockdownAll({ guild: message.guild, executor: message.guild.members.me, reason: 'AntiRaid mass-mention lockdown' });
            scheduleLockdownRelease(message.guild, expiresAt);
        } catch (error) {
            logger.error(`AntiRaid mass-mention lockdown failed in ${message.guild.id}: ${error.message}`);
            scheduleLockdownRelease(message.guild, expiresAt);
        }
    }
    return incident;
}

function scheduleLockdownRelease(guild, expiresAt) {
    clearTimeout(lockdownTimers.get(guild.id));
    const timer = setTimeout(async () => {
        try {
            await lockdownAll({ guild, executor: guild.members.me, reason: 'AntiRaid timed lockdown ended', unlock: true });
            sqlite.prepare('UPDATE antiraid_config SET lockdown_enabled = 0, lockdown_expires_at = NULL WHERE guild_id = ?').run(guild.id);
            lockdownTimers.delete(guild.id);
        } catch (error) {
            logger.error(`AntiRaid timed unlock failed in ${guild.id}: ${error.message}`);
            scheduleLockdownRelease(guild, Date.now() + 30000);
        }
    }, Math.max(0, expiresAt - Date.now()));
    timer.unref?.();
    lockdownTimers.set(guild.id, timer);
}

async function recoverLockdowns(client) {
    const rows = sqlite.prepare(`
        SELECT guild_id, lockdown_expires_at FROM antiraid_config
        WHERE lockdown_enabled = 1 AND lockdown_expires_at IS NOT NULL
    `).all();
    const failures = [];
    for (const row of rows) {
        try {
            const guild = client.guilds.cache.get(row.guild_id) || await client.guilds.fetch(row.guild_id);
            if (row.lockdown_expires_at <= Date.now()) {
                await lockdownAll({ guild, executor: guild.members.me, reason: 'Recovered AntiRaid timed lockdown', unlock: true });
                sqlite.prepare('UPDATE antiraid_config SET lockdown_enabled = 0, lockdown_expires_at = NULL WHERE guild_id = ?').run(row.guild_id);
            } else scheduleLockdownRelease(guild, row.lockdown_expires_at);
        } catch (error) {
            failures.push(`${row.guild_id}: ${error.message}`);
            const guild = client.guilds.cache.get(row.guild_id);
            if (guild) scheduleLockdownRelease(guild, Date.now() + 30000);
        }
    }
    return { recovered: rows.length - failures.length, failures };
}

function recoverPendingIncidents() {
    return sqlite.prepare(`
        UPDATE antiraid_incidents SET status = 'failed', error = COALESCE(error, 'Interrupted before the action result was recorded.')
        WHERE status = 'pending'
    `).run().changes;
}

function clearWindows() {
    joinWindows.clear();
    for (const timer of lockdownTimers.values()) clearTimeout(timer);
    lockdownTimers.clear();
}

module.exports = {
    MODULES, PUNISHMENTS, ensureConfig, upsertModule, isExempt, handleMemberJoin, handleMassMention,
    recoverLockdowns, recoverPendingIncidents, clearWindows
};
