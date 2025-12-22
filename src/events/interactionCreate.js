const { Events, Collection, PermissionFlagsBits, MessageFlags } = require('discord.js');
const logger = require('../utils/logger');
const embeds = require('../utils/embeds');
const config = require('../../config.json');
const { db } = require('../database/index');
const { users, commandPermissions } = require('../database/schema');
const { sql, eq, and } = require('drizzle-orm');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction, client) {
        // Handle Autocomplete interactions
        if (interaction.isAutocomplete()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;

            try {
                await command.autocomplete(interaction, client);
            } catch (error) {
                logger.error(`Autocomplete Error: ${error}`);
            }
            return;
        }

        // Handle BytePod Interactions
        if ((interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) && interaction.customId.startsWith('bytepod_')) {
            const command = client.commands.get('bytepod');
            if (command && command.handleInteraction) {
                try {
                    await command.handleInteraction(interaction, client);
                } catch (error) {
                    logger.errorContext('BytePod Interaction Error', error, {
                        customId: interaction.customId,
                        channelId: interaction.channelId,
                        userId: interaction.user?.id,
                        guildId: interaction.guildId
                    });
                    // Attempt to notify user if possible
                    try {
                        const errorEmbed = embeds.error('Interaction Failed', 'An error occurred while processing this action. The channel may have been deleted or the bot lacks permissions.');
                        if (interaction.replied || interaction.deferred) {
                            await interaction.followUp({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
                        } else {
                            await interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
                        }
                    } catch (e) {
                        logger.error('Failed to send error response to user:', e);
                    }
                }
            }
            return;
        }

        // Handle Bookmark Interactions
        if ((interaction.isButton()) && interaction.customId.startsWith('bookmark_')) {
            const command = client.commands.get('bookmark');
            if (command && command.handleInteraction) {
                try {
                    await command.handleInteraction(interaction, client);
                } catch (error) {
                    logger.errorContext('Bookmark Interaction Error', error, {
                        customId: interaction.customId,
                        userId: interaction.user?.id,
                        guildId: interaction.guildId
                    });
                    // Attempt to notify user if possible
                    try {
                        const errorEmbed = embeds.error('Interaction Failed', 'An error occurred while processing this action.');
                        if (interaction.replied || interaction.deferred) {
                            await interaction.followUp({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
                        } else {
                            await interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
                        }
                    } catch (e) {
                        logger.error('Failed to send error response to user:', e);
                    }
                }
            }
            return;
        }

        // Handle Moderation Button Interactions
        if (interaction.isButton() && interaction.customId.startsWith('mod_')) {
            const modActionsMenu = client.contextMenus.get('Moderate User');
            if (modActionsMenu && modActionsMenu.handleButton) {
                try {
                    await modActionsMenu.handleButton(interaction, client);
                } catch (error) {
                    logger.errorContext('Moderation Button Error', error, {
                        customId: interaction.customId,
                        userId: interaction.user?.id,
                        guildId: interaction.guildId
                    });
                    // Attempt to notify user if possible
                    try {
                        const errorEmbed = embeds.error('Interaction Failed', 'An error occurred while processing this moderation action.');
                        if (interaction.replied || interaction.deferred) {
                            await interaction.followUp({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
                        } else {
                            await interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
                        }
                    } catch (e) {
                        logger.error('Failed to send error response to user:', e);
                    }
                }
            }
            return;
        }

        // Handle Moderation Modal Submissions
        if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_')) {
            const modActionsMenu = client.contextMenus.get('Moderate User');
            if (modActionsMenu && modActionsMenu.handleModal) {
                try {
                    await modActionsMenu.handleModal(interaction, client);
                } catch (error) {
                    logger.errorContext('Moderation Modal Error', error, {
                        customId: interaction.customId,
                        userId: interaction.user?.id,
                        guildId: interaction.guildId
                    });
                    // Attempt to notify user if possible
                    try {
                        const errorEmbed = embeds.error('Action Failed', 'An error occurred while processing this moderation action.');
                        if (interaction.replied || interaction.deferred) {
                            await interaction.followUp({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
                        } else {
                            await interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
                        }
                    } catch (e) {
                        logger.error('Failed to send error response to user:', e);
                    }
                }
            }
            return;
        }

        // Handle Context Menu Commands (User & Message)
        if (interaction.isUserContextMenuCommand() || interaction.isMessageContextMenuCommand()) {
            const menu = client.contextMenus.get(interaction.commandName);

            if (!menu) {
                logger.error(`No context menu matching ${interaction.commandName} was found.`);
                return;
            }

            // Same security pipeline as slash commands

            // 1. DM Check
            const isDM = !interaction.guild;
            const dmAllowed = menu.data.dm_permission !== false;

            if (isDM && !dmAllowed) {
                return interaction.reply({
                    embeds: [embeds.error('Server Only', 'This action can only be used within a server.')],
                    flags: [MessageFlags.Ephemeral]
                });
            }

            // 2. Permission checks (if in guild)
            if (interaction.guild && menu.permissions) {
                const { checkUserPermissions } = require('../utils/permissions');
                const { allowed, error } = await checkUserPermissions(interaction, menu);

                if (!allowed) {
                    return interaction.reply({
                        embeds: [error],
                        flags: [MessageFlags.Ephemeral]
                    });
                }
            }

            // 3. Cooldown (if defined)
            if (menu.cooldown) {
                const { cooldowns } = client;
                if (!cooldowns.has(menu.data.name)) {
                    cooldowns.set(menu.data.name, new Collection());
                }

                const now = Date.now();
                const timestamps = cooldowns.get(menu.data.name);
                const cooldownAmount = menu.cooldown * 1000;

                if (timestamps.has(interaction.user.id)) {
                    const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;

                    if (now < expirationTime) {
                        const expiredTimestamp = Math.round(expirationTime / 1000);
                        return interaction.reply({
                            embeds: [embeds.warn('Cooldown Active', `Please wait, you can use this again <t:${expiredTimestamp}:R>.`)],
                            flags: [MessageFlags.Ephemeral]
                        });
                    }
                }

                timestamps.set(interaction.user.id, now);
                setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);
            }

            // 4. Auto-defer if long-running
            if (menu.longRunning) {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            }

            // 5. Execute
            try {
                await menu.execute(interaction, client);
            } catch (error) {
                logger.errorContext(`Error executing context menu: ${interaction.commandName}`, error, {
                    menuName: interaction.commandName,
                    userId: interaction.user.id,
                    guildId: interaction.guildId,
                    targetType: interaction.targetType
                });

                const errorMessage = embeds.error('Error', 'An unexpected error occurred while processing this action.');

                try {
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp({ embeds: [errorMessage], flags: [MessageFlags.Ephemeral] });
                    } else {
                        await interaction.reply({ embeds: [errorMessage], flags: [MessageFlags.Ephemeral] });
                    }
                } catch (replyError) {
                    // Interaction expired or already handled - log but don't crash
                    logger.debug(`Could not send error response: ${replyError.message}`);
                }
            }

            return;
        }

        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.get(interaction.commandName);

        if (!command) {
            logger.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        // --- SECURITY & EDGE CASES ---

        // 1. Guild Only Restriction (Check data.dm_permission if undefined, default to true for slash commands)
        const isDM = !interaction.guild;
        const dmAllowed = command.data.dm_permission !== false;

        if (isDM && !dmAllowed) {
            return interaction.reply({
                embeds: [embeds.error('Guild Only', 'This command can only be used within a server.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        // 2. Bot Permission Verification (Only if in a guild)
        if (interaction.guild) {
            const botMember = interaction.guild.members.me;
            if (!botMember.permissionsIn(interaction.channel).has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
                try {
                    return await interaction.reply({
                        content: '❌ I do not have permission to send embeds in this channel. Please ensure I have "Send Messages" and "Embed Links" permissions.',
                        flags: [MessageFlags.Ephemeral]
                    });
                } catch (e) {
                    logger.error(`Failed to notify about missing permissions in ${interaction.guild.id}: ${e}`);
                    return;
                }
            }
        }

        // 3. Developer Only Check
        if (command.devOnly && !config.developers.includes(interaction.user.id)) {
            return interaction.reply({
                embeds: [embeds.error('Access Denied', 'This command is restricted to bot developers.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        // 4. Permission Checks (Modular)
        if (interaction.guild) {
            const { checkUserPermissions } = require('../utils/permissions');
            const { allowed, error } = await checkUserPermissions(interaction, command);

            if (!allowed) {
                return interaction.reply({
                    embeds: [error],
                    flags: [MessageFlags.Ephemeral]
                });
            }
        }

        // 5. Cooldown Logic
        const { cooldowns } = client;
        if (!cooldowns.has(command.data.name)) {
            cooldowns.set(command.data.name, new Collection());
        }

        const now = Date.now();
        const timestamps = cooldowns.get(command.data.name);
        const defaultCooldownDuration = 3;
        const cooldownAmount = (command.cooldown ?? defaultCooldownDuration) * 1000;

        if (timestamps.has(interaction.user.id)) {
            const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;

            if (now < expirationTime) {
                const expiredTimestamp = Math.round(expirationTime / 1000);
                return interaction.reply({
                    embeds: [embeds.warn('Cooldown Active', `Please wait, you can use this command again <t:${expiredTimestamp}:R>.`)],
                    flags: [MessageFlags.Ephemeral]
                });
            }
        }

        // --- AUTHORIZED EXECUTION START ---

        // Update database tracking
        try {
            await db.insert(users).values({
                id: interaction.user.id,
                guildId: interaction.guild?.id ?? 'DM',
                commandsRun: 1,
                lastSeen: new Date(),
            }).onConflictDoUpdate({
                target: users.id,
                set: {
                    commandsRun: sql`${users.commandsRun} + 1`,
                    lastSeen: new Date(),
                },
            });
        } catch (error) {
            logger.error(`Failed to update user stats: ${error}`);
        }

        timestamps.set(interaction.user.id, now);
        setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

        // 6. Interaction Deferral
        if (command.longRunning) {
            await interaction.deferReply({ flags: command.data.ephemeral ? [MessageFlags.Ephemeral] : [] });
        }

        // 7. Execution
        try {
            await command.execute(interaction, client);
        } catch (error) {
            // Build detailed context for debugging
            const subcommand = interaction.options.getSubcommand(false);
            const subcommandGroup = interaction.options.getSubcommandGroup(false);
            let commandPath = interaction.commandName;
            if (subcommandGroup) commandPath += ` ${subcommandGroup}`;
            if (subcommand) commandPath += ` ${subcommand}`;

            // Extract options for context (avoid sensitive data)
            const options = {};
            try {
                interaction.options.data.forEach(opt => {
                    if (opt.type === 1) { // Subcommand
                        opt.options?.forEach(o => {
                            options[o.name] = o.value;
                        });
                    } else if (opt.type === 2) { // Subcommand Group
                        opt.options?.forEach(sub => {
                            sub.options?.forEach(o => {
                                options[o.name] = o.value;
                            });
                        });
                    } else {
                        options[opt.name] = opt.value;
                    }
                });
            } catch { }

            logger.errorContext(`Error executing command: ${commandPath}`, error, {
                command: commandPath,
                options: Object.keys(options).length > 0 ? options : undefined,
                userId: interaction.user?.id,
                guildId: interaction.guildId,
                channelId: interaction.channelId
            });

            const errorMessage = embeds.error('Critical Error', 'An unexpected error occurred while executing this command. The developers have been notified.');

            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ embeds: [errorMessage], flags: [MessageFlags.Ephemeral] });
                } else {
                    await interaction.reply({ embeds: [errorMessage], flags: [MessageFlags.Ephemeral] });
                }
            } catch (replyError) {
                // Interaction expired or already handled - log but don't crash
                logger.debug(`Could not send error response: ${replyError.message}`);
            }
        }
    },
};
