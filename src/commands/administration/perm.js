const { ApplicationCommandOptionType, SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { db } = require('../../database/index');
const { commandPermissions, commandAccessRules, fakePermissions, deniedRolePermissions, protectedTargets } = require('../../database/schema');
const embeds = require('../../utils/embeds');
const { handleCommandError } = require('../../utils/errorHandlerUtil');
const { eq, and, or } = require('drizzle-orm');
const { dbLog } = require('../../utils/dbLogger');

function commandPaths(command) {
    const data = command.data.toJSON();
    const paths = [data.name];

    for (const option of data.options || []) {
        if (option.type === ApplicationCommandOptionType.Subcommand) {
            paths.push(`${data.name} ${option.name}`);
        }
        if (option.type === ApplicationCommandOptionType.SubcommandGroup) {
            for (const subcommand of option.options || []) {
                paths.push(`${data.name} ${option.name} ${subcommand.name}`);
            }
        }
    }

    return paths;
}

const PERMISSION_NAMES = Object.keys(PermissionFlagsBits);
const canonicalPermission = input => input && PERMISSION_NAMES
    .find(name => name.toLowerCase() === input.trim().toLowerCase());

module.exports = {
    register: false,
    data: new SlashCommandBuilder()
        .setName('perm')
        .setDescription('Manage custom command permissions for this server.')
        // Only Dropdown/Menu interactions or specific text inputs? 
        // Subcommands are best for clarity.
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Allow a role to use a specific command.')
                .addStringOption(option =>
                    option.setName('command')
                        .setDescription('The name of the command.')
                        .setRequired(true)
                        .setAutocomplete(true))
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('The role to allow.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a role from a command\'s allowlist.')
                .addStringOption(option =>
                    option.setName('command')
                        .setDescription('The name of the command.')
                        .setRequired(true)
                        .setAutocomplete(true))
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('The role to remove.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all custom command permissions.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset a command to its default permissions.')
                .addStringOption(option =>
                    option.setName('command')
                        .setDescription('The name of the command.')
                        .setRequired(true)
                        .setAutocomplete(true)))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async autocomplete(interaction, client) {
        const focusedValue = interaction.options.getFocused().trim().toLowerCase();
        const choices = Array.from(client.commands.values()).flatMap(commandPaths);
        const filtered = choices.filter(choice => choice.startsWith(focusedValue));
        await interaction.respond(
            filtered.map(choice => ({ name: choice, value: choice })).slice(0, 25)
        );
    },

    async execute(interaction, client) {
        const subcommand = interaction.options.getSubcommand();
        const commandName = interaction.options.getString('command')?.trim().replace(/\s+/g, ' ');
        const role = interaction.options.getRole('role');
        const channel = interaction.options.getChannel?.('channel');
        const member = interaction.options.getUser?.('member');

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        try {
            if (commandName) {
                const rootCommand = client.commands.get(commandName.split(' ')[0]);
                if (!rootCommand || !commandPaths(rootCommand).includes(commandName)) {
                    return interaction.editReply({
                        embeds: [embeds.error('Invalid Command', `The command \`${commandName}\` does not exist.`)]
                    });
                }
            }

            if (subcommand === 'fake') {
                const action = interaction.options.getString('action');
                const permissionInput = interaction.options.getString('permissions')?.trim();
                const requested = permissionInput
                    ? [...new Set(permissionInput.split(',').map(value => value.trim()).filter(Boolean))]
                    : [];
                const permissions = requested.map(canonicalPermission);

                if (action === 'add' && (!role || requested.length === 0)) {
                    return interaction.editReply({
                        embeds: [embeds.error('Missing Options', 'Add requires a role and one or more comma-separated permissions.')]
                    });
                }
                if (action === 'remove' && !role) {
                    return interaction.editReply({
                        embeds: [embeds.error('Missing Role', 'Remove requires a role.')]
                    });
                }
                const invalid = requested.filter((_, index) => !permissions[index]);
                if (invalid.length > 0) {
                    return interaction.editReply({
                        embeds: [embeds.error('Invalid Permission', `Unknown Discord permission: \`${invalid.join(', ')}\`.`)]
                    });
                }

                if (action === 'add') {
                    await dbLog.insert('fakePermissions',
                        () => db.insert(fakePermissions).values(permissions.map(permission => ({
                            guildId: interaction.guild.id,
                            roleId: role.id,
                            permission
                        }))).onConflictDoNothing(),
                        { guildId: interaction.guild.id, roleId: role.id, permissions }
                    );
                    return interaction.editReply({
                        embeds: [embeds.success('Fake Permissions Added', `${role} now has: \`${permissions.join(', ')}\`.`)]
                    });
                }

                if (action === 'remove') {
                    await dbLog.delete('fakePermissions',
                        () => db.delete(fakePermissions).where(and(
                            eq(fakePermissions.guildId, interaction.guild.id),
                            eq(fakePermissions.roleId, role.id)
                        )),
                        { guildId: interaction.guild.id, roleId: role.id }
                    );
                    return interaction.editReply({
                        embeds: [embeds.success('Fake Permissions Removed', `Virtual permission labels for ${role} were cleared.`)]
                    });
                }

                if (action === 'reset') {
                    await dbLog.delete('fakePermissions',
                        () => db.delete(fakePermissions)
                            .where(eq(fakePermissions.guildId, interaction.guild.id)),
                        { guildId: interaction.guild.id }
                    );
                    return interaction.editReply({
                        embeds: [embeds.success('Fake Permissions Reset', 'All virtual permission labels were cleared.')]
                    });
                }

                const labels = await dbLog.select('fakePermissions',
                    () => db.select().from(fakePermissions).where(role
                        ? and(
                            eq(fakePermissions.guildId, interaction.guild.id),
                            eq(fakePermissions.roleId, role.id)
                        )
                        : eq(fakePermissions.guildId, interaction.guild.id)),
                    { guildId: interaction.guild.id, roleId: role?.id }
                );
                const description = labels.length
                    ? labels.map(label => `<@&${label.roleId}>: \`${label.permission}\``).join('\n')
                    : 'No virtual permission labels are configured.';
                return interaction.editReply({
                    embeds: [embeds.info('Fake Permissions', description)]
                });
            }

            if (subcommand === 'denyperm') {
                const action = interaction.options.getString('action');
                const permissionInput = interaction.options.getString('permission');
                const permission = canonicalPermission(permissionInput);

                if (action === 'available') {
                    return interaction.editReply({
                        embeds: [embeds.info('Available Permissions', PERMISSION_NAMES.map(name => `\`${name}\``).join(', '))]
                    });
                }
                if (action === 'list') {
                    const blocked = await dbLog.select('deniedRolePermissions',
                        () => db.select().from(deniedRolePermissions)
                            .where(eq(deniedRolePermissions.guildId, interaction.guild.id)),
                        { guildId: interaction.guild.id }
                    );
                    return interaction.editReply({
                        embeds: [embeds.info('Blocked Role Permissions', blocked.length
                            ? blocked.map(row => `\`${row.permission}\``).join(', ')
                            : 'No role permissions are blocked.')]
                    });
                }
                if (action === 'clear') {
                    await dbLog.delete('deniedRolePermissions',
                        () => db.delete(deniedRolePermissions)
                            .where(eq(deniedRolePermissions.guildId, interaction.guild.id)),
                        { guildId: interaction.guild.id }
                    );
                    return interaction.editReply({
                        embeds: [embeds.success('Blocked Permissions Cleared', 'Roles are no longer blocked by permission.')]
                    });
                }
                if (!permissionInput || !permission) {
                    return interaction.editReply({
                        embeds: [embeds.error('Invalid Permission', 'Add and remove require a valid Discord permission name.')]
                    });
                }
                if (action === 'add') {
                    await dbLog.insert('deniedRolePermissions',
                        () => db.insert(deniedRolePermissions).values({
                            guildId: interaction.guild.id,
                            permission
                        }).onConflictDoNothing(),
                        { guildId: interaction.guild.id, permission }
                    );
                    return interaction.editReply({
                        embeds: [embeds.success('Role Permission Blocked', `Roles carrying \`${permission}\` cannot be assigned by ByteBot.`)]
                    });
                }
                await dbLog.delete('deniedRolePermissions',
                    () => db.delete(deniedRolePermissions).where(and(
                        eq(deniedRolePermissions.guildId, interaction.guild.id),
                        eq(deniedRolePermissions.permission, permission)
                    )),
                    { guildId: interaction.guild.id, permission }
                );
                return interaction.editReply({
                    embeds: [embeds.success('Role Permission Unblocked', `Roles carrying \`${permission}\` may be assigned again.`)]
                });
            }

            if (subcommand === 'protect') {
                const action = interaction.options.getString('action');
                const targets = [
                    member && { type: 'member', id: member.id, label: `${member}` },
                    role && { type: 'role', id: role.id, label: `${role}` }
                ].filter(Boolean);

                if (targets.length > 1 || (action !== 'list' && targets.length !== 1)) {
                    return interaction.editReply({
                        embeds: [embeds.error('Invalid Target', 'Choose exactly one member or role for add and remove.')]
                    });
                }

                if (action === 'list') {
                    const protectedRows = await dbLog.select('protectedTargets',
                        () => db.select().from(protectedTargets)
                            .where(eq(protectedTargets.guildId, interaction.guild.id)),
                        { guildId: interaction.guild.id }
                    );
                    const description = protectedRows.length
                        ? protectedRows.map(target => target.targetType === 'member'
                            ? `<@${target.targetId}> (member)`
                            : `<@&${target.targetId}> (role)`).join('\n')
                        : 'No members or roles are protected from moderation.';
                    return interaction.editReply({
                        embeds: [embeds.info('Protected Targets', description)]
                    });
                }

                const target = targets[0];
                if (action === 'add') {
                    await dbLog.insert('protectedTargets',
                        () => db.insert(protectedTargets).values({
                            guildId: interaction.guild.id,
                            targetType: target.type,
                            targetId: target.id
                        }).onConflictDoNothing(),
                        { guildId: interaction.guild.id, targetId: target.id }
                    );
                    return interaction.editReply({
                        embeds: [embeds.success('Target Protected', `${target.label} is protected from moderation.`)]
                    });
                }

                await dbLog.delete('protectedTargets',
                    () => db.delete(protectedTargets).where(and(
                        eq(protectedTargets.guildId, interaction.guild.id),
                        eq(protectedTargets.targetType, target.type),
                        eq(protectedTargets.targetId, target.id)
                    )),
                    { guildId: interaction.guild.id, targetId: target.id }
                );
                return interaction.editReply({
                    embeds: [embeds.success('Protection Removed', `${target.label} is no longer protected from moderation.`)]
                });
            }

            if (['disable', 'enable', 'allow', 'deny', 'unrestrict'].includes(subcommand)) {
                const targets = [
                    channel && { type: 'channel', id: channel.id, label: `${channel}` },
                    role && { type: 'role', id: role.id, label: `${role}` },
                    member && { type: 'member', id: member.id, label: `${member}` }
                ].filter(Boolean);
                if (targets.length > 1) {
                    return interaction.editReply({
                        embeds: [embeds.error('Invalid Scope', 'Choose at most one channel, role, or member.')]
                    });
                }
                const scope = targets[0] || {
                    type: 'guild',
                    id: interaction.guild.id,
                    label: 'this server'
                };

                if (subcommand === 'disable') {
                    await dbLog.insert('commandAccessRules',
                        () => db.insert(commandAccessRules).values({
                            guildId: interaction.guild.id,
                            commandPath: commandName,
                            effect: 'disabled',
                            scopeType: scope.type,
                            scopeId: scope.id
                        }).onConflictDoNothing(),
                        { guildId: interaction.guild.id, commandName }
                    );
                    return interaction.editReply({
                        embeds: [embeds.success('Command Disabled', `\`/${commandName}\` is disabled in ${scope.label}.`)]
                    });
                }

                if (subcommand === 'allow' || subcommand === 'deny') {
                    await dbLog.insert('commandAccessRules',
                        () => db.insert(commandAccessRules).values({
                            guildId: interaction.guild.id,
                            commandPath: commandName,
                            effect: subcommand,
                            scopeType: scope.type,
                            scopeId: scope.id
                        }).onConflictDoNothing(),
                        { guildId: interaction.guild.id, commandName }
                    );
                    await dbLog.delete('commandAccessRules',
                        () => db.delete(commandAccessRules).where(and(
                            eq(commandAccessRules.guildId, interaction.guild.id),
                            eq(commandAccessRules.commandPath, commandName),
                            eq(commandAccessRules.effect, subcommand === 'allow' ? 'deny' : 'allow'),
                            eq(commandAccessRules.scopeType, scope.type),
                            eq(commandAccessRules.scopeId, scope.id)
                        )),
                        { guildId: interaction.guild.id, commandName }
                    );
                    return interaction.editReply({
                        embeds: [embeds.success(
                            subcommand === 'allow' ? 'Command Allowed' : 'Command Denied',
                            `\`/${commandName}\` is ${subcommand}ed for ${scope.label}.`
                        )]
                    });
                }

                if (subcommand === 'unrestrict') {
                    const scopeCondition = targets.length === 0
                        ? undefined
                        : and(
                            eq(commandAccessRules.scopeType, scope.type),
                            eq(commandAccessRules.scopeId, scope.id)
                        );
                    await dbLog.delete('commandAccessRules',
                        () => db.delete(commandAccessRules).where(and(
                            eq(commandAccessRules.guildId, interaction.guild.id),
                            eq(commandAccessRules.commandPath, commandName),
                            or(
                                eq(commandAccessRules.effect, 'allow'),
                                eq(commandAccessRules.effect, 'deny')
                            ),
                            scopeCondition
                        )),
                        { guildId: interaction.guild.id, commandName }
                    );
                    return interaction.editReply({
                        embeds: [embeds.success('Command Unrestricted', `Allow and deny rules for \`/${commandName}\` were removed${targets.length ? ` for ${scope.label}` : ''}.`)]
                    });
                }

                await dbLog.delete('commandAccessRules',
                    () => db.delete(commandAccessRules).where(and(
                        eq(commandAccessRules.guildId, interaction.guild.id),
                        eq(commandAccessRules.commandPath, commandName),
                        eq(commandAccessRules.effect, 'disabled'),
                        targets.length ? eq(commandAccessRules.scopeType, scope.type) : undefined,
                        targets.length ? eq(commandAccessRules.scopeId, scope.id) : undefined
                    )),
                    { guildId: interaction.guild.id, commandName }
                );
                return interaction.editReply({
                    embeds: [embeds.success('Command Enabled', `\`/${commandName}\` is enabled ${targets.length ? `in ${scope.label}` : 'everywhere'}.`)]
                });
            }

            if (subcommand === 'add') {
                // Check if exists
                const existing = await dbLog.select('commandPermissions',
                    () => db.select().from(commandPermissions)
                        .where(and(
                            eq(commandPermissions.guildId, interaction.guild.id),
                            eq(commandPermissions.commandName, commandName),
                            eq(commandPermissions.roleId, role.id)
                        )),
                    { guildId: interaction.guild.id, commandName, roleId: role.id }
                );

                if (existing.length > 0) {
                    return interaction.editReply({
                        embeds: [embeds.warn('Already Exists', `The role ${role} already has permission for \`/${commandName}\`.`)]
                    });
                }

                await dbLog.insert('commandPermissions',
                    () => db.insert(commandPermissions).values({
                        guildId: interaction.guild.id,
                        commandName: commandName,
                        roleId: role.id
                    }),
                    { guildId: interaction.guild.id, commandName, roleId: role.id }
                );

                return interaction.editReply({
                    embeds: [embeds.success('Permission Added', `Role ${role} can now use \`/${commandName}\`.`)]
                });

            } else if (subcommand === 'remove') {
                const deleted = await dbLog.delete('commandPermissions',
                    () => db.delete(commandPermissions)
                        .where(and(
                            eq(commandPermissions.guildId, interaction.guild.id),
                            eq(commandPermissions.commandName, commandName),
                            eq(commandPermissions.roleId, role.id)
                        )).returning(),
                    { guildId: interaction.guild.id, commandName, roleId: role.id }
                );

                if (deleted.length === 0) {
                    return interaction.editReply({
                        embeds: [embeds.error('Not Found', `The role ${role} was not specifically whitelisted for \`/${commandName}\`.`)]
                    });
                }

                return interaction.editReply({
                    embeds: [embeds.success('Permission Removed', `Role ${role} removed from \`/${commandName}\` whitelist.`)]
                });

            } else if (subcommand === 'reset') {
                await dbLog.delete('commandPermissions',
                    () => db.delete(commandPermissions)
                        .where(and(
                            eq(commandPermissions.guildId, interaction.guild.id),
                            eq(commandPermissions.commandName, commandName)
                        )),
                    { guildId: interaction.guild.id, commandName }
                );
                await dbLog.delete('commandAccessRules',
                    () => db.delete(commandAccessRules).where(and(
                        eq(commandAccessRules.guildId, interaction.guild.id),
                        eq(commandAccessRules.commandPath, commandName)
                    )),
                    { guildId: interaction.guild.id, commandName }
                );

                return interaction.editReply({
                    embeds: [embeds.success('Permissions Reset', `Custom permissions for \`/${commandName}\` have been cleared. Default bot permissions apply.`)]
                });

            } else if (subcommand === 'list') {
                const perms = await dbLog.select('commandPermissions',
                    () => db.select().from(commandPermissions)
                        .where(eq(commandPermissions.guildId, interaction.guild.id)),
                    { guildId: interaction.guild.id }
                );
                const rules = await dbLog.select('commandAccessRules',
                    () => db.select().from(commandAccessRules)
                        .where(eq(commandAccessRules.guildId, interaction.guild.id)),
                    { guildId: interaction.guild.id }
                );

                if (perms.length === 0 && rules.length === 0) {
                    return interaction.editReply({
                        embeds: [embeds.info('No Custom Permissions', 'This server checks default bot permissions for all commands.')]
                    });
                }

                // Group by command
                const grouped = perms.reduce((acc, curr) => {
                    if (!acc[curr.commandName]) acc[curr.commandName] = [];
                    acc[curr.commandName].push(`<@&${curr.roleId}>`);
                    return acc;
                }, {});

                const roleLines = Object.entries(grouped).map(([cmd, roles]) => {
                    return `**/${cmd}**: ${roles.join(', ')}`;
                });
                const scopeLabel = rule => ({
                    guild: 'this server',
                    channel: `<#${rule.scopeId}>`,
                    role: `<@&${rule.scopeId}>`,
                    member: `<@${rule.scopeId}>`
                })[rule.scopeType];
                const ruleLines = rules.map(rule => {
                    const action = rule.effect === 'disabled'
                        ? 'disabled in'
                        : `${rule.effect === 'allow' ? 'allowed' : 'denied'} for`;
                    return `**/${rule.commandPath}**: ${action} ${scopeLabel(rule)}`;
                });
                const description = [...roleLines, ...ruleLines].join('\n');

                return interaction.editReply({
                    embeds: [embeds.info('Command Permissions', description)]
                });
            }

        } catch (error) {
            await handleCommandError(error, interaction, 'updating permissions');
        }
    },

    permissions: [PermissionFlagsBits.Administrator]
};
