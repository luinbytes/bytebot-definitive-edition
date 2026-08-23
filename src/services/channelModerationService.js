const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { sqlite } = require('../database');
const { executeRecordedAction } = require('./moderationService');

const MAX_PURGE = 2000;
const MAX_LOCKDOWN_CHANNELS = 500;
const INVITE_RE = /(?:discord\.gg|discord(?:app)?\.com\/invite)\/[\w-]+/i;
const LINK_RE = /https?:\/\/\S+/i;
const EMOJI_RE = /<a?:\w+:\d+>/;

function values(collection) {
    return collection?.values ? [...collection.values()] : [];
}

function has(collection, predicate) {
    return typeof collection?.some === 'function' ? collection.some(predicate) : values(collection).some(predicate);
}

function matches(message, filter, options) {
    const content = message.content || '';
    switch (filter) {
        case 'activity': return message.system || (message.type != null && message.type !== 0 && message.type !== 19);
        case 'bots': return message.author?.bot && !message.webhookId;
        case 'cleanup': return (message.author?.bot && !message.webhookId)
            || Boolean(options.prefix && content.startsWith(options.prefix));
        case 'contains': return content.toLowerCase().includes(options.text.toLowerCase());
        case 'embeds': return (message.embeds?.length || message.embeds?.size || 0) > 0;
        case 'emojis': return EMOJI_RE.test(content);
        case 'endswith': return content.toLowerCase().endsWith(options.text.toLowerCase());
        case 'except': return message.author?.id !== options.memberId;
        case 'files': return (message.attachments?.size || 0) > 0;
        case 'humans': return !message.author?.bot && !message.webhookId;
        case 'images': return has(message.attachments, attachment => attachment.contentType?.startsWith('image/'))
            || has(message.embeds, embed => embed.image || embed.thumbnail);
        case 'invites': return INVITE_RE.test(content);
        case 'links': return LINK_RE.test(content);
        case 'mentions': return (message.mentions?.users?.size || 0) > 0 || (message.mentions?.roles?.size || 0) > 0
            || message.mentions?.everyone;
        case 'reactions': return (message.reactions?.cache?.size || 0) > 0;
        case 'startswith': return content.toLowerCase().startsWith(options.text.toLowerCase());
        case 'stickers': return (message.stickers?.size || 0) > 0;
        case 'system': return Boolean(message.system);
        case 'voice': return message.flags?.has?.(MessageFlags.IsVoiceMessage) || false;
        case 'webhooks': return Boolean(message.webhookId);
        case 'user': return message.author?.id === options.memberId;
        default: return true;
    }
}

async function validateBoundaryMessages(channel, { filter, startId, endId }) {
    if (!['after', 'before', 'between'].includes(filter)) return;
    for (const id of new Set([startId, endId].filter(Boolean))) {
        let message;
        try {
            message = await channel.messages.fetch(id);
        } catch {
            throw new Error(`Message ${id} does not exist or is not accessible.`);
        }
        if (!message || message.channelId !== channel.id) throw new Error(`Message ${id} is not from this channel.`);
    }
}

function validatePurgeOptions({ amount, filter, text, memberId, startId, endId }) {
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_PURGE) throw new Error(`Amount must be between 1 and ${MAX_PURGE}.`);
    if (['contains', 'startswith', 'endswith'].includes(filter)) {
        const minimum = filter === 'contains' ? 2 : 3;
        if (!text || text.length < minimum) throw new Error(`Text must be at least ${minimum} characters long.`);
    }
    if (['user', 'except'].includes(filter) && !memberId) throw new Error(`${filter} requires a member.`);
    if (['after', 'before'].includes(filter) && !/^\d+$/.test(startId || '')) throw new Error(`${filter} requires a message ID.`);
    if (filter === 'between' && (!/^\d+$/.test(startId || '') || !/^\d+$/.test(endId || ''))) {
        throw new Error('between requires two message IDs.');
    }
    if (filter === 'between' && BigInt(startId) >= BigInt(endId)) throw new Error('The start message must be older than the end message.');
}

async function collectMessages(channel, options) {
    const selected = [];
    let before = ['before', 'between'].includes(options.filter)
        ? (options.filter === 'between' ? options.endId : options.startId)
        : undefined;
    let scanned = 0;
    while (selected.length < options.amount && scanned < MAX_PURGE) {
        const page = await channel.messages.fetch({ limit: Math.min(100, MAX_PURGE - scanned), before });
        const messages = values(page);
        if (!messages.length) break;
        scanned += messages.length;
        for (const message of messages) {
            if (message.interaction?.id === options.interactionId) continue;
            if (['after', 'between'].includes(options.filter) && BigInt(message.id) <= BigInt(options.startId)) {
                return selected;
            }
            const effectiveFilter = ['after', 'before', 'between'].includes(options.filter) ? 'all' : options.filter;
            if (matches(message, effectiveFilter, options)) selected.push(message);
            if (selected.length === options.amount) break;
        }
        before = messages[messages.length - 1].id;
        if (messages.length < 100) break;
    }
    return selected;
}

async function purgeMessages({ guild, channel, executor, interactionId, amount, filter = 'all', text, memberId, startId, endId, prefix }) {
    const options = { amount, filter, text, memberId, startId, endId, interactionId, prefix };
    validatePurgeOptions(options);
    await validateBoundaryMessages(channel, options);
    const messages = await collectMessages(channel, options);
    if (!messages.length) throw new Error('No messages matched the purge criteria.');

    return executeRecordedAction({
        guildId: guild.id,
        targetId: channel.id,
        executorId: executor.id,
        action: filter === 'reactions' ? 'PURGE_REACTIONS' : 'PURGE',
        reason: filter === 'reactions' ? `Remove reactions from ${messages.length} messages` : `Delete ${messages.length} messages (${filter})`,
        perform: async () => {
            if (filter === 'reactions') {
                let count = 0;
                for (const message of messages) {
                    count += message.reactions.cache.size;
                    await message.reactions.removeAll();
                }
                return count;
            }
            const recent = messages.filter(message => !message.createdTimestamp || Date.now() - message.createdTimestamp < 14 * 86400000);
            const old = messages.filter(message => !recent.includes(message));
            for (let index = 0; index < recent.length; index += 100) {
                await channel.bulkDelete(recent.slice(index, index + 100), true);
            }
            for (let index = 0; index < old.length; index += 5) {
                await Promise.all(old.slice(index, index + 5).map(message => message.delete()));
            }
            return messages.length;
        }
    });
}

function priorSendMessages(channel, roleId) {
    const overwrite = channel.permissionOverwrites.cache?.get(roleId);
    if (overwrite?.allow?.has(PermissionFlagsBits.SendMessages)) return 1;
    if (overwrite?.deny?.has(PermissionFlagsBits.SendMessages)) return -1;
    return 0;
}

async function lockdownChannel({ guild, channel, executor, reason }) {
    const config = sqlite.prepare('SELECT lock_role_id FROM moderation_config WHERE guild_id = ?').get(guild.id);
    if (!config?.lock_role_id) throw new Error('Set a lockdown role first.');
    if (sqlite.prepare('SELECT 1 FROM lockdown_ignores WHERE guild_id = ? AND channel_id = ?').get(guild.id, channel.id)) {
        throw new Error('This channel is ignored from lockdown.');
    }
    const existing = sqlite.prepare('SELECT * FROM lockdown_states WHERE guild_id = ? AND channel_id = ?').get(guild.id, channel.id);
    if (existing?.state === 'active') throw new Error('This channel is already locked down.');
    await executeRecordedAction({
        guildId: guild.id, targetId: channel.id, executorId: executor.id, action: 'LOCKDOWN', reason,
        perform: async () => {
            const state = existing || (() => {
                sqlite.prepare(`
                    INSERT INTO lockdown_states (guild_id, channel_id, role_id, prior_send_messages, state, created_at)
                    VALUES (?, ?, ?, ?, 'pending', ?)
                `).run(guild.id, channel.id, config.lock_role_id, priorSendMessages(channel, config.lock_role_id), Date.now());
                return sqlite.prepare('SELECT * FROM lockdown_states WHERE guild_id = ? AND channel_id = ?').get(guild.id, channel.id);
            })();
            await channel.permissionOverwrites.edit(state.role_id, { SendMessages: false }, { reason });
            const activated = sqlite.prepare("UPDATE lockdown_states SET state = 'active' WHERE guild_id = ? AND channel_id = ? AND state = 'pending'")
                .run(guild.id, channel.id);
            if (activated.changes !== 1) throw new Error('Lockdown state could not be activated; retry is safe.');
        }
    });
}

async function unlockdownChannel({ guild, channel, executor, reason }) {
    const state = sqlite.prepare('SELECT * FROM lockdown_states WHERE guild_id = ? AND channel_id = ?').get(guild.id, channel.id);
    if (!state) throw new Error('This channel is not locked down.');
    const value = state.prior_send_messages === 1 ? true : state.prior_send_messages === -1 ? false : null;
    await executeRecordedAction({
        guildId: guild.id, targetId: channel.id, executorId: executor.id, action: 'UNLOCKDOWN', reason,
        perform: async () => {
            await channel.permissionOverwrites.edit(state.role_id, { SendMessages: value }, { reason });
            sqlite.prepare('DELETE FROM lockdown_states WHERE guild_id = ? AND channel_id = ?').run(guild.id, channel.id);
        }
    });
}

async function lockdownAll({ guild, executor, reason, unlock = false }) {
    const channels = unlock
        ? sqlite.prepare('SELECT channel_id FROM lockdown_states WHERE guild_id = ?').all(guild.id)
            .map(row => guild.channels.cache.get(row.channel_id)).filter(Boolean)
        : values(guild.channels.cache).filter(channel => channel.isTextBased?.() && !channel.isThread?.());
    if (channels.length > MAX_LOCKDOWN_CHANNELS) throw new Error(`Server lockdown is capped at ${MAX_LOCKDOWN_CHANNELS} channels.`);
    let changed = 0;
    const failures = [];
    for (const channel of channels) {
        try {
            await (unlock ? unlockdownChannel : lockdownChannel)({ guild, channel, executor, reason });
            changed++;
        } catch (error) {
            if (!/ignored|already locked/i.test(error.message)) failures.push(`${channel.id}: ${error.message}`);
        }
    }
    if (failures.length) throw new Error(`Changed ${changed} channels; ${failures.length} failed. Retry is safe.`);
    return changed;
}

module.exports = {
    MAX_PURGE, MAX_LOCKDOWN_CHANNELS, purgeMessages, lockdownChannel, unlockdownChannel, lockdownAll
};
