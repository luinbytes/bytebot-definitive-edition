const logger = require('../utils/logger');

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

function rowToTicket(row) {
    if (!row) return null;
    return {
        ...row,
        openerId: row.opener_id,
        panelId: row.panel_id,
        optionId: row.option_id,
        topicId: row.topic_id,
        topicName: row.topic_name,
        channelId: row.channel_id,
        claimerId: row.claimer_id,
        formSnapshot: row.form_snapshot,
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

class TicketService {
    constructor(client, options = {}) {
        this.client = client;
        this.sqlite = options.sqlite || require('../database').sqlite;
        this.now = options.now || Date.now;
        this.pollMs = options.pollMs || 60000;
        this.interval = null;
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

    reserveTicket({ guildId, openerId, panelId = null, optionId = null, topicId = null, topicName = null, formSnapshot = null }) {
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
                    (guild_id, number, opener_id, panel_id, option_id, topic_id, topic_name, status, form_snapshot, inactivity_deadline, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
                RETURNING *
            `).get(guildId, number, openerId, panelId, optionId, topicId, topicName || (topicId == null ? null : String(topicId)),
                formSnapshot && JSON.stringify(formSnapshot), deadline, now, now);
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
        const row = this.sqlite.prepare(`UPDATE tickets SET channel_id = ?, status = 'open', updated_at = ? WHERE id = ? AND status = 'pending' RETURNING *`)
            .get(channelId, this.now(), id);
        if (!row) throw new Error('Ticket is no longer pending.');
        this.recordAction(id, row.opener_id, 'opened', channelId);
        return rowToTicket(row);
    }

    transition(id, from, to, actorId, detail = null, extra = '', extraValues = []) {
        const states = Array.isArray(from) ? from : [from];
        const placeholders = states.map(() => '?').join(',');
        const row = this.sqlite.prepare(`UPDATE tickets SET status = ?, updated_at = ?${extra} WHERE id = ? AND status IN (${placeholders}) RETURNING *`)
            .get(to, this.now(), ...extraValues, id, ...states);
        if (!row) return null;
        this.recordAction(id, actorId, to, detail);
        return rowToTicket(row);
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
        const row = this.transition(id, ['open', 'claimed', 'closed', 'pending'], 'deleting', actorId);
        if (!row) throw new Error('This ticket cannot be deleted.');
        return row;
    }

    markDeleted(id, actorId) {
        const current = this.getTicket(id);
        if (!current) throw new Error('Ticket not found.');
        if (current.status === 'deleted') return current;
        const now = this.now();
        const row = this.sqlite.prepare(`UPDATE tickets SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ? AND status != 'deleted' RETURNING *`)
            .get(now, now, id);
        this.recordAction(id, actorId, 'deleted');
        return rowToTicket(row);
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
        return '<!doctype html><html><head><meta charset="utf-8"><title>'
            + `Ticket #${escapeHtml(ticket.number)}</title></head><body><h1>Ticket #${escapeHtml(ticket.number)}</h1>`
            + `<dl><dt>Opener</dt><dd>${escapeHtml(ticket.openerId)}</dd><dt>Topic</dt><dd>${escapeHtml(ticket.topicName || 'General')}</dd></dl>`
            + `${rows}</body></html>`;
    }

    async runDue() {}
}

module.exports = { ACTIVE_STATES, TicketService, escapeHtml };
