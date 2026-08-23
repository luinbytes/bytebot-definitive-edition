const { sqlite } = require('../database');
const { PermissionFlagsBits } = require('discord.js');
const { validateHierarchy, validateProtectedTarget } = require('../utils/moderationUtil');
const { RoleManager } = require('../utils/discordApiUtil');
const { deliverTemplates } = require('./moderationTemplateService');

const ROLE_ACTIONS = {
    IMUTE: ['image_mute_role_id', 'add'],
    IUNMUTE: ['image_mute_role_id', 'remove'],
    RMUTE: ['reaction_mute_role_id', 'add'],
    RUNMUTE: ['reaction_mute_role_id', 'remove']
};

function requiredPermissionForAction(action) {
    return ACTION_PERMISSIONS[action.toUpperCase()];
}
const DANGEROUS_PERMISSIONS = [
    'Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'BanMembers',
    'KickMembers', 'ModerateMembers', 'ManageWebhooks', 'MentionEveryone'
];
const ACTION_PERMISSIONS = {
    BAN: PermissionFlagsBits.BanMembers,
    SOFTBAN: PermissionFlagsBits.BanMembers,
    HARDBAN: PermissionFlagsBits.BanMembers,
    UNBAN: PermissionFlagsBits.BanMembers,
    KICK: PermissionFlagsBits.KickMembers,
    TIMEOUT: PermissionFlagsBits.ModerateMembers,
    UNTIMEOUT: PermissionFlagsBits.ModerateMembers,
    WARN: PermissionFlagsBits.ModerateMembers,
    WARN_CLEAR: PermissionFlagsBits.ModerateMembers,
    IMUTE: PermissionFlagsBits.ManageRoles,
    IUNMUTE: PermissionFlagsBits.ManageRoles,
    RMUTE: PermissionFlagsBits.ManageRoles,
    RUNMUTE: PermissionFlagsBits.ManageRoles,
    JAIL: PermissionFlagsBits.ManageRoles,
    UNJAIL: PermissionFlagsBits.ManageRoles,
    STRIP: PermissionFlagsBits.ManageRoles,
    STAFFSTRIP: PermissionFlagsBits.ManageRoles,
    ROLE_ADD: PermissionFlagsBits.ManageRoles,
    ROLE_REMOVE: PermissionFlagsBits.ManageRoles
};

function validateActionPermissions(guild, executor, action, { actor = true } = {}) {
    const permission = ACTION_PERMISSIONS[action];
    if (actor && permission && !executor.permissions.has(permission)) {
        throw new Error('Your Discord permissions do not allow this moderation action.');
    }
    if (action !== 'WARN' && permission && !guild.members.me.permissions?.has(permission)) {
        throw new Error('My Discord permissions do not allow this moderation action.');
    }
}

function createPendingCase({ guildId, targetId, executorId, action, reason, durationMs, metadata, onCreate }) {
    return sqlite.transaction(() => {
        sqlite.prepare(`
            INSERT INTO moderation_config (guild_id, next_case_number)
            VALUES (?, 1) ON CONFLICT (guild_id) DO NOTHING
        `).run(guildId);
        const { case_number: caseNumber } = sqlite.prepare(`
            UPDATE moderation_config
            SET next_case_number = next_case_number + 1
            WHERE guild_id = ?
            RETURNING next_case_number - 1 AS case_number
        `).get(guildId);
        const now = Date.now();
        sqlite.prepare(`
            INSERT INTO moderation_cases
                (guild_id, case_number, target_id, executor_id, action, reason, status,
                 duration_ms, metadata, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
        `).run(
            guildId,
            caseNumber,
            targetId,
            executorId,
            action,
            reason,
            durationMs || null,
            metadata ? JSON.stringify(metadata) : null,
            now,
            now
        );
        onCreate?.(caseNumber, now);
        return caseNumber;
    })();
}

function setCaseStatus(guildId, caseNumber, status) {
    sqlite.prepare(`
        UPDATE moderation_cases SET status = ?, updated_at = ?
        WHERE guild_id = ? AND case_number = ?
    `).run(status, Date.now(), guildId, caseNumber);
}

function recordCompletedCase({ guildId, targetId, executorId, action, reason }) {
    const caseNumber = createPendingCase({ guildId, targetId, executorId, action, reason });
    setCaseStatus(guildId, caseNumber, 'completed');
    return getCase(guildId, caseNumber);
}

async function executeRecordedAction({ guildId, targetId, executorId, action, reason, metadata, perform }) {
    const caseNumber = createPendingCase({ guildId, targetId, executorId, action, reason, metadata });
    try {
        const result = await perform(caseNumber);
        setCaseStatus(guildId, caseNumber, 'completed');
        return result;
    } catch (error) {
        setCaseStatus(guildId, caseNumber, 'failed');
        throw error;
    }
}

async function executeMemberAction({ guild, executor, target, action, reason, durationMs, historyDays, automated = false }) {
    validateActionPermissions(guild, executor, action, { actor: !automated });
    const hierarchy = validateHierarchy(executor, target);
    if (!hierarchy.valid) throw new Error(hierarchy.error);
    if (action === 'TIMEOUT' && (!durationMs || durationMs < 60000 || durationMs > 27 * 86400000)) {
        throw new Error('Timeout duration must be between 60 seconds and 27 days.');
    }

    const roleAction = ROLE_ACTIONS[action];
    const config = roleAction
        ? sqlite.prepare('SELECT * FROM moderation_config WHERE guild_id = ?').get(guild.id)
        : null;
    const roleId = roleAction && config?.[roleAction[0]];
    if (roleAction && !roleId) throw new Error(`${action} is not configured for this server.`);
    const jailConfig = ['JAIL', 'UNJAIL'].includes(action)
        ? sqlite.prepare('SELECT jail_role_id FROM moderation_config WHERE guild_id = ?').get(guild.id)
        : null;
    if (jailConfig && !jailConfig.jail_role_id) throw new Error(`${action} is not configured for this server.`);
    if (historyDays != null && (!Number.isInteger(historyDays) || historyDays < 0 || historyDays > 7)) {
        throw new Error('Hardban history must be between 0 and 7 days.');
    }
    if (action === 'HARDBAN' && sqlite.prepare(`
        SELECT 1 FROM moderation_hardbans WHERE guild_id = ? AND user_id = ?
    `).get(guild.id, target.id)) {
        throw new Error('This user already has a hardban operation in progress or active.');
    }
    const jailState = action === 'UNJAIL' ? sqlite.prepare(`
        SELECT * FROM moderation_jail_state WHERE guild_id = ? AND user_id = ? AND state = 'active'
    `).get(guild.id, target.id) : null;
    if (action === 'JAIL' && sqlite.prepare(`
        SELECT 1 FROM moderation_jail_state WHERE guild_id = ? AND user_id = ?
    `).get(guild.id, target.id)) throw new Error('This member is already jailed.');
    if (action === 'UNJAIL' && !jailState) throw new Error('This member is not jailed.');
    const previousRoleIds = action === 'JAIL'
        ? [...target.roles.cache.values()].filter(role => role.id !== guild.id && !role.managed).map(role => role.id)
        : action === 'UNJAIL' ? JSON.parse(jailState.previous_role_ids) : null;
    const staffRoleIds = action === 'STAFFSTRIP'
        ? new Set(sqlite.prepare('SELECT role_id FROM moderation_staff_roles WHERE guild_id = ?').all(guild.id).map(row => row.role_id))
        : null;
    const strippedRoles = action === 'STRIP'
        ? [...target.roles.cache.values()].filter(role =>
            DANGEROUS_PERMISSIONS.some(permission => role.permissions?.has(PermissionFlagsBits[permission])))
        : action === 'STAFFSTRIP'
            ? [...target.roles.cache.values()].filter(role => staffRoleIds.has(role.id))
            : [];

    const caseNumber = createPendingCase({
        guildId: guild.id,
        targetId: target.id,
        executorId: executor.id,
        action,
        reason,
        durationMs,
        metadata: action === 'JAIL' || action === 'UNJAIL'
            ? { jailRoleId: jailConfig.jail_role_id, previousRoleIds }
            : roleId
            ? { roleId, roleOperation: roleAction[1] }
            : strippedRoles.length ? { strippedRoleIds: strippedRoles.map(role => role.id) }
                : action === 'HARDBAN' ? { historyDays: historyDays || 0 } : null,
        onCreate: (number, now) => {
            if (action === 'HARDBAN') {
                sqlite.prepare(`
                    INSERT INTO moderation_hardbans (guild_id, user_id, case_number, reason, state, created_at)
                    VALUES (?, ?, ?, ?, 'pending', ?)
                `).run(guild.id, target.id, number, reason, now);
            }
            if (action === 'JAIL') {
                sqlite.prepare(`
                    INSERT INTO moderation_jail_state
                        (guild_id, user_id, case_number, previous_role_ids, state, created_at)
                    VALUES (?, ?, ?, ?, 'pending', ?)
                `).run(guild.id, target.id, number, JSON.stringify(previousRoleIds), now);
            }
        }
    });

    let hardbanApplied = false;
    let jailApplied = false;
    try {
        if (action === 'TIMEOUT') await target.timeout(durationMs, reason);
        else if (action === 'UNTIMEOUT') await target.timeout(null, reason);
        else if (action === 'BAN') await target.ban({ reason });
        else if (action === 'KICK') await target.kick(reason);
        else if (action === 'SOFTBAN') {
            await guild.members.ban(target.id, { reason, deleteMessageSeconds: 86400 });
            try {
                await guild.members.unban(target.id, 'Softban cleanup');
            } catch (error) {
                sqlite.prepare(`
                    UPDATE moderation_cases SET status = 'cleanup_required', metadata = ?, updated_at = ?
                    WHERE guild_id = ? AND case_number = ?
                `).run(JSON.stringify({ phase: 'banned', error: error.message }), Date.now(), guild.id, caseNumber);
                throw error;
            }
        }
        else if (action === 'HARDBAN') {
            await target.ban(historyDays
                ? { reason, deleteMessageSeconds: historyDays * 86400 }
                : { reason });
            hardbanApplied = true;
        }
        else if (action === 'JAIL') {
            await target.roles.set([jailConfig.jail_role_id], reason);
            jailApplied = true;
            const activated = sqlite.prepare(`
                UPDATE moderation_jail_state SET state = 'active'
                WHERE guild_id = ? AND user_id = ? AND case_number = ? AND state = 'pending'
            `).run(guild.id, target.id, caseNumber);
            if (activated.changes !== 1) throw new Error('Jail state could not be activated.');
        }
        else if (action === 'UNJAIL') {
            const claimed = sqlite.prepare(`
                UPDATE moderation_jail_state SET state = 'removing'
                WHERE guild_id = ? AND user_id = ? AND case_number = ? AND state = 'active'
            `).run(guild.id, target.id, jailState.case_number);
            if (claimed.changes !== 1) throw new Error('This member is no longer in an active jail state.');
            await target.roles.set(previousRoleIds, reason);
            sqlite.prepare('DELETE FROM moderation_jail_state WHERE guild_id = ? AND user_id = ? AND state = ?')
                .run(guild.id, target.id, 'removing');
        }
        else if (roleAction) {
            const result = await RoleManager[`${roleAction[1]}Role`](target, roleId, { reason, logContext: `moderation:${action}` });
            if (!result.success) throw new Error(result.error);
        }
        else if (action === 'STRIP' || action === 'STAFFSTRIP') {
            const removed = [];
            try {
                for (const role of strippedRoles) {
                    const result = await RoleManager.removeRole(target, role, { reason, logContext: `moderation:${action}` });
                    if (!result.success) throw new Error(result.error);
                    removed.push(role);
                }
            } catch (error) {
                const rollback = await Promise.all(removed.map(role =>
                    RoleManager.addRole(target, role, { reason: 'Strip rollback', logContext: 'moderation:STRIP:rollback' })));
                if (rollback.some(result => !result.success)) {
                    sqlite.prepare(`
                        UPDATE moderation_cases SET status = 'cleanup_required', metadata = ?, updated_at = ?
                        WHERE guild_id = ? AND case_number = ?
                    `).run(JSON.stringify({ strippedRoleIds: removed.map(role => role.id), phase: 'rollback_failed' }), Date.now(), guild.id, caseNumber);
                }
                throw error;
            }
        }
        else if (action !== 'WARN') throw new Error(`Unsupported moderation action: ${action}`);
        if (action === 'HARDBAN') {
            sqlite.prepare(`UPDATE moderation_hardbans SET state = 'active' WHERE guild_id = ? AND user_id = ? AND case_number = ?`)
                .run(guild.id, target.id, caseNumber);
        }
        setCaseStatus(guild.id, caseNumber, 'completed');
        const moderationCase = getCase(guild.id, caseNumber);
        if (action === 'WARN') {
            try {
                moderationCase.punishment = await runWarningPunishment({ guild, executor, target });
            } catch (error) {
                moderationCase.punishmentError = error.message;
            }
        }
        await deliverTemplates({ guild, target, executor, moderationCase });
        return moderationCase;
    } catch (error) {
        if (action === 'HARDBAN') {
            if (hardbanApplied) {
                sqlite.prepare(`
                    UPDATE moderation_cases SET status = 'cleanup_required', metadata = ?, updated_at = ?
                    WHERE guild_id = ? AND case_number = ?
                `).run(JSON.stringify({ phase: 'banned_registry_failed', error: error.message }), Date.now(), guild.id, caseNumber);
            } else {
                sqlite.prepare(`DELETE FROM moderation_hardbans WHERE guild_id = ? AND user_id = ? AND case_number = ? AND state = 'pending'`)
                    .run(guild.id, target.id, caseNumber);
            }
        }
        if (action === 'JAIL') {
            const currentJail = sqlite.prepare(`SELECT state FROM moderation_jail_state WHERE guild_id = ? AND user_id = ?`)
                .get(guild.id, target.id);
            if (jailApplied && currentJail?.state === 'pending') {
                sqlite.prepare(`UPDATE moderation_cases SET status = 'cleanup_required', updated_at = ? WHERE guild_id = ? AND case_number = ?`)
                    .run(Date.now(), guild.id, caseNumber);
            } else if (currentJail?.state === 'pending') {
                sqlite.prepare('DELETE FROM moderation_jail_state WHERE guild_id = ? AND user_id = ? AND state = ?')
                    .run(guild.id, target.id, 'pending');
            }
        } else if (action === 'UNJAIL') {
            sqlite.prepare(`UPDATE moderation_jail_state SET state = 'active' WHERE guild_id = ? AND user_id = ? AND state = 'removing'`)
                .run(guild.id, target.id);
        }
        const current = getCase(guild.id, caseNumber);
        if (current.status === 'pending') setCaseStatus(guild.id, caseNumber, 'failed');
        throw error;
    }
}

async function executeUserAction({ guild, executor, targetId, targetUser, action, reason }) {
    validateActionPermissions(guild, executor, action);
    const protection = validateProtectedTarget(guild.id, targetId);
    if (!protection.valid) throw new Error(protection.error);
    if (!['UNBAN', 'BAN'].includes(action)) throw new Error(`Unsupported moderation action: ${action}`);
    let hardban;
    if (action === 'UNBAN') {
        hardban = sqlite.prepare(`
            SELECT case_number FROM moderation_hardbans WHERE guild_id = ? AND user_id = ? AND state != 'removing'
        `).get(guild.id, targetId);
        if (hardban && executor.id !== guild.ownerId) {
            throw new Error(`Hardban case #${hardban.case_number} can only be removed by the server owner.`);
        }
    }

    const caseNumber = createPendingCase({
        guildId: guild.id,
        targetId,
        executorId: executor.id,
        action,
        reason
    });
    let hardbanClaimed = false;
    let unbanApplied = false;

    try {
        if (hardban) {
            const claimed = sqlite.prepare(`
                UPDATE moderation_hardbans SET state = 'removing'
                WHERE guild_id = ? AND user_id = ? AND case_number = ? AND state != 'removing'
            `).run(guild.id, targetId, hardban.case_number);
            if (claimed.changes !== 1) throw new Error('This hardban is already being removed.');
            hardbanClaimed = true;
        }
        if (action === 'UNBAN') {
            await guild.members.unban(targetId, reason);
            unbanApplied = true;
        }
        else await guild.members.ban(targetId, { reason });
        if (hardban) {
            sqlite.transaction(() => {
                const deleted = sqlite.prepare(`
                    DELETE FROM moderation_hardbans
                    WHERE guild_id = ? AND user_id = ? AND case_number = ? AND state = 'removing'
                `).run(guild.id, targetId, hardban.case_number);
                if (deleted.changes !== 1) throw new Error('The hardban registry changed during removal.');
                setCaseStatus(guild.id, caseNumber, 'completed');
            })();
        } else {
            setCaseStatus(guild.id, caseNumber, 'completed');
        }
        const moderationCase = getCase(guild.id, caseNumber);
        const resolvedTarget = targetUser || await guild.client?.users?.fetch(targetId).catch(() => null);
        if (resolvedTarget) await deliverTemplates({ guild, target: resolvedTarget, executor, moderationCase });
        return moderationCase;
    } catch (error) {
        if (hardbanClaimed) {
            sqlite.prepare(`
                UPDATE moderation_hardbans SET state = 'active'
                WHERE guild_id = ? AND user_id = ? AND case_number = ? AND state = 'removing'
            `).run(guild.id, targetId, hardban.case_number);
            if (unbanApplied) {
                try {
                    await guild.members.ban(targetId, { reason: `Hardban case #${hardban.case_number} removal rollback` });
                } catch (rollbackError) {
                    sqlite.prepare(`
                        UPDATE moderation_cases SET status = 'cleanup_required', metadata = ?, updated_at = ?
                        WHERE guild_id = ? AND case_number = ?
                    `).run(JSON.stringify({ phase: 'hardban_unban_rollback_failed', error: rollbackError.message }), Date.now(), guild.id, caseNumber);
                    error.cleanupRequired = true;
                }
            }
        }
        if (!error.cleanupRequired) setCaseStatus(guild.id, caseNumber, 'failed');
        throw error;
    }
}

function clearWarnings({ guild, executor, target, reason }) {
    validateActionPermissions(guild, executor, 'WARN_CLEAR');
    const hierarchy = validateHierarchy(executor, target);
    if (!hierarchy.valid) throw new Error(hierarchy.error);
    const warnings = sqlite.prepare(`
        SELECT case_number FROM moderation_cases
        WHERE guild_id = ? AND target_id = ? AND action = 'WARN' AND status = 'completed'
    `).all(guild.id, target.id);
    const caseNumber = createPendingCase({
        guildId: guild.id,
        targetId: target.id,
        executorId: executor.id,
        action: 'WARN_CLEAR',
        reason,
        metadata: { warningCases: warnings.map(warning => warning.case_number) }
    });
    try {
        sqlite.transaction(() => {
            sqlite.prepare(`
                UPDATE moderation_cases SET status = 'undone', undone_by = ?, undo_reason = ?, updated_at = ?
                WHERE guild_id = ? AND target_id = ? AND action = 'WARN' AND status = 'completed'
            `).run(executor.id, reason, Date.now(), guild.id, target.id);
            setCaseStatus(guild.id, caseNumber, 'completed');
        })();
        return getCase(guild.id, caseNumber);
    } catch (error) {
        setCaseStatus(guild.id, caseNumber, 'failed');
        throw error;
    }
}

function getCase(guildId, caseNumber) {
    return sqlite.prepare(`
        SELECT * FROM moderation_cases WHERE guild_id = ? AND case_number = ?
    `).get(guildId, caseNumber);
}

async function runWarningPunishment({ guild, executor, target }) {
    const { count } = sqlite.prepare(`
        SELECT COUNT(*) AS count FROM moderation_cases
        WHERE guild_id = ? AND target_id = ? AND action = 'WARN' AND status = 'completed'
    `).get(guild.id, target.id);
    const punishment = sqlite.prepare(`
        SELECT * FROM warning_punishments WHERE guild_id = ? AND threshold = ?
    `).get(guild.id, count);
    if (!punishment) return null;

    return executeMemberAction({
        guild,
        executor,
        target,
        action: punishment.action,
        reason: `Automatic punishment at ${count} warnings`,
        durationMs: punishment.duration_ms,
        automated: true
    });
}

async function undoCase({ guild, executor, caseNumber, reason }) {
    const moderationCase = getCase(guild.id, caseNumber);
    if (!moderationCase) throw new Error(`Case #${caseNumber} was not found.`);
    if (moderationCase.action === 'HARDBAN' && executor.id !== guild.ownerId) {
        throw new Error('Only the server owner can undo a hardban.');
    }
    validateActionPermissions(guild, executor, moderationCase.action);
    if (!['completed', 'cleanup_required'].includes(moderationCase.status)) {
        if (moderationCase.status === 'undo_pending') throw new Error(`Case #${caseNumber} is already being changed.`);
        throw new Error(`Case #${caseNumber} cannot be undone from ${moderationCase.status}.`);
    }
    const metadata = moderationCase.metadata ? JSON.parse(moderationCase.metadata) : {};
    if (!['TIMEOUT', 'BAN', 'HARDBAN', 'WARN'].includes(moderationCase.action)
        && !(moderationCase.action === 'SOFTBAN' && moderationCase.status === 'cleanup_required')
        && !metadata.roleOperation && !metadata.strippedRoleIds && !metadata.jailRoleId) {
        throw new Error(`${moderationCase.action} cases cannot be undone.`);
    }

    let target;
    if (moderationCase.action === 'TIMEOUT' || moderationCase.action === 'WARN'
        || metadata.roleOperation || metadata.strippedRoleIds || metadata.jailRoleId) {
        target = await guild.members.fetch(moderationCase.target_id);
        const hierarchy = validateHierarchy(executor, target, { allowBots: Boolean(metadata.roleOperation) });
        if (!hierarchy.valid) throw new Error(hierarchy.error);
    } else {
        const protection = validateProtectedTarget(guild.id, moderationCase.target_id);
        if (!protection.valid) throw new Error(protection.error);
    }

    const claimed = sqlite.prepare(`
        UPDATE moderation_cases SET status = 'undo_pending', updated_at = ?
        WHERE guild_id = ? AND case_number = ? AND status IN ('completed', 'cleanup_required')
    `).run(Date.now(), guild.id, caseNumber);
    if (claimed.changes !== 1) throw new Error(`Case #${caseNumber} is already being changed.`);
    let hardbanClaimed = false;
    let hardbanUnbanApplied = false;
    try {
        if (moderationCase.action === 'HARDBAN') {
            const hardbanClaim = sqlite.prepare(`
                UPDATE moderation_hardbans SET state = 'removing'
                WHERE guild_id = ? AND user_id = ? AND case_number = ? AND state != 'removing'
            `).run(guild.id, moderationCase.target_id, caseNumber);
            if (hardbanClaim.changes !== 1) throw new Error('The active hardban could not be claimed for removal.');
            hardbanClaimed = true;
        }
        if (moderationCase.action === 'TIMEOUT') {
            await target.timeout(null, reason);
        } else if (moderationCase.action === 'BAN' || moderationCase.action === 'HARDBAN') {
            await guild.members.unban(moderationCase.target_id, reason);
            hardbanUnbanApplied = moderationCase.action === 'HARDBAN';
        } else if (moderationCase.action === 'SOFTBAN') {
            await guild.members.unban(moderationCase.target_id, reason);
        } else if (moderationCase.action === 'WARN') {
            // Warning state is the case itself; marking it undone is the inverse.
        } else if (moderationCase.action === 'JAIL') {
            const jail = sqlite.prepare(`SELECT state FROM moderation_jail_state WHERE guild_id = ? AND user_id = ?`)
                .get(guild.id, moderationCase.target_id);
            if (!jail || !['active', 'pending'].includes(jail.state)) throw new Error('This member is no longer jailed.');
            sqlite.prepare(`UPDATE moderation_jail_state SET state = 'removing' WHERE guild_id = ? AND user_id = ? AND state IN ('active', 'pending')`)
                .run(guild.id, moderationCase.target_id);
            await target.roles.set(metadata.previousRoleIds, reason);
            sqlite.prepare(`DELETE FROM moderation_jail_state WHERE guild_id = ? AND user_id = ? AND state = 'removing'`)
                .run(guild.id, moderationCase.target_id);
        } else if (moderationCase.action === 'UNJAIL') {
            await target.roles.set([metadata.jailRoleId], reason);
            sqlite.prepare(`
                INSERT INTO moderation_jail_state (guild_id, user_id, case_number, previous_role_ids, state, created_at)
                VALUES (?, ?, ?, ?, 'active', ?)
                ON CONFLICT (guild_id, user_id) DO UPDATE SET case_number = excluded.case_number,
                    previous_role_ids = excluded.previous_role_ids, state = 'active', created_at = excluded.created_at
            `).run(guild.id, moderationCase.target_id, caseNumber, JSON.stringify(metadata.previousRoleIds), Date.now());
        } else if (metadata.strippedRoleIds) {
            const added = [];
            try {
                for (const roleId of metadata.strippedRoleIds) {
                    const result = await RoleManager.addRole(target, roleId, { reason, logContext: 'moderation:undo:STRIP' });
                    if (!result.success) throw new Error(result.error);
                    added.push(roleId);
                }
            } catch (error) {
                const rollback = await Promise.all(added.map(roleId =>
                    RoleManager.removeRole(target, roleId, { reason: 'Strip undo rollback', logContext: 'moderation:undo:STRIP:rollback' })));
                if (rollback.some(result => !result.success)) {
                    sqlite.prepare(`
                        UPDATE moderation_cases SET status = 'cleanup_required', metadata = ?, updated_at = ?
                        WHERE guild_id = ? AND case_number = ? AND status = 'undo_pending'
                    `).run(JSON.stringify({ ...metadata, phase: 'undo_rollback_failed' }), Date.now(), guild.id, caseNumber);
                    error.cleanupRequired = true;
                }
                throw error;
            }
        } else {
            const operation = metadata.roleOperation === 'add' ? 'removeRole' : 'addRole';
            const result = await RoleManager[operation](target, metadata.roleId, { reason, logContext: `moderation:undo:${moderationCase.action}` });
            if (!result.success) throw new Error(result.error);
        }
        if (hardbanClaimed) {
            sqlite.transaction(() => {
                const updated = sqlite.prepare(`
                    UPDATE moderation_cases
                    SET status = 'undone', undone_by = ?, undo_reason = ?, updated_at = ?
                    WHERE guild_id = ? AND case_number = ? AND status = 'undo_pending'
                `).run(executor.id, reason, Date.now(), guild.id, caseNumber);
                const deleted = sqlite.prepare(`
                    DELETE FROM moderation_hardbans
                    WHERE guild_id = ? AND user_id = ? AND case_number = ? AND state = 'removing'
                `).run(guild.id, moderationCase.target_id, caseNumber);
                if (updated.changes !== 1 || deleted.changes !== 1) {
                    throw new Error('The hardban state changed during case undo.');
                }
            })();
        } else {
            sqlite.prepare(`
                UPDATE moderation_cases
                SET status = 'undone', undone_by = ?, undo_reason = ?, updated_at = ?
                WHERE guild_id = ? AND case_number = ? AND status = 'undo_pending'
            `).run(executor.id, reason, Date.now(), guild.id, caseNumber);
        }
        return getCase(guild.id, caseNumber);
    } catch (error) {
        if (hardbanClaimed) {
            sqlite.prepare(`
                UPDATE moderation_hardbans SET state = 'active'
                WHERE guild_id = ? AND user_id = ? AND case_number = ? AND state = 'removing'
            `).run(guild.id, moderationCase.target_id, caseNumber);
            if (hardbanUnbanApplied) {
                try {
                    await guild.members.ban(moderationCase.target_id, { reason: `Hardban case #${caseNumber} undo rollback` });
                } catch (rollbackError) {
                    sqlite.prepare(`
                        UPDATE moderation_cases SET status = 'cleanup_required', metadata = ?, updated_at = ?
                        WHERE guild_id = ? AND case_number = ?
                    `).run(JSON.stringify({ ...metadata, phase: 'hardban_undo_rollback_failed', error: rollbackError.message }), Date.now(), guild.id, caseNumber);
                    error.cleanupRequired = true;
                }
            }
        }
        if (moderationCase.action === 'JAIL') {
            sqlite.prepare(`UPDATE moderation_jail_state SET state = 'active' WHERE guild_id = ? AND user_id = ? AND state = 'removing'`)
                .run(guild.id, moderationCase.target_id);
        }
        if (!error.cleanupRequired) {
            sqlite.prepare(`UPDATE moderation_cases SET status = ?, updated_at = ? WHERE guild_id = ? AND case_number = ? AND status = 'undo_pending'`)
                .run(moderationCase.status, Date.now(), guild.id, caseNumber);
        }
        throw error;
    }
}

module.exports = {
    executeMemberAction, executeUserAction, clearWarnings, getCase, undoCase,
    recordCompletedCase, executeRecordedAction, requiredPermissionForAction
};
