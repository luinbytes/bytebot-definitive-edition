const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { db } = require('../../database/index');
const { commandPermissions } = require('../../database/schema');
const embeds = require('../../utils/embeds');
const logger = require('../../utils/logger');
const { eq, and } = require('drizzle-orm');
const { dbLog } = require('../../utils/dbLogger');

module.exports = {
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
        const focusedValue = interaction.options.getFocused();
        // filter commands that are slash commands
        const choices = client.commands.map(c => c.data.name);
        const filtered = choices.filter(choice => choice.startsWith(focusedValue));
        await interaction.respond(
            filtered.map(choice => ({ name: choice, value: choice })).slice(0, 25)
        );
    },

    async execute(interaction, client) {
        const subcommand = interaction.options.getSubcommand();
        const commandName = interaction.options.getString('command');
        const role = interaction.options.getRole('role');

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        try {
            if (commandName) {
                const cmd = client.commands.get(commandName);
                if (!cmd) {
                    return interaction.editReply({
                        embeds: [embeds.error('Invalid Command', `The command \`${commandName}\` does not exist.`)]
                    });
                }
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

                return interaction.editReply({
                    embeds: [embeds.success('Permissions Reset', `Custom permissions for \`/${commandName}\` have been cleared. Default bot permissions apply.`)]
                });

            } else if (subcommand === 'list') {
                const perms = await dbLog.select('commandPermissions',
                    () => db.select().from(commandPermissions)
                        .where(eq(commandPermissions.guildId, interaction.guild.id)),
                    { guildId: interaction.guild.id }
                );

                if (perms.length === 0) {
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

                const description = Object.entries(grouped).map(([cmd, roles]) => {
                    return `**/${cmd}**: ${roles.join(', ')}`;
                }).join('\n');

                return interaction.editReply({
                    embeds: [embeds.info('Command Permissions', description)]
                });
            }

        } catch (error) {
            logger.error(error);
            return interaction.editReply({
                embeds: [embeds.error('Database Error', 'Failed to update permissions.')]
            });
        }
    },

    permissions: [PermissionFlagsBits.Administrator]
};
