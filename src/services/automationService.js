const crypto = require('crypto');
const { and, count, eq, isNull, lte, or, sql } = require('drizzle-orm');
const { db } = require('../database');
const { automationRules } = require('../database/schema');
const logger = require('../utils/logger');
const { RoleManager } = require('../utils/discordApiUtil');
const { parseEmbedScript } = require('./lifecycleMessageService');

const DISBOARD_ID = '302050872383242240';
const SAFE_MENTIONS = { parse: [], repliedUser: false };
const SCHEDULED_KINDS = new Set(['timer', 'bumpreminder', 'sticky', 'revive', 'counter', 'delete-message', 'tracking', 'temp-role', 'booster-role']);
const MAX_PENDING_DELETES = 250;

function parseInterval(value) {
    const match = /^(\d+)\s*([smhdw])$/i.exec(String(value || ''));
    if (!match) return null;
    const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[match[2].toLowerCase()];
    const ms = Number(match[1]) * unit;
    return ms >= 6000 && ms <= 28 * 86400000 ? ms : null;
}

function configOf(rule) {
    try { return JSON.parse(rule.config || '{}'); } catch { return {}; }
}

function render(template, context) {
    const member = context.member || context.author;
    return String(template || '')
        .replaceAll('{user}', member ? `<@${member.id}>` : '')
        .replaceAll('{member.mention}', member ? `<@${member.id}>` : '')
        .replaceAll('{user.mention}', member ? `<@${member.id}>` : '')
        .replaceAll('{user.id}', member?.id || '')
        .replaceAll('{user.name}', member?.user?.username || member?.username || '')
        .replaceAll('{guild.name}', context.guild?.name || '')
        .replaceAll('{guild.id}', context.guild?.id || '')
        .replaceAll('{guild.count}', String(context.guild?.memberCount || 0))
        .replaceAll('{server}', context.guild?.name || '')
        .replaceAll('{channel}', context.channel ? `<#${context.channel.id}>` : '')
        .replaceAll('{channel.name}', context.channel?.name || '')
        .replaceAll('{channel.id}', context.channel?.id || '')
        .replaceAll('{channel.mention}', context.channel ? `<#${context.channel.id}>` : '')
        .replaceAll('{vanity}', context.vanity || '');
}

function payloadFor(template, context, allowedMentions = SAFE_MENTIONS) {
    const rendered = render(template, context);
    return /\{embed\}/i.test(rendered)
        ? { ...parseEmbedScript(rendered), allowedMentions }
        : { content: rendered, allowedMentions };
}

function editableRole(guild, roleId) {
    const role = guild.roles.cache.get(roleId);
    return Boolean(role?.editable && !role.managed);
}

function sendPayload(channel, payload, threadName = 'Automation notification') {
    if (channel.isThreadOnly?.()) return channel.threads.create({ name: threadName.slice(0, 100), message: payload, reason: 'Configured automation' });
    return channel.send(payload);
}

class AutomationService {
    constructor(client, options = {}) {
        this.client = client;
        this.pollMs = options.pollMs || 15000;
        this.batchSize = options.batchSize || 25;
        this.interval = null;
        this.running = false;
    }

    async start() {
        this.interval = setInterval(() => this.runDue().catch(error => logger.error('Automation scheduler failed:', error)), this.pollMs);
        this.interval.unref?.();
        await this.runDue().catch(error => logger.warn(`Initial automation poll failed; background retry remains active: ${error.message}`));
    }

    cleanup() {
        if (this.interval) clearInterval(this.interval);
        this.interval = null;
    }

    list(guildId, kind, enabledOnly = false) {
        const clauses = [eq(automationRules.guildId, guildId)];
        if (kind) clauses.push(eq(automationRules.kind, kind));
        if (enabledOnly) clauses.push(eq(automationRules.enabled, true));
        return db.select().from(automationRules).where(and(...clauses)).orderBy(automationRules.id).all();
    }

    get(guildId, kind, key) {
        return db.select().from(automationRules).where(and(
            eq(automationRules.guildId, guildId), eq(automationRules.kind, kind), eq(automationRules.key, key)
        )).get();
    }

    upsert({ guildId, kind, key, config = {}, enabled = true, nextRunAt = null, createdBy }) {
        const now = Date.now();
        return db.insert(automationRules).values({
            guildId, kind, key, config: JSON.stringify(config), enabled, nextRunAt,
            createdBy, createdAt: now, updatedAt: now
        }).onConflictDoUpdate({
            target: [automationRules.guildId, automationRules.kind, automationRules.key],
            set: { config: JSON.stringify(config), enabled, nextRunAt, updatedAt: now }
        }).returning().get();
    }

    remove(guildId, kind, key) {
        return db.delete(automationRules).where(and(
            eq(automationRules.guildId, guildId), eq(automationRules.kind, kind), eq(automationRules.key, key)
        )).returning().get();
    }

    clear(guildId, kind) {
        return db.delete(automationRules).where(and(eq(automationRules.guildId, guildId), eq(automationRules.kind, kind))).returning().all();
    }

    setEnabled(guildId, kind, key, enabled) {
        return db.update(automationRules).set({ enabled, updatedAt: Date.now() }).where(and(
            eq(automationRules.guildId, guildId), eq(automationRules.kind, kind), eq(automationRules.key, key)
        )).returning().get();
    }

    async handleMessage(message) {
        if (!message.guild) return;
        if (message.author.id === DISBOARD_ID) return this.handleBump(message);
        if (message.author.bot) return;

        const rules = await this.list(message.guild.id, null, true);
        for (const rule of rules) {
            const config = configOf(rule);
            if (rule.kind === 'counter' && rule.key === message.channel.id && config.mode === 'counting') {
                const value = /^\d+$/.test(message.content.trim()) ? Number(message.content.trim()) : NaN;
                const candidate = value === (config.current || 0) + 1 && config.lastUserId !== message.author.id;
                const updated = candidate && await db.update(automationRules).set({
                    config: JSON.stringify({ ...config, current: value, lastUserId: message.author.id }),
                    runCount: sql`${automationRules.runCount} + 1`, updatedAt: Date.now()
                }).where(and(eq(automationRules.id, rule.id), eq(automationRules.config, rule.config))).returning().get();
                const valid = Boolean(updated);
                await message.react(valid ? '✅' : '❌').catch(() => null);
                if (!valid) {
                    const pending = await db.select({ count: count() }).from(automationRules).where(and(
                        eq(automationRules.guildId, message.guild.id), eq(automationRules.kind, 'delete-message')
                    )).get();
                    if (Number(pending.count) < MAX_PENDING_DELETES) {
                        await this.upsert({ guildId: message.guild.id, kind: 'delete-message', key: message.id, config: {
                            channelId: message.channel.id, messageId: message.id
                        }, nextRunAt: Date.now() + 3000, createdBy: rule.createdBy });
                    }
                }
            }
            if (rule.kind === 'autoreact' && this.matches(message, config)) {
                for (const emoji of (config.reactions || []).slice(0, 15)) await message.react(emoji).catch(() => null);
            }
            if (rule.kind === 'sticky' && rule.key === message.channel.id) {
                await db.update(automationRules).set({ nextRunAt: Date.now() + 3000, updatedAt: Date.now() }).where(eq(automationRules.id, rule.id));
            }
            if (rule.kind === 'revive' && rule.key === message.channel.id) {
                await db.update(automationRules).set({ nextRunAt: Date.now() + (config.intervalMs || 21600000), updatedAt: Date.now() }).where(eq(automationRules.id, rule.id));
            }
        }
    }

    matches(message, config) {
        if (config.channelIds?.length && !config.channelIds.includes(message.channel.id)) return false;
        if (config.roleIds?.length && !config.roleIds.some(roleId => message.member?.roles.cache.has(roleId))) return false;
        if (config.event === 'image' && message.attachments?.size) return true;
        if (config.event === 'sticker' && message.stickers?.size) return true;
        if (config.event === 'spoiler' && message.content.includes('||')) return true;
        if (config.event === 'emoji' && /<a?:\w+:\d+>|[^\x00-\x7F]/u.test(message.content)) return true;
        const content = config.strict ? message.content : message.content.toLowerCase();
        const trigger = config.strict ? config.trigger : String(config.trigger || '').toLowerCase();
        return Boolean(trigger) && (config.exact ? content === trigger : content.includes(trigger));
    }

    async handleBump(message) {
        const successful = `${message.content || ''} ${message.embeds?.map(embed => `${embed.title || ''} ${embed.description || ''}`).join(' ')}`.toLowerCase().includes('bump done');
        if (!successful) return;
        const rule = await this.get(message.guild.id, 'bumpreminder', 'main');
        if (!rule?.enabled) return;
        if (rule.lastMessageId === message.id) return;
        const config = configOf(rule);
        const bumper = message.interaction?.user || message.interactionMetadata?.user || null;
        const bumperId = bumper?.id || null;
        const stats = { ...(config.stats || {}) };
        if (bumperId) stats[bumperId] = (stats[bumperId] || 0) + 1;
        await message.channel.send({
            ...payloadFor(config.thankyou || 'Thanks for bumping! {user}', { ...message, author: bumper || message.author },
                bumperId ? { parse: [], users: [bumperId], repliedUser: false } : SAFE_MENTIONS),
            nonce: message.id, enforceNonce: true
        });
        await db.update(automationRules).set({
            config: JSON.stringify({ ...config, stats, channelId: message.channel.id, bumperId }),
            nextRunAt: Date.now() + 7200000, lastMessageId: message.id,
            runCount: sql`${automationRules.runCount} + 1`, updatedAt: Date.now()
        }).where(eq(automationRules.id, rule.id));
    }

    async handleMemberAdd(member) {
        const rules = await this.list(member.guild.id, null, true);
        for (const rule of rules) {
            const config = configOf(rule);
            if (rule.kind === 'autorole' && ((rule.key.startsWith('bot:')) === member.user.bot)) {
                if (editableRole(member.guild, config.roleId)) {
                    await member.roles.add(config.roleId, 'Configured autorole').catch(error => logger.warn(`Autorole failed: ${error.message}`));
                }
            }
            if (rule.kind === 'pingonjoin' && rule.key === 'main') {
                if (config.threshold && member.guild.memberCount < config.threshold) continue;
                const channel = member.guild.channels.cache.get(config.channelId);
                if (channel?.isTextBased() || channel?.isThreadOnly?.()) await sendPayload(channel, payloadFor(config.message || 'Welcome {member.mention}!', { member, guild: member.guild, channel }, { users: [member.id], parse: [] }), `Welcome ${member.user.username}`);
            }
        }
    }

    async handlePresence(oldPresence, newPresence) {
        const member = newPresence.member;
        if (!member) return;
        const rule = await this.get(member.guild.id, 'vanity', 'main');
        if (!rule?.enabled) return;
        const config = configOf(rule);
        const text = newPresence.activities?.map(activity => activity.state || activity.name).join(' ') || '';
        const oldText = oldPresence?.activities?.map(activity => activity.state || activity.name).join(' ') || '';
        const matches = config.strict ? text === config.vanity : text.toLowerCase().includes(String(config.vanity || '').toLowerCase());
        const oldMatches = config.strict ? oldText === config.vanity : oldText.toLowerCase().includes(String(config.vanity || '').toLowerCase());
        for (const roleId of config.roleIds || []) {
            if (!editableRole(member.guild, roleId)) continue;
            if (matches) await member.roles.add(roleId, 'Vanity reward').catch(() => null);
            else await member.roles.remove(roleId, 'Vanity removed').catch(() => null);
        }
        if (matches && !oldMatches && config.channelId) {
            const channel = member.guild.channels.cache.get(config.channelId);
            if (channel) await sendPayload(channel, payloadFor(config.message || '{user} is supporting {vanity}', { member, guild: member.guild, channel, vanity: config.vanity }), `Vanity reward ${member.user.username}`).catch(() => null);
        }
    }

    async handleUserUpdate(oldUser, newUser) {
        if (!oldUser?.username || oldUser.username === newUser.username) return;
        for (const guild of this.client.guilds.cache.values()) {
            const rules = await this.list(guild.id, 'tracking', true);
            const usernameDays = rules.map(configOf).find(config => config.mode === 'channel' && (config.types || []).includes('username'))?.usernameDays || 14;
            const availableAt = Date.now() + usernameDays * 86400000;
            for (const rule of rules) {
                const config = configOf(rule);
                if (config.mode === 'channel' && (config.types || []).includes('username')) {
                    const dropped = [...(config.dropped || []), { type: 'username', value: oldUser.username, availableAt }].slice(-100);
                    await this.upsert({ guildId: guild.id, kind: 'tracking', key: rule.key, config: { ...config, dropped }, enabled: true, createdBy: rule.createdBy });
                    const channel = guild.channels.cache.get(config.channelId);
                    if (channel) await sendPayload(channel, { content: `Username **${oldUser.username}** changed and is being tracked.`, allowedMentions: SAFE_MENTIONS }, `Dropped username ${oldUser.username}`).catch(() => null);
                }
                if (config.mode === 'notify' && config.type === 'username' && String(config.desired || '').toLowerCase() === oldUser.username.toLowerCase()) {
                    await db.update(automationRules).set({ nextRunAt: availableAt, updatedAt: Date.now() }).where(eq(automationRules.id, rule.id));
                }
            }
        }
    }

    async handleGuildUpdate(oldGuild, newGuild) {
        if (!oldGuild?.vanityURLCode || oldGuild.vanityURLCode === newGuild.vanityURLCode) return;
        const rules = await this.list(newGuild.id, 'tracking', true);
        const vanityDays = rules.map(configOf).find(config => config.mode === 'channel' && (config.types || []).includes('vanity'))?.vanityDays || 16;
        const availableAt = Date.now() + vanityDays * 86400000;
        for (const rule of rules) {
            const config = configOf(rule);
            if (config.mode === 'channel' && (config.types || []).includes('vanity')) {
                const dropped = [...(config.dropped || []), { type: 'vanity', value: oldGuild.vanityURLCode, availableAt }].slice(-100);
                await this.upsert({ guildId: newGuild.id, kind: 'tracking', key: rule.key, config: { ...config, dropped }, enabled: true, createdBy: rule.createdBy });
                const channel = newGuild.channels.cache.get(config.channelId);
                if (channel) await sendPayload(channel,
                    config.message ? payloadFor(config.message, { guild: newGuild, channel, vanity: oldGuild.vanityURLCode })
                        : { content: `Vanity **${oldGuild.vanityURLCode}** changed and is being tracked.`, allowedMentions: SAFE_MENTIONS },
                    `Dropped vanity ${oldGuild.vanityURLCode}`).catch(() => null);
            }
            if (config.mode === 'notify' && config.type === 'vanity' && String(config.desired || '').toLowerCase() === oldGuild.vanityURLCode.toLowerCase()) {
                await db.update(automationRules).set({ nextRunAt: availableAt, updatedAt: Date.now() }).where(eq(automationRules.id, rule.id));
            }
        }
    }

    async runDue() {
        if (this.running) return;
        this.running = true;
        try {
            const now = Date.now();
            const due = await db.select().from(automationRules).where(and(
                eq(automationRules.enabled, true), lte(automationRules.nextRunAt, now),
                or(isNull(automationRules.leaseExpiresAt), lte(automationRules.leaseExpiresAt, now))
            )).orderBy(automationRules.nextRunAt).limit(this.batchSize).all();
            for (const rule of due) {
                if (!SCHEDULED_KINDS.has(rule.kind)) continue;
                try {
                    await this.deliver(rule, now);
                } catch (error) {
                    logger.warn(`Automation ${rule.kind} #${rule.id} delivery failed: ${error.message}`);
                }
            }
        } finally {
            this.running = false;
        }
    }

    async deliver(rule, now) {
        const config = configOf(rule);
        const recurring = rule.kind === 'timer' || rule.kind === 'revive' || (rule.kind === 'counter' && config.mode === 'metric');
        const nextRunAt = recurring ? now + (config.intervalMs || 3600000) : null;
        const leaseToken = crypto.randomUUID();
        const claimed = await db.update(automationRules).set({ leaseToken, leaseExpiresAt: now + 300000, updatedAt: now }).where(and(
            eq(automationRules.id, rule.id), eq(automationRules.enabled, true), eq(automationRules.nextRunAt, rule.nextRunAt),
            or(isNull(automationRules.leaseExpiresAt), lte(automationRules.leaseExpiresAt, now))
        )).returning().get();
        if (!claimed) return;
        if (rule.kind === 'tracking' && config.mode === 'notify') {
            try {
                const user = await this.client.users.fetch(config.userId);
                await user.send({
                    content: `The ${config.type} **${config.desired}** should now be available.`,
                    allowedMentions: SAFE_MENTIONS, nonce: `${rule.id}${String(rule.nextRunAt).slice(-15)}`, enforceNonce: true
                });
                await db.delete(automationRules).where(and(eq(automationRules.id, rule.id), eq(automationRules.leaseToken, leaseToken)));
            } catch (error) {
                await db.update(automationRules).set({ leaseToken: null, leaseExpiresAt: now + 60000 })
                    .where(and(eq(automationRules.id, rule.id), eq(automationRules.leaseToken, leaseToken)));
                throw error;
            }
            return;
        }
        if (rule.kind === 'temp-role') {
            try {
                const guild = this.client.guilds.cache.get(rule.guildId);
                if (!guild) throw new Error('Guild is temporarily unavailable');
                let member;
                try {
                    member = await guild.members.fetch(config.userId);
                } catch (error) {
                    if (error.code !== 10007) throw error;
                }
                let role = guild.roles.cache.get(config.roleId);
                if (!role) {
                    try {
                        role = await guild.roles.fetch(config.roleId);
                    } catch (error) {
                        if (error.code !== 10011) throw error;
                    }
                }
                if (member && role) {
                    const result = await RoleManager.removeRole(member, role, { reason: 'Temporary role expired', logContext: 'temp-role' });
                    if (!result.success) throw new Error(result.error);
                }
                await db.delete(automationRules).where(and(eq(automationRules.id, rule.id), eq(automationRules.leaseToken, leaseToken)));
            } catch (error) {
                await db.update(automationRules).set({ leaseToken: null, leaseExpiresAt: now + 60000 })
                    .where(and(eq(automationRules.id, rule.id), eq(automationRules.leaseToken, leaseToken)));
                throw error;
            }
            return;
        }
        if (rule.kind === 'booster-role') {
            try {
                if (!this.client.roleAutomationService) throw new Error('Role automation is temporarily unavailable');
                const active = await this.client.roleAutomationService.reconcileBooster(rule);
                if (active) await db.update(automationRules).set({
                    nextRunAt: now + 3600000, lastRunAt: now, runCount: sql`${automationRules.runCount} + 1`,
                    leaseToken: null, leaseExpiresAt: null, updatedAt: now
                }).where(and(eq(automationRules.id, rule.id), eq(automationRules.leaseToken, leaseToken)));
            } catch (error) {
                await db.update(automationRules).set({ leaseToken: null, leaseExpiresAt: now + 60000 })
                    .where(and(eq(automationRules.id, rule.id), eq(automationRules.leaseToken, leaseToken)));
                throw error;
            }
            return;
        }
        const guild = this.client.guilds.cache.get(rule.guildId);
        const channel = guild?.channels.cache.get(config.channelId || rule.key);
        if (!channel) {
            await db.update(automationRules).set({ nextRunAt: now + 60000, leaseToken: null, leaseExpiresAt: null })
                .where(and(eq(automationRules.id, rule.id), eq(automationRules.leaseToken, leaseToken), eq(automationRules.nextRunAt, rule.nextRunAt)));
            await db.update(automationRules).set({ leaseToken: null, leaseExpiresAt: null })
                .where(and(eq(automationRules.id, rule.id), eq(automationRules.leaseToken, leaseToken)));
            return;
        }

        try {
            if (rule.kind === 'delete-message') {
                try {
                    await channel.messages.delete(config.messageId);
                } catch (error) {
                    if (error?.code !== 10008 && error?.rawError?.code !== 10008) throw error;
                }
                await db.delete(automationRules).where(and(eq(automationRules.id, rule.id), eq(automationRules.leaseToken, leaseToken)));
                return;
            }
            if (rule.kind === 'counter' && config.mode === 'metric') {
                const value = config.metric === 'members' ? guild.memberCount
                    : [...(guild.voiceStates?.cache?.values?.() || [])].filter(state => state.channelId).length;
                await channel.setName(`${config.label || config.metric}: ${value}`, 'Automation counter');
            } else {
                const nonce = `${rule.id}${String(rule.nextRunAt).slice(-15)}`;
                if (rule.kind === 'sticky' && rule.lastMessageId) await channel.messages.delete(rule.lastMessageId).catch(() => null);
                const fallback = rule.kind === 'bumpreminder' ? 'It is time to bump the server again!' : rule.kind === 'revive' ? 'This channel could use a little life!' : '';
                const sent = await channel.send({
                    ...payloadFor(config.message || config.reminder || fallback, { guild, channel }), nonce, enforceNonce: true
                });
                if (rule.kind === 'sticky') await db.update(automationRules).set({ lastMessageId: sent.id }).where(and(
                    eq(automationRules.id, rule.id), eq(automationRules.leaseToken, leaseToken)
                ));
            }
            const finished = await db.update(automationRules).set({
                nextRunAt, lastRunAt: now, runCount: sql`${automationRules.runCount} + 1`,
                leaseToken: null, leaseExpiresAt: null, updatedAt: now
            }).where(and(eq(automationRules.id, rule.id), eq(automationRules.leaseToken, leaseToken), eq(automationRules.nextRunAt, rule.nextRunAt))).returning().get();
            if (!finished) await db.update(automationRules).set({
                lastRunAt: now, runCount: sql`${automationRules.runCount} + 1`, leaseToken: null, leaseExpiresAt: null, updatedAt: now
            }).where(and(eq(automationRules.id, rule.id), eq(automationRules.leaseToken, leaseToken)));
        } catch (error) {
            // Keep the original deadline so a retry reuses the same Discord nonce.
            // A network failure may have happened after Discord accepted the send.
            await db.update(automationRules).set({ leaseToken: null, leaseExpiresAt: now + 60000 })
                .where(and(eq(automationRules.id, rule.id), eq(automationRules.leaseToken, leaseToken)));
            throw error;
        }
    }
}

module.exports = AutomationService;
module.exports.parseInterval = parseInterval;
module.exports.render = render;
module.exports.SAFE_MENTIONS = SAFE_MENTIONS;
module.exports.MAX_PENDING_DELETES = MAX_PENDING_DELETES;
module.exports.payloadFor = payloadFor;
module.exports.sendPayload = sendPayload;
