const {
    ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType,
    EmbedBuilder, MessageFlags, PermissionFlagsBits, RoleSelectMenuBuilder, StringSelectMenuBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const logger = require('../utils/logger');
const { renderScript } = require('./richContentService');

const ACTIVE_STATES = ['pending', 'open', 'claimed', 'closed', 'deleting'];
const CONFIG_COLUMNS = {
    defaultCategoryId: 'default_category_id',
    supportRoleId: 'support_role_id',
    openingMessage: 'opening_message',
    buttonLabel: 'button_label',
    buttonStyle: 'button_style',
    dmsEnabled: 'dms_enabled',
    inactivityHours: 'inactivity_hours',
    limitMode: 'limit_mode',
    logChannelId: 'log_channel_id',
    ratingsEnabled: 'ratings_enabled',
    vouchChannelId: 'vouch_channel_id'
};
const SAFE_MENTIONS = { parse: [], repliedUser: false };
const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;
const STYLE = {
    primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary,
    success: ButtonStyle.Success, danger: ButtonStyle.Danger
};

function rowToTicket(row) {
    if (!row) return null;
    return {
        ...row,
        guildId: row.guild_id,
        openerId: row.opener_id,
        panelId: row.panel_id,
        optionId: row.option_id,
        topicId: row.topic_id,
        topicName: row.topic_name,
        channelId: row.channel_id,
        claimerId: row.claimer_id,
        formSnapshot: row.form_snapshot,
        accessSnapshot: (() => { try { return JSON.parse(row.access_snapshot || 'null'); } catch { return null; } })(),
        inactivityDeadline: row.inactivity_deadline,
        warnedAt: row.warned_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        closedAt: row.closed_at,
        deletedAt: row.deleted_at
    };
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function boundedLines(lines, empty) {
    if (!lines.length) return empty;
    const kept = [];
    for (const line of lines) {
        if (`${kept.join('\n')}\n${line}`.length > 1850) break;
        kept.push(line);
    }
    const omitted = lines.length - kept.length;
    return `${kept.join('\n')}${omitted ? `\n… ${omitted} more. Use the shown IDs with the manager.` : ''}`;
}

class TicketService {
    constructor(client, options = {}) {
        this.client = client;
        this.sqlite = options.sqlite || require('../database').sqlite;
        this.now = options.now || Date.now;
        this.pollMs = options.pollMs || 60000;
        this.interval = null;
        this.running = false;
    }

    start() {
        if (this.interval) return;
        this.interval = setInterval(() => this.runDue().catch(error => logger.warn(`Ticket inactivity check failed: ${error.message}`)), this.pollMs);
        this.interval.unref?.();
    }

    cleanup() {
        if (this.interval) clearInterval(this.interval);
        this.interval = null;
    }

    ensureConfig(guildId) {
        this.sqlite.prepare(`
            INSERT INTO ticket_configs (guild_id, updated_at) VALUES (?, ?)
            ON CONFLICT (guild_id) DO NOTHING
        `).run(guildId, this.now());
        return this.getConfig(guildId);
    }

    getConfig(guildId) {
        return this.sqlite.prepare('SELECT * FROM ticket_configs WHERE guild_id = ?').get(guildId) || null;
    }

    updateConfig(guildId, changes) {
        this.ensureConfig(guildId);
        const entries = Object.entries(changes).filter(([key]) => CONFIG_COLUMNS[key]);
        if (!entries.length) return this.getConfig(guildId);
        if (changes.limitMode && !['one_total', 'one_per_topic', 'unlimited'].includes(changes.limitMode)) throw new Error('Invalid ticket limit mode.');
        if (changes.inactivityHours !== undefined && changes.inactivityHours !== null
            && (!Number.isInteger(changes.inactivityHours) || changes.inactivityHours < 1 || changes.inactivityHours > 168)) {
            throw new Error('Inactivity must be between 1 and 168 hours.');
        }
        const assignments = entries.map(([key]) => `${CONFIG_COLUMNS[key]} = ?`);
        this.sqlite.prepare(`UPDATE ticket_configs SET ${assignments.join(', ')}, updated_at = ? WHERE guild_id = ?`)
            .run(...entries.map(([, value]) => typeof value === 'boolean' ? Number(value) : value), this.now(), guildId);
        return this.getConfig(guildId);
    }

    createPanel(guildId, name, mode, createdBy) {
        const cleanName = String(name || '').trim();
        if (!cleanName || cleanName.length > 100) throw new Error('Panel names must be 1–100 characters.');
        if (!['button', 'dropdown'].includes(mode)) throw new Error('Panel mode must be button or dropdown.');
        if (this.sqlite.prepare('SELECT 1 FROM ticket_panels WHERE guild_id = ? AND name = ? COLLATE NOCASE').get(guildId, cleanName)) {
            throw new Error('A panel with that name already exists.');
        }
        if (this.sqlite.prepare('SELECT COUNT(*) count FROM ticket_panels WHERE guild_id = ?').get(guildId).count >= 15) {
            throw new Error('This server already has the public maximum of 15 panels.');
        }
        const now = this.now();
        try {
            return this.sqlite.prepare(`INSERT INTO ticket_panels (guild_id, name, mode, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?) RETURNING *`).get(guildId, cleanName, mode, createdBy, now, now);
        } catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new Error('A panel with that name already exists.');
            throw error;
        }
    }

    getPanel(guildId, nameOrId) {
        return typeof nameOrId === 'number'
            ? this.sqlite.prepare('SELECT * FROM ticket_panels WHERE guild_id = ? AND id = ?').get(guildId, nameOrId)
            : this.sqlite.prepare('SELECT * FROM ticket_panels WHERE guild_id = ? AND name = ? COLLATE NOCASE').get(guildId, nameOrId);
    }

    listPanels(guildId) {
        return this.sqlite.prepare('SELECT * FROM ticket_panels WHERE guild_id = ? ORDER BY id').all(guildId);
    }

    removePanel(guildId, nameOrId) {
        const panel = this.getPanel(guildId, nameOrId);
        if (!panel) return null;
        return this.sqlite.transaction(() => {
            const optionIds = this.sqlite.prepare('SELECT id FROM ticket_options WHERE panel_id = ?').all(panel.id).map(row => row.id);
            const formIds = this.sqlite.prepare('SELECT id FROM ticket_forms WHERE panel_id = ?').all(panel.id).map(row => row.id);
            for (const id of optionIds) this.sqlite.prepare('DELETE FROM ticket_option_roles WHERE option_id = ?').run(id);
            for (const id of formIds) this.sqlite.prepare('DELETE FROM ticket_form_fields WHERE form_id = ?').run(id);
            this.sqlite.prepare('DELETE FROM ticket_options WHERE panel_id = ?').run(panel.id);
            this.sqlite.prepare('DELETE FROM ticket_forms WHERE panel_id = ?').run(panel.id);
            this.sqlite.prepare('DELETE FROM ticket_panels WHERE id = ?').run(panel.id);
            return panel;
        })();
    }

    addOption(panelId, values) {
        const panel = this.sqlite.prepare('SELECT * FROM ticket_panels WHERE id = ?').get(panelId);
        if (!panel) throw new Error('Panel not found.');
        const label = String(values.label || '').trim();
        if (!label || label.length > 80) throw new Error('Option labels must be 1–80 characters.');
        const position = this.sqlite.prepare('SELECT COALESCE(MAX(position), 0) + 1 position FROM ticket_options WHERE panel_id = ?').get(panelId).position;
        if (position > 25) throw new Error('Discord supports at most 25 options on one panel message.');
        return this.sqlite.prepare(`INSERT INTO ticket_options
            (panel_id, label, description, emoji, style, category_id, topic_id, form_id, close_on_leave, trainee_claim, enabled, position)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?) RETURNING *`).get(
            panelId, label, values.description || null, values.emoji || null, values.style || 'primary',
            values.categoryId || null, values.topicId || null, values.formId || null,
            Number(Boolean(values.closeOnLeave)), Number(Boolean(values.traineeClaim)), position
        );
    }

    listOptions(panelId) {
        return this.sqlite.prepare('SELECT * FROM ticket_options WHERE panel_id = ? ORDER BY position').all(panelId);
    }

    setOptionRole(optionId, roleId, kind, enabled = true) {
        if (!['support', 'trainee'].includes(kind)) throw new Error('Invalid ticket role kind.');
        if (enabled) this.sqlite.prepare(`INSERT INTO ticket_option_roles (option_id, role_id, kind) VALUES (?, ?, ?)
            ON CONFLICT (option_id, role_id, kind) DO NOTHING`).run(optionId, roleId, kind);
        else this.sqlite.prepare('DELETE FROM ticket_option_roles WHERE option_id = ? AND role_id = ? AND kind = ?').run(optionId, roleId, kind);
    }

    createForm(panelId, name) {
        const cleanName = String(name || '').trim();
        if (!cleanName || cleanName.length > 100) throw new Error('Form names must be 1–100 characters.');
        return this.sqlite.prepare('INSERT INTO ticket_forms (panel_id, name, created_at) VALUES (?, ?, ?) RETURNING *')
            .get(panelId, cleanName, this.now());
    }

    addFormField(formId, values) {
        const position = this.sqlite.prepare('SELECT COALESCE(MAX(position), 0) + 1 position FROM ticket_form_fields WHERE form_id = ?').get(formId).position;
        if (position > 5) throw new Error('Forms can contain at most five fields.');
        if (!['short', 'paragraph'].includes(values.type || 'short')) throw new Error('This Discord client supports short and paragraph ticket fields.');
        const label = String(values.label || '').trim();
        if (!label || label.length > 45) throw new Error('Form field labels must be 1–45 characters.');
        return this.sqlite.prepare(`INSERT INTO ticket_form_fields (form_id, label, type, placeholder, required, position)
            VALUES (?, ?, ?, ?, ?, ?) RETURNING *`).get(formId, label, values.type || 'short',
            values.placeholder || null, Number(values.required !== false), position);
    }

    createTopic(guildId, name, description = null) {
        const cleanName = String(name || '').trim();
        if (!cleanName || cleanName.length >= 100) throw new Error('Topic names must be shorter than 100 characters.');
        if (this.getTopic(guildId, cleanName)) throw new Error('A topic with that name already exists.');
        if (this.sqlite.prepare('SELECT COUNT(*) count FROM ticket_topics WHERE guild_id = ?').get(guildId).count >= 25) {
            throw new Error('This server already has the public maximum of 25 topics.');
        }
        const now = this.now();
        return this.sqlite.prepare(`INSERT INTO ticket_topics (guild_id, name, description, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?) RETURNING *`).get(guildId, cleanName, description, now, now);
    }

    getTopic(guildId, name) {
        return this.sqlite.prepare('SELECT * FROM ticket_topics WHERE guild_id = ? AND name = ? COLLATE NOCASE').get(guildId, name);
    }

    listTopics(guildId) {
        return this.sqlite.prepare('SELECT * FROM ticket_topics WHERE guild_id = ? ORDER BY id').all(guildId);
    }

    removeTopic(guildId, name) {
        const topic = this.getTopic(guildId, name);
        if (!topic) return null;
        this.sqlite.transaction(() => {
            this.sqlite.prepare('DELETE FROM ticket_topic_roles WHERE topic_id = ?').run(topic.id);
            this.sqlite.prepare('UPDATE ticket_options SET topic_id = NULL WHERE topic_id = ?').run(topic.id);
            this.sqlite.prepare('DELETE FROM ticket_topics WHERE id = ?').run(topic.id);
        })();
        return topic;
    }

    blacklist(guildId, targetType, targetId, actorId, enabled = true) {
        if (!['member', 'role'].includes(targetType)) throw new Error('Blacklist target must be a member or role.');
        if (enabled) this.sqlite.prepare(`INSERT INTO ticket_blacklist (guild_id, target_type, target_id, created_by, created_at)
            VALUES (?, ?, ?, ?, ?) ON CONFLICT (guild_id, target_type, target_id) DO NOTHING`)
            .run(guildId, targetType, targetId, actorId, this.now());
        else this.sqlite.prepare('DELETE FROM ticket_blacklist WHERE guild_id = ? AND target_type = ? AND target_id = ?')
            .run(guildId, targetType, targetId);
    }

    isBlacklisted(guildId, member) {
        const targets = this.sqlite.prepare('SELECT target_type, target_id FROM ticket_blacklist WHERE guild_id = ?').all(guildId);
        return targets.some(target => target.target_type === 'member' ? target.target_id === member.id : member.roles?.cache?.has(target.target_id));
    }

    setProfile(guildId, userId, greeting) {
        if (!greeting) return this.sqlite.prepare('DELETE FROM ticket_profiles WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
        this.sqlite.prepare(`INSERT INTO ticket_profiles (guild_id, user_id, greeting, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT (guild_id, user_id) DO UPDATE SET greeting = excluded.greeting, updated_at = excluded.updated_at`)
            .run(guildId, userId, greeting, this.now());
        return this.sqlite.prepare('SELECT * FROM ticket_profiles WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
    }

    optionContext(optionId) {
        const option = this.sqlite.prepare(`SELECT o.*, p.guild_id, p.default_category_id panel_category_id, p.enabled panel_enabled,
            t.name topic_name, t.category_id topic_category_id, t.embed_script
            FROM ticket_options o JOIN ticket_panels p ON p.id = o.panel_id
            LEFT JOIN ticket_topics t ON t.id = o.topic_id WHERE o.id = ?`).get(optionId);
        if (!option) return null;
        option.roles = this.sqlite.prepare('SELECT role_id, kind FROM ticket_option_roles WHERE option_id = ?').all(optionId);
        if (option.topic_id) option.topicRoles = this.sqlite.prepare('SELECT role_id FROM ticket_topic_roles WHERE topic_id = ?').all(option.topic_id).map(row => row.role_id);
        else option.topicRoles = [];
        return option;
    }

    supportRoleIds(ticket) {
        if (ticket.accessSnapshot?.supportRoleIds) return ticket.accessSnapshot.supportRoleIds;
        if (ticket.optionId) {
            const option = this.optionContext(ticket.optionId);
            const configured = option?.roles.filter(role => role.kind === 'support').map(role => role.role_id) || [];
            if (configured.length) return configured;
            if (option?.topicRoles.length) return option.topicRoles;
            return [];
        }
        const roleId = this.getConfig(ticket.guild_id || ticket.guildId)?.support_role_id;
        return roleId ? [roleId] : [];
    }

    traineeRoleIds(ticket) {
        if (ticket.accessSnapshot?.traineeRoleIds) return ticket.accessSnapshot.traineeRoleIds;
        if (!ticket.optionId) return [];
        return this.optionContext(ticket.optionId)?.roles.filter(role => role.kind === 'trainee').map(role => role.role_id) || [];
    }

    isAdministrator(member) {
        return Boolean(member?.id === member?.guild?.ownerId || member?.permissions?.has?.(PermissionFlagsBits.Administrator));
    }

    authorize(ticket, member, action) {
        if (!ticket || !member) return false;
        if (this.isAdministrator(member)) return true;
        const roleIds = member.roles?.cache || new Map();
        const support = this.supportRoleIds(ticket).some(roleId => roleIds.has(roleId));
        const option = ticket.optionId && this.optionContext(ticket.optionId);
        const trainee = this.traineeRoleIds(ticket).some(roleId => roleIds.has(roleId));
        if (action === 'view') {
            if (ticket.openerId === member.id || support || trainee) return true;
            return Boolean(this.sqlite.prepare(`SELECT target_type, target_id FROM ticket_members WHERE ticket_id = ? AND
                ((target_type = 'member' AND target_id = ?) OR target_type = 'role')`).all(ticket.id, member.id)
                .some(row => row.target_type === 'member' || roleIds.has(row.target_id)));
        }
        if (action === 'claim') return support || Boolean(trainee && (ticket.accessSnapshot?.traineeClaim || option?.trainee_claim));
        return support;
    }

    panelComponents(panelId) {
        const panel = this.sqlite.prepare('SELECT * FROM ticket_panels WHERE id = ? AND enabled = 1').get(panelId);
        const options = this.listOptions(panelId).filter(option => option.enabled);
        if (!panel || !options.length) throw new Error('A panel needs at least one enabled option before it can be sent.');
        if (panel.mode === 'dropdown') {
            const select = new StringSelectMenuBuilder().setCustomId(`ticket:open:${panel.id}`).setPlaceholder('Choose a ticket topic')
                .addOptions(options.map(option => ({
                    label: option.label, value: String(option.id),
                    ...(option.description && { description: option.description.slice(0, 100) }),
                    ...(option.emoji && { emoji: option.emoji })
                })));
            return [new ActionRowBuilder().addComponents(select)];
        }
        const rows = [];
        for (let index = 0; index < options.length; index += 5) {
            rows.push(new ActionRowBuilder().addComponents(options.slice(index, index + 5).map(option => {
                const button = new ButtonBuilder().setCustomId(`ticket:open:${panel.id}:${option.id}`)
                    .setLabel(option.label).setStyle(STYLE[option.style] || ButtonStyle.Primary);
                if (option.emoji) button.setEmoji(option.emoji);
                return button;
            })));
        }
        return rows;
    }

    panelAppearance(panel, context) {
        if (!panel.message_script) {
            return { embeds: [new EmbedBuilder().setTitle(panel.name).setDescription('Choose an option below to open a support ticket.')] };
        }
        const appearance = renderScript(panel.message_script, context);
        if (appearance.flags || appearance.components?.length) {
            throw new Error('Ticket panel appearance supports content and embeds; its interactive controls are generated by ByteBot.');
        }
        return appearance;
    }

    async publishPanel(guild, panel, channel) {
        const permissions = guild.members.me.permissionsIn(channel);
        const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageWebhooks];
        if (!permissions.has(required)) throw new Error('I need View Channel, Send Messages, Embed Links, and Manage Webhooks in that channel.');
        const oldChannel = panel.channel_id && guild.channels.cache.get(panel.channel_id);
        const oldMessage = panel.message_id && await oldChannel?.messages?.fetch?.(panel.message_id).catch(() => null);
        const appearance = this.panelAppearance(panel, { guild, channel });
        const message = await channel.send({ ...appearance, components: this.panelComponents(panel.id), allowedMentions: SAFE_MENTIONS });
        try {
            this.sqlite.prepare('UPDATE ticket_panels SET channel_id = ?, message_id = ?, updated_at = ? WHERE id = ?')
                .run(channel.id, message.id, this.now(), panel.id);
        } catch (error) {
            await message.edit({ components: [] }).catch(() => null);
            throw error;
        }
        if (oldMessage && oldMessage.id !== message.id) await oldMessage.edit({ components: [] });
        return message;
    }

    async openTicket(interaction, optionId, formSnapshot = null) {
        const option = this.optionContext(Number(optionId));
        if (!option?.enabled || !option.panel_enabled || option.guild_id !== interaction.guild.id) throw new Error('That ticket option is no longer available.');
        if (this.isBlacklisted(interaction.guild.id, interaction.member)) throw new Error('You are not allowed to open tickets in this server.');
        const config = this.ensureConfig(interaction.guild.id);
        const categoryId = option.category_id || option.topic_category_id || option.panel_category_id || config.default_category_id || null;
        if (!interaction.guild.members.me.permissions.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles])) {
            throw new Error('I need Manage Channels and Manage Roles before I can create ticket access overwrites.');
        }
        const category = categoryId && interaction.guild.channels.cache.get(categoryId);
        if (category && !interaction.guild.members.me.permissionsIn(category).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels])) {
            throw new Error('I cannot view or manage channels in the configured ticket category.');
        }
        const supportIds = option.roles.filter(role => role.kind === 'support').map(role => role.role_id);
        if (!supportIds.length && option.topicRoles.length) supportIds.push(...option.topicRoles);
        const traineeIds = option.roles.filter(role => role.kind === 'trainee').map(role => role.role_id);
        const ticket = this.reserveTicket({
            guildId: interaction.guild.id, openerId: interaction.user.id, panelId: option.panel_id,
            optionId: option.id, topicId: option.topic_id, topicName: option.topic_name || option.label, formSnapshot,
            accessSnapshot: { supportRoleIds: supportIds, traineeRoleIds: traineeIds,
                traineeClaim: Boolean(option.trainee_claim), closeOnLeave: Boolean(option.close_on_leave) }
        });
        const overwrites = [
            { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            { id: interaction.guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles] },
            ...[...new Set([...supportIds, ...traineeIds])].map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
        ];
        let channel;
        try {
            channel = await interaction.guild.channels.create({
                name: `ticket-${ticket.number}`,
                type: ChannelType.GuildText,
                parent: categoryId,
                topic: `ByteBot ticket:${ticket.id} opener:${interaction.user.id}`,
                permissionOverwrites: overwrites,
                reason: `Ticket #${ticket.number} opened by ${interaction.user.id}`
            });
            this.attachChannel(ticket.id, channel.id);
            if (option.embed_script) {
                const script = option.embed_script.replaceAll('{ticket.number}', String(ticket.number))
                    .replaceAll('{ticket.topic}', option.topic_name || option.label);
                await channel.send(renderScript(script, { user: interaction.user, member: interaction.member, guild: interaction.guild, channel }));
            }
            await channel.send({
                content: `<@${interaction.user.id}>`,
                embeds: [new EmbedBuilder().setTitle(`Ticket #${ticket.number} · ${option.topic_name || option.label}`)
                    .setDescription(option.embed_script ? 'Ticket details' : config.opening_message)
                    .addFields({ name: 'Reason', value: formSnapshot?.map(field => `**${field.label}:** ${field.value}`).join('\n').slice(0, 1024) || 'No form was attached.' })],
                components: this.ticketControls(ticket.id, 'open'), allowedMentions: { parse: [], users: [interaction.user.id] }
            });
            await this.log(ticket.guildId, `Ticket #${ticket.number} created in <#${channel.id}> by <@${ticket.openerId}>.`);
            await this.notifyOpener(ticket, `Ticket #${ticket.number} was created: <#${channel.id}>.`);
            return { ...ticket, status: 'open', channelId: channel.id };
        } catch (error) {
            if (channel) await channel.delete('Compensating failed ticket open').catch(() => null);
            this.markDeleted(ticket.id, interaction.user.id);
            throw error;
        }
    }

    ticketControls(ticketId, state) {
        const buttons = [];
        if (state !== 'closed') buttons.push(new ButtonBuilder().setCustomId(`ticket:action:claim:${ticketId}`).setLabel('Claim').setStyle(ButtonStyle.Primary));
        buttons.push(new ButtonBuilder().setCustomId(`ticket:action:${state === 'closed' ? 'reopen' : 'close'}:${ticketId}`)
            .setLabel(state === 'closed' ? 'Reopen' : 'Close').setStyle(state === 'closed' ? ButtonStyle.Success : ButtonStyle.Secondary));
        buttons.push(new ButtonBuilder().setCustomId(`ticket:action:transcript:${ticketId}`).setLabel('Transcript').setStyle(ButtonStyle.Secondary));
        buttons.push(new ButtonBuilder().setCustomId(`ticket:action:delete:${ticketId}`).setLabel('Delete').setStyle(ButtonStyle.Danger));
        return [new ActionRowBuilder().addComponents(buttons)];
    }

    async log(guildId, content, files = []) {
        const config = this.getConfig(guildId);
        if (!config?.log_channel_id || !this.client) return null;
        const guild = this.client.guilds.cache.get(guildId) || await this.client.guilds.fetch(guildId).catch(() => null);
        const channel = guild?.channels.cache.get(config.log_channel_id) || await guild?.channels.fetch?.(config.log_channel_id).catch(() => null);
        if (!channel?.send) return null;
        return channel.send({ content, files, allowedMentions: SAFE_MENTIONS }).catch(error => {
            logger.warn(`Ticket log delivery failed in guild ${guildId}: ${error.message}`);
            return null;
        });
    }

    async fetchMessages(channel) {
        const messages = [];
        let before;
        while (true) {
            const batch = await channel.messages.fetch({ limit: 100, ...(before && { before }) });
            if (!batch.size) break;
            messages.push(...batch.values());
            before = batch.last().id;
            if (batch.size < 100) break;
        }
        return messages.sort((left, right) => left.createdTimestamp - right.createdTimestamp);
    }

    async createTranscript(ticket, channel) {
        const messages = await this.fetchMessages(channel);
        const html = this.renderTranscript({ ticket, messages });
        const now = this.now();
        this.sqlite.prepare(`INSERT INTO ticket_transcripts (ticket_id, html, created_at, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT (ticket_id) DO UPDATE SET html = excluded.html, updated_at = excluded.updated_at`)
            .run(ticket.id, html, now, now);
        this.recordAction(ticket.id, this.client?.user?.id || 'bytebot', 'transcript');
        return { html, attachment: new AttachmentBuilder(Buffer.from(html), { name: `ticket-${ticket.number}.html` }) };
    }

    async closeDiscordTicket(ticket, channel, actorId, reason) {
        const updated = this.close(ticket.id, actorId, reason);
        await this.syncChannelAccess(updated, channel);
        await channel.send({ content: `🔒 Ticket closed${reason ? `: ${reason}` : '.'}`, components: this.ticketControls(ticket.id, 'closed'), allowedMentions: SAFE_MENTIONS })
            .catch(error => logger.warn(`Ticket #${ticket.number} close message failed: ${error.message}`));
        await this.log(ticket.guildId, `Ticket #${ticket.number} closed by <@${actorId}>${reason ? `: ${reason}` : '.'}`);
        await this.notifyOpener(updated, `Ticket #${ticket.number} was closed${reason ? `: ${reason}` : '.'}`);
        return updated;
    }

    async reopenDiscordTicket(ticket, channel, actorId) {
        const updated = this.reopen(ticket.id, actorId);
        await this.syncChannelAccess(updated, channel);
        await channel.send({ content: '🔓 Ticket reopened.', components: this.ticketControls(ticket.id, 'open'), allowedMentions: SAFE_MENTIONS })
            .catch(error => logger.warn(`Ticket #${ticket.number} reopen message failed: ${error.message}`));
        await this.log(ticket.guildId, `Ticket #${ticket.number} reopened by <@${actorId}>.`);
        return updated;
    }

    async syncChannelAccess(ticket, channel) {
        const closed = ticket.status === 'closed';
        const explicit = [{ target_type: 'member', target_id: ticket.openerId },
            ...this.sqlite.prepare('SELECT target_type, target_id FROM ticket_members WHERE ticket_id = ?').all(ticket.id)];
        for (const target of explicit) {
            await channel.permissionOverwrites.edit(target.target_id,
                { ViewChannel: !closed, SendMessages: !closed, ReadMessageHistory: !closed },
                { reason: `Reconcile ticket #${ticket.number} ${ticket.status}` });
        }
        for (const roleId of [...new Set([...this.supportRoleIds(ticket), ...this.traineeRoleIds(ticket)])]) {
            await channel.permissionOverwrites.edit(roleId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true },
                { reason: `Reconcile ticket #${ticket.number} staff access` });
        }
    }

    async notifyOpener(ticket, content, components = []) {
        if (!this.getConfig(ticket.guildId)?.dms_enabled || !this.client) return false;
        const user = await this.client.users.fetch(ticket.openerId).catch(() => null);
        if (!user) return false;
        return user.send({ content, components, allowedMentions: SAFE_MENTIONS }).then(() => true, () => false);
    }

    async deleteDiscordTicket(ticket, channel, actorId, reason = null) {
        const config = this.getConfig(ticket.guildId);
        if (!config?.log_channel_id) throw new Error('Set a ticket log channel before deleting tickets so the transcript cannot be lost.');
        const deleting = this.beginDelete(ticket.id, actorId);
        let transcript;
        try {
            transcript = await this.createTranscript(deleting, channel);
            const logged = await this.log(ticket.guildId,
                `Ticket #${ticket.number} deleted by <@${actorId}>${reason ? `: ${reason}` : '.'}`,
                [transcript.attachment]);
            if (!logged) throw new Error('The transcript could not be delivered to the configured ticket log.');
        } catch (error) {
            const restore = ticket.status === 'deleting' ? 'closed' : ticket.status;
            this.sqlite.prepare("UPDATE tickets SET status = ?, updated_at = ? WHERE id = ? AND status = 'deleting'").run(restore, this.now(), ticket.id);
            throw error;
        }
        try {
            await channel.delete(`Ticket #${ticket.number} deleted by ${actorId}${reason ? `: ${reason}` : ''}`);
        } catch (error) {
            if (error?.code !== 10003 && error?.rawError?.code !== 10003) throw error;
        }
        const deleted = this.markDeleted(ticket.id, actorId);
        const ratingRows = config.ratings_enabled ? [new ActionRowBuilder().addComponents([1, 2, 3, 4, 5].map(stars =>
            new ButtonBuilder().setCustomId(`ticket:rating:${ticket.id}:${stars}`).setLabel(`${stars}★`).setStyle(ButtonStyle.Secondary)))] : [];
        await this.notifyOpener(deleted, `Ticket #${ticket.number} was deleted. Transcript ID: ${ticket.id}`, ratingRows);
        return deleted;
    }

    option(interaction, method, name) {
        try { return interaction.options[method](name); } catch { return null; }
    }

    requireAdministrator(interaction) {
        if (!this.isAdministrator(interaction.member)) throw new Error('You need the real Discord Administrator permission to configure tickets.');
    }

    isTicketStaff(member) {
        if (this.isAdministrator(member)) return true;
        const roleIds = member.roles?.cache || new Map();
        const config = this.getConfig(member.guild.id);
        if (config?.support_role_id && roleIds.has(config.support_role_id)) return true;
        const rows = this.sqlite.prepare(`SELECT DISTINCT r.role_id FROM ticket_option_roles r
            JOIN ticket_options o ON o.id = r.option_id JOIN ticket_panels p ON p.id = o.panel_id
            WHERE p.guild_id = ?`).all(member.guild.id);
        return rows.some(row => roleIds.has(row.role_id));
    }

    formatSettings(guildId) {
        const config = this.ensureConfig(guildId);
        return [
            `Default category: ${config.default_category_id ? `<#${config.default_category_id}>` : 'guild root'}`,
            `Default support: ${config.support_role_id ? `<@&${config.support_role_id}>` : 'Administrator only'}`,
            `Ticket limit: **${config.limit_mode.replaceAll('_', ' ')}**`,
            `Inactivity: **${config.inactivity_hours ? `${config.inactivity_hours} hours` : 'off'}**`,
            `DMs: **${config.dms_enabled ? 'on' : 'off'}**`,
            `Ratings: **${config.ratings_enabled ? 'on' : 'off'}**`,
            `Logs: ${config.log_channel_id ? `<#${config.log_channel_id}>` : 'not configured'}`,
            `Vouches: ${config.vouch_channel_id ? `<#${config.vouch_channel_id}>` : 'not configured'}`,
            `Panels: **${this.listPanels(guildId).length}/15** · Topics: **${this.listTopics(guildId).length}/25**`
        ].join('\n');
    }

    managerPayload(panel) {
        const options = this.listOptions(panel.id);
        const forms = this.sqlite.prepare('SELECT * FROM ticket_forms WHERE panel_id = ? ORDER BY id').all(panel.id);
        const rows = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`ticket:manage:add-option:${panel.id}`).setLabel('Add option').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`ticket:manage:add-form:${panel.id}`).setLabel('Add form').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`ticket:manage:appearance:${panel.id}`).setLabel('Panel appearance').setStyle(ButtonStyle.Secondary)
        )];
        if (options.length) rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId(`ticket:manage:option:${panel.id}`).setPlaceholder('Configure an option')
            .addOptions(options.map(option => ({ label: option.label, value: String(option.id) })))));
        if (forms.length) rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId(`ticket:manage:form:${panel.id}`).setPlaceholder('Add or view form fields')
            .addOptions(forms.slice(0, 25).map(form => ({ label: form.name, value: String(form.id) })))));
        rows.push(new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(`ticket:manage:category:${panel.id}`)
            .setPlaceholder('Set the panel default category').setChannelTypes(ChannelType.GuildCategory).setMinValues(0).setMaxValues(1)));
        return {
            content: boundedLines([
                `**${panel.name}** · ${panel.mode}`,
                ...options.map(option => `Option #${option.id} · ${option.label}`),
                ...forms.map(form => `Form #${form.id} · ${form.name}`)
            ], `**${panel.name}** has no options or forms.`),
            components: rows, flags: [MessageFlags.Ephemeral], allowedMentions: SAFE_MENTIONS
        };
    }

    formManagerPayload(formId) {
        const form = this.sqlite.prepare('SELECT * FROM ticket_forms WHERE id = ?').get(formId);
        if (!form) throw new Error('Form not found.');
        const fields = this.sqlite.prepare('SELECT * FROM ticket_form_fields WHERE form_id = ? ORDER BY position').all(formId);
        const rows = [];
        if (fields.length < 5) rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setCustomId(`ticket:manage:add-field:${form.id}`).setLabel('Add field').setStyle(ButtonStyle.Primary)));
        if (fields.length) rows.push(new ActionRowBuilder().addComponents(fields.map(field => new ButtonBuilder()
            .setCustomId(`ticket:manage:remove-field:${field.id}`).setLabel(`Remove ${field.position}`).setStyle(ButtonStyle.Secondary))));
        rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setCustomId(`ticket:manage:remove-form:${form.id}`).setLabel('Remove form').setStyle(ButtonStyle.Danger)));
        return {
            content: `**${form.name}** · ${fields.length}/5 fields\n${fields.map(field => `${field.position}. ${field.label} (${field.type})`).join('\n') || 'No fields yet.'}`,
            components: rows, flags: [MessageFlags.Ephemeral]
        };
    }

    optionManagerPayload(option) {
        const rows = [
            new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(`ticket:option:support:${option.id}`)
                .setPlaceholder('Replace support roles').setMinValues(0).setMaxValues(25)),
            new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(`ticket:option:trainee:${option.id}`)
                .setPlaceholder('Replace trainee roles').setMinValues(0).setMaxValues(25)),
            new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(`ticket:option:category:${option.id}`)
                .setPlaceholder('Set the option category').setChannelTypes(ChannelType.GuildCategory).setMinValues(0).setMaxValues(1)),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`ticket:option:assign-modal:${option.id}`).setLabel('Assign form/topic').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`ticket:option:toggle-leave:${option.id}`).setLabel(`Close on leave: ${option.close_on_leave ? 'on' : 'off'}`).setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`ticket:option:toggle-trainee:${option.id}`).setLabel(`Trainee claim: ${option.trainee_claim ? 'on' : 'off'}`).setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`ticket:option:remove:${option.id}`).setLabel('Remove option').setStyle(ButtonStyle.Danger)
            )
        ];
        return { content: `Configuring **${option.label}**`, components: rows, flags: [MessageFlags.Ephemeral] };
    }

    async handleCommand(interaction) {
        try {
            return await this.executeCommand(interaction);
        } catch (error) {
            return interaction.editReply({ content: `❌ ${error.message}`, components: [], allowedMentions: SAFE_MENTIONS });
        }
    }

    async executeCommand(interaction) {
        const guildId = interaction.guild.id;
        const group = interaction.options.getSubcommandGroup(false);
        const action = interaction.options.getSubcommand();
        const configuration = group && ['panel', 'topics', 'settings', 'access'].includes(group)
            || !group && ['setup', 'support', 'category', 'message', 'button', 'reset'].includes(action);
        if (configuration) this.requireAdministrator(interaction);

        if (action === 'setup' && !group) {
            const channel = this.option(interaction, 'getChannel', 'channel');
            const config = this.ensureConfig(guildId);
            let panel = this.getPanel(guildId, 'default');
            if (!panel) panel = this.createPanel(guildId, 'default', 'button', interaction.user.id);
            const script = this.option(interaction, 'getString', 'script');
            if (script) {
                this.panelAppearance({ ...panel, message_script: script }, { guild: interaction.guild, channel });
                this.sqlite.prepare('UPDATE ticket_panels SET message_script = ?, updated_at = ? WHERE id = ?').run(script, this.now(), panel.id);
                panel = this.getPanel(guildId, panel.id);
            }
            if (!this.listOptions(panel.id).length) {
                const option = this.addOption(panel.id, { label: config.button_label, style: config.button_style });
                if (config.support_role_id) this.setOptionRole(option.id, config.support_role_id, 'support');
            }
            await this.publishPanel(interaction.guild, panel, channel);
            return interaction.editReply({ content: `Ticket panel published in <#${channel.id}>.`, allowedMentions: SAFE_MENTIONS });
        }
        if (action === 'support' && !group) {
            const role = this.option(interaction, 'getRole', 'role');
            this.updateConfig(guildId, { supportRoleId: role.id });
            const panel = this.getPanel(guildId, 'default');
            const option = panel && this.listOptions(panel.id)[0];
            if (option) {
                this.sqlite.prepare("DELETE FROM ticket_option_roles WHERE option_id = ? AND kind = 'support'").run(option.id);
                this.setOptionRole(option.id, role.id, 'support');
            }
            return interaction.editReply({ content: 'Default support role updated.' });
        }
        if (action === 'category' && !group) {
            this.updateConfig(guildId, { defaultCategoryId: this.option(interaction, 'getChannel', 'category').id });
            return interaction.editReply({ content: 'Default ticket category updated.' });
        }
        if (action === 'message' && !group) {
            this.updateConfig(guildId, { openingMessage: this.option(interaction, 'getString', 'message') });
            return interaction.editReply({ content: 'Opening message updated.' });
        }
        if (action === 'button' && !group) {
            const label = this.option(interaction, 'getString', 'label');
            const style = this.option(interaction, 'getString', 'style') || 'primary';
            this.updateConfig(guildId, { buttonLabel: label, buttonStyle: style });
            const panel = this.getPanel(guildId, 'default');
            const option = panel && this.listOptions(panel.id)[0];
            if (option) {
                this.sqlite.prepare('UPDATE ticket_options SET label = ?, style = ? WHERE id = ?').run(label, style, option.id);
                const channel = interaction.guild.channels.cache.get(panel.channel_id);
                const message = await channel?.messages?.fetch?.(panel.message_id).catch(() => null);
                if (message) await message.edit({ components: this.panelComponents(panel.id) });
            }
            return interaction.editReply({ content: 'Default button updated.' });
        }
        if (action === 'reset' && !group) return this.reset(interaction);

        if (group === 'panel') {
            if (action === 'create') {
                const panel = this.createPanel(guildId, this.option(interaction, 'getString', 'name'), this.option(interaction, 'getString', 'mode') || 'dropdown', interaction.user.id);
                return interaction.editReply(this.managerPayload(panel));
            }
            if (action === 'list') {
                const panels = this.listPanels(guildId);
                return interaction.editReply({ content: boundedLines(panels.map(panel => `#${panel.id} **${panel.name}** · ${panel.mode} · ${this.listOptions(panel.id).length} options${panel.message_id ? ` · <#${panel.channel_id}>` : ''}`), 'No ticket panels are configured.'), allowedMentions: SAFE_MENTIONS });
            }
            const panel = this.getPanel(guildId, this.option(interaction, 'getString', 'panel'));
            if (!panel) throw new Error('Panel not found.');
            if (action === 'manage') {
                const optionId = this.option(interaction, 'getInteger', 'option_id');
                const formId = this.option(interaction, 'getInteger', 'form_id');
                if (optionId && formId) throw new Error('Choose an option ID or form ID, not both.');
                if (optionId) {
                    const option = this.optionContext(optionId);
                    if (!option || option.panel_id !== panel.id) throw new Error('That option does not belong to this panel.');
                    return interaction.editReply(this.optionManagerPayload(option));
                }
                if (formId) {
                    const form = this.sqlite.prepare('SELECT * FROM ticket_forms WHERE id = ? AND panel_id = ?').get(formId, panel.id);
                    if (!form) throw new Error('That form does not belong to this panel.');
                    return interaction.editReply(this.formManagerPayload(form.id));
                }
                return interaction.editReply(this.managerPayload(panel));
            }
            if (action === 'send') {
                const channel = this.option(interaction, 'getChannel', 'channel');
                await this.publishPanel(interaction.guild, panel, channel);
                return interaction.editReply({ content: `Panel published in <#${channel.id}>.`, allowedMentions: SAFE_MENTIONS });
            }
            if (!this.option(interaction, 'getBoolean', 'confirm')) throw new Error('Nothing was removed because confirmation was false.');
            const oldChannel = interaction.guild.channels.cache.get(panel.channel_id);
            const oldMessage = await oldChannel?.messages?.fetch?.(panel.message_id).catch(() => null);
            if (oldMessage) await oldMessage.edit({ components: [] });
            this.removePanel(guildId, panel.id);
            return interaction.editReply({ content: 'Panel removed. Existing ticket channels were preserved.' });
        }

        if (group === 'topics') return this.handleTopicCommand(interaction, action);
        if (group === 'settings') return this.handleSettingsCommand(interaction, action);
        if (group === 'access') return this.handleAccessCommand(interaction, action);
        if (group === 'profile') return this.handleProfileCommand(interaction, action);
        if (action === 'list') return this.listCommand(interaction);
        if (action === 'stats') return this.statsCommand(interaction);
        return this.handleTicketAction(interaction, action);
    }

    async handleTopicCommand(interaction, action) {
        const guildId = interaction.guild.id;
        if (action === 'add') {
            const topic = this.createTopic(guildId, this.option(interaction, 'getString', 'name'), this.option(interaction, 'getString', 'description'));
            return interaction.editReply({ content: `Topic **${topic.name}** created.` });
        }
        if (action === 'list') {
            const topics = this.listTopics(guildId);
            return interaction.editReply({ content: boundedLines(topics.map(topic => `#${topic.id} **${topic.name}**${topic.category_id ? ` · <#${topic.category_id}>` : ''}`), 'No ticket topics are configured.'), allowedMentions: SAFE_MENTIONS });
        }
        const name = this.option(interaction, 'getString', 'topic');
        const topic = this.getTopic(guildId, name);
        if (!topic) throw new Error('Topic not found.');
        if (action === 'remove') {
            this.removeTopic(guildId, name);
            return interaction.editReply({ content: `Topic **${topic.name}** removed. Existing tickets retained their topic snapshot.` });
        }
        if (action === 'category') {
            const category = this.option(interaction, 'getChannel', 'category');
            this.sqlite.prepare('UPDATE ticket_topics SET category_id = ?, updated_at = ? WHERE id = ?').run(category.id, this.now(), topic.id);
            return interaction.editReply({ content: `Topic **${topic.name}** now routes to <#${category.id}>.`, allowedMentions: SAFE_MENTIONS });
        }
        if (action === 'embed') {
            this.sqlite.prepare('UPDATE ticket_topics SET embed_script = ?, updated_at = ? WHERE id = ?')
                .run(this.option(interaction, 'getString', 'script'), this.now(), topic.id);
            return interaction.editReply({ content: `Topic **${topic.name}** message updated.` });
        }
        const role = this.option(interaction, 'getRole', 'role');
        const enabled = this.option(interaction, 'getString', 'action') === 'add';
        if (enabled) this.sqlite.prepare('INSERT INTO ticket_topic_roles (topic_id, role_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(topic.id, role.id);
        else this.sqlite.prepare('DELETE FROM ticket_topic_roles WHERE topic_id = ? AND role_id = ?').run(topic.id, role.id);
        return interaction.editReply({ content: `${enabled ? 'Added' : 'Removed'} <@&${role.id}> ${enabled ? 'to' : 'from'} **${topic.name}**.`, allowedMentions: SAFE_MENTIONS });
    }

    handleSettingsCommand(interaction, action) {
        const guildId = interaction.guild.id;
        if (action === 'view') return interaction.editReply({ content: this.formatSettings(guildId), allowedMentions: SAFE_MENTIONS });
        const selectedChannel = this.option(interaction, 'getChannel', 'channel');
        if (selectedChannel) {
            const required = action === 'logs'
                ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles]
                : [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
            if (!interaction.guild.members.me.permissionsIn(selectedChannel).has(required)) {
                throw new Error(`I need View Channel, Send Messages${action === 'logs' ? ', and Attach Files' : ''} in that channel.`);
            }
        }
        const field = {
            dms: ['dmsEnabled', this.option(interaction, 'getBoolean', 'enabled')],
            inactivity: ['inactivityHours', this.option(interaction, 'getInteger', 'hours')],
            limit: ['limitMode', this.option(interaction, 'getString', 'mode')],
            logs: ['logChannelId', selectedChannel?.id || null],
            rating: ['ratingsEnabled', this.option(interaction, 'getBoolean', 'enabled')],
            vouch: ['vouchChannelId', selectedChannel?.id || null]
        }[action];
        this.updateConfig(guildId, { [field[0]]: field[1] });
        return interaction.editReply({ content: `Ticket ${action} setting updated.` });
    }

    handleAccessCommand(interaction, action) {
        const guildId = interaction.guild.id;
        if (action === 'list') {
            const rows = this.sqlite.prepare('SELECT * FROM ticket_blacklist WHERE guild_id = ? ORDER BY created_at').all(guildId);
            return interaction.editReply({ content: boundedLines(rows.map(row => row.target_type === 'member' ? `<@${row.target_id}>` : `<@&${row.target_id}>`), 'The ticket opening blacklist is empty.'), allowedMentions: SAFE_MENTIONS });
        }
        const member = this.option(interaction, 'getUser', 'member');
        const role = this.option(interaction, 'getRole', 'role');
        if (Boolean(member) === Boolean(role)) throw new Error('Choose exactly one member or role.');
        this.blacklist(guildId, member ? 'member' : 'role', (member || role).id, interaction.user.id, action === 'blacklist');
        return interaction.editReply({ content: `${member ? `<@${member.id}>` : `<@&${role.id}>`} ${action === 'blacklist' ? 'added to' : 'removed from'} the ticket opening blacklist.`, allowedMentions: SAFE_MENTIONS });
    }

    handleProfileCommand(interaction, action) {
        if (!this.isTicketStaff(interaction.member)) throw new Error('Only configured ticket staff can use claim profiles.');
        const target = this.option(interaction, 'getUser', 'member') || interaction.user;
        if (action === 'set') {
            this.setProfile(interaction.guild.id, interaction.user.id, this.option(interaction, 'getString', 'greeting'));
            return interaction.editReply({ content: 'Claim greeting saved.' });
        }
        if (action === 'clear') {
            this.setProfile(interaction.guild.id, interaction.user.id, null);
            return interaction.editReply({ content: 'Claim greeting cleared.' });
        }
        const profile = this.sqlite.prepare('SELECT * FROM ticket_profiles WHERE guild_id = ? AND user_id = ?').get(interaction.guild.id, target.id);
        return interaction.editReply({ content: profile ? `**${target.username}:** ${profile.greeting}` : 'No claim greeting is configured.', allowedMentions: SAFE_MENTIONS });
    }

    async reset(interaction) {
        if (!this.option(interaction, 'getBoolean', 'confirm')) throw new Error('Nothing was reset because confirmation was false.');
        const panels = this.listPanels(interaction.guild.id);
        for (const panel of panels) {
            const channel = interaction.guild.channels.cache.get(panel.channel_id);
            const message = await channel?.messages?.fetch?.(panel.message_id).catch(() => null);
            if (message) await message.edit({ components: [] });
            this.removePanel(interaction.guild.id, panel.id);
        }
        this.sqlite.transaction(() => {
            const topicIds = this.listTopics(interaction.guild.id).map(topic => topic.id);
            for (const id of topicIds) this.sqlite.prepare('DELETE FROM ticket_topic_roles WHERE topic_id = ?').run(id);
            this.sqlite.prepare('DELETE FROM ticket_topics WHERE guild_id = ?').run(interaction.guild.id);
            this.sqlite.prepare('DELETE FROM ticket_blacklist WHERE guild_id = ?').run(interaction.guild.id);
            this.sqlite.prepare('DELETE FROM ticket_profiles WHERE guild_id = ?').run(interaction.guild.id);
            this.sqlite.prepare('DELETE FROM ticket_configs WHERE guild_id = ?').run(interaction.guild.id);
        })();
        return interaction.editReply({ content: 'Ticket configuration reset. Existing ticket channels, history, ratings, and transcripts were preserved.' });
    }

    listCommand(interaction) {
        const requested = this.option(interaction, 'getString', 'status') || 'open';
        let rows = this.sqlite.prepare('SELECT * FROM tickets WHERE guild_id = ? ORDER BY number DESC LIMIT 100').all(interaction.guild.id).map(rowToTicket);
        if (requested === 'open') rows = rows.filter(ticket => ['pending', 'open', 'claimed'].includes(ticket.status));
        if (requested === 'closed') rows = rows.filter(ticket => ticket.status === 'closed');
        rows = rows.filter(ticket => this.authorize(ticket, interaction.member, 'view')).slice(0, 25);
        return interaction.editReply({ content: boundedLines(rows.map(ticket => `#${ticket.number} · **${ticket.status}** · ${ticket.channelId ? `<#${ticket.channelId}>` : 'no channel'} · <@${ticket.openerId}>`), 'No accessible tickets matched.'), allowedMentions: SAFE_MENTIONS });
    }

    statsCommand(interaction) {
        if (!this.isTicketStaff(interaction.member)) throw new Error('Only ticket staff can view ticket statistics.');
        const member = this.option(interaction, 'getUser', 'member');
        const totals = this.sqlite.prepare(`SELECT status, COUNT(*) count FROM tickets WHERE guild_id = ? GROUP BY status`).all(interaction.guild.id);
        const staff = member ? this.sqlite.prepare(`SELECT action, COUNT(*) count FROM ticket_actions a JOIN tickets t ON t.id = a.ticket_id
            WHERE t.guild_id = ? AND a.actor_id = ? GROUP BY action`).all(interaction.guild.id, member.id) : [];
        const lines = totals.map(row => `${row.status}: **${row.count}**`);
        if (member) lines.push('', `**${member.username}**`, ...staff.map(row => `${row.action}: **${row.count}**`));
        return interaction.editReply({ content: lines.join('\n') || 'No ticket history exists.' });
    }

    async handleTicketAction(interaction, action) {
        const archiveId = action === 'transcript' ? this.option(interaction, 'getInteger', 'id') : null;
        const ticket = archiveId ? this.getTicket(archiveId) : this.getByChannel(interaction.guild.id, interaction.channel.id);
        if (!ticket) throw new Error('Use this command inside a tracked ticket channel.');
        if (ticket.guildId !== interaction.guild.id) throw new Error('Ticket not found in this server.');
        const authorization = action === 'claim' ? 'claim' : action === 'transcript' && ticket.openerId === interaction.user.id ? 'view' : 'manage';
        if (!this.authorize(ticket, interaction.member, authorization)) throw new Error('You are not authorized to perform that ticket action.');
        if (action === 'claim') {
            const claimed = this.claim(ticket.id, interaction.user.id);
            const profile = this.sqlite.prepare('SELECT greeting FROM ticket_profiles WHERE guild_id = ? AND user_id = ?').get(ticket.guildId, interaction.user.id);
            await interaction.channel.send({ content: profile?.greeting || `Claimed by <@${interaction.user.id}>.`, allowedMentions: { parse: [], users: [interaction.user.id] } });
            await this.log(ticket.guildId, `Ticket #${ticket.number} claimed by <@${interaction.user.id}>.`);
            await this.notifyOpener(claimed, `Ticket #${ticket.number} was claimed.`);
            return interaction.editReply({ content: 'Ticket claimed.' });
        }
        if (action === 'unclaim') {
            if (ticket.claimerId !== interaction.user.id && !this.isAdministrator(interaction.member)) throw new Error('Only the current claimer or an Administrator can release this ticket.');
            this.unclaim(ticket.id, interaction.user.id);
            await this.log(ticket.guildId, `Ticket #${ticket.number} released by <@${interaction.user.id}>.`);
            return interaction.editReply({ content: 'Ticket released.' });
        }
        if (action === 'close') {
            await this.closeDiscordTicket(ticket, interaction.channel, interaction.user.id, this.option(interaction, 'getString', 'reason'));
            return interaction.editReply({ content: 'Ticket closed.' });
        }
        if (action === 'reopen') {
            await this.reopenDiscordTicket(ticket, interaction.channel, interaction.user.id);
            return interaction.editReply({ content: 'Ticket reopened.' });
        }
        if (action === 'transcript') {
            if (archiveId) {
                const stored = this.sqlite.prepare('SELECT html FROM ticket_transcripts WHERE ticket_id = ?').get(ticket.id);
                if (!stored) throw new Error('No stored transcript exists for that ticket ID.');
                return interaction.editReply({ content: `Transcript ID: ${ticket.id}`, files: [new AttachmentBuilder(Buffer.from(stored.html), { name: `ticket-${ticket.number}.html` })] });
            }
            const transcript = await this.createTranscript(ticket, interaction.channel);
            await this.log(ticket.guildId, `Transcript refreshed for ticket #${ticket.number}.`, [transcript.attachment]);
            return interaction.editReply({ content: `Transcript ID: ${ticket.id}`, files: [new AttachmentBuilder(Buffer.from(transcript.html), { name: `ticket-${ticket.number}.html` })] });
        }
        if (action === 'delete') {
            if (!this.option(interaction, 'getBoolean', 'confirm')) throw new Error('Nothing was deleted because confirmation was false.');
            await interaction.editReply({ content: 'Saving the transcript and deleting this ticket…' });
            return this.deleteDiscordTicket(ticket, interaction.channel, interaction.user.id, this.option(interaction, 'getString', 'reason'));
        }
        if (action === 'rename') {
            const name = this.option(interaction, 'getString', 'name').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
            if (!name) throw new Error('The channel name must contain a letter or number.');
            await interaction.channel.setName(name, `Ticket renamed by ${interaction.user.id}`);
            this.recordAction(ticket.id, interaction.user.id, 'renamed', name);
            return interaction.editReply({ content: `Ticket renamed to **${name}**.` });
        }
        if (action === 'move') {
            const category = this.option(interaction, 'getChannel', 'category');
            await interaction.channel.setParent(category.id, { lockPermissions: false, reason: `Ticket moved by ${interaction.user.id}` });
            this.recordAction(ticket.id, interaction.user.id, 'moved', category.id);
            return interaction.editReply({ content: `Ticket moved to **${category.name}**.` });
        }
        if (action === 'reason') {
            const reason = this.option(interaction, 'getString', 'reason');
            this.sqlite.prepare('UPDATE tickets SET reason = ?, updated_at = ? WHERE id = ?').run(reason, this.now(), ticket.id);
            this.recordAction(ticket.id, interaction.user.id, 'reason', reason);
            return interaction.editReply({ content: 'Ticket reason updated.' });
        }
        const member = this.option(interaction, 'getUser', 'member');
        const role = this.option(interaction, 'getRole', 'role');
        if (Boolean(member) === Boolean(role)) throw new Error('Choose exactly one member or role.');
        const target = member || role;
        const targetType = member ? 'member' : 'role';
        if (action === 'remove' && member?.id === ticket.openerId) throw new Error('The ticket opener cannot be removed.');
        if (action === 'add') this.sqlite.prepare(`INSERT INTO ticket_members (ticket_id, target_type, target_id, added_by, created_at)
            VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(ticket.id, targetType, target.id, interaction.user.id, this.now());
        else this.sqlite.prepare('DELETE FROM ticket_members WHERE ticket_id = ? AND target_type = ? AND target_id = ?').run(ticket.id, targetType, target.id);
        await interaction.channel.permissionOverwrites.edit(target.id,
            action === 'add' ? { ViewChannel: true, SendMessages: ticket.status !== 'closed', ReadMessageHistory: true } : { ViewChannel: false },
            { reason: `Ticket access ${action} by ${interaction.user.id}` });
        this.recordAction(ticket.id, interaction.user.id, `${action}_${targetType}`, target.id);
        return interaction.editReply({ content: `${targetType === 'member' ? `<@${target.id}>` : `<@&${target.id}>`} ${action === 'add' ? 'added to' : 'removed from'} the ticket.`, allowedMentions: SAFE_MENTIONS });
    }

    autocomplete(interaction) {
        const query = interaction.options.getFocused().toLowerCase();
        const group = interaction.options.getSubcommandGroup(false);
        const rows = group === 'topics' ? this.listTopics(interaction.guild.id) : this.listPanels(interaction.guild.id);
        return interaction.respond(rows.filter(row => row.name.toLowerCase().includes(query)).slice(0, 25)
            .map(row => ({ name: row.name, value: row.name })));
    }

    async interactionError(interaction, error) {
        const payload = { content: `❌ ${error.message}`, components: [], flags: [MessageFlags.Ephemeral], allowedMentions: SAFE_MENTIONS };
        if (interaction.deferred || interaction.replied) return interaction.editReply(payload).catch(() => interaction.followUp(payload));
        return interaction.reply(payload);
    }

    async handleInteraction(interaction) {
        try {
            return await this.executeInteraction(interaction);
        } catch (error) {
            return this.interactionError(interaction, error);
        }
    }

    async executeInteraction(interaction) {
        const parts = interaction.customId.split(':');
        if (parts[1] === 'open') return this.handleOpenInteraction(interaction, parts);
        if (parts[1] === 'form') return this.handleFormSubmission(interaction, Number(parts[2]));
        if (parts[1] === 'manage') return this.handleManagerInteraction(interaction, parts);
        if (parts[1] === 'option') return this.handleOptionInteraction(interaction, parts);
        if (parts[1] === 'action') return this.handleActionInteraction(interaction, parts);
        if (parts[1] === 'rating') return this.handleRating(interaction, Number(parts[2]), Number(parts[3]));
        throw new Error('Unknown ticket interaction.');
    }

    async handleOpenInteraction(interaction, parts) {
        const optionId = interaction.isStringSelectMenu() ? Number(interaction.values[0]) : Number(parts[3]);
        const option = this.optionContext(optionId);
        if (!option || option.panel_id !== Number(parts[2])) throw new Error('That ticket option is invalid.');
        const fields = option.form_id ? this.sqlite.prepare('SELECT * FROM ticket_form_fields WHERE form_id = ? ORDER BY position').all(option.form_id) : [];
        if (fields.length) {
            const modal = new ModalBuilder().setCustomId(`ticket:form:${option.id}`).setTitle(option.label.slice(0, 45));
            modal.addComponents(fields.map(field => new ActionRowBuilder().addComponents(new TextInputBuilder()
                .setCustomId(`ticket:field:${field.id}`).setLabel(field.label.slice(0, 45))
                .setStyle(field.type === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
                .setRequired(Boolean(field.required)).setMaxLength(2000)
                .setPlaceholder((field.placeholder || '').slice(0, 100)))));
            return interaction.showModal(modal);
        }
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const ticket = await this.openTicket(interaction, optionId);
        return interaction.editReply({ content: `Ticket created: <#${ticket.channelId}>`, allowedMentions: SAFE_MENTIONS });
    }

    async handleFormSubmission(interaction, optionId) {
        const option = this.optionContext(optionId);
        const fields = option?.form_id ? this.sqlite.prepare('SELECT * FROM ticket_form_fields WHERE form_id = ? ORDER BY position').all(option.form_id) : [];
        if (!option || !fields.length) throw new Error('That ticket form is no longer available.');
        const snapshot = fields.map(field => ({
            id: field.id, label: field.label, type: field.type, required: Boolean(field.required),
            value: interaction.fields.getTextInputValue(`ticket:field:${field.id}`)
        }));
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const ticket = await this.openTicket(interaction, optionId, snapshot);
        return interaction.editReply({ content: `Ticket created: <#${ticket.channelId}>`, allowedMentions: SAFE_MENTIONS });
    }

    async handleManagerInteraction(interaction, parts) {
        this.requireAdministrator(interaction);
        const action = parts[2];
        const panelId = Number(parts[3]);
        if (['add-field', 'field-modal', 'remove-form', 'remove-form-confirm'].includes(action)) {
            const form = this.sqlite.prepare(`SELECT f.*, p.guild_id FROM ticket_forms f JOIN ticket_panels p ON p.id = f.panel_id WHERE f.id = ?`).get(panelId);
            if (!form || form.guild_id !== interaction.guild.id) throw new Error('Form not found.');
            if (action === 'remove-form') return interaction.reply({
                content: `Remove form **${form.name}**? Existing ticket snapshots are preserved.`,
                components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket:manage:remove-form-confirm:${form.id}`).setLabel('Remove form').setStyle(ButtonStyle.Danger))],
                flags: [MessageFlags.Ephemeral]
            });
            if (action === 'remove-form-confirm') {
                this.sqlite.transaction(() => {
                    this.sqlite.prepare('UPDATE ticket_options SET form_id = NULL WHERE form_id = ?').run(form.id);
                    this.sqlite.prepare('DELETE FROM ticket_form_fields WHERE form_id = ?').run(form.id);
                    this.sqlite.prepare('DELETE FROM ticket_forms WHERE id = ?').run(form.id);
                })();
                return interaction.update({ content: 'Form removed.', components: [] });
            }
            if (action === 'add-field') {
                return interaction.showModal(new ModalBuilder().setCustomId(`ticket:manage:field-modal:${form.id}`).setTitle('Add form field').addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('label').setLabel('Label').setStyle(TextInputStyle.Short).setMaxLength(45).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('type').setLabel('Type: short or paragraph').setStyle(TextInputStyle.Short).setMaxLength(9).setRequired(false)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('placeholder').setLabel('Placeholder').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(false)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('required').setLabel('Required: yes or no').setStyle(TextInputStyle.Short).setMaxLength(3).setRequired(false))
                ));
            }
            const type = interaction.fields.getTextInputValue('type').trim().toLowerCase() || 'short';
            const required = interaction.fields.getTextInputValue('required').trim().toLowerCase() !== 'no';
            this.addFormField(form.id, { label: interaction.fields.getTextInputValue('label'), type,
                placeholder: interaction.fields.getTextInputValue('placeholder'), required });
            return interaction.reply({ content: 'Form field added.', flags: [MessageFlags.Ephemeral] });
        }
        if (action === 'remove-field' || action === 'remove-field-confirm') {
            const field = this.sqlite.prepare(`SELECT ff.*, f.panel_id, p.guild_id FROM ticket_form_fields ff
                JOIN ticket_forms f ON f.id = ff.form_id JOIN ticket_panels p ON p.id = f.panel_id WHERE ff.id = ?`).get(panelId);
            if (!field || field.guild_id !== interaction.guild.id) throw new Error('Form field not found.');
            if (action === 'remove-field') return interaction.reply({
                content: `Remove field **${field.label}**? Existing ticket snapshots are preserved.`,
                components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket:manage:remove-field-confirm:${field.id}`).setLabel('Remove field').setStyle(ButtonStyle.Danger))],
                flags: [MessageFlags.Ephemeral]
            });
            this.sqlite.transaction(() => {
                this.sqlite.prepare('DELETE FROM ticket_form_fields WHERE id = ?').run(field.id);
                const remaining = this.sqlite.prepare('SELECT id FROM ticket_form_fields WHERE form_id = ? ORDER BY position').all(field.form_id);
                remaining.forEach((row, index) => this.sqlite.prepare('UPDATE ticket_form_fields SET position = ? WHERE id = ?').run(100 + index, row.id));
                remaining.forEach((row, index) => this.sqlite.prepare('UPDATE ticket_form_fields SET position = ? WHERE id = ?').run(index + 1, row.id));
            })();
            return interaction.update({ content: 'Form field removed.', components: [] });
        }
        const panel = this.getPanel(interaction.guild.id, panelId);
        if (!panel) throw new Error('Panel not found.');
        if (action === 'add-option') {
            return interaction.showModal(new ModalBuilder().setCustomId(`ticket:manage:option-modal:${panelId}`).setTitle('Add ticket option').addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('label').setLabel('Label').setStyle(TextInputStyle.Short).setMaxLength(80).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setMaxLength(100).setRequired(false)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('emoji').setLabel('Emoji').setStyle(TextInputStyle.Short).setMaxLength(50).setRequired(false)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('style').setLabel('Style: primary/secondary/success/danger').setStyle(TextInputStyle.Short).setMaxLength(9).setRequired(false))
            ));
        }
        if (action === 'add-form') {
            return interaction.showModal(new ModalBuilder().setCustomId(`ticket:manage:form-modal:${panelId}`).setTitle('Add ticket form').addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Form name').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true))
            ));
        }
        if (action === 'appearance') {
            const input = new TextInputBuilder().setCustomId('script').setLabel('Rich-message script (blank for default)')
                .setStyle(TextInputStyle.Paragraph).setMaxLength(2000).setRequired(false);
            if (panel.message_script) input.setValue(panel.message_script.slice(0, 2000));
            return interaction.showModal(new ModalBuilder().setCustomId(`ticket:manage:appearance-modal:${panelId}`).setTitle('Panel appearance').addComponents(
                new ActionRowBuilder().addComponents(input)
            ));
        }
        if (action === 'category') {
            this.sqlite.prepare('UPDATE ticket_panels SET default_category_id = ?, updated_at = ? WHERE id = ?')
                .run(interaction.values[0] || null, this.now(), panel.id);
            return interaction.update(this.managerPayload(this.getPanel(interaction.guild.id, panel.id)));
        }
        if (action === 'option-modal') {
            const style = interaction.fields.getTextInputValue('style').trim().toLowerCase() || 'primary';
            if (!STYLE[style]) throw new Error('Style must be primary, secondary, success, or danger.');
            this.addOption(panelId, {
                label: interaction.fields.getTextInputValue('label'),
                description: interaction.fields.getTextInputValue('description'),
                emoji: interaction.fields.getTextInputValue('emoji'), style
            });
            return interaction.reply(this.managerPayload(panel));
        }
        if (action === 'form-modal') {
            this.createForm(panelId, interaction.fields.getTextInputValue('name'));
            return interaction.reply(this.managerPayload(panel));
        }
        if (action === 'appearance-modal') {
            const script = interaction.fields.getTextInputValue('script').trim();
            if (script) this.panelAppearance({ ...panel, message_script: script }, { guild: interaction.guild, channel: interaction.channel });
            this.sqlite.prepare('UPDATE ticket_panels SET message_script = ?, updated_at = ? WHERE id = ?').run(script || null, this.now(), panel.id);
            return interaction.reply({ content: 'Panel appearance updated. Use `/ticket panel send` to publish it.', flags: [MessageFlags.Ephemeral] });
        }
        if (action === 'option') {
            const option = this.optionContext(Number(interaction.values[0]));
            return interaction.reply(this.optionManagerPayload(option));
        }
        if (action === 'form') {
            const formId = Number(interaction.values[0]);
            const form = this.sqlite.prepare('SELECT * FROM ticket_forms WHERE id = ? AND panel_id = ?').get(formId, panelId);
            if (!form) throw new Error('Form not found.');
            return interaction.reply(this.formManagerPayload(formId));
        }
    }

    async handleOptionInteraction(interaction, parts) {
        this.requireAdministrator(interaction);
        const action = parts[2];
        const option = this.optionContext(Number(parts[3]));
        if (!option || option.guild_id !== interaction.guild.id) throw new Error('Ticket option not found.');
        if (['support', 'trainee'].includes(action)) {
            this.sqlite.transaction(() => {
                this.sqlite.prepare('DELETE FROM ticket_option_roles WHERE option_id = ? AND kind = ?').run(option.id, action);
                for (const roleId of interaction.values) this.setOptionRole(option.id, roleId, action, true);
            })();
        } else if (action === 'category') {
            this.sqlite.prepare('UPDATE ticket_options SET category_id = ? WHERE id = ?').run(interaction.values[0] || null, option.id);
        } else if (action === 'assign-modal') {
            return interaction.showModal(new ModalBuilder().setCustomId(`ticket:option:assign-submit:${option.id}`).setTitle('Assign form and topic').addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('form_id').setLabel('Form ID (blank to clear)').setStyle(TextInputStyle.Short).setMaxLength(20).setRequired(false)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('topic_id').setLabel('Topic ID (blank to clear)').setStyle(TextInputStyle.Short).setMaxLength(20).setRequired(false))
            ));
        } else if (action === 'assign-submit') {
            const formValue = interaction.fields.getTextInputValue('form_id').trim();
            const topicValue = interaction.fields.getTextInputValue('topic_id').trim();
            const formId = formValue ? Number(formValue) : null;
            const topicId = topicValue ? Number(topicValue) : null;
            if (formValue && (!Number.isInteger(formId) || !this.sqlite.prepare('SELECT 1 FROM ticket_forms WHERE id = ? AND panel_id = ?').get(formId, option.panel_id))) {
                throw new Error('That form ID does not belong to this panel.');
            }
            if (topicValue && (!Number.isInteger(topicId) || !this.sqlite.prepare('SELECT 1 FROM ticket_topics WHERE id = ? AND guild_id = ?').get(topicId, option.guild_id))) {
                throw new Error('That topic ID does not belong to this server.');
            }
            this.sqlite.prepare('UPDATE ticket_options SET form_id = ?, topic_id = ? WHERE id = ?').run(formId, topicId, option.id);
            return interaction.reply({ content: 'Option form and topic updated.', flags: [MessageFlags.Ephemeral] });
        } else if (action === 'remove') {
            return interaction.reply({
                content: `Remove option **${option.label}**? Existing ticket snapshots are preserved.`,
                components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket:option:remove-confirm:${option.id}`).setLabel('Remove option').setStyle(ButtonStyle.Danger))],
                flags: [MessageFlags.Ephemeral]
            });
        } else if (action === 'remove-confirm') {
            this.sqlite.transaction(() => {
                this.sqlite.prepare('DELETE FROM ticket_option_roles WHERE option_id = ?').run(option.id);
                this.sqlite.prepare('DELETE FROM ticket_options WHERE id = ?').run(option.id);
                const remaining = this.sqlite.prepare('SELECT id FROM ticket_options WHERE panel_id = ? ORDER BY position').all(option.panel_id);
                remaining.forEach((row, index) => this.sqlite.prepare('UPDATE ticket_options SET position = ? WHERE id = ?').run(100 + index, row.id));
                remaining.forEach((row, index) => this.sqlite.prepare('UPDATE ticket_options SET position = ? WHERE id = ?').run(index + 1, row.id));
            })();
            return interaction.update({ content: 'Option removed.', components: [] });
        } else if (action === 'toggle-leave') {
            this.sqlite.prepare('UPDATE ticket_options SET close_on_leave = NOT close_on_leave WHERE id = ?').run(option.id);
        } else if (action === 'toggle-trainee') {
            this.sqlite.prepare('UPDATE ticket_options SET trainee_claim = NOT trainee_claim WHERE id = ?').run(option.id);
        }
        return interaction.update(this.optionManagerPayload(this.optionContext(option.id)));
    }

    async handleActionInteraction(interaction, parts) {
        const action = parts[2];
        const ticketId = Number(parts[3]);
        const ticket = this.getTicket(ticketId);
        if (!ticket || ticket.guildId !== interaction.guild.id || ticket.channelId !== interaction.channel.id) throw new Error('This ticket control is stale.');
        if (action === 'delete') {
            if (!this.authorize(ticket, interaction.member, 'manage')) throw new Error('You are not authorized to delete this ticket.');
            return interaction.reply({ content: 'Delete this ticket after saving its transcript to the configured log?', components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`ticket:action:confirm-delete:${ticket.id}`).setLabel('Save transcript and delete').setStyle(ButtonStyle.Danger)
            )], flags: [MessageFlags.Ephemeral] });
        }
        if (action === 'confirm-delete') {
            if (!this.authorize(ticket, interaction.member, 'manage')) throw new Error('You are not authorized to delete this ticket.');
            await interaction.update({ content: 'Saving transcript and deleting…', components: [] });
            return this.deleteDiscordTicket(ticket, interaction.channel, interaction.user.id);
        }
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const shim = {
            guild: interaction.guild, channel: interaction.channel, user: interaction.user, member: interaction.member,
            editReply: interaction.editReply.bind(interaction),
            options: {
            getSubcommandGroup: () => null, getSubcommand: () => action,
            getString: () => null, getBoolean: () => true, getUser: () => null, getRole: () => null, getChannel: () => null
        } };
        return this.handleTicketAction(shim, action);
    }

    async handleRating(interaction, ticketId, stars) {
        const ticket = this.getTicket(ticketId);
        if (!ticket || ticket.status !== 'deleted' || ticket.openerId !== interaction.user.id || stars < 1 || stars > 5) {
            throw new Error('That rating prompt is invalid.');
        }
        const result = this.sqlite.prepare(`INSERT INTO ticket_ratings (ticket_id, user_id, stars, created_at) VALUES (?, ?, ?, ?)
            ON CONFLICT (ticket_id) DO NOTHING`).run(ticketId, interaction.user.id, stars, this.now());
        if (!result.changes) return interaction.update({ content: 'Your rating was already saved.', components: [] });
        const config = this.getConfig(ticket.guildId);
        const guild = this.client?.guilds.cache.get(ticket.guildId);
        const vouch = guild?.channels.cache.get(config?.vouch_channel_id);
        if (vouch) await vouch.send({ content: `${'⭐'.repeat(stars)} for ticket #${ticket.number} from <@${interaction.user.id}>`, allowedMentions: SAFE_MENTIONS }).catch(() => null);
        return interaction.update({ content: `Thanks — your ${stars}-star rating was saved.`, components: [] });
    }

    reserveTicket({ guildId, openerId, panelId = null, optionId = null, topicId = null, topicName = null, formSnapshot = null, accessSnapshot = null }) {
        return this.sqlite.transaction(() => {
            const config = this.ensureConfig(guildId);
            const active = ACTIVE_STATES.map(() => '?').join(',');
            if (config.limit_mode === 'one_total') {
                const existing = this.sqlite.prepare(`SELECT 1 FROM tickets WHERE guild_id = ? AND opener_id = ? AND status IN (${active}) LIMIT 1`)
                    .get(guildId, openerId, ...ACTIVE_STATES);
                if (existing) throw new Error('You already have an open ticket.');
            }
            if (config.limit_mode === 'one_per_topic') {
                const existing = this.sqlite.prepare(`SELECT 1 FROM tickets WHERE guild_id = ? AND opener_id = ? AND topic_id IS ? AND status IN (${active}) LIMIT 1`)
                    .get(guildId, openerId, topicId, ...ACTIVE_STATES);
                if (existing) throw new Error('You already have an open ticket for that topic.');
            }
            const number = config.next_number;
            const now = this.now();
            const deadline = config.inactivity_hours ? now + config.inactivity_hours * 3600000 : null;
            this.sqlite.prepare('UPDATE ticket_configs SET next_number = next_number + 1, updated_at = ? WHERE guild_id = ?').run(now, guildId);
            const row = this.sqlite.prepare(`
                INSERT INTO tickets
                    (guild_id, number, opener_id, panel_id, option_id, topic_id, topic_name, status, form_snapshot, access_snapshot, inactivity_deadline, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
                RETURNING *
            `).get(guildId, number, openerId, panelId, optionId, topicId, topicName || (topicId == null ? null : String(topicId)),
                formSnapshot && JSON.stringify(formSnapshot), accessSnapshot && JSON.stringify(accessSnapshot), deadline, now, now);
            this.recordAction(row.id, openerId, 'open_reserved');
            return rowToTicket(row);
        }).immediate();
    }

    getTicket(id) {
        return rowToTicket(this.sqlite.prepare('SELECT * FROM tickets WHERE id = ?').get(id));
    }

    getByChannel(guildId, channelId) {
        return rowToTicket(this.sqlite.prepare('SELECT * FROM tickets WHERE guild_id = ? AND channel_id = ?').get(guildId, channelId));
    }

    attachChannel(id, channelId) {
        return this.sqlite.transaction(() => {
            const row = this.sqlite.prepare(`UPDATE tickets SET channel_id = ?, status = 'open', updated_at = ? WHERE id = ? AND status = 'pending' RETURNING *`)
                .get(channelId, this.now(), id);
            if (!row) throw new Error('Ticket is no longer pending.');
            this.recordAction(id, row.opener_id, 'opened', channelId);
            return rowToTicket(row);
        }).immediate();
    }

    transition(id, from, to, actorId, detail = null, extra = '', extraValues = []) {
        const states = Array.isArray(from) ? from : [from];
        const placeholders = states.map(() => '?').join(',');
        return this.sqlite.transaction(() => {
            const row = this.sqlite.prepare(`UPDATE tickets SET status = ?, updated_at = ?${extra} WHERE id = ? AND status IN (${placeholders}) RETURNING *`)
                .get(to, this.now(), ...extraValues, id, ...states);
            if (!row) return null;
            this.recordAction(id, actorId, to, detail);
            return rowToTicket(row);
        }).immediate();
    }

    claim(id, actorId) {
        const row = this.transition(id, 'open', 'claimed', actorId, null, ', claimer_id = ?', [actorId]);
        if (!row) throw new Error('This ticket is not available to claim.');
        return row;
    }

    unclaim(id, actorId) {
        const row = this.transition(id, 'claimed', 'open', actorId, null, ', claimer_id = NULL');
        if (!row) throw new Error('This ticket is not claimed.');
        return row;
    }

    close(id, actorId, reason = null) {
        const row = this.transition(id, ['open', 'claimed'], 'closed', actorId, reason,
            ', reason = ?, closed_at = ?', [reason, this.now()]);
        if (!row) throw new Error('This ticket cannot be closed.');
        return row;
    }

    reopen(id, actorId) {
        const row = this.transition(id, 'closed', 'open', actorId, null, ', claimer_id = NULL, closed_at = NULL');
        if (!row) throw new Error('This ticket cannot be reopened.');
        return row;
    }

    beginDelete(id, actorId) {
        const current = this.getTicket(id);
        if (current?.status === 'deleting') return current;
        const row = this.transition(id, ['open', 'claimed', 'closed', 'pending'], 'deleting', actorId);
        if (!row) throw new Error('This ticket cannot be deleted.');
        return row;
    }

    markDeleted(id, actorId) {
        return this.sqlite.transaction(() => {
            const current = this.getTicket(id);
            if (!current) throw new Error('Ticket not found.');
            if (current.status === 'deleted') return current;
            const now = this.now();
            const row = this.sqlite.prepare(`UPDATE tickets SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ? AND status != 'deleted' RETURNING *`)
                .get(now, now, id);
            this.recordAction(id, actorId, 'deleted');
            return rowToTicket(row);
        }).immediate();
    }

    recordAction(ticketId, actorId, action, detail = null) {
        this.sqlite.prepare('INSERT INTO ticket_actions (ticket_id, actor_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(ticketId, actorId, action, detail, this.now());
    }

    renderTranscript({ ticket, messages }) {
        const rows = messages.map(message => {
            const display = message.member?.displayName || message.author?.username || message.author?.id || 'Unknown';
            const roles = [...(message.member?.roles?.cache?.values?.() || [])].map(role => role.name).filter(Boolean).join(', ');
            const attachments = [...(message.attachments?.values?.() || [])]
                .filter(file => /^https:\/\//i.test(file.url || ''))
                .map(file => `<a href="${escapeHtml(file.url)}">${escapeHtml(file.name || 'attachment')}</a>`).join(' ');
            return `<article><header>${escapeHtml(display)} (${escapeHtml(message.author?.id || '')}) · ${escapeHtml(new Date(message.createdTimestamp || 0).toISOString())}</header>`
                + `${roles ? `<small>${escapeHtml(roles)}</small>` : ''}<p>${escapeHtml(message.content)}</p>${attachments}</article>`;
        }).join('\n');
        const html = '<!doctype html><html><head><meta charset="utf-8"><title>'
            + `Ticket #${escapeHtml(ticket.number)}</title></head><body><h1>Ticket #${escapeHtml(ticket.number)}</h1>`
            + `<dl><dt>Opener</dt><dd>${escapeHtml(ticket.openerId)}</dd><dt>Topic</dt><dd>${escapeHtml(ticket.topicName || 'General')}</dd></dl>`
            + `${rows}</body></html>`;
        if (Buffer.byteLength(html) > MAX_TRANSCRIPT_BYTES) {
            throw new Error('This complete transcript exceeds ByteBot’s safe 8 MiB attachment limit; the ticket was not deleted.');
        }
        return html;
    }

    async handleMessage(message) {
        const ticket = this.getByChannel(message.guild.id, message.channel.id);
        if (!ticket || !['open', 'claimed'].includes(ticket.status)) return;
        const hours = this.getConfig(message.guild.id)?.inactivity_hours;
        if (!hours) return;
        this.sqlite.prepare('UPDATE tickets SET inactivity_deadline = ?, warned_at = NULL, updated_at = ? WHERE id = ?')
            .run(this.now() + hours * 3600000, this.now(), ticket.id);
    }

    async handleMemberRemove(member) {
        const rows = this.sqlite.prepare(`SELECT * FROM tickets WHERE guild_id = ? AND opener_id = ? AND status IN ('open', 'claimed')`).all(member.guild.id, member.id);
        for (const row of rows) {
            const ticket = rowToTicket(row);
            const closeOnLeave = ticket.accessSnapshot?.closeOnLeave
                || Boolean(ticket.optionId && this.optionContext(ticket.optionId)?.close_on_leave);
            if (!closeOnLeave) continue;
            const channel = member.guild.channels.cache.get(ticket.channelId) || await member.guild.channels.fetch(ticket.channelId).catch(() => null);
            if (channel) {
                await this.log(ticket.guildId, `Ticket #${ticket.number} opener <@${member.id}> left the server.`);
                await this.closeDiscordTicket(ticket, channel, this.client.user.id, 'Ticket opener left the server');
            }
        }
    }

    async reconcile() {
        if (!this.client) return { adopted: 0, lost: 0, ambiguous: 0 };
        let adopted = 0;
        let lost = 0;
        let ambiguous = 0;
        const pending = this.sqlite.prepare("SELECT * FROM tickets WHERE status = 'pending'").all();
        for (const row of pending) {
            const guild = this.client.guilds.cache.get(row.guild_id) || await this.client.guilds.fetch(row.guild_id).catch(() => null);
            if (!guild) continue;
            const matches = [...guild.channels.cache.values()].filter(channel => channel.topic?.includes(`ByteBot ticket:${row.id} `));
            if (matches.length === 1) {
                this.attachChannel(row.id, matches[0].id);
                adopted++;
            } else if (matches.length === 0) {
                this.markDeleted(row.id, this.client.user.id);
                lost++;
            } else {
                ambiguous++;
                logger.error(`Ticket #${row.id} has ${matches.length} marked channels; no channel was changed.`);
            }
        }
        const active = this.sqlite.prepare("SELECT * FROM tickets WHERE channel_id IS NOT NULL AND status IN ('open', 'claimed', 'closed', 'deleting')").all();
        for (const row of active) {
            const guild = this.client.guilds.cache.get(row.guild_id);
            if (!guild) continue;
            const channel = guild.channels.cache.get(row.channel_id) || await guild.channels.fetch(row.channel_id).catch(error => {
                if (error?.code === 10003 || error?.rawError?.code === 10003) return null;
                throw error;
            });
            if (!channel) {
                this.sqlite.prepare("UPDATE tickets SET status = 'lost', updated_at = ? WHERE id = ?").run(this.now(), row.id);
                this.recordAction(row.id, this.client.user.id, 'channel_lost');
                lost++;
            } else if (['open', 'claimed', 'closed'].includes(row.status)) {
                await this.syncChannelAccess(rowToTicket(row), channel).catch(error => {
                    logger.warn(`Ticket #${row.id} access reconciliation failed: ${error.message}`);
                });
            }
        }
        return { adopted, lost, ambiguous };
    }

    purgeGuild(guildId) {
        this.sqlite.transaction(() => {
            const ticketIds = this.sqlite.prepare('SELECT id FROM tickets WHERE guild_id = ?').all(guildId).map(row => row.id);
            const panels = this.sqlite.prepare('SELECT id FROM ticket_panels WHERE guild_id = ?').all(guildId).map(row => row.id);
            const options = panels.flatMap(id => this.sqlite.prepare('SELECT id FROM ticket_options WHERE panel_id = ?').all(id).map(row => row.id));
            const forms = panels.flatMap(id => this.sqlite.prepare('SELECT id FROM ticket_forms WHERE panel_id = ?').all(id).map(row => row.id));
            const topics = this.sqlite.prepare('SELECT id FROM ticket_topics WHERE guild_id = ?').all(guildId).map(row => row.id);
            for (const id of ticketIds) {
                this.sqlite.prepare('DELETE FROM ticket_actions WHERE ticket_id = ?').run(id);
                this.sqlite.prepare('DELETE FROM ticket_members WHERE ticket_id = ?').run(id);
                this.sqlite.prepare('DELETE FROM ticket_transcripts WHERE ticket_id = ?').run(id);
                this.sqlite.prepare('DELETE FROM ticket_ratings WHERE ticket_id = ?').run(id);
            }
            for (const id of options) this.sqlite.prepare('DELETE FROM ticket_option_roles WHERE option_id = ?').run(id);
            for (const id of forms) this.sqlite.prepare('DELETE FROM ticket_form_fields WHERE form_id = ?').run(id);
            for (const id of topics) this.sqlite.prepare('DELETE FROM ticket_topic_roles WHERE topic_id = ?').run(id);
            for (const id of panels) {
                this.sqlite.prepare('DELETE FROM ticket_options WHERE panel_id = ?').run(id);
                this.sqlite.prepare('DELETE FROM ticket_forms WHERE panel_id = ?').run(id);
            }
            this.sqlite.prepare('DELETE FROM tickets WHERE guild_id = ?').run(guildId);
            this.sqlite.prepare('DELETE FROM ticket_panels WHERE guild_id = ?').run(guildId);
            this.sqlite.prepare('DELETE FROM ticket_topics WHERE guild_id = ?').run(guildId);
            this.sqlite.prepare('DELETE FROM ticket_blacklist WHERE guild_id = ?').run(guildId);
            this.sqlite.prepare('DELETE FROM ticket_profiles WHERE guild_id = ?').run(guildId);
            this.sqlite.prepare('DELETE FROM ticket_configs WHERE guild_id = ?').run(guildId);
        })();
    }

    async runDue() {
        if (!this.client || this.running) return;
        this.running = true;
        try {
            const due = this.sqlite.prepare(`SELECT * FROM tickets WHERE status IN ('open', 'claimed')
            AND inactivity_deadline IS NOT NULL AND inactivity_deadline <= ? AND warned_at IS NULL LIMIT 25`).all(this.now());
            for (const row of due) {
                const ticket = rowToTicket(row);
                const guild = this.client.guilds.cache.get(ticket.guildId);
                const channel = guild?.channels.cache.get(ticket.channelId);
                if (!channel) continue;
                await channel.send({
                    content: '⚠️ This ticket is inactive. Staff may close or delete it.',
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`ticket:action:close:${ticket.id}`).setLabel('Close').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId(`ticket:action:delete:${ticket.id}`).setLabel('Delete').setStyle(ButtonStyle.Danger)
                    )], allowedMentions: SAFE_MENTIONS
                });
                this.sqlite.prepare('UPDATE tickets SET warned_at = ?, inactivity_deadline = NULL, updated_at = ? WHERE id = ? AND warned_at IS NULL')
                    .run(this.now(), this.now(), ticket.id);
                this.recordAction(ticket.id, this.client.user.id, 'inactive');
                await this.log(ticket.guildId, `Ticket #${ticket.number} reached its inactivity timeout.`);
            }
        } finally {
            this.running = false;
        }
    }
}

module.exports = { ACTIVE_STATES, TicketService, escapeHtml };
