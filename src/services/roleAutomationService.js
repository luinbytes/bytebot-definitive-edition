const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { and, eq } = require('drizzle-orm');
const { db } = require('../database');
const { automationRules, deniedRolePermissions } = require('../database/schema');
const { RoleManager } = require('../utils/discordApiUtil');

const BUTTON_STYLES = {
    primary: ButtonStyle.Primary,
    secondary: ButtonStyle.Secondary,
    success: ButtonStyle.Success,
    danger: ButtonStyle.Danger
};

function configOf(rule) {
    try { return JSON.parse(rule.config || '{}'); } catch { return {}; }
}

function boundedList(lines, empty) {
    if (!lines.length) return empty;
    const visible = [];
    while (lines.length && `${visible.join('\n')}\n${lines[0]}`.length <= 1800) visible.push(lines.shift());
    return `${visible.join('\n')}${lines.length ? `\n… ${lines.length} more configured.` : ''}`;
}

function emojiKey(emoji) {
    if (typeof emoji !== 'string') return emoji.id || emoji.name;
    return /<a?:\w+:(\d+)>/.exec(emoji)?.[1] || emoji;
}

function parseMessageLink(link, guildId) {
    const match = /^https?:\/\/(?:canary\.|ptb\.)?(?:discord(?:app)?\.com)\/channels\/(\d+)\/(\d+)\/(\d+)\/?$/.exec(String(link).trim());
    if (!match || match[1] !== guildId) return null;
    return { channelId: match[2], messageId: match[3] };
}

class RoleAutomationService {
    constructor(client, automationService) {
        this.client = client;
        this.automation = automationService;
        this.boosterLists = new Map();
        this.boosterLocks = new Map();
    }

    async validateRole(guild, role, actor) {
        if (!role || role.id === guild.id || role.managed || !role.editable) return 'That role is managed or above ByteBot.';
        if (actor && actor.id !== guild.ownerId && role.position >= actor.roles.highest.position) return 'You cannot manage a role at or above your highest role.';
        const denied = await db.select().from(deniedRolePermissions).where(eq(deniedRolePermissions.guildId, guild.id));
        const blocked = denied.find(row => role.permissions?.has(PermissionFlagsBits[row.permission]));
        return blocked ? `That role carries the blocked permission ${blocked.permission}.` : null;
    }

    async fetchMessage(guild, link) {
        const target = parseMessageLink(link, guild.id);
        if (!target) throw new Error('Use a message link from this server.');
        const channel = guild.channels.cache.get(target.channelId) || await guild.channels.fetch(target.channelId).catch(() => null);
        if (!channel?.messages?.fetch) throw new Error('ByteBot cannot access that message channel.');
        const message = await channel.messages.fetch(target.messageId).catch(() => null);
        if (!message) throw new Error('That message was not found.');
        return message;
    }

    async addReactionRole({ guild, messageLink, emoji, role, actor, createdBy }) {
        const invalid = await this.validateRole(guild, role, actor);
        if (invalid) throw new Error(invalid);
        const message = await this.fetchMessage(guild, messageLink);
        const key = `${message.id}:${emojiKey(emoji)}`;
        const existing = await this.automation.get(guild.id, 'reaction-role', key);
        const reaction = await message.react(emoji);
        try {
            const now = Date.now();
            const saved = db.transaction(tx => {
                const rules = tx.select().from(automationRules).where(and(
                    eq(automationRules.guildId, guild.id), eq(automationRules.kind, 'reaction-role')
                )).all();
                if (rules.length >= 500 && !rules.some(rule => rule.key === key)) return null;
                return tx.insert(automationRules).values({
                    guildId: guild.id, kind: 'reaction-role', key,
                    config: JSON.stringify({ channelId: message.channel.id, messageId: message.id, emoji, roleId: role.id }),
                    enabled: true, createdBy, createdAt: now, updatedAt: now
                }).onConflictDoUpdate({
                    target: [automationRules.guildId, automationRules.kind, automationRules.key],
                    set: { config: JSON.stringify({ channelId: message.channel.id, messageId: message.id, emoji, roleId: role.id }), enabled: true, updatedAt: now }
                }).returning().get();
            });
            if (!saved) throw new Error('This server has reached the 500 reaction-role limit.');
            return saved;
        } catch (error) {
            if (!existing && !await this.automation.get(guild.id, 'reaction-role', key)) {
                await reaction.users.remove(this.client.user.id).catch(() => null);
            }
            throw error;
        }
    }

    async removeReactionRole(guild, messageLink, emoji) {
        const message = await this.fetchMessage(guild, messageLink);
        return this.automation.remove(guild.id, 'reaction-role', `${message.id}:${emojiKey(emoji)}`);
    }

    async handleReaction(reaction, user, adding) {
        if (user.bot || !reaction.message.guild) return;
        const rule = await this.automation.get(reaction.message.guild.id, 'reaction-role', `${reaction.message.id}:${emojiKey(reaction.emoji)}`);
        if (!rule?.enabled) return;
        const config = configOf(rule);
        const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
        if (!member) return;
        const result = adding
            ? await RoleManager.addRole(member, config.roleId, { reason: 'Reaction role', logContext: 'reaction-role' })
            : await RoleManager.removeRole(member, config.roleId, { reason: 'Reaction role removed', logContext: 'reaction-role' });
        return result;
    }

    async addButtonRole({ guild, messageLink, role, actor, style = 'secondary', emoji, label, createdBy }) {
        const invalid = await this.validateRole(guild, role, actor);
        if (invalid) throw new Error(invalid);
        const message = await this.fetchMessage(guild, messageLink);
        if (message.author.id !== this.client.user.id) throw new Error('Button roles can only be added to ByteBot-authored messages.');
        if (message.components?.some(row => row.components.some(component => component.customId && !component.customId.startsWith('rolebtn:')))) {
            throw new Error('That message already contains components owned by another feature.');
        }
        const rules = (await this.automation.list(guild.id, 'button-role')).filter(rule => configOf(rule).messageId === message.id);
        if (rules.length >= 25) throw new Error('A message can have at most 25 role buttons.');
        if (rules.some(rule => configOf(rule).roleId === role.id)) throw new Error('That role already has a button on this message.');
        const key = `${message.id}:${role.id}`;
        await this.automation.upsert({ guildId: guild.id, kind: 'button-role', key, config: {
            channelId: message.channel.id, messageId: message.id, roleId: role.id,
            style: BUTTON_STYLES[style] ? style : 'secondary', emoji: emoji || null, label: label || role.name
        }, createdBy });
        try {
            await this.refreshButtons(guild, message);
        } catch (error) {
            await this.automation.remove(guild.id, 'button-role', key);
            throw error;
        }
    }

    async refreshButtons(guild, message) {
        const rules = (await this.automation.list(guild.id, 'button-role', true)).filter(rule => configOf(rule).messageId === message.id);
        const buttons = rules.map(rule => {
            const config = configOf(rule);
            const button = new ButtonBuilder().setCustomId(`rolebtn:${message.id}:${config.roleId}`)
                .setLabel(String(config.label || 'Toggle role').slice(0, 80)).setStyle(BUTTON_STYLES[config.style] || ButtonStyle.Secondary);
            if (config.emoji) button.setEmoji(config.emoji);
            return button;
        });
        const rows = [];
        while (buttons.length) rows.push(new ActionRowBuilder().addComponents(buttons.splice(0, 5)));
        await message.edit({ components: rows });
    }

    async handleButton(interaction) {
        const match = /^rolebtn:(\d+):(\d+)$/.exec(interaction.customId);
        if (!match || interaction.message.id !== match[1]) {
            return interaction.reply({ content: 'This role button is stale or expired.', flags: [MessageFlags.Ephemeral] });
        }
        const rule = await this.automation.get(interaction.guildId, 'button-role', `${match[1]}:${match[2]}`);
        if (!rule?.enabled || configOf(rule).messageId !== interaction.message.id) {
            return interaction.reply({ content: 'This role button is stale or expired.', flags: [MessageFlags.Ephemeral] });
        }
        const roleId = configOf(rule).roleId;
        const hasRole = interaction.member.roles.cache.has(roleId);
        const result = hasRole
            ? await RoleManager.removeRole(interaction.member, roleId, { reason: 'Button role removed', logContext: 'button-role' })
            : await RoleManager.addRole(interaction.member, roleId, { reason: 'Button role', logContext: 'button-role' });
        return interaction.reply({ content: result.success ? `Role ${hasRole ? 'removed' : 'added'}.` : result.error, flags: [MessageFlags.Ephemeral] });
    }

    async boosterRole(guildId, ownerId) {
        return this.automation.get(guildId, 'booster-role', ownerId);
    }

    claimBoosterRole({ guildId, ownerId, roleId = null, maxRoles, createdBy }) {
        const now = Date.now();
        return db.transaction(tx => {
            const rules = tx.select().from(automationRules).where(and(
                eq(automationRules.guildId, guildId), eq(automationRules.kind, 'booster-role')
            )).all();
            if (rules.some(rule => rule.key === ownerId)) return { status: 'owner' };
            if (roleId && rules.some(rule => configOf(rule).roleId === roleId)) return { status: 'role' };
            if (rules.length >= maxRoles) return { status: 'limit' };
            const pendingName = roleId ? null : `ByteBot pending ${crypto.randomUUID()}`;
            tx.insert(automationRules).values({
                guildId, kind: 'booster-role', key: ownerId,
                config: JSON.stringify({ roleId, shares: [], pendingName, pendingGrant: Boolean(roleId), included: Boolean(roleId) }), enabled: true,
                nextRunAt: now + 60000, createdBy, createdAt: now, updatedAt: now
            }).run();
            return { status: 'claimed', pendingName };
        });
    }

    async withBoosterLock(key, work) {
        const previous = this.boosterLocks.get(key) || Promise.resolve();
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const tail = previous.then(() => gate);
        this.boosterLocks.set(key, tail);
        await previous;
        try {
            return await work();
        } finally {
            release();
            if (this.boosterLocks.get(key) === tail) this.boosterLocks.delete(key);
        }
    }

    async reconcileBooster(rule) {
        const guild = this.client.guilds.cache.get(rule.guildId);
        if (!guild) throw new Error('Guild is temporarily unavailable');
        const config = configOf(rule);
        if (!config.roleId && config.pendingName) {
            const roles = await guild.roles.fetch();
            const pending = roles.find(role => role.name === config.pendingName);
            if (pending) await pending.delete('Interrupted booster role setup');
            await this.automation.remove(guild.id, 'booster-role', rule.key);
            return false;
        }
        let role = config.roleId && guild.roles.cache.get(config.roleId);
        if (config.roleId && !role) {
            try {
                role = await guild.roles.fetch(config.roleId);
            } catch (error) {
                if (error.code !== 10011) throw error;
            }
        }
        if (!role) {
            await this.automation.remove(guild.id, 'booster-role', rule.key);
            return false;
        }
        let member;
        try {
            member = await guild.members.fetch(rule.key);
        } catch (error) {
            if (error.code !== 10007) throw error;
        }
        if (config.pendingGrant && member?.premiumSince) {
            if (!member.roles.cache.has(role.id)) {
                await this.automation.remove(guild.id, 'booster-role', rule.key);
                return false;
            }
            await this.automation.upsert({ guildId: guild.id, kind: 'booster-role', key: rule.key,
                config: { ...config, pendingGrant: false }, nextRunAt: Date.now() + 3600000, createdBy: rule.createdBy });
            return true;
        }
        if (member?.premiumSince && !config.cleanup) return true;
        await this.cleanupBooster(member || { id: rule.key, guild }, !config.cleanup);
        return false;
    }

    async listBoosters(guild) {
        const cached = this.boosterLists.get(guild.id);
        if (cached?.expiresAt > Date.now()) return cached.members;
        const members = [...(await guild.members.fetch()).values()].filter(member => member.premiumSince)
            .map(member => ({ id: member.id, premiumSinceTimestamp: member.premiumSinceTimestamp }));
        this.boosterLists.set(guild.id, { members, expiresAt: Date.now() + 300000 });
        return members;
    }

    async cleanupBooster(member, recordLost = true) {
        return this.withBoosterLock(`${member.guild.id}:${member.id}`, () => this.performBoosterCleanup(member, recordLost));
    }

    async requestBoosterCleanup(member) {
        return this.withBoosterLock(`${member.guild.id}:${member.id}`, async () => {
            const rule = await this.boosterRole(member.guild.id, member.id);
            if (!rule) return false;
            await this.automation.upsert({ guildId: member.guild.id, kind: 'booster-role', key: member.id,
                config: { ...configOf(rule), cleanup: true }, nextRunAt: Date.now() + 60000, createdBy: rule.createdBy });
            return this.performBoosterCleanup(member, false);
        });
    }

    async performBoosterCleanup(member, recordLost) {
        this.boosterLists.delete(member.guild.id);
        const rule = await this.boosterRole(member.guild.id, member.id);
        if (!rule) return false;
        const config = configOf(rule);
        const role = member.guild.roles.cache.get(config.roleId) || await member.guild.roles.fetch(config.roleId);
        if (config.included && role) {
            for (const userId of config.shares || []) {
                let shared;
                try {
                    shared = await member.guild.members.fetch(userId);
                } catch (error) {
                    if (error.code !== 10007) throw error;
                }
                if (shared) {
                    const removed = await RoleManager.removeRole(shared, role, { reason: 'Booster role owner stopped boosting', logContext: 'booster-role' });
                    if (!removed.success) throw new Error(removed.error);
                }
            }
            if (member.user) {
                const removed = await RoleManager.removeRole(member, role, { reason: 'Booster role owner stopped boosting', logContext: 'booster-role' });
                if (!removed.success) throw new Error(removed.error);
            }
        } else await role?.delete('Booster stopped boosting or left');
        await this.automation.remove(member.guild.id, 'booster-role', member.id);
        if (recordLost) await this.automation.upsert({ guildId: member.guild.id, kind: 'booster-lost', key: member.id, config: {
            userId: member.id, lostAt: Date.now()
        }, enabled: false, createdBy: member.id });
        return true;
    }

    async handleMemberUpdate(oldMember, newMember) {
        if (Boolean(oldMember.premiumSince) !== Boolean(newMember.premiumSince)) this.boosterLists.delete(newMember.guild.id);
        if (oldMember.premiumSince && !newMember.premiumSince) return this.cleanupBooster(newMember);
        if (!oldMember.premiumSince && newMember.premiumSince) return this.automation.remove(newMember.guild.id, 'booster-lost', newMember.id);
    }
}

module.exports = RoleAutomationService;
module.exports.configOf = configOf;
module.exports.boundedList = boundedList;
