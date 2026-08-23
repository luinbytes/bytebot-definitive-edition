const { PermissionFlagsBits } = require('discord.js');
const { db } = require('../database/index');
const { commandPermissions, commandAccessRules, fakePermissions } = require('../database/schema');
const { eq, and, or } = require('drizzle-orm');
const embeds = require('./embeds');
const { dbLog } = require('./dbLogger');

/**
 * Converts permission flags to human-readable names
 * @param {bigint[]} permissions - Array of permission flags
 * @returns {string[]} Array of permission names
 */
function getPermissionNames(permissions) {
    const names = [];
    for (const permission of permissions) {
        // Find the matching permission name from PermissionFlagsBits
        const entry = Object.entries(PermissionFlagsBits).find(([_, value]) => value === permission);
        if (entry) {
            names.push(entry[0]);
        } else {
            names.push(permission.toString());
        }
    }
    return names;
}

/**
 * Checks if a user has permission to execute a command.
 * Real Discord permissions are mandatory; ByteBot rules can only add restrictions
 * or satisfy explicitly virtual permission checks.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {object} command
 * @returns {Promise<{ allowed: boolean, error?: any }>}
 */
async function checkUserPermissions(interaction, command) {
    const rootCommand = interaction.commandName || command.data.name;
    const group = interaction.options?.getSubcommandGroup?.(false);
    const subcommand = interaction.options?.getSubcommand?.(false);
    const commandPath = [rootCommand, group, subcommand].filter(Boolean).join(' ');

    // ByteBot policy may restrict access, but never grants Discord permissions.
    if (command.permissions && command.permissions.length > 0
        && !interaction.member.permissions.has(command.permissions)) {
        const permissionNames = getPermissionNames(command.permissions);
        return {
            allowed: false,
            error: embeds.error('Insufficient Permissions', `You need the following permissions: \`${permissionNames.join(', ')}\``)
        };
    }

    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    const accessRules = await dbLog.select('commandAccessRules',
        () => db.select().from(commandAccessRules).where(and(
            eq(commandAccessRules.guildId, interaction.guild.id),
            commandPath === rootCommand
                ? eq(commandAccessRules.commandPath, rootCommand)
                : or(
                    eq(commandAccessRules.commandPath, commandPath),
                    eq(commandAccessRules.commandPath, rootCommand)
                )
        )),
        { guildId: interaction.guild.id, commandName: commandPath }
    );

    if (!isAdmin) {
        const rules = accessRules.filter(rule => ['disabled', 'allow', 'deny'].includes(rule.effect));
        const roleIds = interaction.member.roles?.cache || new Map();
        const matchesScope = rule => (
            (rule.scopeType === 'guild' && rule.scopeId === interaction.guild.id)
            || (rule.scopeType === 'channel' && rule.scopeId === (interaction.channelId || interaction.channel?.id))
            || (rule.scopeType === 'role' && roleIds.has(rule.scopeId))
            || (rule.scopeType === 'member' && rule.scopeId === (interaction.user?.id || interaction.member.id))
        );

        if (rules.some(rule => ['disabled', 'deny'].includes(rule.effect) && matchesScope(rule))
            || (rules.some(rule => rule.effect === 'allow')
                && !rules.some(rule => rule.effect === 'allow' && matchesScope(rule)))) {
            return {
                allowed: false,
                error: embeds.error('Access Denied', 'This command is disabled for you here.')
            };
        }
    }

    if (command.virtualPermissions?.length > 0
        && !interaction.member.permissions.has(command.virtualPermissions)) {
        const labels = await dbLog.select('fakePermissions',
            () => db.select().from(fakePermissions)
                .where(eq(fakePermissions.guildId, interaction.guild.id)),
            { guildId: interaction.guild.id }
        );
        const memberRoles = interaction.member.roles?.cache || new Map();
        const granted = new Set(labels
            .filter(label => memberRoles.has(label.roleId))
            .map(label => label.permission));
        const missing = getPermissionNames(command.virtualPermissions)
            .filter(permission => !granted.has(permission));

        if (missing.length > 0) {
            return {
                allowed: false,
                error: embeds.error('Access Denied', `You need the following ByteBot permissions: \`${missing.join(', ')}\``)
            };
        }
    }

    // Check the legacy role allowlist after scoped restrictions.
    const storedOverrides = await dbLog.select('commandPermissions',
        () => db.select().from(commandPermissions).where(and(
            eq(commandPermissions.guildId, interaction.guild.id),
            commandPath === rootCommand
                ? eq(commandPermissions.commandName, rootCommand)
                : or(
                    eq(commandPermissions.commandName, commandPath),
                    eq(commandPermissions.commandName, rootCommand)
                )
        )),
        { guildId: interaction.guild.id, commandName: commandPath }
    );
    const pathOverrides = storedOverrides.filter(override => override.commandName === commandPath);
    const overrides = pathOverrides.length > 0
        ? pathOverrides
        : storedOverrides.filter(override => override.commandName === rootCommand);

    if (overrides.length > 0) {
        // Custom permissions exist: Allow if user has ANY allowed role or is Admin
        const userRoles = interaction.member.roles.cache;
        const hasAllowedRole = overrides.some(override => userRoles.has(override.roleId));
        if (!hasAllowedRole && !isAdmin) {
            const roleMentions = overrides.map(o => `<@&${o.roleId}>`).join(', ');
            return {
                allowed: false,
                error: embeds.error('Access Denied', `This command is restricted to the following roles: ${roleMentions}`)
            };
        }
        return { allowed: true };
    }

    return { allowed: true };
}

module.exports = { checkUserPermissions, getPermissionNames };
