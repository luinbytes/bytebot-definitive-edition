const { EmbedBuilder } = require('discord.js');
const { sqlite } = require('../database');
const { formatDuration } = require('../utils/timeParser');
const logger = require('../utils/logger');
const embeds = require('../utils/embeds');
const { notifyUser } = require('../utils/moderationUtil');

const VARIABLES = [
    'target_user', 'target_user.mention', 'target_user.name', 'target_user.id',
    'target_user.avatar', 'target_user.display_name', 'target_user.top_role',
    'target_user.color', 'target_user.created_at', 'target_user.joined_at',
    'moderator', 'moderator.mention', 'moderator.name', 'moderator.id',
    'moderator.avatar', 'moderator.display_name', 'moderator.top_role', 'moderator.color',
    'guild', 'guild.name', 'guild.id', 'guild.member_count',
    'channel', 'channel.name', 'channel.mention', 'channel.id',
    'reason', 'time', 'duration_seconds', 'duration_minutes', 'duration_hours',
    'duration_days', 'history', 'warning_count'
];

function avatar(user) {
    return user?.displayAvatarURL?.() || user?.avatarURL?.() || '';
}

function timestamp(value) {
    return value ? `<t:${Math.floor(value / 1000)}:F>` : '';
}

function valuesFor({ guild, channel, target, executor, moderationCase }) {
    const targetUser = target.user || target;
    const moderator = executor.user || executor;
    const duration = moderationCase.duration_ms || 0;
    const { count: priorActions } = sqlite.prepare(`
        SELECT COUNT(*) AS count FROM moderation_cases
        WHERE guild_id = ? AND target_id = ? AND case_number < ?
    `).get(guild.id, targetUser.id, moderationCase.case_number);
    const { count: warningCount } = sqlite.prepare(`
        SELECT COUNT(*) AS count FROM moderation_cases
        WHERE guild_id = ? AND target_id = ? AND action = 'WARN' AND status = 'completed'
    `).get(guild.id, targetUser.id);

    const metadata = moderationCase.metadata ? JSON.parse(moderationCase.metadata) : {};
    return {
        target_user: targetUser.username || targetUser.tag || targetUser.id,
        'target_user.mention': `<@${targetUser.id}>`,
        'target_user.name': targetUser.username || '',
        'target_user.id': targetUser.id,
        'target_user.avatar': avatar(targetUser),
        'target_user.display_name': target.displayName || targetUser.displayName || targetUser.username || '',
        'target_user.top_role': target.roles?.highest?.name || '',
        'target_user.color': target.roles?.highest?.hexColor || '',
        'target_user.created_at': timestamp(targetUser.createdTimestamp),
        'target_user.joined_at': timestamp(target.joinedTimestamp),
        moderator: moderator.username || moderator.tag || moderator.id,
        'moderator.mention': `<@${moderator.id}>`,
        'moderator.name': moderator.username || '',
        'moderator.id': moderator.id,
        'moderator.avatar': avatar(moderator),
        'moderator.display_name': executor.displayName || moderator.displayName || moderator.username || '',
        'moderator.top_role': executor.roles?.highest?.name || '',
        'moderator.color': executor.roles?.highest?.hexColor || '',
        guild: guild.name,
        'guild.name': guild.name,
        'guild.id': guild.id,
        'guild.member_count': guild.memberCount ?? '',
        channel: channel?.name || '',
        'channel.name': channel?.name || '',
        'channel.mention': channel ? `<#${channel.id}>` : '',
        'channel.id': channel?.id || '',
        reason: moderationCase.reason || 'No reason provided',
        time: duration ? formatDuration(duration) : '',
        duration_seconds: Math.floor(duration / 1000),
        duration_minutes: Math.floor(duration / 60000),
        duration_hours: Math.floor(duration / 3600000),
        duration_days: Math.floor(duration / 86400000),
        history: metadata.historyDays ?? priorActions,
        warning_count: warningCount
    };
}

function validateTemplate(template) {
    const allowed = new Set([...VARIABLES, 'embed']);
    const unknown = [...template.matchAll(/\{([a-z_]+(?:\.[a-z_]+)?)\}/g)]
        .map(match => match[1])
        .filter(variable => !allowed.has(variable));
    return unknown.length ? `Unknown template variable: {${unknown[0]}}` : null;
}

function renderTemplate(template, context) {
    const values = valuesFor(context);
    const rendered = template.replace(/\{([a-z_]+(?:\.[a-z_]+)?)\}/g,
        (match, variable) => Object.hasOwn(values, variable) ? String(values[variable]) : match);
    if (!rendered.includes('{embed}')) return { content: rendered.slice(0, 2000), allowedMentions: { parse: [] } };

    const embed = new EmbedBuilder();
    const tag = name => rendered.match(new RegExp(`\\{${name}:\\s*([^{}]+)\\}`))?.[1]?.trim();
    let budget = 6000;
    const take = (value, limit) => {
        const clipped = value?.slice(0, Math.min(limit, budget));
        budget -= clipped?.length || 0;
        return clipped;
    };
    const color = tag('color');
    if (color) embed.setColor(color.startsWith('#') ? color : Number(color));
    if (tag('title')) embed.setTitle(take(tag('title'), 256));
    if (tag('description') && budget) embed.setDescription(take(tag('description'), 4096));
    if (tag('thumbnail')) embed.setThumbnail(tag('thumbnail'));
    for (const field of [...rendered.matchAll(/\{field:\s*([^|{}]+)\|([^{}]+)\}/g)].slice(0, 25)) {
        if (budget < 2) break;
        embed.addFields({
            name: take(field[1].trim(), Math.min(256, budget - 1)),
            value: take(field[2].trim(), 1024) || '\u200b'
        });
    }
    return { embeds: [embed], allowedMentions: { parse: [] } };
}

async function deliverTemplates({ guild, target, executor, moderationCase }) {
    const templates = sqlite.prepare(`
        SELECT message_type, template FROM moderation_templates WHERE guild_id = ? AND action = ?
    `).all(guild.id, moderationCase.action);
    const config = sqlite.prepare('SELECT log_channel_id FROM moderation_config WHERE guild_id = ?').get(guild.id);
    const channel = config?.log_channel_id ? guild.channels?.cache?.get(config.log_channel_id) : null;
    for (const template of templates) {
        try {
            const payload = renderTemplate(template.template, { guild, channel, target, executor, moderationCase });
            if (template.message_type === 'dm') await (target.user || target).send(payload);
            else if (channel) await channel.send(payload);
        } catch (error) {
            logger.warn(`Moderation template delivery failed in ${guild.id}: ${error.message}`);
        }
    }

    if (!templates.some(template => template.message_type === 'dm')
        && ['WARN', 'KICK', 'BAN'].includes(moderationCase.action)) {
        await notifyUser(
            target.user || target,
            moderationCase.action,
            guild.name,
            moderationCase.reason || 'No reason provided',
            executor.user?.tag || executor.user?.username
        );
    }
    if (channel && !templates.some(template => template.message_type === 'message')) {
        try {
            await channel.send({
                embeds: [embeds.info(
                    `Moderation Case #${moderationCase.case_number}`,
                    `**${moderationCase.action}** <@${moderationCase.target_id}> by <@${moderationCase.executor_id}>\nReason: ${moderationCase.reason || 'No reason provided'}`
                )],
                allowedMentions: { parse: [] }
            });
        } catch (error) {
            logger.warn(`Moderation log delivery failed in ${guild.id}: ${error.message}`);
        }
    }
}

module.exports = { VARIABLES, validateTemplate, renderTemplate, deliverTemplates };
