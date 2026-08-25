const { MessageType, PermissionFlagsBits } = require('discord.js');
const { randomInt } = require('crypto');
const { and, eq } = require('drizzle-orm');
const { db } = require('../database');
const { uwuLockMembers, uwuRouletteConfigs } = require('../database/schema');
const logger = require('./logger');

const FUNCTIONAL_TOKEN = /```[\s\S]*?```|`[^`\n]*`|https?:\/\/\S+|<[^>\n]+>/g;
const WEBHOOK_NAME = 'ByteBot UwU Lock';
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const ROULETTE_WINDOW_MS = 10_000;
const MAX_ROULETTE_REPLAYS = 10;
const rouletteWindows = new Map();
const webhookRequests = new Map();

function getReplayWebhook(channel, botId) {
    let request = webhookRequests.get(channel.id);
    if (!request) {
        request = channel.fetchWebhooks().then(webhooks =>
            Array.from(webhooks.values()).find(item =>
                item.owner?.id === botId && item.name === WEBHOOK_NAME
            ) || channel.createWebhook({ name: WEBHOOK_NAME, reason: 'UwU Lock message replay' })
        );
        webhookRequests.set(channel.id, request);
        request.finally(() => {
            if (webhookRequests.get(channel.id) === request) webhookRequests.delete(channel.id);
        }).catch(() => {});
    }
    return request;
}

function uwuifyText(text) {
    const input = String(text ?? '');
    let cursor = 0;
    let result = '';

    for (const match of input.matchAll(FUNCTIONAL_TOKEN)) {
        result += input.slice(cursor, match.index).replace(/[rl]/g, 'w').replace(/[RL]/g, 'W');
        result += match[0];
        cursor = match.index + match[0].length;
    }

    return result + input.slice(cursor).replace(/[rl]/g, 'w').replace(/[RL]/g, 'W');
}

function getUwuLockState(guildId, userId) {
    return db.select()
        .from(uwuLockMembers)
        .where(and(eq(uwuLockMembers.guildId, guildId), eq(uwuLockMembers.userId, userId)))
        .get();
}

function setUwuLockState(guildId, userId, state) {
    if (state !== 'target' && state !== 'protected') {
        throw new Error(`Invalid UwU Lock state: ${state}`);
    }

    return db.insert(uwuLockMembers)
        .values({ guildId, userId, state })
        .onConflictDoUpdate({
            target: [uwuLockMembers.guildId, uwuLockMembers.userId],
            set: { state }
        })
        .run();
}

function removeUwuLockState(guildId, userId, state) {
    return db.delete(uwuLockMembers)
        .where(and(
            eq(uwuLockMembers.guildId, guildId),
            eq(uwuLockMembers.userId, userId),
            eq(uwuLockMembers.state, state)
        ))
        .run();
}

function listUwuLockMembers(guildId, state) {
    return db.select()
        .from(uwuLockMembers)
        .where(and(eq(uwuLockMembers.guildId, guildId), eq(uwuLockMembers.state, state)))
        .orderBy(uwuLockMembers.userId)
        .all();
}

function setUwuRoulette(guildId, percentage) {
    if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) {
        throw new Error('UwU Roulette percentage must be an integer from 0 to 100.');
    }
    if (percentage === 0) return db.delete(uwuRouletteConfigs).where(eq(uwuRouletteConfigs.guildId, guildId)).run();
    return db.insert(uwuRouletteConfigs).values({ guildId, percentage, updatedAt: Date.now() }).onConflictDoUpdate({
        target: uwuRouletteConfigs.guildId,
        set: { percentage, updatedAt: Date.now() }
    }).run();
}

function rouletteSelected(message) {
    const config = db.select().from(uwuRouletteConfigs)
        .where(eq(uwuRouletteConfigs.guildId, message.guild.id)).get();
    if (!config) return false;

    const key = `${message.guild.id}:${message.channelId || message.channel.id}`;
    const now = Date.now();
    let window = rouletteWindows.get(key);
    if (!window || now - window.startedAt >= ROULETTE_WINDOW_MS) window = { startedAt: now, replays: 0 };
    if (window.replays >= MAX_ROULETTE_REPLAYS || randomInt(100) >= config.percentage) return false;
    window.replays += 1;
    if (!rouletteWindows.has(key) && rouletteWindows.size >= 1000) {
        rouletteWindows.delete(rouletteWindows.keys().next().value);
    }
    rouletteWindows.set(key, window);
    return true;
}

async function handleUwuLockMessage(message) {
    if (!message.guild || message.author?.bot || message.webhookId || message.system) return false;
    if (message.author.id === message.guild.ownerId || message.author.id === message.client.user.id) return false;
    const state = getUwuLockState(message.guild.id, message.author.id)?.state;
    if (state === 'protected') return false;
    if (message.type !== MessageType.Default || message.reference || message.poll) return false;
    if (message.components?.length || message.stickers?.size) return false;

    const attachments = Array.from(message.attachments?.values?.() || []);
    const attachmentBytes = attachments.reduce((total, attachment) => total + (attachment.size || 0), 0);
    if (attachments.length > MAX_ATTACHMENTS || attachmentBytes > MAX_ATTACHMENT_BYTES) return false;
    if (attachments.some(attachment => !attachment.url || !attachment.name || !attachment.size)) return false;

    const sourceChannel = message.channel;
    const webhookChannel = sourceChannel.isThread?.() ? sourceChannel.parent : sourceChannel;
    const botMember = message.guild.members.me;
    const sourcePermissions = sourceChannel.permissionsFor?.(botMember);
    const webhookPermissions = webhookChannel?.permissionsFor?.(botMember);
    if (!webhookChannel || !message.deletable) return false;
    if (!sourcePermissions?.has(PermissionFlagsBits.ManageMessages)) return false;
    if (!webhookPermissions?.has(PermissionFlagsBits.ManageWebhooks)) return false;
    if (state !== 'target' && !rouletteSelected(message)) return false;

    let replay;
    try {
        const webhook = await getReplayWebhook(webhookChannel, message.client.user.id);
        const payload = {
            content: uwuifyText(message.content),
            username: (message.member?.displayName || message.author.username).slice(0, 80),
            avatarURL: message.author.displayAvatarURL({ extension: 'png', size: 256 }),
            allowedMentions: { parse: [], repliedUser: false }
        };

        if (attachments.length) {
            payload.files = attachments.map(attachment => ({
                attachment: attachment.url,
                name: attachment.name
            }));
        }
        if (sourceChannel.isThread?.()) payload.threadId = sourceChannel.id;

        replay = await webhook.send(payload);
    } catch (error) {
        logger.warn(`UwU Lock replay failed for message ${message.id}: ${error.message}`);
        return true;
    }

    try {
        await message.delete();
        logger.info(`UwU Lock replayed message ${message.id} in guild ${message.guild.id}`);
    } catch (error) {
        logger.warn(`UwU Lock original delete failed for message ${message.id}: ${error.message}`);
        const originalStillExists = await sourceChannel.messages?.fetch({ message: message.id, force: true })
            .then(() => true)
            .catch(() => false);
        if (!originalStillExists) {
            logger.warn(`UwU Lock kept replay ${message.id} because original state is unknown`);
            return true;
        }
        try {
            await replay.delete();
        } catch (cleanupError) {
            logger.warn(`UwU Lock replay cleanup failed for message ${message.id}: ${cleanupError.message}`);
        }
    }

    return true;
}

module.exports = {
    getUwuLockState,
    handleUwuLockMessage,
    listUwuLockMembers,
    removeUwuLockState,
    setUwuLockState,
    setUwuRoulette,
    uwuifyText
};
