const crypto = require('crypto');
const axios = require('axios');
const sharp = require('sharp');
const {
    ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags,
    ModalBuilder, PermissionFlagsBits, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    TextInputBuilder, TextInputStyle
} = require('discord.js');
const { sqlite } = require('../database');
const logger = require('../utils/logger');

const SAFE_MENTIONS = { parse: [], repliedUser: false };
const LINK_PATTERN = /(?:https?:\/\/|www\.|discord(?:app)?\.com\/invite|discord\.gg\/)/i;
const POLL_MIN_MS = 10000;
const POLL_MAX_MS = 7 * 86400000;

function parsePollDuration(value) {
    const match = /^\s*(\d+)\s*([smhd])\s*$/i.exec(String(value || ''));
    if (!match) throw new Error('Invalid duration. Use a value such as 10s, 30m, 1h, or 2d.');
    const duration = Number(match[1]) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2].toLowerCase()];
    if (duration < POLL_MIN_MS || duration > POLL_MAX_MS) throw new Error('Poll duration must be between 10 seconds and 7 days.');
    return duration;
}

function parsePollOptions(value) {
    const options = String(value || '').split(',').map(item => item.trim()).filter(Boolean);
    if (options.length < 2 || options.length > 10) throw new Error('Provide between 2 and 10 comma-separated options.');
    if (options.some(option => option.length > 55)) throw new Error('Poll options cannot exceed 55 characters.');
    if (new Set(options.map(option => option.toLocaleLowerCase())).size !== options.length) throw new Error('Poll options must be unique.');
    return options;
}

function normalizePhrase(value, maximum = 100) {
    const phrase = String(value || '').trim().replace(/\s+/g, ' ');
    if (!phrase || phrase.length > maximum) throw new Error(`Text must be between 1 and ${maximum} characters.`);
    return { phrase, key: phrase.toLocaleLowerCase() };
}

function messageIdFrom(value) {
    const raw = String(value || '').trim();
    const link = /discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/i.exec(raw);
    if (link) return { guildId: link[1], channelId: link[2], messageId: link[3] };
    if (/^\d{16,22}$/.test(raw)) return { messageId: raw };
    throw new Error('Provide a Discord message link or message ID.');
}

function escapeXml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
}

function wrapText(value, width = 54) {
    const lines = [];
    for (const paragraph of String(value).split(/\r?\n/)) {
        const words = paragraph.split(/\s+/).filter(Boolean);
        let line = '';
        for (const word of words) {
            if (word.length > width) {
                if (line) lines.push(line);
                for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
                line = '';
            } else if (!line || line.length + word.length + 1 <= width) {
                line += `${line ? ' ' : ''}${word}`;
            } else {
                lines.push(line);
                line = word;
            }
        }
        if (line || !words.length) lines.push(line);
    }
    return lines.slice(0, 44);
}

function pollFromRow(row) {
    return row && { ...row, options: JSON.parse(row.options_json) };
}

class CommunityUtilityService {
    constructor(client, options = {}) {
        this.client = client;
        this.sqlite = options.sqlite || sqlite;
        this.now = options.now || Date.now;
        this.randomInt = options.randomInt || crypto.randomInt;
        this.interval = null;
        this.running = false;
        this.memberRefreshes = new Map();
        this.confessionSubmissions = new Map();
    }

    start() {
        if (this.interval) return;
        this.interval = setInterval(() => this.runDuePolls().catch(error => logger.error(`Community poll scheduler failed: ${error.message}`)), 5000);
        this.interval.unref?.();
    }

    cleanup() {
        if (this.interval) clearInterval(this.interval);
        this.interval = null;
        this.memberRefreshes.clear();
        this.confessionSubmissions.clear();
    }

    async reconcile() {
        this.sqlite.prepare("UPDATE community_polls SET status = 'active' WHERE status = 'ending'").run();
        await this.runDuePolls();
    }

    confessionConfig(guildId) {
        return this.sqlite.prepare('SELECT * FROM confession_configs WHERE guild_id = ?').get(guildId);
    }

    confessionCategories(guildId) {
        return this.sqlite.prepare('SELECT * FROM confession_categories WHERE guild_id = ? ORDER BY name_key LIMIT 25').all(guildId);
    }

    setConfessionConfig(guildId, channelId) {
        this.sqlite.prepare(`INSERT INTO confession_configs (guild_id, channel_id, updated_at) VALUES (?, ?, ?)
            ON CONFLICT (guild_id) DO UPDATE SET channel_id = excluded.channel_id, enabled = 1, updated_at = excluded.updated_at`)
            .run(guildId, channelId, this.now());
        return this.confessionConfig(guildId);
    }

    setPanelMessage(guildId, messageId) {
        this.sqlite.prepare('UPDATE confession_configs SET panel_message_id = ?, updated_at = ? WHERE guild_id = ?')
            .run(messageId, this.now(), guildId);
    }

    setConfessionPanel(guildId, channelId, messageId) {
        this.sqlite.transaction(() => {
            this.setConfessionConfig(guildId, channelId);
            this.setPanelMessage(guildId, messageId);
        }).immediate();
        return this.confessionConfig(guildId);
    }

    disableConfessions(guildId) {
        return Boolean(this.sqlite.prepare('UPDATE confession_configs SET enabled = 0, panel_message_id = NULL, updated_at = ? WHERE guild_id = ?')
            .run(this.now(), guildId).changes);
    }

    configureCategory(guildId, action, name, channelId) {
        if (action === 'list') return this.confessionCategories(guildId);
        const normalized = normalizePhrase(name, 50);
        if (action === 'remove') {
            this.sqlite.prepare('DELETE FROM confession_categories WHERE guild_id = ? AND name_key = ?').run(guildId, normalized.key);
            return this.confessionCategories(guildId);
        }
        if (this.confessionCategories(guildId).length >= 24
            && !this.sqlite.prepare('SELECT 1 FROM confession_categories WHERE guild_id = ? AND name_key = ?').get(guildId, normalized.key)) {
            throw new Error('Confession categories are limited to 24 plus General.');
        }
        this.sqlite.prepare(`INSERT INTO confession_categories (guild_id, name, name_key, channel_id, created_at)
            VALUES (?, ?, ?, ?, ?) ON CONFLICT (guild_id, name_key) DO UPDATE SET name = excluded.name, channel_id = excluded.channel_id`)
            .run(guildId, normalized.phrase, normalized.key, channelId, this.now());
        return this.confessionCategories(guildId);
    }

    configureBlacklist(guildId, action, phrase, actorId) {
        if (action === 'clear') this.sqlite.prepare('DELETE FROM confession_blacklist WHERE guild_id = ?').run(guildId);
        if (action === 'add' || action === 'remove') {
            const normalized = normalizePhrase(phrase);
            if (action === 'add') this.sqlite.prepare(`INSERT INTO confession_blacklist (guild_id, phrase, phrase_key, created_by, created_at)
                VALUES (?, ?, ?, ?, ?) ON CONFLICT (guild_id, phrase_key) DO NOTHING`).run(guildId, normalized.phrase, normalized.key, actorId, this.now());
            else this.sqlite.prepare('DELETE FROM confession_blacklist WHERE guild_id = ? AND phrase_key = ?').run(guildId, normalized.key);
        }
        return this.sqlite.prepare('SELECT phrase FROM confession_blacklist WHERE guild_id = ? ORDER BY phrase_key LIMIT 100').all(guildId);
    }

    setConfessionEmojis(guildId, action, up, down) {
        const config = this.confessionConfig(guildId);
        if (!config) throw new Error('Configure confessions first.');
        if (action === 'reset') [up, down] = ['👍', '👎'];
        if (action === 'set') {
            for (const value of [up, down]) {
                if (!value || value.length > 64 || (value !== 'none' && /\s/.test(value))) throw new Error('Each emoji must be one emoji, a custom emoji, or `none`.');
            }
        }
        if (action !== 'view') this.sqlite.prepare('UPDATE confession_configs SET up_emoji = ?, down_emoji = ?, updated_at = ? WHERE guild_id = ?')
            .run(up, down, this.now(), guildId);
        return this.confessionConfig(guildId);
    }

    confessionByNumber(guildId, number) {
        return this.sqlite.prepare('SELECT * FROM confessions WHERE guild_id = ? AND number = ? AND status = ?').get(guildId, number, 'published');
    }

    muteConfessionAuthor(guildId, number, actorId, reason) {
        const confession = this.confessionByNumber(guildId, number);
        if (!confession) throw new Error('That confession was not found.');
        this.sqlite.prepare(`INSERT INTO confession_mutes (guild_id, user_id, muted_by, reason, created_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (guild_id, user_id) DO UPDATE SET muted_by = excluded.muted_by, reason = excluded.reason, created_at = excluded.created_at`)
            .run(guildId, confession.author_id, actorId, reason || null, this.now());
        return confession;
    }

    unmuteConfessionAuthor(guildId, number, all) {
        if (all) return this.sqlite.prepare('DELETE FROM confession_mutes WHERE guild_id = ?').run(guildId).changes;
        const confession = this.confessionByNumber(guildId, number);
        if (!confession) throw new Error('That confession was not found.');
        return this.sqlite.prepare('DELETE FROM confession_mutes WHERE guild_id = ? AND user_id = ?').run(guildId, confession.author_id).changes;
    }

    validateConfessionText(guildId, userId, content, reply = false) {
        const text = String(content || '').trim();
        if (!text || text.length > 2000) throw new Error('Confession text must be between 1 and 2000 characters.');
        if (LINK_PATTERN.test(text)) throw new Error('Links are not allowed in confessions or anonymous replies.');
        if (this.sqlite.prepare('SELECT 1 FROM confession_mutes WHERE guild_id = ? AND user_id = ?').get(guildId, userId)) {
            throw new Error('You are muted from confessions and anonymous replies.');
        }
        const lower = text.toLocaleLowerCase();
        const blocked = this.sqlite.prepare('SELECT phrase FROM confession_blacklist WHERE guild_id = ?').all(guildId)
            .find(row => lower.includes(row.phrase.toLocaleLowerCase()));
        if (blocked) throw new Error('That text contains a blocked phrase.');
        const cutoff = this.now() - 60000;
        const recent = reply
            ? this.sqlite.prepare(`SELECT 1 FROM confession_replies replies
                JOIN confessions ON confessions.id = replies.confession_id
                WHERE confessions.guild_id = ? AND replies.replier_id = ? AND replies.created_at > ? LIMIT 1`).get(guildId, userId, cutoff)
            : this.sqlite.prepare('SELECT 1 FROM confessions WHERE guild_id = ? AND author_id = ? AND created_at > ? LIMIT 1').get(guildId, userId, cutoff);
        if (recent) throw new Error('Please wait 60 seconds before submitting again.');
        return text;
    }

    confessionModal(customId, title = 'Anonymous confession') {
        return new ModalBuilder().setCustomId(customId).setTitle(title).addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('content').setLabel('Message')
                .setStyle(TextInputStyle.Paragraph).setMinLength(1).setMaxLength(2000).setRequired(true))
        );
    }

    async openConfession(interaction, categoryId = 0) {
        const config = this.confessionConfig(interaction.guildId);
        if (!config?.enabled) throw new Error('Confessions are not configured in this server.');
        if (!categoryId) {
            const categories = this.confessionCategories(interaction.guildId);
            if (categories.length) {
                const select = new StringSelectMenuBuilder().setCustomId(`community:cf:c:${interaction.guildId}`)
                    .setPlaceholder('Choose a confession category').addOptions(
                        new StringSelectMenuOptionBuilder().setLabel('General').setValue('0'),
                        ...categories.map(row => new StringSelectMenuOptionBuilder().setLabel(row.name).setValue(String(row.id)))
                    );
                return interaction.reply({ content: 'Choose where to send your anonymous confession.', components: [new ActionRowBuilder().addComponents(select)], flags: [MessageFlags.Ephemeral] });
            }
        }
        return interaction.showModal(this.confessionModal(`community:cf:s:${categoryId || 0}`));
    }

    confessionEmbed(confession, categoryName) {
        return new EmbedBuilder().setColor(0x8b5cf6).setTitle(`Anonymous Confession #${confession.number}`)
            .setDescription(confession.content).setFooter({ text: categoryName || 'General' }).setTimestamp(confession.created_at);
    }

    async submitConfession(interaction, categoryId) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const prior = this.confessionSubmissions.get(interaction.guildId) || Promise.resolve();
        // ponytail: per-guild serialization keeps public numbering gap-free; add a distributed lock only for multi-process deployment.
        const submission = prior.catch(() => null).then(() => this.publishConfession(interaction, categoryId));
        this.confessionSubmissions.set(interaction.guildId, submission);
        try {
            return await submission;
        } finally {
            if (this.confessionSubmissions.get(interaction.guildId) === submission) this.confessionSubmissions.delete(interaction.guildId);
        }
    }

    async publishConfession(interaction, categoryId) {
        const config = this.confessionConfig(interaction.guildId);
        if (!config?.enabled) throw new Error('Confessions are not configured in this server.');
        const content = this.validateConfessionText(interaction.guildId, interaction.user.id, interaction.fields.getTextInputValue('content'));
        const category = categoryId ? this.sqlite.prepare('SELECT * FROM confession_categories WHERE id = ? AND guild_id = ?').get(categoryId, interaction.guildId) : null;
        if (categoryId && !category) throw new Error('That confession category no longer exists.');
        const channelId = category?.channel_id || config.channel_id;
        const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased()) throw new Error('The confession channel is unavailable.');
        const row = this.sqlite.transaction(() => {
            const current = this.confessionConfig(interaction.guildId);
            if (!current?.enabled) throw new Error('Confessions were disabled.');
            this.sqlite.prepare('UPDATE confession_configs SET next_number = next_number + 1, updated_at = ? WHERE guild_id = ?').run(this.now(), interaction.guildId);
            return this.sqlite.prepare(`INSERT INTO confessions (guild_id, number, category_id, channel_id, author_id, content, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`).get(interaction.guildId, current.next_number, category?.id || null, channelId, interaction.user.id, content, this.now());
        }).immediate();
        let message;
        try {
            const controls = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`community:cf:r:${row.id}`).setLabel('Anonymous reply').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`community:cf:g:${row.id}`).setLabel('Report').setStyle(ButtonStyle.Danger)
            );
            message = await channel.send({ embeds: [this.confessionEmbed(row, category?.name)], components: [controls], allowedMentions: SAFE_MENTIONS });
            this.sqlite.prepare("UPDATE confessions SET message_id = ?, status = 'published' WHERE id = ?").run(message.id, row.id);
            for (const emoji of [config.up_emoji, config.down_emoji]) if (emoji !== 'none') await message.react(emoji).catch(() => null);
        } catch (error) {
            if (message) await message.delete().catch(() => null);
            this.sqlite.transaction(() => {
                this.sqlite.prepare('DELETE FROM confessions WHERE id = ?').run(row.id);
                this.sqlite.prepare('UPDATE confession_configs SET next_number = next_number - 1 WHERE guild_id = ? AND next_number = ?')
                    .run(interaction.guildId, row.number + 1);
            }).immediate();
            throw error;
        }
        return interaction.editReply({ content: `Confession #${row.number} was posted anonymously.`, allowedMentions: SAFE_MENTIONS });
    }

    async submitAnonymousReply(interaction, confessionId) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const confession = this.sqlite.prepare("SELECT * FROM confessions WHERE id = ? AND guild_id = ? AND status = 'published'").get(confessionId, interaction.guildId);
        if (!confession || confession.message_id !== interaction.message?.id && interaction.message) throw new Error('That confession is no longer available.');
        const content = this.validateConfessionText(interaction.guildId, interaction.user.id, interaction.fields.getTextInputValue('content'), true);
        const result = this.sqlite.prepare(`INSERT INTO confession_replies (confession_id, replier_id, content, created_at)
            VALUES (?, ?, ?, ?) RETURNING id`).get(confession.id, interaction.user.id, content, this.now());
        const author = await this.client.users.fetch(confession.author_id).catch(() => null);
        const delivered = author && await author.send({
            embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle(`Anonymous reply to confession #${confession.number}`).setDescription(content)],
            allowedMentions: SAFE_MENTIONS
        }).then(() => true).catch(() => false);
        this.sqlite.prepare('UPDATE confession_replies SET delivered = ? WHERE id = ?').run(Number(Boolean(delivered)), result.id);
        if (!delivered) throw new Error('The author could not receive the anonymous reply.');
        return interaction.editReply({ content: 'Your reply was delivered anonymously.' });
    }

    submitConfessionReport(interaction, confessionId) {
        const confession = this.sqlite.prepare("SELECT * FROM confessions WHERE id = ? AND guild_id = ? AND status = 'published'").get(confessionId, interaction.guildId);
        if (!confession) throw new Error('That confession is no longer available.');
        const reason = normalizePhrase(interaction.fields.getTextInputValue('reason'), 500).phrase;
        this.sqlite.transaction(() => {
            const duplicate = this.sqlite.prepare(`SELECT 1 FROM moderation_logs
                WHERE guild_id = ? AND executor_id = ? AND action = 'CONFESSION_REPORT' AND reason LIKE ? LIMIT 1`)
                .get(interaction.guildId, interaction.user.id, `Confession #${confession.number}: %`);
            if (duplicate) throw new Error('You have already reported this confession.');
            this.sqlite.prepare(`INSERT INTO moderation_logs (guild_id, target_id, executor_id, action, reason, timestamp)
                VALUES (?, ?, ?, 'CONFESSION_REPORT', ?, ?)`).run(interaction.guildId, confession.author_id, interaction.user.id, `Confession #${confession.number}: ${reason}`, this.now());
        }).immediate();
        const logId = this.sqlite.prepare('SELECT log_channel_id FROM moderation_config WHERE guild_id = ?').get(interaction.guildId)?.log_channel_id;
        if (logId) interaction.guild.channels.fetch(logId).then(channel => channel?.send({
            embeds: [new EmbedBuilder().setColor(0xef4444).setTitle(`Confession #${confession.number} reported`)
                .setDescription(reason).addFields({ name: 'Reporter', value: `<@${interaction.user.id}>` }, { name: 'Attributed author', value: `<@${confession.author_id}>` })],
            allowedMentions: SAFE_MENTIONS
        })).catch(() => null);
        return interaction.reply({ content: 'The confession was reported to the server moderators.', flags: [MessageFlags.Ephemeral] });
    }

    panelPayload(guildId) {
        return {
            embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle('Anonymous Confessions')
                .setDescription('Share a confession without exposing your identity publicly. Links and blocked phrases are rejected.')],
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`community:cf:o:${guildId}`)
                .setLabel('Submit confession').setStyle(ButtonStyle.Primary))],
            allowedMentions: SAFE_MENTIONS
        };
    }

    pollCounts(poll) {
        const counts = Array(poll.options.length).fill(0);
        for (const row of this.sqlite.prepare('SELECT option_index, COUNT(*) AS count FROM community_poll_votes WHERE poll_id = ? GROUP BY option_index').all(poll.id)) {
            if (row.option_index < counts.length) counts[row.option_index] = row.count;
        }
        return counts;
    }

    pollPayload(poll, ended = poll.status !== 'active') {
        const counts = this.pollCounts(poll);
        const total = counts.reduce((sum, value) => sum + value, 0);
        const description = poll.options.map((option, index) => `**${index + 1}. ${option}** — ${counts[index]} vote${counts[index] === 1 ? '' : 's'}`).join('\n');
        const embed = new EmbedBuilder().setColor(ended ? 0x64748b : 0x8b5cf6).setTitle('Poll').setDescription(`**${poll.question}**\n\n${description}`)
            .setFooter({ text: `${total} vote${total === 1 ? '' : 's'}${ended ? ' • Poll ended' : poll.ends_at ? ' • Timed poll' : ' • Quick poll'}` });
        if (poll.ends_at && !ended) embed.setTimestamp(poll.ends_at);
        const buttons = poll.options.map((option, index) => new ButtonBuilder().setCustomId(`community:poll:${poll.id}:${index}`)
            .setLabel(`${index + 1}. ${option}`.slice(0, 80)).setStyle(ButtonStyle.Secondary).setDisabled(ended));
        const rows = [];
        while (buttons.length) rows.push(new ActionRowBuilder().addComponents(buttons.splice(0, 5)));
        return { embeds: [embed], components: rows, allowedMentions: SAFE_MENTIONS };
    }

    async createPoll(interaction, question, options, duration) {
        const cleanQuestion = String(question || '').trim();
        if (!cleanQuestion || cleanQuestion.length > 300) throw new Error('Poll questions must be between 1 and 300 characters.');
        const values = Array.isArray(options) ? options : parsePollOptions(options);
        const durationMs = duration == null ? null : parsePollDuration(duration);
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const row = this.sqlite.prepare(`INSERT INTO community_polls (guild_id, channel_id, creator_id, question, options_json, ends_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`).get(interaction.guildId, interaction.channelId, interaction.user.id, cleanQuestion,
            JSON.stringify(values), durationMs == null ? null : this.now() + durationMs, this.now());
        const poll = pollFromRow(row);
        let message;
        try {
            message = await interaction.channel.send(this.pollPayload({ ...poll, status: 'active' }));
            this.sqlite.prepare("UPDATE community_polls SET message_id = ?, status = 'active' WHERE id = ?").run(message.id, poll.id);
        } catch (error) {
            if (message) await message.delete().catch(() => null);
            this.sqlite.prepare('DELETE FROM community_polls WHERE id = ?').run(poll.id);
            throw error;
        }
        const published = pollFromRow(this.sqlite.prepare('SELECT * FROM community_polls WHERE id = ?').get(poll.id));
        await interaction.editReply({ content: `Poll created: ${message.url}`, allowedMentions: SAFE_MENTIONS });
        return published;
    }

    getPollByMessage(guildId, messageId) {
        return pollFromRow(this.sqlite.prepare('SELECT * FROM community_polls WHERE guild_id = ? AND message_id = ?').get(guildId, messageId));
    }

    async vote(interaction, pollId, optionIndex) {
        if (!interaction.member || interaction.user.bot) throw new Error('Only current server members can vote.');
        let poll;
        try {
            poll = this.sqlite.transaction(() => {
                const current = pollFromRow(this.sqlite.prepare('SELECT * FROM community_polls WHERE id = ?').get(pollId));
                if (!current || current.status !== 'active' || current.guild_id !== interaction.guildId || current.channel_id !== interaction.channelId
                    || current.message_id !== interaction.message?.id) throw new Error('This poll control is stale or does not belong to this message.');
                if (current.ends_at && current.ends_at <= this.now()) throw new Error('This poll has ended.');
                if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= current.options.length) throw new Error('That poll option does not exist.');
                this.sqlite.prepare('INSERT INTO community_poll_votes (poll_id, user_id, option_index, created_at) VALUES (?, ?, ?, ?)')
                    .run(current.id, interaction.user.id, optionIndex, this.now());
                return current;
            }).immediate();
        } catch (error) {
            if (String(error.code).startsWith('SQLITE_CONSTRAINT')) throw new Error('You have already voted in this poll.');
            throw error;
        }
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const updated = pollFromRow(this.sqlite.prepare('SELECT * FROM community_polls WHERE id = ?').get(poll.id));
        await interaction.message.edit(this.pollPayload(updated)).catch(() => null);
        return interaction.editReply({ content: `Vote recorded for **${poll.options[optionIndex]}**.`, allowedMentions: SAFE_MENTIONS });
    }

    async finishPoll(id) {
        const claim = this.sqlite.transaction(() => {
            const row = this.sqlite.prepare("UPDATE community_polls SET status = 'ending' WHERE id = ? AND status = 'active' RETURNING *").get(id);
            return { claimed: Boolean(row), poll: pollFromRow(row || this.sqlite.prepare('SELECT * FROM community_polls WHERE id = ?').get(id)) };
        }).immediate();
        const poll = claim.poll;
        if (!poll) throw new Error('Poll not found.');
        if (poll.status === 'ended') return poll;
        if (!claim.claimed) throw new Error('Poll ending is already in progress.');
        if (poll.status !== 'ending') throw new Error('Poll is not active.');
        try {
            const guild = await this.client.guilds.fetch(poll.guild_id);
            const channel = await guild.channels.fetch(poll.channel_id);
            const message = await channel.messages.fetch(poll.message_id);
            const ended = { ...poll, status: 'ended' };
            await message.edit(this.pollPayload(ended, true));
            this.sqlite.prepare("UPDATE community_polls SET status = 'ended', ended_at = ? WHERE id = ? AND status = 'ending'").run(this.now(), id);
            return pollFromRow(this.sqlite.prepare('SELECT * FROM community_polls WHERE id = ?').get(id));
        } catch (error) {
            this.sqlite.prepare("UPDATE community_polls SET status = 'active' WHERE id = ? AND status = 'ending'").run(id);
            throw error;
        }
    }

    async runDuePolls() {
        if (this.running) return;
        this.running = true;
        try {
            const due = this.sqlite.prepare("SELECT id FROM community_polls WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at <= ? ORDER BY ends_at LIMIT 25").all(this.now());
            for (const row of due) await this.finishPoll(row.id).catch(error => logger.warn(`Could not finish poll ${row.id}: ${error.message}`));
        } finally {
            this.running = false;
        }
    }

    async endPoll(interaction, messageTarget) {
        const parsed = messageIdFrom(messageTarget);
        if (parsed.guildId && parsed.guildId !== interaction.guildId) throw new Error('The poll must be in this server.');
        const poll = this.getPollByMessage(interaction.guildId, parsed.messageId);
        if (!poll) throw new Error('That active ByteBot poll was not found.');
        if (parsed.channelId && parsed.channelId !== poll.channel_id) throw new Error('That message link does not match the poll channel.');
        if (poll.creator_id !== interaction.user.id) {
            const channel = await interaction.guild.channels.fetch(poll.channel_id).catch(() => null);
            if (!channel || !interaction.member?.permissionsIn(channel)?.has(PermissionFlagsBits.ManageMessages)) {
                throw new Error('Only the poll creator or a moderator in the poll channel can end this poll.');
            }
        }
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const ended = await this.finishPoll(poll.id);
        return interaction.editReply({ content: `Poll ended with ${this.pollCounts(ended).reduce((sum, count) => sum + count, 0)} votes.` });
    }

    isImageOnly(guildId, channelId) {
        return Boolean(this.sqlite.prepare('SELECT 1 FROM image_only_channels WHERE guild_id = ? AND channel_id = ?').get(guildId, channelId));
    }

    setImageOnly(guildId, channelId, enabled, actorId) {
        if (enabled) this.sqlite.prepare(`INSERT INTO image_only_channels (guild_id, channel_id, created_by, created_at) VALUES (?, ?, ?, ?)
            ON CONFLICT (guild_id, channel_id) DO UPDATE SET created_by = excluded.created_by, created_at = excluded.created_at`)
            .run(guildId, channelId, actorId, this.now());
        else this.sqlite.prepare('DELETE FROM image_only_channels WHERE guild_id = ? AND channel_id = ?').run(guildId, channelId);
        return enabled;
    }

    async handleMessage(message) {
        if (!message.guild || message.system || message.author?.bot || message.webhookId || !this.isImageOnly(message.guild.id, message.channel.id)) return false;
        if (message.member?.permissionsIn(message.channel)?.has(PermissionFlagsBits.ManageMessages)) return false;
        if (message.attachments?.size) return false;
        await message.delete();
        return true;
    }

    async resolveMessage(interaction, target) {
        const parsed = messageIdFrom(target);
        if (parsed.guildId && parsed.guildId !== interaction.guildId) throw new Error('The message must be in this server.');
        const channel = parsed.channelId ? await interaction.guild.channels.fetch(parsed.channelId).catch(() => null) : interaction.channel;
        if (!channel?.isTextBased()) throw new Error('The message channel is unavailable.');
        const permissions = interaction.member?.permissionsIn(channel);
        if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) {
            throw new Error(`You need View Channel and Read Message History in ${channel}.`);
        }
        if (!interaction.guild.members.me.permissionsIn(channel).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) {
            throw new Error(`I need View Channel and Read Message History in ${channel}.`);
        }
        const message = await channel.messages.fetch(parsed.messageId).catch(() => null);
        if (!message) throw new Error('The message was not found.');
        return message;
    }

    choose(values) {
        const options = String(values || '').split(',').map(value => value.trim()).filter(Boolean);
        if (options.length < 2 || options.length > 100) throw new Error('Provide between 2 and 100 comma-separated choices.');
        return options[this.randomInt(options.length)];
    }

    async randomMember(guild) {
        if (guild.members.cache.size < guild.memberCount) {
            let refresh = this.memberRefreshes.get(guild.id);
            if (!refresh || refresh.expiresAt <= this.now()) {
                // ponytail: one full refresh per guild per five minutes; revisit only if Discord stops returning a complete member fetch.
                refresh = { expiresAt: this.now() + 300000 };
                refresh.promise = guild.members.fetch().catch(error => {
                    if (this.memberRefreshes.get(guild.id) === refresh) this.memberRefreshes.delete(guild.id);
                    throw error;
                });
                this.memberRefreshes.set(guild.id, refresh);
            }
            await refresh.promise;
        }
        const members = [...guild.members.cache.values()].filter(member => !member.user.bot);
        if (!members.length) throw new Error('This server has no eligible non-bot members.');
        return members[this.randomInt(members.length)];
    }

    async quoteImage(message) {
        if (!message.content?.trim()) throw new Error('The quoted message must contain text.');
        const lines = wrapText(message.content);
        const height = Math.max(360, 250 + lines.length * 48);
        let avatar = null;
        try {
            const url = new URL(message.author.displayAvatarURL({ extension: 'png', size: 128 }));
            if (url.hostname !== 'cdn.discordapp.com') throw new Error('Unexpected avatar host');
            const response = await axios.get(url.href, { responseType: 'arraybuffer', timeout: 3000, maxContentLength: 2_000_000 });
            avatar = Buffer.from(response.data).toString('base64');
        } catch { /* neutral avatar below */ }
        const body = lines.map((line, index) => `<text x="72" y="${230 + index * 48}" font-size="36" fill="#f8fafc">${escapeXml(line)}</text>`).join('');
        const avatarMarkup = avatar
            ? `<clipPath id="avatar"><circle cx="112" cy="104" r="56"/></clipPath><image href="data:image/png;base64,${avatar}" x="56" y="48" width="112" height="112" clip-path="url(#avatar)" preserveAspectRatio="xMidYMid slice"/>`
            : '<circle cx="112" cy="104" r="56" fill="#64748b"/><circle cx="112" cy="92" r="18" fill="#cbd5e1"/><path d="M78 137c8-28 60-28 68 0" fill="#cbd5e1"/>';
        const svg = `<svg width="1200" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="${height}" rx="28" fill="#111827"/>${avatarMarkup}<text x="190" y="96" font-size="40" font-weight="700" fill="#f8fafc">${escapeXml(message.member?.displayName || message.author.displayName || message.author.username)}</text><text x="190" y="140" font-size="25" fill="#94a3b8">${escapeXml(new Date(message.createdTimestamp).toISOString())}</text>${body}</svg>`;
        return new AttachmentBuilder(await sharp(Buffer.from(svg)).png().toBuffer(), { name: `quote-${message.id}.png` });
    }

    async handleInteraction(interaction) {
        const parts = interaction.customId.split(':');
        try {
            if (parts[1] === 'poll') return await this.vote(interaction, Number(parts[2]), Number(parts[3]));
            if (parts[1] !== 'cf') return;
            const action = parts[2];
            const id = Number(parts[3]);
            if (action === 'o') {
                if (this.confessionConfig(interaction.guildId)?.panel_message_id !== interaction.message?.id) throw new Error('That confession panel is stale.');
                return await this.openConfession(interaction);
            }
            if (action === 'c') return interaction.showModal(this.confessionModal(`community:cf:s:${interaction.values[0]}`));
            if (action === 's') return await this.submitConfession(interaction, id);
            if (action === 'r') return interaction.showModal(this.confessionModal(`community:cf:rs:${id}`, 'Anonymous reply'));
            if (action === 'rs') return await this.submitAnonymousReply(interaction, id);
            if (action === 'g') {
                const modal = new ModalBuilder().setCustomId(`community:cf:gs:${id}`).setTitle('Report confession').addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason')
                        .setStyle(TextInputStyle.Paragraph).setMinLength(1).setMaxLength(500).setRequired(true))
                );
                return interaction.showModal(modal);
            }
            if (action === 'gs') return this.submitConfessionReport(interaction, id);
        } catch (error) {
            const response = { content: error.message || 'That community action failed.', flags: [MessageFlags.Ephemeral], allowedMentions: SAFE_MENTIONS };
            if (interaction.deferred) return interaction.editReply({ content: response.content, allowedMentions: SAFE_MENTIONS }).catch(() => null);
            if (interaction.replied) return interaction.followUp(response).catch(() => null);
            return interaction.reply(response).catch(() => null);
        }
    }

    purgeGuild(guildId) {
        this.memberRefreshes.delete(guildId);
        this.confessionSubmissions.delete(guildId);
        this.sqlite.transaction(() => {
            const pollIds = this.sqlite.prepare('SELECT id FROM community_polls WHERE guild_id = ?').all(guildId).map(row => row.id);
            if (pollIds.length) this.sqlite.prepare(`DELETE FROM community_poll_votes WHERE poll_id IN (${pollIds.map(() => '?').join(',')})`).run(...pollIds);
            const confessionIds = this.sqlite.prepare('SELECT id FROM confessions WHERE guild_id = ?').all(guildId).map(row => row.id);
            if (confessionIds.length) this.sqlite.prepare(`DELETE FROM confession_replies WHERE confession_id IN (${confessionIds.map(() => '?').join(',')})`).run(...confessionIds);
            for (const table of ['community_polls', 'confessions', 'confession_categories', 'confession_blacklist', 'confession_mutes', 'confession_configs', 'image_only_channels']) {
                this.sqlite.prepare(`DELETE FROM ${table} WHERE guild_id = ?`).run(guildId);
            }
        }).immediate();
    }
}

module.exports = {
    CommunityUtilityService, messageIdFrom, parsePollDuration, parsePollOptions, wrapText
};
