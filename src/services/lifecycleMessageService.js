const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { sqlite } = require('../database');
const embeds = require('../utils/embeds');
const logger = require('../utils/logger');
const { fetchChannel, safeChannelSend } = require('../utils/discordApiUtil');

const TYPES = new Set(['welcome', 'goodbye', 'boost', 'join_dm']);
const DEFAULTS = {
    welcome: 'Welcome to **{server}**, {user}! You are member #{memberCount}.',
    goodbye: 'Goodbye **{displayname}**. **{server}** now has {memberCount} members.',
    boost: 'Thank you {user} for boosting **{server}**! We now have {boostCount} boosts.',
    join_dm: 'Welcome to **{server}**, {displayname}!'
};
const MAX_LIFECYCLE_CHANNELS = 4;
const MAX_WELCOMES_PER_MINUTE = 20;
const MAX_JOIN_DMS_PER_MINUTE = 40;
const MAX_JOIN_DMS_PER_HOUR = 750;
const welcomeWindows = new Map();
const EMBED_KEYS = new Set(['embed', 'content', 'title', 'description', 'color', 'url', 'image', 'thumbnail', 'timestamp', 'author', 'field', 'fields', 'footer', 'button']);

function ordinal(number) {
    const mod100 = number % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${number}th`;
    return `${number}${({ 1: 'st', 2: 'nd', 3: 'rd' })[number % 10] || 'th'}`;
}

function valuesFor(member, channel = null) {
    const guild = member.guild;
    const user = member.user || member;
    const now = new Date();
    const createdAt = user.createdAt || now;
    const joinedAt = member.joinedAt || now;
    const accountAgeDays = Math.floor((now - createdAt) / 86400000);
    const date = value => value.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const isoDate = value => value.toISOString().slice(0, 10);
    const relative = value => `<t:${Math.floor(value.getTime() / 1000)}:R>`;
    const full = value => `<t:${Math.floor(value.getTime() / 1000)}:F>`;
    const mention = `<@${member.id || user.id}>`;
    const avatar = user.displayAvatarURL?.({ size: 256 }) || '';
    const roles = member.roles?.cache ? [...member.roles.cache.values()].filter(role => role.id !== guild.id) : [];
    const topRole = member.roles?.highest?.id === guild.id ? null : member.roles?.highest;
    const boostAt = member.premiumSince || null;
    const count = Number(guild.memberCount || 0);
    const guildCreatedAt = guild.createdAt || now;
    const channelCreatedAt = channel?.createdAt || now;
    return {
        user: user.username || 'Unknown', mention, 'user.mention': mention,
        'user.id': user.id || member.id, 'user.avatar': avatar, 'user.display_avatar': avatar,
        'user.banner': user.bannerURL?.({ size: 1024 }) || '',
        username: user.username || 'Unknown', 'user.name': user.username || 'Unknown',
        tag: user.discriminator || '0', 'user.tag': user.discriminator || '0',
        displayname: member.displayName || user.displayName || user.username || 'Unknown',
        'user.display_name': member.displayName || user.displayName || user.username || 'Unknown',
        'user.nick': member.nickname || member.displayName || '', 'user.role_count': String(roles.length),
        'user.roles': roles.map(role => `<@&${role.id}>`).join(', '),
        'user.role_list': roles.map(role => role.name).join(', '),
        'user.role_text_list': roles.map(role => `<@&${role.id}>`).join(', '),
        'user.top_role': topRole?.name || 'N/A', 'user.color': topRole?.hexColor || member.displayHexColor || 'N/A',
        'user.join_position': count ? String(count) : 'N/A', 'user.join_position_suffix': count ? ordinal(count) : 'N/A',
        'user.bot': user.bot ? 'Yes' : 'No', 'user.boost': member.premiumSince ? 'Yes' : 'No',
        'user.created_at': full(createdAt), 'user.created_at_timestamp': String(Math.floor(createdAt.getTime() / 1000)),
        'user.created_at_iso': createdAt.toISOString(), 'user.created_at_date': isoDate(createdAt),
        'user.joined_at': full(joinedAt), 'user.joined_at_timestamp': String(Math.floor(joinedAt.getTime() / 1000)),
        'user.boost_since': boostAt ? full(boostAt) : 'N/A', 'user.premium_since': boostAt ? full(boostAt) : 'N/A',
        'user.boosting_since': boostAt ? full(boostAt) : 'N/A',
        'user.boost_since_timestamp': boostAt ? String(Math.floor(boostAt.getTime() / 1000)) : 'N/A',
        'user.premium_since_timestamp': boostAt ? String(Math.floor(boostAt.getTime() / 1000)) : 'N/A',
        'user.boosting_since_timestamp': boostAt ? String(Math.floor(boostAt.getTime() / 1000)) : 'N/A',
        'user.guild_avatar': member.displayAvatarURL?.({ size: 256 }) || 'N/A',
        server: guild.name, guild: guild.name, 'guild.name': guild.name, 'guild.id': guild.id || '',
        'guild.owner': guild.ownerId ? `<@${guild.ownerId}>` : '',
        'guild.owner_id': guild.ownerId || '',
        'guild.icon': guild.iconURL?.({ size: 256 }) || '', 'guild.banner': guild.bannerURL?.({ size: 1024 }) || 'N/A',
        'guild.count': count.toLocaleString('en-US'), 'guild.member_count': count.toLocaleString('en-US'), 'guild.mention': guild.name,
        'guild.created_at': full(guildCreatedAt), 'guild.created_at_timestamp': String(Math.floor(guildCreatedAt.getTime() / 1000)), 'guild.created_at_date': isoDate(guildCreatedAt),
        'guild.emoji_count': String(guild.emojis?.cache?.size || 0), 'guild.role_count': String(guild.roles?.cache?.size || 0),
        memberCount: String(guild.memberCount || 0), membercount: String(guild.memberCount || 0),
        memberNumber: ordinal(guild.memberCount || 0), membernumber: ordinal(guild.memberCount || 0),
        joinedAt: date(joinedAt), joinedat: date(joinedAt), joinedRelative: relative(joinedAt), joinedrelative: relative(joinedAt),
        joinedFull: full(joinedAt), joinedfull: full(joinedAt), createdAt: date(createdAt), createdat: date(createdAt),
        createdRelative: relative(createdAt), createdrelative: relative(createdAt), createdFull: full(createdAt), createdfull: full(createdAt),
        accountAgeDays: String(accountAgeDays), accountagedays: String(accountAgeDays),
        accountAgeMonths: String(Math.floor(accountAgeDays / 30)), accountagemonths: String(Math.floor(accountAgeDays / 30)),
        boostCount: String(guild.premiumSubscriptionCount || 0), boostLevel: String(guild.premiumTier || 0),
        'guild.boost_count': String(guild.premiumSubscriptionCount || 0), 'guild.boost_tier': String(guild.premiumTier || 0),
        channel: channel?.name || '', 'channel.id': channel?.id || '',
        'channel.name': channel?.name || '', 'channel.mention': channel ? `<#${channel.id}>` : '',
        'channel.topic': channel?.topic || '', 'channel.category_id': channel?.parentId || '',
        'channel.is_thread': channel?.isThread?.() ? 'Yes' : 'No',
        'channel.created_at': channel ? relative(channelCreatedAt) : ''
    };
}

function variableNames(template) {
    return [...String(template).matchAll(/\{\{?([A-Za-z][\w.]*)\}\}?/g)]
        .map(match => match[1])
        .filter(name => !EMBED_KEYS.has(name.toLowerCase()));
}

function validateTemplate(template) {
    if (typeof template !== 'string' || !template.trim()) throw new Error('Message template cannot be empty.');
    if (template.length > 2000) throw new Error('Message template cannot exceed 2000 characters.');
    if (/@everyone|@here|<@&\d+>|<@!?\d+>/.test(template)) {
        throw new Error('Templates cannot contain literal mass, role, or user mentions; use {user} for the lifecycle member.');
    }
    const known = valuesFor({ id: '0', guild: { name: '', memberCount: 0 }, user: { username: '', createdAt: new Date(0) } });
    const unknown = variableNames(template).find(name => !Object.hasOwn(known, name));
    if (unknown) throw new Error(`Unknown template variable: {${unknown}}`);
    if (/\{embed\}/i.test(template) && !/\{(?:if |cscript:|cv2)/i.test(template)) parseEmbedScript(template, known);
    return template;
}

function conditionalValue(input, values) {
    const key = String(input).trim().replace(/^\{([^{}]+)\}$/, '$1');
    return Object.hasOwn(values, key) ? String(values[key]) : key.replace(/^['"]|['"]$/g, '');
}

function renderConditionals(template, values) {
    let source = String(template);
    const block = /\{if ([^{}]*(?:\{[^{}]+\}[^{}]*)*)\}([\s\S]*?)\{\/if\}/i;
    let match;
    while ((match = source.match(block))) {
        const branches = [];
        const marker = /\{(elseif [^{}]*(?:\{[^{}]+\}[^{}]*)*|else)\}/gi;
        let cursor = 0;
        let condition = match[1];
        for (const part of match[2].matchAll(marker)) {
            branches.push({ condition, content: match[2].slice(cursor, part.index) });
            condition = part[1].toLowerCase() === 'else' ? null : part[1].slice(7);
            cursor = part.index + part[0].length;
        }
        branches.push({ condition, content: match[2].slice(cursor) });
        const chosen = branches.find(branch => {
            if (branch.condition === null) return true;
            const comparison = branch.condition.match(/^(.+?)\s*(==|!=)\s*(.+)$/);
            if (comparison) {
                const equal = conditionalValue(comparison[1], values).toLowerCase() === conditionalValue(comparison[3], values).toLowerCase();
                return comparison[2] === '==' ? equal : !equal;
            }
            return !['', 'false', 'no', '0', 'none', 'null'].includes(conditionalValue(branch.condition, values).toLowerCase());
        });
        source = source.replace(match[0], chosen?.content || '');
    }
    return source;
}

function renderTemplate(template, member, channel = null) {
    const values = valuesFor(member, channel);
    return renderConditionals(template, values)
        .replace(/\{lower\(([A-Za-z][\w.]*)\)\}/g, (token, name) => values[name] == null ? token : String(values[name]).toLowerCase())
        .replace(/\{\{?([A-Za-z][\w.]*)(?::([tTdDfFR]))?\}\}?/g, (token, name, style) => {
            const value = values[name];
            if (value == null) return token;
            if (style && /^<t:\d+:[tTdDfFR]>$/.test(value)) return value.replace(/:[tTdDfFR]>$/, `:${style}>`);
            return value;
        });
}

function assertType(type) {
    if (!TYPES.has(type)) throw new Error(`Unknown lifecycle message type: ${type}`);
}

function getConfig(guildId, type) {
    assertType(type);
    const row = sqlite.prepare('SELECT * FROM lifecycle_messages WHERE guild_id = ? AND type = ?').get(guildId, type);
    if (row || type !== 'welcome') return row || null;
    const legacy = sqlite.prepare('SELECT welcome_channel, welcome_message, welcome_enabled, welcome_use_embed FROM guilds WHERE id = ?').get(guildId);
    if (!legacy || (!legacy.welcome_channel && !legacy.welcome_message && !legacy.welcome_enabled)) return null;
    return {
        guild_id: guildId, type, channel_id: legacy.welcome_channel, template: legacy.welcome_message,
        enabled: legacy.welcome_enabled, format: legacy.welcome_use_embed ? 'embed' : 'text', delete_after_seconds: null
    };
}

function setConfig(guildId, type, changes) {
    assertType(type);
    if (changes.template !== undefined) validateTemplate(changes.template);
    if (changes.format !== undefined && !['text', 'embed'].includes(changes.format)) throw new Error('Format must be text or embed.');
    if (changes.deleteAfterSeconds !== undefined && changes.deleteAfterSeconds !== null
        && (!Number.isInteger(changes.deleteAfterSeconds) || changes.deleteAfterSeconds < 1 || changes.deleteAfterSeconds > 30)) {
        throw new Error('Auto-delete must be between 1 and 30 seconds.');
    }
    return sqlite.transaction(() => {
        const current = getConfig(guildId, type) || {};
        const row = {
            channelId: changes.channelId === undefined ? current.channel_id || null : changes.channelId,
            template: changes.template === undefined ? current.template || null : changes.template,
            enabled: changes.enabled === undefined ? Number(current.enabled || 0) : Number(changes.enabled),
            format: changes.format === undefined ? current.format || 'embed' : changes.format,
            deleteAfter: changes.deleteAfterSeconds === undefined ? current.delete_after_seconds || null : changes.deleteAfterSeconds
        };
        const extra = sqlite.prepare('SELECT channel_id FROM lifecycle_message_channels WHERE guild_id = ? AND type = ?')
            .all(guildId, type).map(item => item.channel_id);
        if (new Set([row.channelId, ...extra].filter(Boolean)).size > MAX_LIFECYCLE_CHANNELS) {
            throw new Error(`At most ${MAX_LIFECYCLE_CHANNELS} ${type} channels are allowed.`);
        }
        sqlite.prepare(`
            INSERT INTO lifecycle_messages (guild_id, type, channel_id, template, enabled, format, delete_after_seconds, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (guild_id, type) DO UPDATE SET channel_id=excluded.channel_id, template=excluded.template,
                enabled=excluded.enabled, format=excluded.format, delete_after_seconds=excluded.delete_after_seconds, updated_at=excluded.updated_at
        `).run(guildId, type, row.channelId, row.template, row.enabled, row.format, row.deleteAfter, Date.now());
        if (row.channelId) sqlite.prepare('DELETE FROM lifecycle_message_channels WHERE guild_id = ? AND type = ? AND channel_id = ?')
            .run(guildId, type, row.channelId);
        return getConfig(guildId, type);
    })();
}

function resetConfig(guildId, type) {
    assertType(type);
    sqlite.prepare(`
        INSERT INTO lifecycle_messages (guild_id, type, enabled, format, updated_at)
        VALUES (?, ?, 0, 'embed', ?)
        ON CONFLICT (guild_id, type) DO UPDATE SET channel_id=NULL, template=NULL, enabled=0,
            format='embed', delete_after_seconds=NULL, updated_at=excluded.updated_at
    `).run(guildId, type, Date.now());
    sqlite.prepare('DELETE FROM lifecycle_message_channels WHERE guild_id = ? AND type = ?').run(guildId, type);
    if (type === 'join_dm') sqlite.prepare('DELETE FROM join_dm_deliveries WHERE guild_id = ?').run(guildId);
}

function listLifecycleChannels(guildId, type) {
    const primary = getConfig(guildId, type)?.channel_id;
    const extra = sqlite.prepare(`SELECT channel_id FROM lifecycle_message_channels
        WHERE guild_id = ? AND type = ? ORDER BY channel_id`).all(guildId, type).map(row => row.channel_id);
    return [...new Set([primary, ...extra].filter(Boolean))];
}

function lifecycleChannelUsesCustomTemplate(guildId, type, channelId) {
    const config = getConfig(guildId, type);
    if (config?.channel_id === channelId) return Boolean(config.template);
    return Boolean(sqlite.prepare(`SELECT template FROM lifecycle_message_channels
        WHERE guild_id = ? AND type = ? AND channel_id = ?`).get(guildId, type, channelId)?.template);
}

function addLifecycleChannel(guildId, type, channelId) {
    assertType(type);
    return sqlite.transaction(() => {
        const channels = listLifecycleChannels(guildId, type);
        if (channels.includes(channelId)) return channels;
        if (channels.length >= MAX_LIFECYCLE_CHANNELS) throw new Error(`At most ${MAX_LIFECYCLE_CHANNELS} ${type} channels are allowed.`);
        if (!channels.length) {
            setConfig(guildId, type, { channelId });
            return listLifecycleChannels(guildId, type);
        }
        sqlite.prepare('INSERT INTO lifecycle_message_channels (guild_id, type, channel_id) VALUES (?, ?, ?)')
            .run(guildId, type, channelId);
        return listLifecycleChannels(guildId, type);
    })();
}

function removeLifecycleChannel(guildId, type, channelId) {
    return sqlite.transaction(() => {
        if (getConfig(guildId, type)?.channel_id === channelId) {
            const promoted = sqlite.prepare(`SELECT channel_id, template FROM lifecycle_message_channels
                WHERE guild_id = ? AND type = ? ORDER BY channel_id LIMIT 1`).get(guildId, type);
            sqlite.prepare('UPDATE lifecycle_messages SET channel_id = ?, template = COALESCE(?, template), updated_at = ? WHERE guild_id = ? AND type = ?')
                .run(promoted?.channel_id || null, promoted?.template || null, Date.now(), guildId, type);
            if (promoted) sqlite.prepare('DELETE FROM lifecycle_message_channels WHERE guild_id = ? AND type = ? AND channel_id = ?')
                .run(guildId, type, promoted.channel_id);
        }
        sqlite.prepare('DELETE FROM lifecycle_message_channels WHERE guild_id = ? AND type = ? AND channel_id = ?')
            .run(guildId, type, channelId);
        return listLifecycleChannels(guildId, type);
    })();
}

function setLifecycleChannelTemplate(guildId, type, channelId, template) {
    validateTemplate(template);
    if (getConfig(guildId, type)?.channel_id === channelId) return setConfig(guildId, type, { template });
    const changed = sqlite.prepare(`UPDATE lifecycle_message_channels SET template = ?
        WHERE guild_id = ? AND type = ? AND channel_id = ?`).run(template, guildId, type, channelId).changes;
    if (!changed) throw new Error('That lifecycle channel is not configured.');
    return template;
}

function migrateLegacyWelcome() {
    return sqlite.prepare(`
        INSERT INTO lifecycle_messages (guild_id, type, channel_id, template, enabled, format, updated_at)
        SELECT id, 'welcome', welcome_channel, welcome_message, welcome_enabled,
               CASE WHEN welcome_use_embed = 1 THEN 'embed' ELSE 'text' END, ?
        FROM guilds
        WHERE welcome_channel IS NOT NULL OR welcome_message IS NOT NULL OR welcome_enabled = 1
        ON CONFLICT (guild_id, type) DO NOTHING
    `).run(Date.now()).changes;
}

function httpUrl(value) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Embed URLs must use http or https.');
    return url.toString();
}

function parseEmbedScript(template, replacements = null) {
    const rendered = replacements
        ? String(template).replace(/\{\{?([A-Za-z][\w.]*)\}\}?/g, (token, name) => replacements[name] ?? token)
        : String(template);
    const tokens = rendered.split('$v').map(token => token.trim()).filter(Boolean);
    const payload = { embeds: [], components: [] };
    let embed;
    let buttons = [];
    const flushButtons = () => {
        if (!buttons.length) return;
        if (payload.components.length === 5) throw new Error('Embed scripts can contain at most 5 button rows.');
        payload.components.push(new ActionRowBuilder().addComponents(buttons.splice(0, 5)));
    };
    for (const token of tokens) {
        const match = token.match(/^\{([a-z]+)(?::\s*([\s\S]*))?\}$/i);
        if (!match || !EMBED_KEYS.has(match[1].toLowerCase())) throw new Error(`Invalid embed directive: ${token.slice(0, 40)}`);
        const key = match[1].toLowerCase();
        const value = match[2] || '';
        if (key === 'embed') {
            flushButtons();
            embed = new EmbedBuilder();
            payload.embeds.push(embed);
        } else if (key === 'content') payload.content = value.slice(0, 2000);
        else {
            if (!embed) throw new Error(`{${key}} must follow {embed}.`);
            if (key === 'title') embed.setTitle(value.slice(0, 256));
            else if (key === 'description') embed.setDescription(value.slice(0, 4096));
            else if (key === 'color') embed.setColor(value.startsWith('#') ? Number.parseInt(value.slice(1), 16) : Number(value));
            else if (key === 'url') embed.setURL(httpUrl(value));
            else if (key === 'image') embed.setImage(httpUrl(value));
            else if (key === 'thumbnail') embed.setThumbnail(httpUrl(value));
            else if (key === 'timestamp') embed.setTimestamp(value && value !== 'true' ? new Date(value) : new Date());
            else if (key === 'author') {
                const [name, iconURL, url] = value.split('&&').map(part => part.trim());
                embed.setAuthor({ name: name.slice(0, 256), ...(iconURL && { iconURL: httpUrl(iconURL) }), ...(url && { url: httpUrl(url) }) });
            } else if (key === 'field' || key === 'fields') {
                const [name, fieldValue, inline] = value.split('&&').map(part => part.trim());
                if (!name || !fieldValue) throw new Error('Embed fields require name && value.');
                if ((embed.data.fields?.length || 0) === 25) throw new Error('Each embed can contain at most 25 fields.');
                embed.addFields({ name: name.slice(0, 256), value: fieldValue.slice(0, 1024), inline: inline === 'true' });
            } else if (key === 'footer') {
                const [text, iconURL] = value.split('&&').map(part => part.trim());
                embed.setFooter({ text: text.slice(0, 2048), ...(iconURL && { iconURL: httpUrl(iconURL) }) });
            } else if (key === 'button') {
                const [label, styleOrUrl, emoji, disabled] = value.split('&&').map(part => part.trim());
                if (!label || !styleOrUrl) throw new Error('Buttons require label && style or URL.');
                const button = new ButtonBuilder().setLabel(label.slice(0, 80));
                if (/^https?:\/\//i.test(styleOrUrl)) button.setStyle(ButtonStyle.Link).setURL(httpUrl(styleOrUrl));
                else {
                    const style = { blurple: ButtonStyle.Primary, green: ButtonStyle.Success, grey: ButtonStyle.Secondary, gray: ButtonStyle.Secondary, red: ButtonStyle.Danger }[styleOrUrl.toLowerCase()];
                    if (!style) throw new Error(`Unknown button style: ${styleOrUrl}`);
                    button.setStyle(style).setCustomId(`lifecycle:${payload.components.length}:${buttons.length}`).setDisabled(true);
                }
                if (emoji) button.setEmoji(emoji);
                if (disabled === 'true') button.setDisabled(true);
                buttons.push(button);
                if (buttons.length === 5) flushButtons();
            }
        }
    }
    flushButtons();
    if (!payload.embeds.length) throw new Error('Embed scripts must contain {embed}.');
    if (payload.embeds.length > 10) throw new Error('Embed scripts can contain at most 10 embeds.');
    const totalCharacters = payload.embeds.reduce((sum, item) => {
        const json = item.toJSON();
        return sum + [json.title, json.description, json.footer?.text, json.author?.name,
            ...(json.fields || []).flatMap(field => [field.name, field.value])]
            .filter(Boolean).reduce((count, value) => count + value.length, 0);
    }, 0);
    if (totalCharacters > 6000) throw new Error('Embed scripts can contain at most 6000 text characters.');
    return payload;
}

function buildPayload(config, member, test = false, channel = null, template = config.template || DEFAULTS[config.type]) {
    const rich = member.client?.richContentService || member.guild.client?.richContentService;
    const expanded = rich?.expandCustom ? rich.expandCustom(template, member.guild.id) : template;
    const rendered = renderTemplate(expanded, member, channel);
    const content = (test ? `[Test] ${rendered}` : rendered).slice(0, 2000);
    const allowedMentions = { parse: [], users: [member.id || member.user.id], roles: [], repliedUser: false };
    if (rich && /^\s*\{(?:cv2(?::)?|embed|content\s*:)/i.test(rendered)) {
        const payload = rich.render(rendered, { user: member.user, member, guild: member.guild, channel });
        if (test && !payload.flags) payload.content = `[Test]${payload.content ? ` ${payload.content}` : ''}`;
        return { ...payload, allowedMentions };
    }
    if (/\{embed\}/i.test(rendered)) {
        const payload = parseEmbedScript(rendered);
        if (test) payload.content = `[Test]${payload.content ? ` ${payload.content}` : ''}`;
        return { ...payload, allowedMentions };
    }
    if (config.format === 'text') return { content, allowedMentions };
    const embed = embeds.brand(`${test ? 'Test ' : ''}${config.type[0].toUpperCase()}${config.type.slice(1)}`, rendered.slice(0, 4096));
    const avatar = member.user?.displayAvatarURL?.({ size: 256 });
    if (avatar) embed.setThumbnail(avatar);
    return { embeds: [embed], allowedMentions };
}

function welcomeAllowed(guildId, now = Date.now()) {
    const retained = (welcomeWindows.get(guildId) || []).filter(timestamp => timestamp > now - 60000);
    if (retained.length >= MAX_WELCOMES_PER_MINUTE) return false;
    retained.push(now);
    if (!welcomeWindows.has(guildId) && welcomeWindows.size >= 1000) welcomeWindows.delete(welcomeWindows.keys().next().value);
    welcomeWindows.set(guildId, retained);
    return true;
}

function purgeLifecycleRuntime(guildId) {
    welcomeWindows.delete(guildId);
}

async function sendLifecycleMessage(type, member, { test = false } = {}) {
    const config = getConfig(member.guild.id, type);
    if (!config || (!test && !config.enabled)) return { status: 'disabled' };
    const channelIds = listLifecycleChannels(member.guild.id, type);
    if (!channelIds.length) return { status: 'unconfigured' };
    if (!test && member.user?.bot && (type === 'welcome' || type === 'goodbye')) return { status: 'bot' };
    if (!test && type === 'welcome' && !welcomeAllowed(member.guild.id)) return { status: 'limited' };
    const sent = [];
    for (const channelId of channelIds) {
        const channel = await fetchChannel(member.guild, channelId, { logContext: `${type}-message` });
        if (!channel) continue;
        const override = channelId === config.channel_id ? null : sqlite.prepare(`SELECT template FROM lifecycle_message_channels
            WHERE guild_id = ? AND type = ? AND channel_id = ?`).get(member.guild.id, type, channelId)?.template;
        const message = await safeChannelSend(channel, buildPayload(config, member, test, channel, override || config.template || DEFAULTS[type]), { logContext: `${type}-message` });
        if (!message) continue;
        sent.push(message);
        if (config.delete_after_seconds) {
            const timer = setTimeout(() => message.delete().catch(error => logger.warn(`Failed to auto-delete ${type} message: ${error.message}`)), config.delete_after_seconds * 1000);
            timer.unref?.();
        }
    }
    return sent.length ? { status: 'sent', message: sent[0], messages: sent } : { status: 'failed' };
}

async function sendJoinDm(member, { test = false } = {}) {
    const config = getConfig(member.guild.id, 'join_dm') || { type: 'join_dm', format: 'embed' };
    if (!test && !config.enabled) return { status: 'disabled' };
    if (member.user?.bot) return { status: 'bot' };
    const payloadFor = isTest => {
        const payload = buildPayload(config, member, isTest);
        payload.allowedMentions = { parse: [], users: [], roles: [], repliedUser: false };
        if ((payload.components?.length || 0) >= 5) throw new Error('Join DM scripts may use at most four component rows because Server Info is always attached.');
        payload.components = [...(payload.components || []), new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`join_dm:info:${member.guild.id}:${member.id}`).setLabel('Server Info').setStyle(ButtonStyle.Secondary)
        )];
        return payload;
    };
    if (test) return { status: 'sent', message: await member.send(payloadFor(true)) };
    const reservationId = sqlite.transaction(() => {
        const now = Date.now();
        sqlite.prepare('DELETE FROM join_dm_deliveries WHERE guild_id = ? AND sent_at < ?').run(member.guild.id, now - 60 * 60 * 1000);
        const hour = sqlite.prepare('SELECT COUNT(*) count FROM join_dm_deliveries WHERE guild_id = ?').get(member.guild.id).count;
        const minute = sqlite.prepare('SELECT COUNT(*) count FROM join_dm_deliveries WHERE guild_id = ? AND sent_at >= ?')
            .get(member.guild.id, now - 60000).count;
        if (minute >= MAX_JOIN_DMS_PER_MINUTE || hour >= MAX_JOIN_DMS_PER_HOUR) return null;
        return Number(sqlite.prepare('INSERT INTO join_dm_deliveries (guild_id, user_id, sent_at) VALUES (?, ?, ?)')
            .run(member.guild.id, member.id, now).lastInsertRowid);
    })();
    if (!reservationId) return { status: 'limited' };
    try {
        return { status: 'sent', message: await member.send(payloadFor(false)) };
    } catch (error) {
        sqlite.prepare('DELETE FROM join_dm_deliveries WHERE id = ?').run(reservationId);
        logger.warn(`Join DM delivery failed for ${member.id}: ${error.message}`);
        return { status: 'failed' };
    }
}

function isNewBoost(oldMember, newMember) {
    return !oldMember.premiumSince && Boolean(newMember.premiumSince);
}

module.exports = {
    TYPES, DEFAULTS, validateTemplate, renderTemplate, parseEmbedScript, getConfig, setConfig, resetConfig,
    addLifecycleChannel, listLifecycleChannels, lifecycleChannelUsesCustomTemplate, removeLifecycleChannel, migrateLegacyWelcome,
    setLifecycleChannelTemplate, purgeLifecycleRuntime, sendJoinDm, sendLifecycleMessage, isNewBoost
};
