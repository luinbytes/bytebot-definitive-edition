const { PermissionFlagsBits } = require('discord.js');
const { and, desc, eq, inArray } = require('drizzle-orm');
const { db } = require('../database');
const {
    guilds,
    honeypotConfig,
    honeypotExemptRoles,
    honeypotExemptUsers,
    honeypotIncidents,
    moderationLogs
} = require('../database/schema');
const embeds = require('./embeds');
const logger = require('./logger');

const CATEGORY_NAME = 'dangerous';
const CHANNEL_NAME = 'danger';
const CHANNEL_TOPIC = 'Do not post here. Posts in this honeypot channel are automatically banned.';
const MAX_SNIPPET_LENGTH = 120;
const MAX_AUDIT_REASON_LENGTH = 512;
const DELETE_MESSAGE_SECONDS = 7 * 24 * 60 * 60;
const SUCCESS_STATUSES = ['banned', 'banned_left_server'];
const REQUIRED_BOT_PERMISSIONS = [
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.BanMembers
];

function sanitizeSnippet(content = '', maxLength = MAX_SNIPPET_LENGTH) {
    const withoutUrls = String(content)
        .replace(/https?:\/\/\S+/gi, '[link removed]')
        .replace(/discord\.gg\/\S+/gi, '[invite removed]')
        .replace(/\s+/g, ' ')
        .trim();

    if (!withoutUrls) return '[no text]';
    return withoutUrls.length > maxLength ? `${withoutUrls.slice(0, maxLength - 1)}...` : withoutUrls;
}

function buildAttachmentSummary(message) {
    const count = message.attachments?.size ?? 0;
    if (!count) return null;

    const types = new Set();
    for (const attachment of message.attachments.values()) {
        const type = attachment.contentType?.split('/')[0] || 'file';
        types.add(type);
    }

    return `${count} ${count === 1 ? 'file' : 'files'}${types.size ? ` (${Array.from(types).join(', ')})` : ''}`;
}

function buildBanReason(snippet) {
    const reason = `Honeypot trap triggered in #${CHANNEL_NAME}: "${snippet}"`;
    return reason.length > MAX_AUDIT_REASON_LENGTH
        ? reason.slice(0, MAX_AUDIT_REASON_LENGTH - 1)
        : reason;
}

function discordTimestamp(date, style = 'R') {
    if (!date) return 'unknown';
    return `<t:${Math.floor(new Date(date).getTime() / 1000)}:${style}>`;
}

function hasAnyPermission(member, permissions) {
    return permissions.some(permission => member.permissions?.has(permission));
}

async function getConfigByChannel(channelId) {
    return db.select()
        .from(honeypotConfig)
        .where(and(eq(honeypotConfig.channelId, channelId), eq(honeypotConfig.enabled, true)))
        .get();
}

async function isExempt(message) {
    const { guild, member, author } = message;
    if (!member) return false;
    if (author.id === guild.ownerId) return true;
    if (hasAnyPermission(member, [
        PermissionFlagsBits.Administrator,
        PermissionFlagsBits.ModerateMembers,
        PermissionFlagsBits.ManageMessages
    ])) return true;

    const userExemption = db.select()
        .from(honeypotExemptUsers)
        .where(and(eq(honeypotExemptUsers.guildId, guild.id), eq(honeypotExemptUsers.userId, author.id)))
        .get();
    if (userExemption) return true;

    const roleIds = Array.from(member.roles?.cache?.keys?.() || []);
    if (roleIds.length === 0) return false;

    const roleExemption = db.select()
        .from(honeypotExemptRoles)
        .where(and(eq(honeypotExemptRoles.guildId, guild.id), inArray(honeypotExemptRoles.roleId, roleIds)))
        .get();

    return !!roleExemption;
}

async function deleteMessageQuietly(message) {
    try {
        await message.delete();
        return null;
    } catch (error) {
        logger.warn(`Failed to delete honeypot message ${message.id}: ${error.message}`);
        return error.message;
    }
}

async function sendModLog(guild, title, description) {
    const config = db.select().from(guilds).where(eq(guilds.id, guild.id)).get();
    if (!config?.logChannel) return null;

    try {
        const channel = await guild.channels.fetch(config.logChannel).catch(() => null);
        if (!channel?.send) return false;
        await channel.send({ embeds: [embeds.warn(title, description)] });
        return true;
    } catch (error) {
        logger.warn(`Failed to send honeypot mod-log alert in ${guild.id}: ${error.message}`);
        return false;
    }
}

function incidentFromMessage(message, status, snippet, attachmentSummary, failureReason = null) {
    return {
        guildId: message.guild.id,
        userId: message.author.id,
        username: message.author.tag || message.author.username,
        displayName: message.member?.displayName || message.author.displayName || message.author.username,
        messageId: message.id,
        channelId: message.channelId,
        snippet,
        attachmentSummary,
        status,
        failureReason,
        accountCreatedAt: message.author.createdAt || null,
        joinedAt: message.member?.joinedAt || null,
        triggeredAt: new Date()
    };
}

async function writeIncident(message, status, snippet, attachmentSummary, failureReason = null) {
    await db.insert(honeypotIncidents).values(incidentFromMessage(
        message,
        status,
        snippet,
        attachmentSummary,
        failureReason
    ));
}

async function writeModerationLog(message, reason) {
    await db.insert(moderationLogs).values({
        guildId: message.guild.id,
        targetId: message.author.id,
        executorId: message.client.user.id,
        action: 'BAN',
        reason,
        timestamp: new Date()
    });
}

function buildWarningEmbed() {
    return embeds.warn(
        'DO NOT POST HERE',
        'If you post something here, you will be banned instantly.\n\n' +
        'This channel is a honeypot for compromised accounts and spam accounts.\n\n' +
        '**This is your only warning.**\n' +
        'Turn back now.\n\n' +
        'This message is permanent. The channel is actively monitored.'
    );
}

function buildShameBoardEmbed(incidents, total) {
    const embed = embeds.brand('Honeypot Shame Board', null);
    const description = incidents.length
        ? incidents.map((incident, index) => {
            const account = incident.accountCreatedAt ? discordTimestamp(incident.accountCreatedAt) : 'unknown';
            const joined = incident.joinedAt ? discordTimestamp(incident.joinedAt) : 'unknown';
            const attachments = incident.attachmentSummary ? `\nAttachments: ${incident.attachmentSummary}` : '';
            return [
                `**${index + 1}. ${incident.displayName || incident.username || incident.userId}**`,
                `User: <@${incident.userId}> (${incident.userId})`,
                `Account: ${account} | Joined: ${joined}`,
                `Message: ${incident.snippet || '[no text]'}${attachments}`
            ].join('\n');
        }).join('\n\n')
        : 'No honeypot bans yet. Good. Weirdly peaceful.';

    embed.setDescription(description);
    embed.addFields({ name: 'Successful Bans', value: String(total), inline: true });
    embed.setFooter({ text: `Last updated ${new Date().toLocaleString()} | Posts here are automatically banned.` });
    return embed;
}

async function updateShameBoard(guild, config) {
    if (!config?.channelId || !config?.shameBoardMessageId) return false;

    const incidents = db.select()
        .from(honeypotIncidents)
        .where(and(eq(honeypotIncidents.guildId, guild.id), inArray(honeypotIncidents.status, SUCCESS_STATUSES)))
        .orderBy(desc(honeypotIncidents.triggeredAt))
        .limit(10)
        .all();
    const total = db.select()
        .from(honeypotIncidents)
        .where(and(eq(honeypotIncidents.guildId, guild.id), inArray(honeypotIncidents.status, SUCCESS_STATUSES)))
        .all()
        .length;

    try {
        const channel = await guild.channels.fetch(config.channelId).catch(() => null);
        const message = await channel?.messages?.fetch(config.shameBoardMessageId).catch(() => null);
        if (!message) return false;
        await message.edit({ embeds: [buildShameBoardEmbed(incidents, total)] });
        return true;
    } catch (error) {
        logger.warn(`Failed to update honeypot Shame Board in ${guild.id}: ${error.message}`);
        await sendModLog(guild, 'Honeypot Shame Board Update Failed', error.message);
        return false;
    }
}

async function handleHoneypotMessage(message) {
    if (!message.guild || message.author?.bot || message.system || message.webhookId) return false;

    const config = await getConfigByChannel(message.channelId);
    if (!config) return false;

    const snippet = sanitizeSnippet(message.content);
    const attachmentSummary = buildAttachmentSummary(message);

    const exempt = await isExempt(message);
    await deleteMessageQuietly(message);
    if (exempt) return true;

    const reason = buildBanReason(snippet);
    let status;
    try {
        const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
        if (member) {
            await member.ban({ reason, deleteMessageSeconds: DELETE_MESSAGE_SECONDS });
            status = 'banned';
        } else {
            await message.guild.members.ban(message.author.id, { reason, deleteMessageSeconds: DELETE_MESSAGE_SECONDS });
            status = 'banned_left_server';
        }
    } catch (error) {
        const failureReason = error.message || 'Unknown ban failure';
        await writeIncident(message, 'failed_ban', snippet, attachmentSummary, failureReason);
        await sendModLog(
            message.guild,
            'Honeypot Ban Failed',
            `Failed to ban <@${message.author.id}> (${message.author.id}) after a honeypot post.\n\n**Reason:** ${failureReason}`
        );
        return true;
    }

    try {
        await writeIncident(message, status, snippet, attachmentSummary);
        await writeModerationLog(message, reason);
    } catch (error) {
        logger.warn(`Failed to write honeypot audit rows in ${message.guild.id}: ${error.message}`);
    }

    await updateShameBoard(message.guild, config);
    return true;
}

module.exports = {
    CATEGORY_NAME,
    CHANNEL_NAME,
    CHANNEL_TOPIC,
    DELETE_MESSAGE_SECONDS,
    REQUIRED_BOT_PERMISSIONS,
    SUCCESS_STATUSES,
    buildAttachmentSummary,
    buildBanReason,
    buildShameBoardEmbed,
    buildWarningEmbed,
    handleHoneypotMessage,
    sanitizeSnippet,
    sendModLog,
    updateShameBoard
};
