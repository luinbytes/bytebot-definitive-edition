const crypto = require('crypto');
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder,
    MessageFlags, PermissionFlagsBits, StringSelectMenuBuilder
} = require('discord.js');
const config = require('../utils/config');
const embeds = require('../utils/embeds');

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
        this.sqlite.prepare(`UPDATE event_log_outbox SET status = 'sent' WHERE status = 'sending'`).run();
    }

    module(value) {
        const normalized = ALIASES[String(value || '').toLowerCase()];
        if (!normalized) throw new Error('Choose a valid logging module.');
        return normalized;
    }

    response(title, description, extra = {}) {
        return { embeds: [embeds.brand(title, description)], allowedMentions: { parse: [] }, ...extra };
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
            return interaction.reply(this.response('Event Logs', content, {
                flags: interaction.options.getBoolean('private') ? [MessageFlags.Ephemeral] : []
            }));
        }
        if (action === 'add') {
            const channel = interaction.options.getChannel('channel');
            const module = interaction.options.getString('module');
            if (Boolean(channel) !== Boolean(module)) throw new Error('Choose both a channel and module, or leave both empty for interactive setup.');
            if (!channel) {
                this.pending.set(`${interaction.guildId}:${interaction.user.id}`, { expiresAt: this.now() + 10 * 60 * 1000 });
                return interaction.reply(this.response('Add Event Log', 'Choose a log channel and event module.', {
                    components: this.selector(interaction.user.id), flags: [MessageFlags.Ephemeral]
                }));
            }
            this.add(interaction.guild, channel, module);
            return interaction.reply(this.response('Event Log Added', `Added **${this.module(module)}** logs in <#${channel.id}>.`, {
                flags: [MessageFlags.Ephemeral]
            }));
        }
        if (action === 'remove') {
            const channel = interaction.options.getChannel('channel');
            const rawModule = interaction.options.getString('module');
            if (!channel && !rawModule) {
                for (const [key, value] of this.confirmations) {
                    if (value.expiresAt < this.now()
                        || (value.guildId === interaction.guildId && value.actorId === interaction.user.id)) {
                        this.confirmations.delete(key);
                    }
                }
                const token = crypto.randomBytes(8).toString('hex');
                const plan = this.sqlite.prepare(`
                    SELECT module, channel_id FROM event_log_channels
                    WHERE guild_id = ? ORDER BY module, channel_id
                `).all(interaction.guildId);
                this.confirmations.set(token, {
                    guildId: interaction.guildId, actorId: interaction.user.id,
                    plan, expiresAt: this.now() + 10 * 60 * 1000
                });
                return interaction.reply(this.response('Remove Event Logs', 'Remove all event log destinations from this server?', {
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`eventlogs:confirm:${token}`).setLabel('Remove All Logs').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId(`eventlogs:cancel:${token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                    )], flags: [MessageFlags.Ephemeral]
                }));
            }
            const clauses = ['guild_id = ?'];
            const values = [interaction.guildId];
            if (channel) { clauses.push('channel_id = ?'); values.push(channel.id); }
            if (rawModule) { clauses.push('module = ?'); values.push(this.module(rawModule)); }
            const removed = this.sqlite.prepare(`DELETE FROM event_log_channels WHERE ${clauses.join(' AND ')}`).run(...values).changes;
            return interaction.reply(this.response('Event Logs Removed', `Removed **${removed}** event log destination${removed === 1 ? '' : 's'}.`, {
                flags: [MessageFlags.Ephemeral]
            }));
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
            return interaction.reply(this.response('Event Log Color', `Set **${module}** logs in <#${channel.id}> to **${color}**.`, {
                flags: [MessageFlags.Ephemeral]
            }));
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
            return interaction.reply(this.response('Event Log Ignores', `${type === 'member' ? `<@${target.id}>` : `<#${target.id}>`} is ${exists ? 'no longer' : 'now'} ignored.\n${rows.length ? rows.map(row => row.target_type === 'member' ? `<@${row.target_id}>` : `<#${row.target_id}>`).join(', ') : '*None*'}`, {
                flags: [MessageFlags.Ephemeral]
            }));
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
            await this.assertRbac(interaction, 'remove');
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) throw new Error('You need Manage Server.');
            if (decision === 'confirm') this.sqlite.transaction(() => {
                const remove = this.sqlite.prepare(`
                    DELETE FROM event_log_channels WHERE guild_id = ? AND module = ? AND channel_id = ?
                `);
                for (const row of confirmation.plan) remove.run(interaction.guildId, row.module, row.channel_id);
            })();
            return interaction.update(this.response('Event Logs', decision === 'confirm' ? 'Removed all event log destinations.' : 'Removal cancelled.', { components: [] }));
        }
        const [, action, field, actorId] = interaction.customId.split(':');
        const key = `${interaction.guildId}:${interaction.user.id}`;
        const pending = this.pending.get(key);
        if (action !== 'add' || actorId !== interaction.user.id || !pending || pending.expiresAt < this.now()) {
            throw new Error('That event-log setup has expired or is not yours.');
        }
        await this.assertRbac(interaction, 'add');
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) throw new Error('You need Manage Server.');
        if (field === 'channel') pending.channel = interaction.channels.first();
        else pending.module = this.module(interaction.values[0]);
        if (!pending.channel || !pending.module) return interaction.update(this.response(
            'Add Event Log', 'Choose a log channel and event module.', { components: this.selector(actorId) }
        ));
        this.add(interaction.guild, pending.channel, pending.module);
        this.pending.delete(key);
        return interaction.update(this.response('Event Log Added', `Added **${pending.module}** logs in <#${pending.channel.id}>.`, { components: [] }));
    }

    async assertRbac(interaction, subcommand) {
        const command = this.client?.commands?.get?.('server');
        if (!command) return;
        const { checkUserPermissions } = require('../utils/permissions');
        const { allowed } = await checkUserPermissions({
            guild: interaction.guild, member: interaction.member, user: interaction.user,
            channel: interaction.channel, channelId: interaction.channelId, commandName: 'server',
            options: { getSubcommandGroup: () => 'logs', getSubcommand: () => subcommand }
        }, command);
        if (!allowed) throw new Error('This event-log action is disabled for you here.');
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
            description: String(description || 'No details available.').slice(0, 4096), color: row.color || config.brand.color
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
            const claimed = this.sqlite.prepare(`
                UPDATE event_log_outbox SET status = 'sending', attempts = attempts + 1
                WHERE id = ? AND status = 'pending'
            `).run(row.id);
            if (!claimed.changes) continue;
            try {
                const guild = this.client.guilds.cache.get(row.guild_id);
                const channel = guild?.channels.cache.get(row.channel_id)
                    || await guild?.channels.fetch(row.channel_id).catch(() => null);
                if (!channel?.send) throw new Error('channel unavailable');
                const payload = JSON.parse(row.payload);
                const nonce = crypto.createHash('sha256')
                    .update(`${row.guild_id}:${row.event_key}:${row.channel_id}`)
                    .digest('hex').slice(0, 24);
                await channel.send({
                    embeds: [embeds.base(payload.title, payload.description).setColor(payload.color)],
                    allowedMentions: { parse: [] }, nonce, enforceNonce: true
                });
                this.sqlite.prepare(`UPDATE event_log_outbox SET status = 'sent' WHERE id = ?`).run(row.id);
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
