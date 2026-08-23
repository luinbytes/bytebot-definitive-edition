const path = require('path');
const { Worker } = require('worker_threads');
const { PermissionFlagsBits } = require('discord.js');
const { sqlite } = require('../database');
const { executeMemberAction, executeRecordedAction } = require('./moderationService');

const FILTERS = [
    'spam', 'caps', 'emoji', 'massmention', 'spoilers', 'images', 'invites', 'links',
    'repetition', 'walloftext', 'keywords', 'musicfiles', 'nicknames', 'nsfw', 'malicious'
];
const ACTIONS = ['delete', 'timeout', 'warn', 'kick', 'ban', 'jail', 'strip', 'stripstaff'];
const RULE_LIMITS = { keyword: 1000, regex: 10, blacklist: 1000, allowlink: 100, allowword: 100 };
const WINDOW_KEY_LIMIT = 10000;
const REGEX_QUEUE_LIMIT = 100;
const spamWindows = new Map();
const repetitionWindows = new Map();
let regexWorker;
let regexRequestId = 0;
let regexQueue = Promise.resolve();
let regexPending = 0;

function ensureConfig(guildId) {
    sqlite.prepare('INSERT INTO automod_config (guild_id) VALUES (?) ON CONFLICT DO NOTHING').run(guildId);
    return sqlite.prepare('SELECT * FROM automod_config WHERE guild_id = ?').get(guildId);
}

function upsertFilter(guildId, filter, changes) {
    if (!FILTERS.includes(filter)) throw new Error('Unknown AutoMod filter.');
    if (changes.threshold != null && (!Number.isInteger(changes.threshold) || changes.threshold < 1 || changes.threshold > 2000)) {
        throw new Error('AutoMod thresholds must be between 1 and 2000.');
    }
    if (['spam', 'repetition'].includes(filter) && changes.threshold > 100) {
        throw new Error(`${filter} thresholds must be between 1 and 100.`);
    }
    if (changes.secondaryThreshold != null && (!Number.isInteger(changes.secondaryThreshold) || changes.secondaryThreshold < 0 || changes.secondaryThreshold > 2000)) {
        throw new Error('AutoMod secondary thresholds must be between 0 and 2000.');
    }
    if (changes.action != null && !ACTIONS.includes(changes.action)) throw new Error('Unknown AutoMod action.');
    sqlite.prepare('INSERT INTO automod_filters (guild_id, filter) VALUES (?, ?) ON CONFLICT DO NOTHING').run(guildId, filter);
    const columns = { enabled: 'enabled', threshold: 'threshold', secondaryThreshold: 'secondary_threshold', action: 'action' };
    const updates = Object.entries(changes).filter(([key]) => columns[key]);
    if (updates.length) {
        sqlite.prepare(`UPDATE automod_filters SET ${updates.map(([key]) => `${columns[key]} = ?`).join(', ')} WHERE guild_id = ? AND filter = ?`)
            .run(...updates.map(([, value]) => value), guildId, filter);
    }
    return sqlite.prepare('SELECT * FROM automod_filters WHERE guild_id = ? AND filter = ?').get(guildId, filter);
}

function normalizedRule(kind, value) {
    const raw = String(value || '').trim();
    const result = kind === 'regex' ? raw : raw.toLowerCase();
    if (!result) throw new Error('Rule value is required.');
    if (kind === 'keyword' && result.length > 32) throw new Error('Keywords must be 32 characters or less.');
    if (kind === 'regex' && result.length > 260) throw new Error('Regex patterns must be 260 characters or less.');
    if (['blacklist', 'allowlink'].includes(kind)) {
        const host = result.replace(/^https?:\/\//, '').split('/')[0].replace(/\.$/, '');
        if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(host)) throw new Error('A valid domain is required.');
        return host;
    }
    return result;
}

function addRule(guildId, kind, value, name = value) {
    if (!RULE_LIMITS[kind]) throw new Error('Unknown AutoMod rule type.');
    const count = sqlite.prepare('SELECT COUNT(*) AS count FROM automod_rules WHERE guild_id = ? AND kind = ?').get(guildId, kind).count;
    if (count >= RULE_LIMITS[kind]) throw new Error(`${kind} rules have reached their ${RULE_LIMITS[kind]} entry limit.`);
    const normalized = normalizedRule(kind, value);
    const normalizedName = kind === 'regex' ? String(name).trim().toLowerCase() : normalized;
    sqlite.prepare(`
        INSERT INTO automod_rules (guild_id, kind, name, value, created_at) VALUES (?, ?, ?, ?, ?)
    `).run(guildId, kind, normalizedName, normalized, Date.now());
    return normalized;
}

function removeRule(guildId, kind, value) {
    const normalized = normalizedRule(kind, value);
    return sqlite.prepare('DELETE FROM automod_rules WHERE guild_id = ? AND kind = ? AND value = ?').run(guildId, kind, normalized);
}

async function addRegex(guildId, name, pattern) {
    if (!name || String(name).length > 32) throw new Error('Regex names must be 1-32 characters.');
    const normalized = normalizedRule('regex', pattern);
    try { new RegExp(normalized, 'iu'); } catch (error) { throw new Error(`Invalid regex: ${error.message}`); }
    const probe = await testRegex(normalized, '', 100);
    if (probe.timedOut || probe.error) throw new Error('Regex could not be evaluated safely.');
    return addRule(guildId, 'regex', normalized, name);
}

function createRegexWorker() {
    const worker = new Worker(path.join(__dirname, '../workers/regexWorker.js'));
    worker.unref();
    return worker;
}

function evaluateRegex(patterns, text, timeoutMs) {
    return new Promise(resolve => {
        if (!regexWorker) regexWorker = createRegexWorker();
        const worker = regexWorker;
        const id = ++regexRequestId;
        const finish = result => {
            clearTimeout(timer);
            worker.off('message', onMessage);
            worker.off('error', onError);
            worker.off('exit', onExit);
            resolve(result);
        };
        const onMessage = result => { if (result.id === id) finish(result); };
        const onError = error => {
            regexWorker = null;
            finish({ matched: false, error: error.message });
        };
        const onExit = code => {
            if (regexWorker === worker) regexWorker = null;
            finish({ matched: false, error: `Regex worker exited with code ${code}.` });
        };
        const timer = setTimeout(() => {
            regexWorker = null;
            worker.terminate().catch(() => {});
            finish({ timedOut: true, matched: false });
        }, timeoutMs);
        timer.unref?.();
        worker.on('message', onMessage);
        worker.once('error', onError);
        worker.once('exit', onExit);
        worker.postMessage({ id, patterns, text: String(text).slice(0, 2000) });
    });
}

function queueRegex(task) {
    if (regexPending >= REGEX_QUEUE_LIMIT) return Promise.resolve({ matched: false, error: 'Regex queue is full.' });
    regexPending++;
    const result = regexQueue.then(task, task);
    regexQueue = result.catch(() => {});
    return result.finally(() => { regexPending--; });
}

function testRegex(pattern, text, timeoutMs = 50) {
    return queueRegex(() => evaluateRegex([{ name: 'test', pattern }], text, timeoutMs));
}

function testRegexRules(patterns, text, timeoutMs = 50) {
    return queueRegex(() => evaluateRegex(patterns, text, timeoutMs));
}

function memberRoleIds(member) {
    return [...(member.roles?.cache?.keys?.() || [])];
}

function isExempt(member) {
    if (!member?.guild || member.user?.bot || member.id === member.guild.ownerId) return true;
    if ([PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ModerateMembers]
        .some(permission => member.permissions?.has(permission))) return true;
    if (sqlite.prepare("SELECT 1 FROM automod_exemptions WHERE guild_id = ? AND target_type = 'user' AND target_id = ?")
        .get(member.guild.id, member.id)) return true;
    const roles = memberRoleIds(member);
    return Boolean(roles.length && sqlite.prepare(`
        SELECT 1 FROM automod_exemptions WHERE guild_id = ? AND target_type = 'role'
        AND target_id IN (${roles.map(() => '?').join(',')}) LIMIT 1
    `).get(member.guild.id, ...roles));
}

function isMessageExempt(message) {
    if (isExempt(message.member)) return true;
    return Boolean(sqlite.prepare(`
        SELECT 1 FROM automod_exemptions WHERE guild_id = ? AND target_type = 'channel' AND target_id = ?
    `).get(message.guild.id, message.channelId));
}

function boundedWindow(map, key, now, duration, value) {
    if (!map.has(key) && map.size >= WINDOW_KEY_LIMIT) map.delete(map.keys().next().value);
    const values = (map.get(key) || []).filter(entry => entry.at >= now - duration).slice(-99);
    values.push({ at: now, value });
    map.set(key, values);
    return values;
}

function urls(content) {
    return [...String(content).matchAll(/https?:\/\/[^\s<>()]+/gi)].map(match => {
        try { return new URL(match[0]).hostname.toLowerCase().replace(/\.$/, ''); } catch { return null; }
    }).filter(Boolean);
}

function domainMatches(host, configured) {
    return host === configured || host.endsWith(`.${configured}`);
}

function keywordMatches(content, keyword) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(content);
}

function filterMatch(filter, message, row, now, rules) {
    const content = String(message.content || '').slice(0, 2000);
    if (filter === 'spam') {
        return boundedWindow(spamWindows, `${message.guild.id}:${message.author.id}`, now, 10000).length >= row.threshold;
    }
    if (filter === 'caps') {
        const letters = content.match(/\p{L}/gu) || [];
        const uppercase = content.match(/\p{Lu}/gu) || [];
        return letters.length >= 10 && uppercase.length * 100 / letters.length >= row.threshold;
    }
    if (filter === 'emoji') return (content.match(/\p{Extended_Pictographic}|<a?:\w+:\d+>/gu) || []).length >= row.threshold;
    if (filter === 'massmention') return (message.mentions?.users?.size || 0) + (message.mentions?.roles?.size || 0)
        + Number(Boolean(message.mentions?.everyone)) >= row.threshold;
    if (filter === 'spoilers') return (content.match(/\|\|/g) || []).length / 2 >= row.threshold;
    if (filter === 'images') return [...(message.attachments?.values?.() || [])].filter(item => item.contentType?.startsWith('image/')).length
        + (message.embeds || []).filter(embed => embed.image || embed.thumbnail).length >= row.threshold;
    if (filter === 'invites') return /(?:discord\.gg|discord(?:app)?\.com\/invite)\/[\w-]+/i.test(content);
    if (filter === 'links') {
        const allowed = rules.filter(rule => rule.kind === 'allowlink').map(rule => rule.value);
        return urls(content).some(host => !allowed.some(domain => domainMatches(host, domain)));
    }
    if (filter === 'repetition') {
        const normalized = content.trim().replace(/\s+/g, ' ').toLowerCase();
        if (!normalized) return false;
        const values = boundedWindow(repetitionWindows, `${message.guild.id}:${message.author.id}`, now, 30000, normalized);
        return values.filter(entry => entry.value === normalized).length >= row.threshold;
    }
    if (filter === 'walloftext') return content.length >= row.threshold
        || (row.secondary_threshold > 0 && (content.match(/\n/g) || []).length >= row.secondary_threshold);
    if (filter === 'keywords') {
        if (rules.filter(rule => rule.kind === 'allowword').some(rule => keywordMatches(content, rule.value))) return false;
        return rules.filter(rule => rule.kind === 'keyword').some(rule => keywordMatches(content, rule.value));
    }
    if (filter === 'musicfiles') return [...(message.attachments?.values?.() || [])].some(item =>
        item.contentType?.startsWith('audio/') || /\.(?:mp3|wav|ogg|flac|m4a|aac)$/i.test(item.name || ''));
    if (filter === 'malicious') {
        const blocked = rules.filter(rule => rule.kind === 'blacklist').map(rule => rule.value);
        return urls(content).some(host => blocked.some(domain => domainMatches(host, domain)));
    }
    return false;
}

function getActiveStrikes(guildId, userId, now = Date.now()) {
    const config = ensureConfig(guildId);
    const row = sqlite.prepare('SELECT * FROM automod_strikes WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
    if (!row || now - row.last_strike_at >= config.strike_decay_hours * 3600000) return { count: 0, lastStrikeAt: null };
    return { count: row.count, lastStrikeAt: row.last_strike_at };
}

function addStrike(guildId, userId, now) {
    const config = ensureConfig(guildId);
    const active = getActiveStrikes(guildId, userId, now);
    const count = Math.min(config.strike_cap, active.count + 1);
    sqlite.prepare(`
        INSERT INTO automod_strikes (guild_id, user_id, count, last_strike_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (guild_id, user_id) DO UPDATE SET count = excluded.count, last_strike_at = excluded.last_strike_at
    `).run(guildId, userId, count, now);
    return count;
}

function setStrikeLevel(guildId, level, action, durationMs = null) {
    if (!Number.isInteger(level) || level < 1 || level > 10) throw new Error('Strike levels must be between 1 and 10.');
    if (!ACTIONS.includes(action)) throw new Error('Unknown strike action.');
    sqlite.prepare(`
        INSERT INTO automod_strike_levels (guild_id, level, action, duration_ms) VALUES (?, ?, ?, ?)
        ON CONFLICT (guild_id, level) DO UPDATE SET action = excluded.action, duration_ms = excluded.duration_ms
    `).run(guildId, level, action, durationMs);
}

async function applyAction(message, action, durationMs, reason) {
    if (action === 'delete') {
        if (!message.channel.permissionsFor?.(message.guild.members.me)?.has(PermissionFlagsBits.ManageMessages)) {
            throw new Error('I need Manage Messages to delete filtered messages.');
        }
        return message.delete();
    }
    const mapped = { timeout: 'TIMEOUT', warn: 'WARN', kick: 'KICK', ban: 'BAN', jail: 'JAIL', strip: 'STRIP', stripstaff: 'STAFFSTRIP' }[action];
    return executeMemberAction({
        guild: message.guild, executor: message.guild.members.me, target: message.member,
        action: mapped, reason, durationMs: action === 'timeout' ? durationMs : undefined, automated: true
    });
}

async function handleMessage(message, now = Date.now()) {
    if (!message.guild || message.author?.bot || message.webhookId || message.system || isMessageExempt(message)) return null;
    const config = sqlite.prepare('SELECT * FROM automod_config WHERE guild_id = ? AND enabled = 1').get(message.guild.id);
    if (!config) return null;
    const enabledRows = sqlite.prepare('SELECT * FROM automod_filters WHERE guild_id = ? AND enabled = 1').all(message.guild.id);
    const byName = new Map(enabledRows.map(row => [row.filter, row]));
    const filters = FILTERS.map(name => byName.get(name)).filter(Boolean);
    const rules = sqlite.prepare('SELECT * FROM automod_rules WHERE guild_id = ? ORDER BY kind, name').all(message.guild.id);
    let matched;
    for (const row of filters) {
        if (row.filter === 'nsfw' || row.filter === 'nicknames') continue;
        if (filterMatch(row.filter, message, row, now, rules)) {
            matched = { filter: row.filter, action: row.action };
            break;
        }
    }
    if (!matched) {
        const patterns = rules.filter(rule => rule.kind === 'regex').map(rule => ({ name: rule.name, pattern: rule.value }));
        if (patterns.length) {
            const regex = await testRegexRules(patterns, message.content || '');
            if (regex.matched) matched = { filter: `regex:${regex.name}`, action: 'delete' };
        }
    }
    if (!matched) return null;

    const inserted = sqlite.prepare(`
        INSERT INTO automod_incidents (guild_id, user_id, message_id, filter, action, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?) ON CONFLICT (guild_id, message_id) DO NOTHING
    `).run(message.guild.id, message.author.id, message.id, matched.filter, matched.action, now);
    if (!inserted.changes) return null;
    let action = matched.action;
    let durationMs = config.timeout_ms;
    if (config.strikes_enabled) {
        const count = addStrike(message.guild.id, message.author.id, now);
        const level = sqlite.prepare('SELECT * FROM automod_strike_levels WHERE guild_id = ? AND level = ?').get(message.guild.id, count);
        if (level) {
            action = level.action;
            durationMs = level.duration_ms || durationMs;
        }
    }
    let status = 'applied';
    let error = null;
    try {
        await applyAction(message, action, durationMs, `AutoMod ${matched.filter} filter`);
    } catch (caught) {
        status = 'failed';
        error = caught.message;
    }
    sqlite.prepare('UPDATE automod_incidents SET action = ?, status = ?, error = ? WHERE guild_id = ? AND message_id = ?')
        .run(action, status, error, message.guild.id, message.id);
    return { filter: matched.filter, action, status, error };
}

async function handleMemberUpdate(oldMember, newMember, now = Date.now()) {
    if ((oldMember.displayName || oldMember.nickname) === (newMember.displayName || newMember.nickname) || isExempt(newMember)) return null;
    const config = sqlite.prepare('SELECT * FROM automod_config WHERE guild_id = ? AND enabled = 1').get(newMember.guild.id);
    const filter = sqlite.prepare("SELECT * FROM automod_filters WHERE guild_id = ? AND filter = 'nicknames' AND enabled = 1")
        .get(newMember.guild.id);
    if (!config || !filter) return null;
    if (sqlite.prepare('SELECT 1 FROM forced_nicknames WHERE guild_id = ? AND user_id = ?').get(newMember.guild.id, newMember.id)) return null;
    const name = newMember.displayName || newMember.nickname || newMember.user.username;
    const keyword = sqlite.prepare(`
        SELECT value FROM automod_rules WHERE guild_id = ? AND kind = 'keyword' ORDER BY length(value) DESC LIMIT 1000
    `).all(newMember.guild.id).find(rule => keywordMatches(name, rule.value));
    if (!keyword) return null;
    if (filter.action === 'delete' && newMember.nickname) {
        await executeRecordedAction({
            guildId: newMember.guild.id, targetId: newMember.id, executorId: newMember.guild.members.me.id,
            action: 'AUTOMOD_NICKNAME', reason: 'AutoMod nickname filter',
            perform: () => newMember.setNickname(null, 'AutoMod nickname filter')
        });
    } else if (filter.action !== 'delete') {
        const fakeMessage = {
            id: `member-${newMember.id}-${now}`, guild: newMember.guild, author: newMember.user,
            member: newMember, channel: {}, delete: async () => {}
        };
        await applyAction(fakeMessage, filter.action, config.timeout_ms, 'AutoMod nickname filter');
    }
    return { filter: 'nicknames', action: filter.action };
}

async function handleNativeActionExecution(execution, now = Date.now()) {
    const guild = execution.guild;
    const config = sqlite.prepare('SELECT * FROM automod_config WHERE guild_id = ?').get(guild.id);
    if (!config?.enabled || !execution.messageId) return null;
    const filterName = execution.ruleId === config.native_rule_id
        ? 'keywords' : execution.ruleId === config.native_nsfw_rule_id ? 'nsfw' : null;
    if (!filterName) return null;
    const member = execution.member || await guild.members.fetch(execution.userId);
    if (isExempt(member)) return null;
    const filter = sqlite.prepare('SELECT * FROM automod_filters WHERE guild_id = ? AND filter = ?').get(guild.id, filterName)
        || { action: 'delete' };
    if (!filter.enabled) return null;
    const inserted = sqlite.prepare(`
        INSERT INTO automod_incidents (guild_id, user_id, message_id, filter, action, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?) ON CONFLICT (guild_id, message_id) DO NOTHING
    `).run(guild.id, member.id, execution.messageId, `native:${filterName}`, filter.action, now);
    if (!inserted.changes) return null;
    let action = filter.action;
    let durationMs = config.timeout_ms;
    if (config.strikes_enabled) {
        const count = addStrike(guild.id, member.id, now);
        const level = sqlite.prepare('SELECT * FROM automod_strike_levels WHERE guild_id = ? AND level = ?').get(guild.id, count);
        if (level) {
            action = level.action;
            durationMs = level.duration_ms || durationMs;
        }
    }
    let status = 'applied';
    let error = null;
    try {
        if (action !== 'delete') {
            await applyAction({ guild, member, author: member.user, channel: {} }, action, durationMs, `Discord AutoMod ${filterName} rule`);
        }
    } catch (caught) {
        status = 'failed';
        error = caught.message;
    }
    sqlite.prepare('UPDATE automod_incidents SET action = ?, status = ?, error = ? WHERE guild_id = ? AND message_id = ?')
        .run(action, status, error, guild.id, execution.messageId);
    return { filter: `native:${filterName}`, action, status, error };
}

async function reconcileNativeRules(client) {
    const rows = sqlite.prepare(`
        SELECT guild_id, enabled, native_rule_id, native_nsfw_rule_id FROM automod_config
        WHERE native_rule_id IS NOT NULL OR native_nsfw_rule_id IS NOT NULL
    `).all();
    const failures = [];
    let reconciled = 0;
    for (const row of rows) {
        try {
            const guild = client.guilds.cache.get(row.guild_id) || await client.guilds.fetch(row.guild_id);
            const rules = await guild.autoModerationRules.fetch();
            const keyword = row.native_rule_id && rules.has(row.native_rule_id) ? row.native_rule_id : null;
            const nsfw = row.native_nsfw_rule_id && rules.has(row.native_nsfw_rule_id) ? row.native_nsfw_rule_id : null;
            const filters = new Map(sqlite.prepare("SELECT filter, enabled FROM automod_filters WHERE guild_id = ? AND filter IN ('keywords', 'nsfw')")
                .all(row.guild_id).map(filter => [filter.filter, Boolean(filter.enabled)]));
            for (const [id, filter] of [[keyword, 'keywords'], [nsfw, 'nsfw']].filter(([id]) => id)) {
                const rule = rules.get(id);
                const enabled = Boolean(row.enabled && filters.get(filter));
                if (rule.enabled !== enabled) await rule.edit({ enabled, reason: 'ByteBot startup reconciliation' });
            }
            sqlite.prepare('UPDATE automod_config SET native_rule_id = ?, native_nsfw_rule_id = ? WHERE guild_id = ?')
                .run(keyword, nsfw, row.guild_id);
            reconciled++;
        } catch (error) {
            failures.push(`${row.guild_id}: ${error.message}`);
        }
    }
    return { reconciled, failures };
}

function forgetNativeRule(guildId, ruleId) {
    sqlite.prepare(`
        UPDATE automod_config
        SET native_rule_id = CASE WHEN native_rule_id = ? THEN NULL ELSE native_rule_id END,
            native_nsfw_rule_id = CASE WHEN native_nsfw_rule_id = ? THEN NULL ELSE native_nsfw_rule_id END
        WHERE guild_id = ?
    `).run(ruleId, ruleId, guildId);
}

function recoverPendingIncidents() {
    return sqlite.prepare(`
        UPDATE automod_incidents SET status = 'failed', error = COALESCE(error, 'Interrupted before the action result was recorded.')
        WHERE status = 'pending'
    `).run().changes;
}

async function cleanup() {
    spamWindows.clear();
    repetitionWindows.clear();
    if (regexWorker) await regexWorker.terminate();
    regexWorker = null;
}

module.exports = {
    FILTERS, ACTIONS, ensureConfig, upsertFilter, addRule, removeRule, addRegex, testRegex,
    getActiveStrikes, setStrikeLevel, isExempt, handleMessage, handleMemberUpdate,
    handleNativeActionExecution, reconcileNativeRules, forgetNativeRule, recoverPendingIncidents, cleanup
};
