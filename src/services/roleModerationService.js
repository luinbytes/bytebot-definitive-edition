const { PermissionFlagsBits } = require('discord.js');
const { sqlite } = require('../database');
const { RoleManager } = require('../utils/discordApiUtil');
const { validateHierarchy, validateProtectedTarget } = require('../utils/moderationUtil');
const { recordCompletedCase } = require('./moderationService');

const MAX_BULK_MEMBERS = 5000;
const DANGEROUS = [
    PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.BanMembers, PermissionFlagsBits.KickMembers,
    PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.ManageWebhooks,
    PermissionFlagsBits.MentionEveryone
];

function validateRole(executor, guild, role, { adding = false } = {}) {
    if (!role || role.id === guild.id || role.managed) throw new Error('That role cannot be managed.');
    if (role.position >= guild.members.me.roles.highest.position) throw new Error('That role is higher than or equal to my highest role.');
    if (!executor.permissions.has(PermissionFlagsBits.Administrator) && role.position >= executor.roles.highest.position) {
        throw new Error('That role is higher than or equal to your highest role.');
    }
    const protection = validateProtectedTarget(guild.id, '', [role.id]);
    if (!protection.valid) throw new Error(protection.error);
    if (adding && DANGEROUS.some(permission => role.permissions?.has(permission))) {
        throw new Error('Roles with administrator, moderation, or management permissions cannot be assigned.');
    }
}

function snapshotRoles(member) {
    const roleIds = [...member.roles.cache.values()]
        .filter(role => role.id !== member.guild.id && !role.managed)
        .map(role => role.id);
    sqlite.prepare(`
        INSERT INTO member_role_snapshots (guild_id, user_id, role_ids, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (guild_id, user_id) DO UPDATE SET role_ids = excluded.role_ids, updated_at = excluded.updated_at
    `).run(member.guild.id, member.id, JSON.stringify(roleIds), Date.now());
}

async function changeMemberRole({ guild, executor, member, role, add, reason }) {
    const hierarchy = validateHierarchy(executor, member);
    if (!hierarchy.valid) throw new Error(hierarchy.error);
    validateRole(executor, guild, role, { adding: add });
    if (!add) snapshotRoles(member);
    const result = await RoleManager[add ? 'addRole' : 'removeRole'](member, role, {
        reason,
        logContext: `moderation:role:${add ? 'add' : 'remove'}`
    });
    if (!result.success) throw new Error(result.error);
    recordCompletedCase({
        guildId: guild.id, targetId: member.id, executorId: executor.id,
        action: add ? 'ROLE_ADD' : 'ROLE_REMOVE', reason: `${reason} (${role.id})`
    });
}

async function restoreMemberRoles({ guild, executor, member, reason }) {
    const hierarchy = validateHierarchy(executor, member);
    if (!hierarchy.valid) throw new Error(hierarchy.error);
    const snapshot = sqlite.prepare('SELECT role_ids FROM member_role_snapshots WHERE guild_id = ? AND user_id = ?')
        .get(guild.id, member.id);
    if (!snapshot) throw new Error('This member has no saved roles to restore.');
    const roles = JSON.parse(snapshot.role_ids).map(id => guild.roles.cache.get(id)).filter(Boolean);
    let restored = 0;
    for (const role of roles) {
        validateRole(executor, guild, role, { adding: true });
        const result = await RoleManager.addRole(member, role, { reason, logContext: 'moderation:role:restore' });
        if (!result.success) throw new Error(`Restored ${restored} roles; ${result.error}. Retry is safe.`);
        restored++;
    }
    sqlite.prepare('DELETE FROM member_role_snapshots WHERE guild_id = ? AND user_id = ?').run(guild.id, member.id);
    recordCompletedCase({ guildId: guild.id, targetId: member.id, executorId: executor.id, action: 'ROLE_RESTORE', reason });
    return restored;
}

async function bulkRole({ guild, executor, role, add, scope, targetRole, reason }) {
    validateRole(executor, guild, role, { adding: add });
    if (targetRole) validateRole(executor, guild, targetRole);
    const fetched = await guild.members.fetch();
    let members = [...fetched.values()].filter(member => {
        if (scope === 'bots') return member.user.bot;
        if (scope === 'humans') return !member.user.bot;
        if (scope === 'has') return member.roles.cache.has(targetRole.id);
        return true;
    });
    if (members.length > MAX_BULK_MEMBERS) throw new Error(`Bulk role actions are capped at ${MAX_BULK_MEMBERS} members.`);
    members = members.filter(member => add ? !member.roles.cache.has(role.id) : member.roles.cache.has(role.id));
    let changed = 0;
    let skipped = 0;
    for (let index = 0; index < members.length; index += 5) {
        const results = await Promise.all(members.slice(index, index + 5).map(async member => {
            const hierarchy = validateHierarchy(executor, member);
            if (!hierarchy.valid) return false;
            if (!add) snapshotRoles(member);
            const result = await RoleManager[add ? 'addRole' : 'removeRole'](member, role, {
                reason, logContext: 'moderation:role:bulk'
            });
            return result.success;
        }));
        changed += results.filter(Boolean).length;
        skipped += results.filter(result => !result).length;
    }
    recordCompletedCase({
        guildId: guild.id, targetId: role.id, executorId: executor.id,
        action: add ? 'ROLE_BULK_ADD' : 'ROLE_BULK_REMOVE',
        reason: `${reason}; scope=${scope}; changed=${changed}; skipped=${skipped}`
    });
    return { changed, skipped };
}

async function setNickname({ guild, executor, member, nickname, force = false, remove = false, cancel = false, reason }) {
    const hierarchy = validateHierarchy(executor, member);
    if (!hierarchy.valid) throw new Error(hierarchy.error);
    const forced = sqlite.prepare('SELECT nickname FROM forced_nicknames WHERE guild_id = ? AND user_id = ?').get(guild.id, member.id);
    if (cancel) {
        if (!forced) throw new Error('This member does not have a forced nickname.');
        sqlite.prepare('DELETE FROM forced_nicknames WHERE guild_id = ? AND user_id = ?').run(guild.id, member.id);
        return;
    }
    if (forced && !force) throw new Error('Cancel the forced nickname first.');
    if (!remove && (!nickname || nickname.length > 32)) throw new Error('Nickname must be 1–32 characters.');
    await member.setNickname(remove ? null : nickname, reason);
    if (force) {
        sqlite.prepare(`
            INSERT INTO forced_nicknames (guild_id, user_id, nickname, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT (guild_id, user_id) DO UPDATE SET nickname = excluded.nickname, updated_at = excluded.updated_at
        `).run(guild.id, member.id, nickname, Date.now());
    }
    recordCompletedCase({
        guildId: guild.id, targetId: member.id, executorId: executor.id,
        action: force ? 'NICKNAME_FORCE' : remove ? 'NICKNAME_REMOVE' : 'NICKNAME', reason
    });
}

module.exports = {
    MAX_BULK_MEMBERS, validateRole, changeMemberRole, restoreMemberRoles, bulkRole, setNickname
};
