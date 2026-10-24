const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const { createHash } = require('crypto');
const embeds = require('../../utils/embeds');
const { shouldRegisterCommand } = require('../../utils/commandRegistration');

const categoryOrder = ['Administration', 'Moderation', 'Utility', 'Fun', 'Games', 'Music', 'Voice', 'Economy', 'LastFM', 'Developer'];
const optionTypes = { 3: 'String', 4: 'Integer', 5: 'Boolean', 6: 'User', 7: 'Channel', 8: 'Role', 9: 'Mentionable', 10: 'Number', 11: 'Attachment' };
const footer = 'Use /bot help command:<path> for details. Availability depends on permissions and server rules.';
const providerNote = 'Unavailable provider features: AI chat/STT/generation, persistent social feeds/downloads/provider-backed behavior, Rolimons, Valorant, Minecraft, Spotify search, Reddit, YouTube downloads, Telegram, bio providers.';
const notes = {
    economy: {
        name: 'Compatibility',
        value: '`bal` is a text compatibility alias for `/economy balance`. Games use the public 10–1,000,000 bet bound. Odds, crime/rob cooldowns, gang limits, and lab progression are ByteBot-owned rules. Member areas include games, crime, rob, leaderboards, gangs, and labs. Gang owner/admin checks apply inside their exact paths.'
    },
    fun: {
        name: 'Safety and availability',
        value: 'Snipe keeps at most 10 entries per kind/channel for 15 minutes and honors global self-protection. Roleplay exposes 40 provider-backed actions; `fuck`, `spank`, and `nutkick` are policy-excluded. `howgay`, `pp`, `bitches`, `nword`, and `nwordlb` are policy-excluded. Image/media subjects use the bounded media service.'
    }
};

function normalizePath(raw) {
    if (typeof raw !== 'string' || raw.length > 100) return null;
    const path = raw.trim().replace(/^\//, '').trim().replace(/\s+/g, ' ').toLowerCase();
    return /^[\p{L}\p{N}_-]+(?: [\p{L}\p{N}_-]+){0,2}$/u.test(path) ? path : null;
}

function snapshot(commands) {
    const roots = [];
    for (const command of commands.values()) {
        if (!shouldRegisterCommand(command) || command.devOnly || !command.data) continue;
        const data = command.data.toJSON?.() || command.data;
        if (data.type !== undefined && data.type !== 1) continue;
        const category = command.discovery?.category || command.category || 'Other';
        const publicPaths = command.discovery?.publicPaths;
        function walk(schema, path, relative) {
            const routes = (schema.options || []).filter(option => option.type === 1 || option.type === 2);
            if (!routes.length) {
                if (publicPaths && !publicPaths.includes(relative)) return null;
                return { path, description: schema.description, category, options: schema.options || [] };
            }
            const children = routes.map(route => walk(route, `${path} ${route.name}`, relative ? `${relative} ${route.name}` : route.name))
                .filter(Boolean).sort((a, b) => a.path.localeCompare(b.path));
            if (!children.length) return null;
            return {
                path, category, children,
                description: publicPaths ? 'Browse public command paths.' : schema.description
            };
        }
        const root = walk(data, data.name, '');
        if (root) roots.push({ ...root, cooldown: command.cooldown ?? 3 });
    }
    roots.sort((a, b) => a.path.localeCompare(b.path));
    const byPath = new Map();
    function index(node) {
        byPath.set(node.path, node);
        node.children?.forEach(index);
    }
    roots.forEach(index);
    const topics = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
    const revision = createHash('sha256').update(JSON.stringify({ version: 1, roots, notes, providerNote, footer })).digest('hex').slice(0, 16);
    return { roots, byPath, topics, revision };
}

function optionField(option) {
    const lines = [
        `${option.required ? 'required' : 'optional'} • ${optionTypes[option.type] || `Type ${option.type}`}`,
        option.description
    ];
    if (option.autocomplete) lines.push('Autocomplete available.');
    for (const [key, label] of Object.entries({
        min_value: 'Minimum value', max_value: 'Maximum value',
        min_length: 'Minimum length', max_length: 'Maximum length'
    })) {
        if (option[key] !== undefined) lines.push(`${label}: ${option[key]}`);
    }
    if (option.channel_types?.length) lines.push(`Channel types: ${option.channel_types.join(', ')}`);
    if (option.choices?.length) lines.push('Choices:', ...option.choices.map(choice => `${choice.name}: ${choice.value}`));
    return { name: `Argument: ${option.name}`, value: lines.filter(Boolean).join('\n') };
}

function viewContent(book, view) {
    if (view > 0) {
        const node = book.topics[view - 1];
        const fields = [{ name: 'Description', value: node.description || 'No description available.' }];
        fields.push({ name: 'Category', value: node.category });
        if (node.children) {
            fields.push({ name: 'Browse topic', value: 'Choose a full child path to inspect its usage.' });
            fields.push(...node.children.map(child => ({
                name: child.children ? 'Browse topic' : 'Runnable command',
                value: `/${child.path}\n${child.description || ''}`
            })));
        } else {
            fields.push({ name: 'Usage', value: `/${node.path}` });
            fields.push(...node.options.map(optionField));
        }
        if (node.cooldown !== undefined) fields.push({ name: 'Hub cooldown', value: `${node.cooldown} seconds. Delegated commands may have their own cooldowns.` });
        if (notes[node.path]) fields.push(notes[node.path]);
        return { title: `Command: /${node.path}`, fields };
    }
    const leaves = book.topics.filter(node => !node.children);
    const categories = [...new Set(book.roots.map(root => root.category))].sort((a, b) => {
        const rank = category => categoryOrder.includes(category) ? categoryOrder.indexOf(category) : categoryOrder.length;
        return rank(a) - rank(b) || a.localeCompare(b);
    });
    const fields = [{
        name: 'Registered commands',
        value: `${book.roots.length} registered roots • ${leaves.length} runnable paths • ${categories.length} categories`
    }];
    if (!leaves.length) fields.push({ name: 'No commands available', value: 'No public slash commands are registered in this catalog.' });
    for (const category of categories) {
        fields.push(...leaves.filter(node => node.category === category).map(node => ({
            name: category, value: `/${node.path}\n${node.description || ''}`
        })));
    }
    fields.push({ name: 'Provider availability', value: providerNote });
    const levelAliases = [
        ['levels rank', '`level`, `rank`, `xp`, `lvl`'],
        ['levels leaderboard', '`levels lb`, `levels top`'],
        ['levels rankcard view', '`rankcard`, `rc`'],
        ['levels rankcard color', '`rankcard colour`, `rankcard accent`']
    ].filter(([path]) => book.byPath.has(path));
    if (levelAliases.length) fields.push({ name: 'Text compatibility aliases', value: levelAliases.map(([path, aliases]) => `${aliases} → /${path}`).join('\n') });
    return { title: 'ByteBot Help', fields };
}

function splitText(text, limit) {
    const parts = [];
    let remaining = String(text || 'No description available.');
    while (remaining.length > limit) {
        let end = remaining.lastIndexOf('\n', limit - 1) + 1;
        if (!end) end = limit;
        const code = remaining.charCodeAt(end - 1);
        if (code >= 0xD800 && code <= 0xDBFF) end--;
        parts.push(remaining.slice(0, end));
        remaining = remaining.slice(end);
    }
    if (remaining) parts.push(remaining);
    return parts;
}

function heading(text) {
    return text.length <= 256 ? text : `${splitText(text, 255)[0]}…`;
}

function pagesFor(book, view) {
    const content = viewContent(book, view);
    const title = heading(content.title);
    const pages = [];
    let fields = [];
    // Reserve space for the footer and its final page numbers before packing fields.
    const budget = 6000 - title.length - footer.length - 64;
    let used = 0;
    for (const field of content.fields) {
        const values = splitText(field.value, 1024);
        for (let index = 0; index < values.length; index++) {
            const name = heading(`${field.name}${index ? ' (continued)' : ''}`);
            const value = values[index];
            if (fields.length === 25 || used + name.length + value.length > budget) {
                pages.push({ title, fields });
                fields = [];
                used = 0;
            }
            fields.push({ name, value });
            used += name.length + value.length;
        }
    }
    pages.push({ title, fields });
    return pages;
}

function payloadFor(book, view, page, pages) {
    const content = pages[page];
    const embed = embeds.brand(content.title).setFields(content.fields)
        .setFooter({ text: `${footer} Page ${page + 1}/${pages.length}.` });
    const button = (action, label, targetView, targetPage, disabled = false) => new ButtonBuilder()
        .setCustomId(action === 'i' ? 'help_page_indicator' : `help_page_v1_${action}_${book.revision}_${targetView}_${targetPage}`)
        .setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(disabled);
    const row = new ActionRowBuilder().addComponents(
        button('p', 'Previous', view, Math.max(0, page - 1), page === 0),
        button('i', `${page + 1}/${pages.length}`, view, page, true),
        button('n', 'Next', view, Math.min(pages.length - 1, page + 1), page === pages.length - 1),
        button('o', 'Overview', 0, 0, view === 0 && page === 0)
    );
    return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

function parseCursor(customId, book) {
    if (customId.length > 100) return null;
    const match = /^help_page_v1_[pno]_([a-f0-9]{16})_(0|[1-9][0-9]{0,8})_(0|[1-9][0-9]{0,8})$/.exec(customId);
    if (!match || match[1] !== book.revision) return null;
    const view = Number(match[2]);
    const page = Number(match[3]);
    if (!Number.isSafeInteger(view) || !Number.isSafeInteger(page) || view > book.topics.length) return null;
    return { view, page };
}

function unavailable(interaction, title = 'Help page unavailable', message = 'Run /bot help again to open the current command catalog.') {
    return interaction.reply({
        embeds: [embeds.brand(title, message).setFooter({ text: footer })],
        flags: [MessageFlags.Ephemeral], allowedMentions: { parse: [] }
    });
}

module.exports = {
    register: false,
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Browse all commands or get info about a specific command')
        .addStringOption(option => option.setName('command').setDescription('Full command path to inspect')
            .setRequired(false).setAutocomplete(true).setMaxLength(100)),
    cooldown: 5,

    async autocomplete(interaction, client) {
        const focused = interaction.options.getFocused(true);
        if (focused.name !== 'command') return interaction.respond([]);
        const raw = focused.value;
        const query = normalizePath(raw);
        if (raw.trim() && query === null && raw.trim() !== '/') return interaction.respond([]);
        const book = snapshot(client.commands);
        const match = path => !query || path.includes(query);
        const rank = path => path === query ? 0 : path.startsWith(query || '') ? 1 : 2;
        const choices = book.topics.filter(node => node.path.length <= 99 && match(node.path))
            .sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path))
            .slice(0, 25).map(node => ({ name: `/${node.path}`, value: node.path }));
        return interaction.respond(choices);
    },

    async execute(interaction, client) {
        const raw = interaction.options.getString('command');
        const book = snapshot(client.commands);
        const path = normalizePath(raw);
        if (raw?.trim() && !book.byPath.has(path)) {
            return unavailable(interaction, 'Command Not Found', 'No public command path matches. Use /bot help to browse available paths.');
        }
        const view = path ? book.topics.findIndex(node => node.path === path) + 1 : 0;
        const payload = payloadFor(book, view, 0, pagesFor(book, view));
        if (view > 0) payload.flags = [MessageFlags.Ephemeral];
        return interaction.reply(payload);
    },

    async handleInteraction(interaction, client) {
        if (!interaction.isButton() || !interaction.customId.startsWith('help_page_')) return;
        const book = snapshot(client.commands);
        const cursor = parseCursor(interaction.customId, book);
        if (!cursor) return unavailable(interaction);
        const pages = pagesFor(book, cursor.view);
        if (cursor.page >= pages.length) return unavailable(interaction);
        await interaction.deferUpdate();
        return interaction.editReply(payloadFor(book, cursor.view, cursor.page, pages));
    }
};
