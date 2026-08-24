const crypto = require('crypto');
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, EmbedBuilder,
    MessageFlags, PermissionFlagsBits, StringSelectMenuBuilder
} = require('discord.js');

const MODULES = [
    'messages', 'members', 'moderation', 'server', 'voice', 'channels',
    'roles', 'invites', 'emojis', 'stickers', 'integrations', 'soundboard'
];
const ALIASES = Object.fromEntries(MODULES.flatMap(name => [[name, name], [name.replace(/s$/, ''), name]]));

class EventLoggingService {
    constructor({ sqlite, client, now = Date.now }) {
        this.sqlite = sqlite;
        this.client = client;
        this.now = now;
        this.pending = new Map();
        this.confirmations = new Map();
    }

    module(value) {
        const normalized = ALIASES[String(value || '').toLowerCase()];
        if (!normalized) throw new Error('Choose a valid logging module.');
        return normalized;
    }

    preflight(guild, channel) {
        if (!channel?.send || !guild.members.me.permissionsIn(channel).has([
            PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks
        ])) throw new Error('I need View Channel, Send Messages, and Embed Links in that log channel.');
    }

    add(guild, channel, module) {
        module = this.module(module);
        this.preflight(guild, channel);
        if (module === 'moderation' && !guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
            throw new Error('I need View Audit Log for moderation event logs.');
        }
        const exists = this.sqlite.prepare(`
            SELECT 1 FROM event_log_channels WHERE guild_id = ? AND module = ? AND channel_id = ?
        `).get(guild.id, module, channel.id);
        const count = this.sqlite.prepare(`
            SELECT COUNT(DISTINCT channel_id) AS count FROM event_log_channels WHERE guild_id = ?
        `).get(guild.id).count;
        const channelKnown = this.sqlite.prepare(`
            SELECT 1 FROM event_log_channels WHERE guild_id = ? AND channel_id = ? LIMIT 1
        `).get(guild.id, channel.id);
        if (!exists && !channelKnown && count >= 15) throw new Error('A server can configure at most 15 logging channels.');
        this.sqlite.prepare(`
            INSERT OR IGNORE INTO event_log_channels (guild_id, module, channel_id, created_at)
            VALUES (?, ?, ?, ?)
        `).run(guild.id, module, channel.id, this.now());
        return !exists;
    }

    selector(actorId) {
        return [
            new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder()
                .setCustomId(`eventlogs:add:channel:${actorId}`).setPlaceholder('Choose a log channel')),
            new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
                .setCustomId(`eventlogs:add:module:${actorId}`).setPlaceholder('Choose an event module')
                .addOptions(MODULES.map(value => ({ label: value, value }))))
        ];
    }

    async execute(interaction) {
        const action = interaction.options.getSubcommand();
        if (action !== 'view' && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            throw new Error('You need Manage Server to configure event logs.');
        }
        if (action === 'view') {
            const rows = this.sqlite.prepare(`
                SELECT module, channel_id, color FROM event_log_channels
                WHERE guild_id = ? ORDER BY module, channel_id
            `).all(interaction.guildId);
            const content = rows.length
                ? rows.map(row => {
                    const channel = interaction.guild.channels.cache.get(row.channel_id);
                    const visible = channel && interaction.member.permissionsIn(channel).has(PermissionFlagsBits.ViewChannel);
                    return `**${row.module}** → ${visible ? `<#${row.channel_id}>` : '*inaccessible channel*'}${row.color ? ` · ${row.color}` : ''}`;
                }).join('\n')
                : 'No event log destinations are configured.';
            return interaction.reply({
                content, flags: interaction.options.getBoolean('private') ? [MessageFlags.Ephemeral] : [], allowedMentions: { parse: [] }
            });
        }
        if (action === 'add') {
            const channel = interaction.options.getChannel('channel');
            const module = interaction.options.getString('module');
            if (Boolean(channel) !== Boolean(module)) throw new Error('Choose both a channel and module, or leave both empty for interactive setup.');
            if (!channel) {
                this.pending.set(`${interaction.guildId}:${interaction.user.id}`, { expiresAt: this.now() + 10 * 60 * 1000 });
                return interaction.reply({
                    content: 'Choose a log channel and event module.', components: this.selector(interaction.user.id),
                    flags: [MessageFlags.Ephemeral], allowedMentions: { parse: [] }
                });
            }
            this.add(interaction.guild, channel, module);
            return interaction.reply({
                content: `Added **${this.module(module)}** logs in <#${channel.id}>.`,
                flags: [MessageFlags.Ephemeral], allowedMentions: { parse: [] }
            });
        }
        if (action === 'remove') {
            const channel = interaction.options.getChannel('channel');
            const rawModule = interaction.options.getString('module');
            if (!channel && !rawModule) {
                const token = crypto.randomBytes(8).toString('hex');
                this.confirmations.set(token, {
                    guildId: interaction.guildId, actorId: interaction.user.id, expiresAt: this.now() + 10 * 60 * 1000
                });
                return interaction.reply({
                    content: 'Remove all event log destinations from this server?',
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`eventlogs:confirm:${token}`).setLabel('Remove All Logs').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId(`eventlogs:cancel:${token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                    )], flags: [MessageFlags.Ephemeral], allowedMentions: { parse: [] }
                });
            }
            const clauses = ['guild_id = ?'];
            const values = [interaction.guildId];
            if (channel) { clauses.push('channel_id = ?'); values.push(channel.id); }
            if (rawModule) { clauses.push('module = ?'); values.push(this.module(rawModule)); }
            const removed = this.sqlite.prepare(`DELETE FROM event_log_channels WHERE ${clauses.join(' AND ')}`).run(...values).changes;
            return interaction.reply({
                content: `Removed **${removed}** event log destination${removed === 1 ? '' : 's'}.`,
                flags: [MessageFlags.Ephemeral], allowedMentions: { parse: [] }
            });
        }
        if (action === 'color') {
            const channel = interaction.options.getChannel('channel', true);
            const module = this.module(interaction.options.getString('module', true));
            const input = interaction.options.getString('hex', true).toUpperCase();
            const color = input.startsWith('#') ? input : `#${input}`;
            if (!/^#[0-9A-F]{6}$/.test(color)) throw new Error('Use a six-digit hex color.');
            this.preflight(interaction.guild, channel);
            const changed = this.sqlite.prepare(`
                UPDATE event_log_channels SET color = ? WHERE guild_id = ? AND module = ? AND channel_id = ?
            `).run(color, interaction.guildId, module, channel.id).changes;
            if (!changed) throw new Error('That logging destination is not configured.');
            return interaction.reply({
                content: `Set **${module}** logs in <#${channel.id}> to **${color}**.`,
                flags: [MessageFlags.Ephemeral], allowedMentions: { parse: [] }
            });
        }
        if (action === 'ignore') {
            const member = interaction.options.getUser('member');
            const channel = interaction.options.getChannel('channel');
            if (Boolean(member) === Boolean(channel)) throw new Error('Choose exactly one member or channel.');
            const type = member ? 'member' : 'channel';
            const target = member || channel;
            const exists = this.sqlite.prepare(`
                SELECT 1 FROM event_log_ignores WHERE guild_id = ? AND target_type = ? AND target_id = ?
            `).get(interaction.guildId, type, target.id);
            if (exists) this.sqlite.prepare(`DELETE FROM event_log_ignores WHERE guild_id = ? AND target_type = ? AND target_id = ?`)
                .run(interaction.guildId, type, target.id);
            else this.sqlite.prepare(`INSERT INTO event_log_ignores (guild_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)`)
                .run(interaction.guildId, type, target.id, this.now());
            const rows = this.sqlite.prepare(`SELECT target_type, target_id FROM event_log_ignores WHERE guild_id = ? ORDER BY target_type, target_id`)
                .all(interaction.guildId);
            return interaction.reply({
                content: `${type === 'member' ? `<@${target.id}>` : `<#${target.id}>`} is ${exists ? 'no longer' : 'now'} ignored.\n${rows.length ? rows.map(row => row.target_type === 'member' ? `<@${row.target_id}>` : `<#${row.target_id}>`).join(', ') : '*None*'}`,
                flags: [MessageFlags.Ephemeral], allowedMentions: { parse: [] }
            });
        }
    }

    async handleInteraction(interaction) {
        if (interaction.customId.startsWith('eventlogs:confirm:') || interaction.customId.startsWith('eventlogs:cancel:')) {
            const [, decision, token] = interaction.customId.split(':');
            const confirmation = this.confirmations.get(token);
            this.confirmations.delete(token);
            if (!confirmation || confirmation.expiresAt < this.now()
                || confirmation.guildId !== interaction.guildId || confirmation.actorId !== interaction.user.id) {
                throw new Error('That confirmation has expired or is not yours.');
            }
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) throw new Error('You need Manage Server.');
            if (decision === 'confirm') this.sqlite.prepare(`DELETE FROM event_log_channels WHERE guild_id = ?`).run(interaction.guildId);
            return interaction.update({ content: decision === 'confirm' ? 'Removed all event log destinations.' : 'Removal cancelled.', components: [], allowedMentions: { parse: [] } });
        }
        const [, action, field, actorId] = interaction.customId.split(':');
        const key = `${interaction.guildId}:${interaction.user.id}`;
        const pending = this.pending.get(key);
        if (action !== 'add' || actorId !== interaction.user.id || !pending || pending.expiresAt < this.now()) {
            throw new Error('That event-log setup has expired or is not yours.');
        }
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) throw new Error('You need Manage Server.');
        if (field === 'channel') pending.channel = interaction.channels.first();
        else pending.module = this.module(interaction.values[0]);
        if (!pending.channel || !pending.module) return interaction.update({
            content: 'Choose a log channel and event module.', components: this.selector(actorId), allowedMentions: { parse: [] }
        });
        this.add(interaction.guild, pending.channel, pending.module);
        this.pending.delete(key);
        return interaction.update({
            content: `Added **${pending.module}** logs in <#${pending.channel.id}>.`, components: [], allowedMentions: { parse: [] }
        });
    }

    async log(guild, module, eventKey, { title, description, actorId = null, channelId = null } = {}) {
        if (!guild?.id || !eventKey) return 0;
        module = this.module(module);
        const ignored = this.sqlite.prepare(`
            SELECT 1 FROM event_log_ignores WHERE guild_id = ? AND (
                (target_type = 'member' AND target_id = ?) OR (target_type = 'channel' AND target_id = ?)
            ) LIMIT 1
        `).get(guild.id, actorId, channelId);
        if (ignored) return 0;
        const now = this.now();
        const rows = this.sqlite.prepare(`SELECT channel_id, color FROM event_log_channels WHERE guild_id = ? AND module = ?`)
            .all(guild.id, module);
        for (const row of rows) this.sqlite.prepare(`
            INSERT OR IGNORE INTO event_log_outbox
                (guild_id, event_key, channel_id, module, payload, attempts, next_attempt_at, status, created_at)
            VALUES (?, ?, ?, ?, ?, 0, ?, 'pending', ?)
        `).run(guild.id, eventKey, row.channel_id, module, JSON.stringify({
            title: String(title || `${module} event`).slice(0, 256),
            description: String(description || 'No details available.').slice(0, 4096), color: row.color || '#5865F2'
        }), now, now);
        await this.processOutbox();
        return rows.length;
    }

    async processOutbox(limit = 50) {
        const rows = this.sqlite.prepare(`
            SELECT * FROM event_log_outbox WHERE status = 'pending' AND next_attempt_at <= ?
            ORDER BY id LIMIT ?
        `).all(this.now(), limit);
        for (const row of rows) {
            try {
                const guild = this.client.guilds.cache.get(row.guild_id);
                const channel = guild?.channels.cache.get(row.channel_id)
                    || await guild?.channels.fetch(row.channel_id).catch(() => null);
                if (!channel?.send) throw new Error('channel unavailable');
                const payload = JSON.parse(row.payload);
                await channel.send({
                    embeds: [new EmbedBuilder().setColor(payload.color).setTitle(payload.title).setDescription(payload.description).setTimestamp()],
                    allowedMentions: { parse: [] }
                });
                this.sqlite.prepare(`UPDATE event_log_outbox SET status = 'sent', attempts = attempts + 1 WHERE id = ?`).run(row.id);
            } catch {
                const attempts = row.attempts + 1;
                this.sqlite.prepare(`UPDATE event_log_outbox SET attempts = ?, status = ?, next_attempt_at = ? WHERE id = ?`)
                    .run(attempts, attempts >= 3 ? 'failed' : 'pending', this.now() + 1000 * 2 ** (attempts - 1), row.id);
            }
        }
        return rows.length;
    }
}

module.exports = EventLoggingService;
module.exports.MODULES = MODULES;
