const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MediaGalleryBuilder,
    MediaGalleryItemBuilder, MessageFlags, SectionBuilder, SeparatorBuilder,
    SeparatorSpacingSize, StringSelectMenuBuilder, TextDisplayBuilder, ThumbnailBuilder
} = require('discord.js');
const crypto = require('crypto');
const { and, eq } = require('drizzle-orm');
const { db } = require('../database');
const { automationRules } = require('../database/schema');
const { parseEmbedScript } = require('./lifecycleMessageService');

const SAFE_MENTIONS = { parse: [], repliedUser: false };

function renderVariables(script, { user, member, guild, channel } = {}) {
    const subject = member?.user || user || member;
    const avatar = subject?.displayAvatarURL?.() || subject?.avatarURL?.() || '';
    const values = {
        user: subject?.username || '',
        'user.id': subject?.id || member?.id || '',
        'user.name': subject?.username || '',
        'user.mention': subject?.id || member?.id ? `<@${subject?.id || member.id}>` : '',
        'user.avatar': avatar,
        'user.banner': subject?.bannerURL?.() || '',
        'user.tag': subject?.tag || subject?.username || '',
        'user.created_at': subject?.createdAt?.toISOString?.() || '',
        'user.bot': String(Boolean(subject?.bot)),
        'member.display_name': member?.displayName || subject?.displayName || subject?.username || '',
        'member.nick': member?.nickname || '',
        'member.roles': member?.roles?.cache?.filter?.(role => role.id !== guild?.id).map?.(role => `<@&${role.id}>`).join(', ') || '',
        'member.boost': String(Boolean(member?.premiumSince)),
        'guild.id': guild?.id || '',
        'guild.name': guild?.name || '',
        'guild.count': String(guild?.memberCount || 0),
        'guild.owner': guild?.ownerId ? `<@${guild.ownerId}>` : '',
        'guild.icon': guild?.iconURL?.() || '',
        'channel.id': channel?.id || '',
        'channel.name': channel?.name || '',
        'channel.mention': channel?.id ? `<#${channel.id}>` : '',
        'channel.topic': channel?.topic || ''
    };
    return String(script).replace(/\{([a-z]+(?:\.[a-z_]+)?)\}/g,
        (token, name) => Object.hasOwn(values, name) ? values[name] : token);
}

function nodes(source) {
    const result = [];
    let index = 0;
    while (index < source.length) {
        while (index < source.length) {
            if (/\s/.test(source[index])) index += 1;
            else if (source.startsWith('$v', index)) index += 2;
            else break;
        }
        if (index >= source.length) break;
        if (source[index] !== '{') throw new Error(`Unexpected script content near ${source.slice(index, index + 20)}`);
        const start = ++index;
        let depth = 1;
        while (index < source.length && depth) {
            if (source[index] === '{') depth += 1;
            else if (source[index] === '}') depth -= 1;
            index += 1;
        }
        if (depth) throw new Error('Script contains an unclosed directive.');
        const body = source.slice(start, index - 1);
        const colon = body.indexOf(':');
        result.push({ name: (colon < 0 ? body : body.slice(0, colon)).trim().toLowerCase(), value: colon < 0 ? '' : body.slice(colon + 1).trim() });
    }
    return result;
}

function validateLegacy(script) {
    let embeds = 0;
    let fields = 0;
    let total = 0;
    const limits = { title: 256, description: 4096, footer: 2048, author: 256 };
    for (const node of nodes(script)) {
        if (node.name === 'content' && node.value.length > 2000) throw new Error('Message content cannot exceed 2000 characters.');
        if (node.name === 'embed') {
            embeds += 1;
            fields = 0;
            if (embeds > 10) throw new Error('Embed scripts can contain at most 10 embeds.');
            continue;
        }
        if (limits[node.name]) {
            const value = node.value.split('&&')[0].trim();
            if (value.length > limits[node.name]) throw new Error(`Embed ${node.name} cannot exceed ${limits[node.name]} characters.`);
            total += value.length;
        }
        if (node.name === 'field' || node.name === 'fields') {
            fields += 1;
            if (fields > 25) throw new Error('Each embed can contain at most 25 fields.');
            const [name = '', value = ''] = node.value.split('&&').map(part => part.trim());
            if (name.length > 256) throw new Error('Embed field names cannot exceed 256 characters.');
            if (value.length > 1024) throw new Error('Embed field values cannot exceed 1024 characters.');
            total += name.length + value.length;
        }
    }
    if (total > 6000) throw new Error('Embed scripts can contain at most 6000 text characters.');
}

function httpUrl(value) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Component URLs must use HTTP or HTTPS.');
    return url.toString();
}

function mediaUrl(value) {
    if (/^attachment:\/\/[\w.-]+$/i.test(value)) return value;
    return httpUrl(value);
}

function optionsFor(value) {
    const parts = value.split('&&').map(part => part.trim()).filter(Boolean);
    const options = Object.fromEntries(parts.filter(part => part.includes(':')).map(part => {
        const index = part.indexOf(':');
        return [part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim()];
    }));
    return { parts, options };
}

function buttonFor(value, context) {
    const { parts, options } = optionsFor(value);
    const url = options.url || parts.find(part => /^https?:\/\//i.test(part));
    const unsupportedUrl = !url && parts.find(part => /^[a-z][a-z\d+.-]*:\/\//i.test(part));
    if (unsupportedUrl) httpUrl(unsupportedUrl);
    const label = options.label || parts.find(part => !part.includes(':') && part !== url);
    const custom = options.custom || options.custom_id || options.id;
    if (!label && !custom) throw new Error('Buttons require a label.');
    const button = new ButtonBuilder().setLabel((label || custom).slice(0, 80));
    if (url) return button.setStyle(ButtonStyle.Link).setURL(httpUrl(url));
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(custom || '')) throw new Error('Custom button names must be 1-32 lowercase letters, digits, underscores, or hyphens.');
    const style = {
        primary: ButtonStyle.Primary, blurple: ButtonStyle.Primary,
        secondary: ButtonStyle.Secondary, grey: ButtonStyle.Secondary, gray: ButtonStyle.Secondary,
        success: ButtonStyle.Success, green: ButtonStyle.Success,
        danger: ButtonStyle.Danger, red: ButtonStyle.Danger
    }[String(options.style || 'secondary').toLowerCase()];
    if (!style) throw new Error(`Unknown button style: ${options.style}`);
    return button.setStyle(style).setCustomId(`rich:custom:${custom}`)
        .setDisabled(parts.includes('disabled') || !context?.customScripts?.has(custom));
}

function splitChildren(value) {
    const start = value.indexOf('{');
    return {
        options: optionsFor(start < 0 ? value : value.slice(0, start).replace(/&&\s*$/, '')).options,
        children: start < 0 ? [] : nodes(value.slice(start))
    };
}

function galleryFor(value) {
    const items = [];
    for (const part of value.split('&&').map(item => item.trim()).filter(Boolean)) {
        if (/^(?:https?:\/\/|attachment:\/\/)/i.test(part)) items.push(new MediaGalleryItemBuilder().setURL(mediaUrl(part)));
        else if (part.toLowerCase() === 'spoiler' && items.length) items.at(-1).setSpoiler(true);
        else if (/^description\s*:/i.test(part) && items.length) items.at(-1).setDescription(part.slice(part.indexOf(':') + 1).trim().slice(0, 1024));
        else throw new Error(`Invalid gallery option: ${part}`);
    }
    if (!items.length || items.length > 10) throw new Error('Galleries require 1-10 valid HTTP(S) images.');
    return new MediaGalleryBuilder().addItems(...items);
}

function selectFor(value) {
    const parts = value.split('&&').map(part => part.trim()).filter(Boolean);
    const placeholderPart = parts.find(part => /^placeholder\s*:/i.test(part));
    const options = parts.filter(part => part.includes(':') && !/^(placeholder|min_values|max_values)\s*:/i.test(part))
        .map(part => {
            const index = part.indexOf(':');
            return { label: part.slice(0, index).trim().slice(0, 100), value: part.slice(index + 1).trim().slice(0, 100) };
        });
    for (const part of parts.filter(part => !part.includes(':') && part.toLowerCase() !== 'disabled')) {
        options.push({ label: part.slice(0, 100), value: part.slice(0, 100) });
    }
    if (!options.length || options.length > 25 || options.some(option => !option.label || !option.value)) {
        throw new Error('Display selects require 1-25 label:value options.');
    }
    return new StringSelectMenuBuilder()
        .setCustomId(`rich:display:${crypto.createHash('sha256').update(value).digest('hex').slice(0, 12)}`)
        .setPlaceholder((placeholderPart ? placeholderPart.slice(placeholderPart.indexOf(':') + 1).trim() : 'Choose an option').slice(0, 150))
        .setDisabled(true)
        .addOptions(...options);
}

function componentFor(node, context) {
    if (node.name === 'text') return new TextDisplayBuilder().setContent(node.value);
    if (node.name === 'button') return buttonFor(node.value, context);
    if (node.name === 'separator') {
        const separator = new SeparatorBuilder();
        if (/large|spacing\s*:\s*2/i.test(node.value)) separator.setSpacing(SeparatorSpacingSize.Large);
        if (/divider\s*:\s*false/i.test(node.value)) separator.setDivider(false);
        return separator;
    }
    if (node.name === 'gallery') return galleryFor(node.value);
    if (node.name === 'thumbnail') return new ThumbnailBuilder().setURL(mediaUrl(node.value));
    if (node.name === 'select' || node.name === 'selectmenu') return new ActionRowBuilder().addComponents(selectFor(node.value));
    if (node.name === 'actionrow') {
        const { children } = splitChildren(node.value);
        if (children.length === 1 && ['select', 'selectmenu'].includes(children[0].name)) {
            return new ActionRowBuilder().addComponents(selectFor(children[0].value));
        }
        if (!children.length || children.length > 5 || children.some(child => child.name !== 'button')) {
            throw new Error('Action rows require 1-5 buttons or one display select.');
        }
        return new ActionRowBuilder().addComponents(...children.map(child => buttonFor(child.value, context)));
    }
    if (node.name === 'section') {
        const { children } = splitChildren(node.value);
        const text = children.filter(child => child.name === 'text');
        const accessories = children.filter(child => ['button', 'thumbnail'].includes(child.name));
        if (!text.length || text.length > 3 || accessories.length !== 1 || children.length !== text.length + 1) {
            throw new Error('Sections require 1-3 text blocks and exactly one button or thumbnail.');
        }
        const section = new SectionBuilder().addTextDisplayComponents(...text.map(child => componentFor(child, context)));
        const accessory = componentFor(accessories[0], context);
        return accessories[0].name === 'button' ? section.setButtonAccessory(accessory) : section.setThumbnailAccessory(accessory);
    }
    if (node.name === 'container') {
        const { options, children } = splitChildren(node.value);
        if (!children.length) throw new Error('Containers require at least one child.');
        const container = new ContainerBuilder();
        const accent = options.accent || options.accent_color || options.accent_colour;
        if (accent) {
            if (!/^#?[\da-f]{6}$/i.test(accent)) throw new Error('Container accents must be six-digit hex colors.');
            container.setAccentColor(Number.parseInt(accent.replace('#', ''), 16));
        }
        container.spliceComponents(0, 0, ...componentsFor(children, context));
        return container;
    }
    throw new Error(`Unknown Components V2 directive: ${node.name}`);
}

function componentsFor(sourceNodes, context) {
    const components = [];
    let buttons = [];
    const flush = () => {
        if (buttons.length) components.push(new ActionRowBuilder().addComponents(buttons.splice(0, 5)));
    };
    for (const node of sourceNodes) {
        if (node.name === 'button') {
            buttons.push(componentFor(node, context));
            if (buttons.length === 5) flush();
        } else {
            flush();
            components.push(componentFor(node, context));
        }
    }
    flush();
    return components;
}

function renderComponents(script, context) {
    const components = componentsFor(nodes(script.replace(/^\s*\{cv2(?::)?\}/i, '')), context);
    if (!components.length) throw new Error('Components V2 scripts must render at least one component.');
    const count = component => 1
        + (component.components || []).reduce((sum, child) => sum + count(child), 0)
        + (component.accessory ? count(component.accessory) : 0);
    const json = components.map(component => component.toJSON());
    if (json.reduce((sum, component) => sum + count(component), 0) > 40) {
        throw new Error('Components V2 messages can contain at most 40 components.');
    }
    return { components, flags: MessageFlags.IsComponentsV2, allowedMentions: SAFE_MENTIONS };
}

function renderScript(script, context) {
    const rendered = renderVariables(script, context);
    if (/^\s*\{cv2(?::)?\}/i.test(rendered)) return renderComponents(rendered, context);
    if (/\{embed\}/i.test(rendered)) validateLegacy(rendered);
    let payload;
    if (/\{embed\}/i.test(rendered)) payload = parseEmbedScript(rendered);
    else if (/^\s*\{content\s*:/i.test(rendered)) {
        const directives = nodes(rendered);
        if (directives.length !== 1 || directives[0].name !== 'content') throw new Error('Content scripts must contain one content directive.');
        if (directives[0].value.length > 2000) throw new Error('Message content cannot exceed 2000 characters.');
        payload = { content: directives[0].value };
    } else {
        if (rendered.length > 2000) throw new Error('Message content cannot exceed 2000 characters.');
        payload = { content: rendered };
    }
    return { ...payload, allowedMentions: SAFE_MENTIONS };
}

function normalizedName(name) {
    const normalized = String(name || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(normalized)) {
        throw new Error('Names must be 1-32 letters, digits, underscores, or hyphens.');
    }
    return normalized;
}

function configOf(rule) {
    try { return JSON.parse(rule?.config || '{}'); } catch { return {}; }
}

function messageToScript(message) {
    const parts = [];
    if (message.content) parts.push(`{content: ${message.content}}`);
    for (const source of message.embeds || []) {
        const embed = source.toJSON ? source.toJSON() : source;
        parts.push('{embed}');
        if (embed.title) parts.push(`{title: ${embed.title}}`);
        if (embed.description) parts.push(`{description: ${embed.description}}`);
        if (embed.color !== undefined) parts.push(`{color: #${embed.color.toString(16).padStart(6, '0')}}`);
        if (embed.url) parts.push(`{url: ${embed.url}}`);
        if (embed.image?.url) parts.push(`{image: ${embed.image.url}}`);
        if (embed.thumbnail?.url) parts.push(`{thumbnail: ${embed.thumbnail.url}}`);
        if (embed.timestamp) parts.push(`{timestamp: ${embed.timestamp}}`);
        if (embed.author?.name) parts.push(`{author: ${[embed.author.name, embed.author.icon_url, embed.author.url].filter(Boolean).join(' && ')}}`);
        for (const field of embed.fields || []) parts.push(`{field: ${field.name} && ${field.value}${field.inline ? ' && true' : ''}}`);
        if (embed.footer?.text) parts.push(`{footer: ${[embed.footer.text, embed.footer.icon_url].filter(Boolean).join(' && ')}}`);
    }
    for (const row of message.components || []) {
        for (const component of row.components || []) {
            const button = component.toJSON ? component.toJSON() : component;
            if (button.type === 2 && button.url) parts.push(`{button: ${button.label || 'Link'} && ${button.url}${button.emoji?.name ? ` && ${button.emoji.name}` : ''}}`);
        }
    }
    if (!parts.length) throw new Error('That message has no scriptable content.');
    return parts.join('$v');
}

function sourceReply(source, filename = 'script.txt') {
    const escaped = String(source).replaceAll('```', '``\`');
    return escaped.length <= 1900
        ? { content: `\`\`\`\n${escaped}\n\`\`\``, allowedMentions: SAFE_MENTIONS }
        : { files: [{ attachment: Buffer.from(String(source)), name: filename }], allowedMentions: SAFE_MENTIONS };
}

class RichContentService {
    constructor(client, automation) {
        this.client = client;
        this.automation = automation;
        this.paginationLocks = new Map();
    }

    getTag(name) {
        return this.automation.get('global', 'tag', normalizedName(name));
    }

    async saveTag(authorId, name, script, { canManage = false } = {}) {
        const key = normalizedName(name);
        const existing = await this.getTag(key);
        if (existing && existing.createdBy !== authorId && !canManage) throw new Error('You do not have permission to edit this tag.');
        if (!String(script || '').trim()) throw new Error('Tag content cannot be empty.');
        return this.automation.upsert({
            guildId: 'global', kind: 'tag', key, config: { script: String(script) },
            createdBy: existing?.createdBy || authorId
        });
    }

    listTags(query = '') {
        const needle = String(query).trim().toLowerCase();
        return this.automation.list('global', 'tag').filter(rule => !needle || rule.key.includes(needle));
    }

    async removeTag(actorId, name, { canManage = false } = {}) {
        const existing = await this.getTag(name);
        if (!existing) return null;
        if (existing.createdBy !== actorId && !canManage) throw new Error('You do not have permission to remove this tag.');
        return this.automation.remove('global', 'tag', existing.key);
    }

    async renameTag(actorId, name, newName, { canManage = false } = {}) {
        const oldKey = normalizedName(name);
        const nextKey = normalizedName(newName);
        return db.transaction(tx => {
            const existing = tx.select().from(automationRules).where(and(
                eq(automationRules.guildId, 'global'), eq(automationRules.kind, 'tag'), eq(automationRules.key, oldKey)
            )).get();
            if (!existing) throw new Error(`Tag ${oldKey} was not found.`);
            if (existing.createdBy !== actorId && !canManage) throw new Error('You do not have permission to rename this tag.');
            const collision = tx.select({ id: automationRules.id }).from(automationRules).where(and(
                eq(automationRules.guildId, 'global'), eq(automationRules.kind, 'tag'), eq(automationRules.key, nextKey)
            )).get();
            if (collision) throw new Error(`Tag ${nextKey} already exists.`);
            tx.insert(automationRules).values({ ...existing, id: undefined, key: nextKey, updatedAt: Date.now() }).run();
            tx.delete(automationRules).where(eq(automationRules.id, existing.id)).run();
            return { ...existing, key: nextKey };
        });
    }

    resetTags(authorId) {
        return db.delete(automationRules).where(and(
            eq(automationRules.guildId, 'global'), eq(automationRules.kind, 'tag'), eq(automationRules.createdBy, authorId)
        )).returning().all().length;
    }

    getCustom(guildId, name) {
        return this.automation.get(guildId, 'custom-script', normalizedName(name));
    }

    listCustom(guildId) {
        return this.automation.list(guildId, 'custom-script');
    }

    async saveCustom(guildId, authorId, name, script) {
        const key = normalizedName(name);
        if (!String(script || '').trim()) throw new Error('Custom script content cannot be empty.');
        return db.transaction(tx => {
            const rules = tx.select().from(automationRules).where(and(
                eq(automationRules.guildId, guildId), eq(automationRules.kind, 'custom-script')
            )).all();
            const existing = rules.find(rule => rule.key === key);
            if (!existing && rules.length >= 100) throw new Error('This server has reached the 100-script limit.');
            const now = Date.now();
            const config = JSON.stringify({ script: String(script), useCount: configOf(existing).useCount || 0 });
            if (existing) {
                return tx.update(automationRules).set({ config, updatedAt: now }).where(eq(automationRules.id, existing.id)).returning().get();
            }
            return tx.insert(automationRules).values({
                guildId, kind: 'custom-script', key, config, enabled: true,
                createdBy: authorId, createdAt: now, updatedAt: now
            }).returning().get();
        });
    }

    useCustom(guildId, name) {
        const key = normalizedName(name);
        return db.transaction(tx => {
            const existing = tx.select().from(automationRules).where(and(
                eq(automationRules.guildId, guildId), eq(automationRules.kind, 'custom-script'), eq(automationRules.key, key)
            )).get();
            if (!existing) return null;
            const config = configOf(existing);
            return tx.update(automationRules).set({
                config: JSON.stringify({ ...config, useCount: (config.useCount || 0) + 1 }), updatedAt: Date.now()
            }).where(eq(automationRules.id, existing.id)).returning().get();
        });
    }

    removeCustom(guildId, name) {
        return this.automation.remove(guildId, 'custom-script', normalizedName(name));
    }

    resetCustom(guildId) {
        return this.automation.clear(guildId, 'custom-script').length;
    }

    customNames(guildId) {
        return new Set(this.listCustom(guildId).map(rule => rule.key));
    }

    renameCustom(guildId, name, newName) {
        const oldKey = normalizedName(name);
        const nextKey = normalizedName(newName);
        return db.transaction(tx => {
            const existing = tx.select().from(automationRules).where(and(
                eq(automationRules.guildId, guildId), eq(automationRules.kind, 'custom-script'), eq(automationRules.key, oldKey)
            )).get();
            if (!existing) throw new Error(`Custom script ${oldKey} was not found.`);
            if (tx.select({ id: automationRules.id }).from(automationRules).where(and(
                eq(automationRules.guildId, guildId), eq(automationRules.kind, 'custom-script'), eq(automationRules.key, nextKey)
            )).get()) throw new Error(`Custom script ${nextKey} already exists.`);
            tx.insert(automationRules).values({ ...existing, id: undefined, key: nextKey, updatedAt: Date.now() }).run();
            tx.delete(automationRules).where(eq(automationRules.id, existing.id)).run();
            return { ...existing, key: nextKey };
        });
    }

    async handleCustomButton(interaction) {
        const name = interaction.customId.slice('rich:custom:'.length);
        const rule = this.getCustom(interaction.guildId, name);
        if (!rule) {
            return interaction.reply({ content: 'That custom response is no longer available.', flags: MessageFlags.Ephemeral });
        }
        const payload = renderScript(configOf(rule).script, {
            user: interaction.user, member: interaction.member, guild: interaction.guild,
            channel: interaction.channel, customScripts: this.customNames(interaction.guildId)
        });
        payload.flags = (payload.flags || 0) | MessageFlags.Ephemeral;
        await interaction.reply(payload);
        this.useCustom(interaction.guildId, name);
        return true;
    }

    getEmbed(ownerId, name) {
        return this.automation.get(`user:${ownerId}`, 'saved-embed', normalizedName(name));
    }

    listEmbeds(ownerId) {
        return this.automation.list(`user:${ownerId}`, 'saved-embed');
    }

    async saveEmbed(ownerId, name, script) {
        const key = normalizedName(name);
        if (!String(script || '').trim()) throw new Error('Embed script cannot be empty.');
        return this.automation.upsert({
            guildId: `user:${ownerId}`, kind: 'saved-embed', key,
            config: { script: String(script) }, createdBy: ownerId
        });
    }

    removeEmbed(ownerId, name) {
        return this.automation.remove(`user:${ownerId}`, 'saved-embed', normalizedName(name));
    }

    renameEmbed(ownerId, name, newName) {
        const scope = `user:${ownerId}`;
        const oldKey = normalizedName(name);
        const nextKey = normalizedName(newName);
        return db.transaction(tx => {
            const existing = tx.select().from(automationRules).where(and(
                eq(automationRules.guildId, scope), eq(automationRules.kind, 'saved-embed'), eq(automationRules.key, oldKey)
            )).get();
            if (!existing) throw new Error(`Saved embed ${oldKey} was not found.`);
            if (tx.select({ id: automationRules.id }).from(automationRules).where(and(
                eq(automationRules.guildId, scope), eq(automationRules.kind, 'saved-embed'), eq(automationRules.key, nextKey)
            )).get()) throw new Error(`Saved embed ${nextKey} already exists.`);
            tx.insert(automationRules).values({ ...existing, id: undefined, key: nextKey, updatedAt: Date.now() }).run();
            tx.delete(automationRules).where(eq(automationRules.id, existing.id)).run();
            return { ...existing, key: nextKey };
        });
    }

    async publishEmbed(ownerId, name, category, description = '') {
        const key = normalizedName(name);
        const saved = await this.getEmbed(ownerId, key);
        if (!saved) throw new Error(`Saved embed ${key} was not found.`);
        const publishedKey = `${ownerId}:${key}`;
        return db.transaction(tx => {
            const rules = tx.select().from(automationRules).where(and(
                eq(automationRules.guildId, 'global'), eq(automationRules.kind, 'published-embed')
            )).all();
            const existing = rules.find(rule => rule.key === publishedKey);
            if (!existing && rules.filter(rule => rule.createdBy === ownerId).length >= 10) {
                throw new Error('You have reached the 10-published limit.');
            }
            const now = Date.now();
            const config = JSON.stringify({
                name: key, category: String(category || 'Other').slice(0, 32),
                description: String(description || '').slice(0, 200), script: configOf(saved).script,
                copies: configOf(existing).copies || 0
            });
            if (existing) return tx.update(automationRules).set({ config, updatedAt: now }).where(eq(automationRules.id, existing.id)).returning().get();
            return tx.insert(automationRules).values({
                guildId: 'global', kind: 'published-embed', key: publishedKey, config,
                enabled: true, createdBy: ownerId, createdAt: now, updatedAt: now
            }).returning().get();
        });
    }

    listPublished(category = '') {
        const needle = String(category).trim().toLowerCase();
        return this.automation.list('global', 'published-embed')
            .filter(rule => !needle || String(configOf(rule).category).toLowerCase() === needle);
    }

    unpublishEmbed(ownerId, name) {
        return this.automation.remove('global', 'published-embed', `${ownerId}:${normalizedName(name)}`);
    }

    copyPublishedEmbed(ownerId, publishedKey, saveAs) {
        const scope = `user:${ownerId}`;
        const key = String(publishedKey || '').trim().toLowerCase();
        return db.transaction(tx => {
            const published = tx.select().from(automationRules).where(and(
                eq(automationRules.guildId, 'global'), eq(automationRules.kind, 'published-embed'), eq(automationRules.key, key)
            )).get();
            if (!published) throw new Error('Published embed not found.');
            const publishedConfig = configOf(published);
            const savedKey = normalizedName(saveAs || publishedConfig.name);
            const now = Date.now();
            const saved = tx.select().from(automationRules).where(and(
                eq(automationRules.guildId, scope), eq(automationRules.kind, 'saved-embed'), eq(automationRules.key, savedKey)
            )).get();
            const savedConfig = JSON.stringify({ script: publishedConfig.script });
            if (saved) tx.update(automationRules).set({ config: savedConfig, updatedAt: now }).where(eq(automationRules.id, saved.id)).run();
            else tx.insert(automationRules).values({ guildId: scope, kind: 'saved-embed', key: savedKey, config: savedConfig,
                enabled: true, createdBy: ownerId, createdAt: now, updatedAt: now }).run();
            const priorCopy = tx.select({ id: automationRules.id }).from(automationRules).where(and(
                eq(automationRules.guildId, scope), eq(automationRules.kind, 'published-copy'), eq(automationRules.key, key)
            )).get();
            if (!priorCopy) {
                tx.insert(automationRules).values({ guildId: scope, kind: 'published-copy', key, config: '{}',
                    enabled: true, createdBy: ownerId, createdAt: now, updatedAt: now }).run();
                tx.update(automationRules).set({ config: JSON.stringify({ ...publishedConfig, copies: (publishedConfig.copies || 0) + 1 }), updatedAt: now })
                    .where(eq(automationRules.id, published.id)).run();
            }
            return savedKey;
        });
    }

    getTagSettings(guildId) {
        return { enabled: true, ...configOf(this.automation.get(guildId, 'tag-config', 'main')) };
    }

    setTagsEnabled(guildId, enabled, actorId) {
        return this.automation.upsert({ guildId, kind: 'tag-config', key: 'main', config: { enabled }, enabled: true, createdBy: actorId });
    }

    getEmbedColors(guildId) {
        return configOf(this.automation.get(guildId, 'embed-colors', 'main'));
    }

    setEmbedColor(guildId, type, color, actorId) {
        if (!['information', 'success', 'error', 'warning'].includes(type)) throw new Error('Unknown embed color type.');
        if (!/^#?[\da-f]{6}$/i.test(color)) throw new Error('Use a six-digit hex color.');
        const colors = { ...this.getEmbedColors(guildId), [type]: `#${color.replace('#', '').toUpperCase()}` };
        return this.automation.upsert({ guildId, kind: 'embed-colors', key: 'main', config: colors, createdBy: actorId });
    }

    resetEmbedColors(guildId) {
        return this.automation.remove(guildId, 'embed-colors', 'main');
    }

    getPagination(guildId, messageId) {
        return this.automation.get(guildId, 'pagination', messageId);
    }

    listPagination(guildId) {
        return this.automation.list(guildId, 'pagination');
    }

    async setupPagination(message, actorId) {
        if (message.author?.id !== this.client.user?.id) throw new Error('Pagination can only use ByteBot-authored messages.');
        if (!message.embeds?.length) throw new Error('Pagination requires a message containing an embed.');
        if (this.getPagination(message.guild.id, message.id)) throw new Error('That message already has pagination.');
        const rule = this.automation.upsert({ guildId: message.guild.id, kind: 'pagination', key: message.id,
            config: { channelId: message.channel.id, pages: [messageToScript(message)], page: 0 }, createdBy: actorId });
        try {
            await this.restorePaginationReactions(message);
        } catch (error) {
            this.automation.remove(message.guild.id, 'pagination', message.id);
            throw error;
        }
        return rule;
    }

    addPaginationPage(message, script, actorId) {
        const payload = renderScript(script, { guild: message.guild, channel: message.channel });
        if (!payload.embeds?.length || payload.flags === MessageFlags.IsComponentsV2) throw new Error('Pagination pages must be embed scripts.');
        return db.transaction(tx => {
            const rule = tx.select().from(automationRules).where(and(
                eq(automationRules.guildId, message.guild.id), eq(automationRules.kind, 'pagination'), eq(automationRules.key, message.id)
            )).get();
            if (!rule) throw new Error('That message is not set up for pagination.');
            const config = configOf(rule);
            if (config.pages.length >= 10) throw new Error('Pagination supports at most 10 pages.');
            config.pages.push(String(script));
            tx.update(automationRules).set({ config: JSON.stringify(config), updatedAt: Date.now() }).where(eq(automationRules.id, rule.id)).run();
            return config.pages.length;
        });
    }

    updatePaginationPage(message, page, script) {
        const payload = renderScript(script, { guild: message.guild, channel: message.channel });
        if (!payload.embeds?.length || payload.flags === MessageFlags.IsComponentsV2) throw new Error('Pagination pages must be embed scripts.');
        return this.changePaginationPages(message, config => {
            if (page < 1 || page > config.pages.length) throw new Error(`Page must be between 1 and ${config.pages.length}.`);
            config.pages[page - 1] = String(script);
        });
    }

    removePaginationPage(message, page) {
        return this.changePaginationPages(message, config => {
            if (config.pages.length === 1) throw new Error('Delete pagination instead of removing its only page.');
            if (page < 1 || page > config.pages.length) throw new Error(`Page must be between 1 and ${config.pages.length}.`);
            config.pages.splice(page - 1, 1);
            config.page = Math.min(config.page || 0, config.pages.length - 1);
        });
    }

    changePaginationPages(message, mutate) {
        return db.transaction(tx => {
            const rule = tx.select().from(automationRules).where(and(
                eq(automationRules.guildId, message.guild.id), eq(automationRules.kind, 'pagination'), eq(automationRules.key, message.id)
            )).get();
            if (!rule) throw new Error('That message is not set up for pagination.');
            const config = configOf(rule);
            mutate(config);
            return tx.update(automationRules).set({ config: JSON.stringify(config), updatedAt: Date.now() })
                .where(eq(automationRules.id, rule.id)).returning().get();
        });
    }

    async deletePagination(message) {
        const removed = this.automation.remove(message.guild.id, 'pagination', message.id);
        if (!removed) throw new Error('That message is not set up for pagination.');
        for (const emoji of ['⬅️', '➡️']) {
            await message.reactions?.cache?.get(emoji)?.users?.remove(this.client.user?.id).catch(() => null);
        }
        return removed;
    }

    resetPagination(guildId) {
        return this.automation.clear(guildId, 'pagination').length;
    }

    async restorePaginationReactions(message) {
        await message.react('⬅️');
        await message.react('➡️');
    }

    async withPaginationLock(key, work) {
        const previous = this.paginationLocks.get(key) || Promise.resolve();
        const current = previous.catch(() => null).then(work);
        this.paginationLocks.set(key, current);
        try { return await current; } finally { if (this.paginationLocks.get(key) === current) this.paginationLocks.delete(key); }
    }

    handlePaginationReaction(reaction, user) {
        if (user.bot || !['⬅️', '➡️'].includes(reaction.emoji.name)) return undefined;
        const message = reaction.message;
        return this.withPaginationLock(`${message.guild.id}:${message.id}`, async () => {
            const rule = this.getPagination(message.guild.id, message.id);
            if (!rule) return false;
            const config = configOf(rule);
            const delta = reaction.emoji.name === '➡️' ? 1 : -1;
            const page = (Number(config.page || 0) + delta + config.pages.length) % config.pages.length;
            const payload = renderScript(config.pages[page], { user, guild: message.guild, channel: message.channel,
                customScripts: this.customNames(message.guild.id) });
            await message.edit(payload);
            this.automation.upsert({ guildId: message.guild.id, kind: 'pagination', key: message.id,
                config: { ...config, page }, createdBy: rule.createdBy });
            await reaction.users.remove(user.id).catch(() => null);
            return true;
        });
    }

    listWebhooks(guildId) {
        return this.automation.list(guildId, 'managed-webhook');
    }

    async createWebhook(guild, channel, name, actorId) {
        const normalized = String(name || '').trim();
        if (!normalized || normalized.length > 80 || /clyde|discord/i.test(normalized)) throw new Error('Use a valid webhook name up to 80 characters.');
        if (!channel?.createWebhook || !channel?.fetchWebhooks) throw new Error('Webhooks cannot be created in that channel.');
        if (this.listWebhooks(guild.id).some(rule => {
            const config = configOf(rule);
            return config.channelId === channel.id && String(config.name).toLowerCase() === normalized.toLowerCase();
        })) throw new Error('A managed webhook with that name already exists in this channel.');
        let webhook;
        try { webhook = await channel.createWebhook({ name: normalized, reason: `Managed webhook created by ${actorId}` }); }
        catch { throw new Error('Discord could not create that webhook.'); }
        try {
            let key;
            do { key = crypto.randomBytes(5).toString('base64url').slice(0, 7).toLowerCase(); }
            while (this.automation.get(guild.id, 'managed-webhook', key));
            return this.automation.upsert({ guildId: guild.id, kind: 'managed-webhook', key,
                config: { webhookId: webhook.id, channelId: channel.id, name: normalized }, createdBy: actorId });
        } catch (error) {
            await webhook.delete('Managed webhook persistence failed').catch(() => null);
            throw error;
        }
    }

    async managedWebhook(guild, shortId) {
        const rule = this.automation.get(guild.id, 'managed-webhook', String(shortId || '').toLowerCase());
        if (!rule) throw new Error('Managed webhook not found.');
        const config = configOf(rule);
        const channel = guild.channels.cache.get(config.channelId) || await guild.channels.fetch(config.channelId).catch(() => null);
        if (!channel?.fetchWebhooks) throw new Error('Managed webhook channel is unavailable.');
        let webhooks;
        try { webhooks = await channel.fetchWebhooks(); }
        catch { throw new Error('Discord could not retrieve that managed webhook.'); }
        const webhook = webhooks.get(config.webhookId);
        if (!webhook) {
            this.automation.remove(guild.id, 'managed-webhook', rule.key);
            throw new Error('Managed webhook was deleted from Discord.');
        }
        return { rule, config, channel, webhook };
    }

    async sendWebhook(guild, shortId, script, context = {}) {
        const managed = await this.managedWebhook(guild, shortId);
        const payload = renderScript(script, { ...context, guild, channel: managed.channel,
            customScripts: this.customNames(guild.id) });
        let message;
        try { message = await managed.webhook.send(payload); }
        catch { throw new Error('Discord could not send the managed webhook message.'); }
        this.automation.upsert({ guildId: guild.id, kind: 'webhook-message', key: `${managed.channel.id}:${message.id}`,
            config: { shortId: managed.rule.key, webhookId: managed.config.webhookId, channelId: managed.channel.id },
            createdBy: managed.rule.createdBy });
        return message;
    }

    async editWebhookMessage(guild, channel, messageId, script, context = {}) {
        const tracked = this.automation.get(guild.id, 'webhook-message', `${channel.id}:${messageId}`);
        if (!tracked) throw new Error('No tracked managed-webhook message was found.');
        const trackedConfig = configOf(tracked);
        const managed = await this.managedWebhook(guild, trackedConfig.shortId);
        const payload = renderScript(script, { ...context, guild, channel, customScripts: this.customNames(guild.id) });
        try { return await managed.webhook.editMessage(messageId, payload); }
        catch { throw new Error('Discord could not edit the managed webhook message.'); }
    }

    async deleteWebhook(guild, shortId) {
        const managed = await this.managedWebhook(guild, shortId);
        try { await managed.webhook.delete('Managed webhook removed through ByteBot'); }
        catch { throw new Error('Discord could not delete that managed webhook.'); }
        this.automation.remove(guild.id, 'managed-webhook', managed.rule.key);
        for (const rule of this.automation.list(guild.id, 'webhook-message')) {
            if (configOf(rule).shortId === managed.rule.key) this.automation.remove(guild.id, 'webhook-message', rule.key);
        }
        return true;
    }

    async setWebhookAvatar(guild, shortId, attachment) {
        if (!attachment || attachment.size > 8 * 1024 * 1024 || !attachment.contentType?.startsWith('image/')) {
            throw new Error('Webhook avatars must be images up to 8 MiB.');
        }
        const url = new URL(attachment.url);
        if (url.protocol !== 'https:' || !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname)) {
            throw new Error('Webhook avatars must be Discord-hosted HTTPS attachments.');
        }
        const managed = await this.managedWebhook(guild, shortId);
        try { return await managed.webhook.edit({ avatar: url.toString(), reason: 'Managed webhook avatar update' }); }
        catch { throw new Error('Discord could not update that managed webhook avatar.'); }
    }
}

module.exports = RichContentService;
module.exports.renderScript = renderScript;
module.exports.renderVariables = renderVariables;
module.exports.SAFE_MENTIONS = SAFE_MENTIONS;
module.exports.normalizedName = normalizedName;
module.exports.configOf = configOf;
module.exports.messageToScript = messageToScript;
module.exports.sourceReply = sourceReply;
