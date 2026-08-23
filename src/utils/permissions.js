const { PermissionFlagsBits } = require('discord.js');
const { db } = require('../database/index');
const { commandPermissions } = require('../database/schema');
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
 * Priority: Database Overrides > Default Command Permissions.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {object} command
 * @returns {Promise<{ allowed: boolean, error?: any }>}
 */
async function checkUserPermissions(interaction, command) {
    const rootCommand = command.data.name;
    const group = interaction.options?.getSubcommandGroup?.(false);
    const subcommand = interaction.options?.getSubcommand?.(false);
    const commandPath = [rootCommand, group, subcommand].filter(Boolean).join(' ');

    // 1. Check for custom permission overrides in the database
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
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

        if (!hasAllowedRole && !isAdmin) {
            const roleMentions = overrides.map(o => `<@&${o.roleId}>`).join(', ');
            return {
                allowed: false,
                error: embeds.error('Access Denied', `This command is restricted to the following roles: ${roleMentions}`)
            };
        }
        return { allowed: true };
    }

    // 2. Fallback to default code-defined permissions
    if (command.permissions && command.permissions.length > 0) {
        if (!interaction.member.permissions.has(command.permissions)) {
            const permissionNames = getPermissionNames(command.permissions);
            return {
                allowed: false,
                error: embeds.error('Insufficient Permissions', `You need the following permissions: \`${permissionNames.join(', ')}\``)
            };
        }
    }

    return { allowed: true };
}

module.exports = { checkUserPermissions, getPermissionNames };
