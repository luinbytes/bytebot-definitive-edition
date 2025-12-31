const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { db } = require('../../database');
const { achievementRoleConfig, achievementRoles, customAchievements } = require('../../database/schema');
const { eq, and } = require('drizzle-orm');
const embeds = require('../../utils/embeds');
const logger = require('../../utils/logger');
const { dbLog } = require('../../utils/dbLogger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('achievement')
        .setDescription('Manage achievement role rewards and custom achievements')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false)
        .addSubcommand(sub =>
            sub
                .setName('setup')
                .setDescription('Configure achievement role reward settings')
                .addBooleanOption(opt =>
                    opt
                        .setName('enabled')
                        .setDescription('Enable or disable role rewards')
                        .setRequired(false))
                .addStringOption(opt =>
                    opt
                        .setName('prefix')
                        .setDescription('Role name prefix (e.g., 🏆)')
                        .setRequired(false)
                        .setMaxLength(10))
                .addBooleanOption(opt =>
                    opt
                        .setName('use_rarity_colors')
                        .setDescription('Use rarity-based colors instead of brand purple')
                        .setRequired(false))
                .addBooleanOption(opt =>
                    opt
                        .setName('cleanup_orphaned')
                        .setDescription('Automatically delete roles with 0 members')
                        .setRequired(false))
                .addBooleanOption(opt =>
                    opt
                        .setName('notify_on_earn')
                        .setDescription('Send DM notifications when achievements are earned')
                        .setRequired(false)))
        .addSubcommand(sub =>
            sub
                .setName('view')
                .setDescription('View current achievement role reward configuration'))
        .addSubcommand(sub =>
            sub
                .setName('cleanup')
                .setDescription('Manually trigger orphaned role cleanup'))
        .addSubcommand(sub =>
            sub
                .setName('list_roles')
                .setDescription('List all achievement roles with member counts'))
        .addSubcommand(sub =>
            sub
                .setName('create')
                .setDescription('Create a custom achievement for your server'))
        .addSubcommand(sub =>
            sub
                .setName('award')
                .setDescription('Manually award an achievement to a user')
                .addUserOption(opt =>
                    opt
                        .setName('user')
                        .setDescription('User to award achievement to')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt
                        .setName('achievement')
                        .setDescription('Achievement to award')
                        .setRequired(true)
                        .setAutocomplete(true)))
        .addSubcommand(sub =>
            sub
                .setName('remove')
                .setDescription('Remove an achievement from a user')
                .addUserOption(opt =>
                    opt
                        .setName('user')
                        .setDescription('User to remove achievement from')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt
                        .setName('achievement')
                        .setDescription('Achievement to remove')
                        .setRequired(true)
                        .setAutocomplete(true))),

    async execute(interaction, client) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'setup') {
            await handleSetup(interaction);
        } else if (subcommand === 'view') {
            await handleView(interaction);
        } else if (subcommand === 'cleanup') {
            await handleCleanup(interaction, client);
        } else if (subcommand === 'list_roles') {
            await handleListRoles(interaction);
        } else if (subcommand === 'create') {
            await handleCreate(interaction);
        } else if (subcommand === 'award') {
            await handleAward(interaction, client);
        } else if (subcommand === 'remove') {
            await handleRemove(interaction, client);
        }
    },

    async autocomplete(interaction, client) {
        const focusedOption = interaction.options.getFocused(true);
        const subcommand = interaction.options.getSubcommand();

        if (focusedOption.name === 'achievement') {
            try {
                if (!client.activityStreakService) {
                    return interaction.respond([]);
                }

                const manager = client.activityStreakService.achievementManager;
                await manager.loadDefinitions();

                let allAchievements = Array.from(manager.achievements.values());

                // Add custom achievements for this guild
                const customAchs = await manager.getCustomAchievements(interaction.guild.id);
                allAchievements.push(...customAchs);

                // For remove command, only show achievements the user actually has
                if (subcommand === 'remove') {
                    const targetUser = interaction.options.getUser('user');
                    if (targetUser) {
                        const userAchievements = await dbLog.select('activityAchievements',
                            () => db.select()
                                .from(require('../../database/schema').activityAchievements)
                                .where(and(
                                    eq(require('../../database/schema').activityAchievements.userId, targetUser.id),
                                    eq(require('../../database/schema').activityAchievements.guildId, interaction.guild.id)
                                )),
                            { userId: targetUser.id, guildId: interaction.guild.id }
                        );

                        const userAchIds = new Set(userAchievements.map(a => a.achievementId));
                        allAchievements = allAchievements.filter(ach =>
                            userAchIds.has(ach.achievementId || ach.id)
                        );
                    }
                }

                // Filter by user input
                const filtered = allAchievements
                    .filter(ach => {
                        const search = focusedOption.value.toLowerCase();
                        return ach.title.toLowerCase().includes(search) ||
                               ach.achievementId?.toLowerCase().includes(search) ||
                               ach.id?.toLowerCase().includes(search) ||
                               ach.description.toLowerCase().includes(search);
                    })
                    .slice(0, 25); // Discord limit

                const choices = filtered.map(ach => ({
                    name: `${ach.emoji} ${ach.title} (${ach.rarity})`,
                    value: ach.achievementId || ach.id
                }));

                await interaction.respond(choices);

            } catch (error) {
                logger.error('Error in achievement autocomplete:', error);
                await interaction.respond([]);
            }
        }
    }
};

/**
 * Handle setup subcommand - configure role reward settings
 */
async function handleSetup(interaction) {
    try {
        const enabled = interaction.options.getBoolean('enabled');
        const prefix = interaction.options.getString('prefix');
        const useRarityColors = interaction.options.getBoolean('use_rarity_colors');
        const cleanupOrphaned = interaction.options.getBoolean('cleanup_orphaned');
        const notifyOnEarn = interaction.options.getBoolean('notify_on_earn');

        // Check if at least one option was provided
        if (enabled === null && !prefix && useRarityColors === null &&
            cleanupOrphaned === null && notifyOnEarn === null) {
            return interaction.reply({
                embeds: [embeds.error('No Options', 'Please provide at least one setting to configure.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        // Get existing config
        const existing = await dbLog.select('achievementRoleConfig',
            () => db.select()
                .from(achievementRoleConfig)
                .where(eq(achievementRoleConfig.guildId, interaction.guild.id))
                .get(),
            { guildId: interaction.guild.id }
        );

        // Build update object
        const updates = {
            updatedAt: new Date()
        };

        if (enabled !== null) updates.enabled = enabled;
        if (prefix !== null) updates.rolePrefix = prefix;
        if (useRarityColors !== null) updates.useRarityColors = useRarityColors;
        if (cleanupOrphaned !== null) updates.cleanupOrphaned = cleanupOrphaned;
        if (notifyOnEarn !== null) updates.notifyOnEarn = notifyOnEarn;

        if (existing) {
            // Update existing config
            await dbLog.update('achievementRoleConfig',
                () => db.update(achievementRoleConfig)
                    .set(updates)
                    .where(eq(achievementRoleConfig.guildId, interaction.guild.id)),
                { guildId: interaction.guild.id, updates: Object.keys(updates) }
            );
        } else {
            // Create new config with defaults
            await dbLog.insert('achievementRoleConfig',
                () => db.insert(achievementRoleConfig).values({
                    guildId: interaction.guild.id,
                    enabled: enabled ?? true,
                    rolePrefix: prefix ?? '🏆',
                    useRarityColors: useRarityColors ?? true,
                    cleanupOrphaned: cleanupOrphaned ?? true,
                    notifyOnEarn: notifyOnEarn ?? true,
                    createdAt: new Date(),
                    updatedAt: new Date()
                }),
                { guildId: interaction.guild.id }
            );
        }

        const embed = embeds.success(
            '⚙️ Configuration Updated',
            'Achievement role reward settings have been updated.'
        );

        const changedSettings = [];
        if (enabled !== null) changedSettings.push(`**Enabled:** ${enabled ? '✅' : '❌'}`);
        if (prefix) changedSettings.push(`**Prefix:** ${prefix}`);
        if (useRarityColors !== null) changedSettings.push(`**Rarity Colors:** ${useRarityColors ? '✅' : '❌'}`);
        if (cleanupOrphaned !== null) changedSettings.push(`**Auto Cleanup:** ${cleanupOrphaned ? '✅' : '❌'}`);
        if (notifyOnEarn !== null) changedSettings.push(`**DM Notifications:** ${notifyOnEarn ? '✅' : '❌'}`);

        embed.setDescription(changedSettings.join('\n'));

        await interaction.reply({
            embeds: [embed],
            flags: [MessageFlags.Ephemeral]
        });

        logger.success(`Achievement config updated in ${interaction.guild.name} by ${interaction.user.tag}`);

    } catch (error) {
        logger.error('Error updating achievement config:', error);
        await interaction.reply({
            embeds: [embeds.error('Configuration Failed', 'An error occurred while updating settings.')],
            flags: [MessageFlags.Ephemeral]
        });
    }
}

/**
 * Handle view subcommand - show current configuration
 */
async function handleView(interaction) {
    try {
        const config = await dbLog.select('achievementRoleConfig',
            () => db.select()
                .from(achievementRoleConfig)
                .where(eq(achievementRoleConfig.guildId, interaction.guild.id))
                .get(),
            { guildId: interaction.guild.id }
        );

        const embed = embeds.brand(
            '⚙️ Achievement Role Reward Configuration',
            interaction.guild.name
        );

        if (!config) {
            embed.setDescription('**Status:** Using default settings (not configured)\n\n**Default Settings:**');
            embed.addFields(
                { name: 'Enabled', value: '✅ Yes', inline: true },
                { name: 'Role Prefix', value: '🏆', inline: true },
                { name: 'Rarity Colors', value: '✅ Yes', inline: true },
                { name: 'Auto Cleanup', value: '✅ Yes', inline: true },
                { name: 'DM Notifications', value: '✅ Yes', inline: true }
            );
        } else {
            embed.addFields(
                { name: 'Enabled', value: config.enabled ? '✅ Yes' : '❌ No', inline: true },
                { name: 'Role Prefix', value: config.rolePrefix, inline: true },
                { name: 'Rarity Colors', value: config.useRarityColors ? '✅ Yes' : '❌ No', inline: true },
                { name: 'Auto Cleanup', value: config.cleanupOrphaned ? '✅ Yes' : '❌ No', inline: true },
                { name: 'DM Notifications', value: config.notifyOnEarn ? '✅ Yes' : '❌ No', inline: true }
            );
        }

        embed.setFooter({ text: 'Use /achievement setup to configure settings' });

        await interaction.reply({
            embeds: [embed],
            flags: [MessageFlags.Ephemeral]
        });

    } catch (error) {
        logger.error('Error viewing achievement config:', error);
        await interaction.reply({
            embeds: [embeds.error('View Failed', 'An error occurred while fetching settings.')],
            flags: [MessageFlags.Ephemeral]
        });
    }
}

/**
 * Handle cleanup subcommand - manually trigger orphaned role cleanup
 */
async function handleCleanup(interaction, client) {
    try {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        if (!client.activityStreakService) {
            return interaction.editReply({
                embeds: [embeds.error('Service Unavailable', 'Activity streak service is not initialized.')]
            });
        }

        // Run cleanup
        await client.activityStreakService.cleanupOrphanedRoles();

        const embed = embeds.success(
            '🧹 Cleanup Complete',
            'Orphaned achievement roles have been cleaned up. Check the console logs for details.'
        );

        await interaction.editReply({ embeds: [embed] });

        logger.success(`Manual role cleanup triggered in ${interaction.guild.name} by ${interaction.user.tag}`);

    } catch (error) {
        logger.error('Error during manual cleanup:', error);
        await interaction.editReply({
            embeds: [embeds.error('Cleanup Failed', 'An error occurred during cleanup.')]
        });
    }
}

/**
 * Handle list_roles subcommand - list all achievement roles with member counts
 */
async function handleListRoles(interaction) {
    try {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        // Get all achievement roles for this guild
        const guildRoles = await dbLog.select('achievementRoles',
            () => db.select()
                .from(achievementRoles)
                .where(eq(achievementRoles.guildId, interaction.guild.id)),
            { guildId: interaction.guild.id }
        );

        if (guildRoles.length === 0) {
            return interaction.editReply({
                embeds: [embeds.info('No Roles', 'No achievement roles have been created yet in this server.')]
            });
        }

        const embed = embeds.brand(
            '🏆 Achievement Roles',
            `${guildRoles.length} role${guildRoles.length !== 1 ? 's' : ''} in ${interaction.guild.name}`
        );

        let roleList = '';
        let totalMembers = 0;

        for (const roleRecord of guildRoles) {
            const discordRole = interaction.guild.roles.cache.get(roleRecord.roleId);

            if (discordRole) {
                const memberCount = discordRole.members.size;
                totalMembers += memberCount;
                roleList += `**${discordRole.name}**\n`;
                roleList += `   ${memberCount} member${memberCount !== 1 ? 's' : ''} • ID: \`${roleRecord.achievementId}\`\n\n`;
            } else {
                roleList += `**[Deleted Role]**\n`;
                roleList += `   Achievement: \`${roleRecord.achievementId}\` (orphaned)\n\n`;
            }
        }

        if (roleList.length > 4000) {
            roleList = roleList.substring(0, 3900) + '\n\n*...list truncated*';
        }

        embed.setDescription(roleList || 'No roles found.');
        embed.setFooter({ text: `Total members with achievement roles: ${totalMembers}` });

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        logger.error('Error listing achievement roles:', error);
        await interaction.editReply({
            embeds: [embeds.error('List Failed', 'An error occurred while fetching roles.')]
        });
    }
}

/**
 * Handle create subcommand - show modal for custom achievement creation
 */
async function handleCreate(interaction) {
    try {
        // Create modal with achievement fields
        const modal = new ModalBuilder()
            .setCustomId('achievement_create_modal')
            .setTitle('Create Custom Achievement');

        // Achievement ID (auto-generated from title, shown in step 2)
        const titleInput = new TextInputBuilder()
            .setCustomId('achievement_title')
            .setLabel('Achievement Title')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g., Server Booster')
            .setRequired(true)
            .setMaxLength(100);

        const descriptionInput = new TextInputBuilder()
            .setCustomId('achievement_description')
            .setLabel('Description')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('What does this achievement recognize?')
            .setRequired(true)
            .setMaxLength(500);

        const emojiInput = new TextInputBuilder()
            .setCustomId('achievement_emoji')
            .setLabel('Emoji')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g., 🎉 (single emoji)')
            .setRequired(true)
            .setMaxLength(10);

        const rarityInput = new TextInputBuilder()
            .setCustomId('achievement_rarity')
            .setLabel('Rarity')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('common/uncommon/rare/epic/legendary/mythic')
            .setRequired(true)
            .setMaxLength(20);

        const pointsInput = new TextInputBuilder()
            .setCustomId('achievement_points')
            .setLabel('Points (1-1000)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('100')
            .setRequired(true)
            .setMaxLength(4);

        // Add inputs to action rows
        modal.addComponents(
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(descriptionInput),
            new ActionRowBuilder().addComponents(emojiInput),
            new ActionRowBuilder().addComponents(rarityInput),
            new ActionRowBuilder().addComponents(pointsInput)
        );

        await interaction.showModal(modal);

    } catch (error) {
        logger.error('Error showing achievement creation modal:', error);
        await interaction.reply({
            embeds: [embeds.error('Modal Error', 'Failed to show achievement creation form.')],
            flags: [MessageFlags.Ephemeral]
        });
    }
}

/**
 * Handle award subcommand - manually award achievement to user
 */
async function handleAward(interaction, client) {
    try {
        const targetUser = interaction.options.getUser('user');
        const achievementId = interaction.options.getString('achievement');

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        if (!client.activityStreakService) {
            return interaction.editReply({
                embeds: [embeds.error('Service Unavailable', 'Activity streak service is not initialized.')]
            });
        }

        // Verify achievement exists
        const achievement = await client.activityStreakService.achievementManager.getById(achievementId);
        if (!achievement) {
            return interaction.editReply({
                embeds: [embeds.error('Not Found', `Achievement \`${achievementId}\` does not exist.`)]
            });
        }

        // Check if seasonal achievement is active
        if (achievement.seasonal) {
            const canAward = await client.activityStreakService.achievementManager.canAward(achievementId);
            if (!canAward) {
                return interaction.editReply({
                    embeds: [embeds.error(
                        'Seasonal Achievement Inactive',
                        `**${achievement.title}** is a seasonal achievement that is not currently active.\n\n` +
                        `**Event:** ${achievement.seasonalEvent}\n` +
                        `**Active:** ${achievement.startDate} to ${achievement.endDate}\n\n` +
                        `This achievement can only be awarded during its active period.`
                    )]
                });
            }
        }

        // Check if user already has the achievement
        const hasAchievement = await client.activityStreakService.hasAchievement(
            targetUser.id,
            interaction.guild.id,
            achievementId
        );

        if (hasAchievement) {
            return interaction.editReply({
                embeds: [embeds.warn(
                    'Already Earned',
                    `${targetUser.username} already has **${achievement.emoji} ${achievement.title}**.`
                )]
            });
        }

        // Award the achievement (mark as manually awarded by admin)
        await client.activityStreakService.awardAchievement(
            targetUser.id,
            interaction.guild.id,
            achievementId,
            interaction.user.id // Track who manually awarded this
        );

        const embed = embeds.success(
            '🏆 Achievement Awarded!',
            `Successfully awarded **${achievement.emoji} ${achievement.title}** to ${targetUser.username}!`
        );

        embed.addFields(
            { name: 'User', value: `<@${targetUser.id}>`, inline: true },
            { name: 'Achievement', value: achievement.title, inline: true },
            { name: 'Points', value: `${achievement.points}`, inline: true },
            { name: 'Rarity', value: achievement.rarity, inline: true }
        );

        if (achievement.grantRole) {
            embed.addFields({
                name: 'Role Reward',
                value: '✅ Role will be granted automatically',
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });

        logger.success(`${interaction.user.tag} manually awarded ${achievement.title} to ${targetUser.tag} in ${interaction.guild.name}`);

    } catch (error) {
        logger.error('Error awarding achievement:', error);
        await interaction.editReply({
            embeds: [embeds.error('Award Failed', 'An error occurred while awarding the achievement.')]
        });
    }
}

async function handleRemove(interaction, client) {
    try {
        const targetUser = interaction.options.getUser('user');
        const achievementId = interaction.options.getString('achievement');

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        if (!client.activityStreakService) {
            return interaction.editReply({
                embeds: [embeds.error('Service Unavailable', 'Activity streak service is not initialized.')]
            });
        }

        // Verify achievement exists
        const achievement = await client.activityStreakService.achievementManager.getById(achievementId);
        if (!achievement) {
            return interaction.editReply({
                embeds: [embeds.error('Not Found', `Achievement \`${achievementId}\` does not exist.`)]
            });
        }

        // Check if user has the achievement
        const hasAchievement = await client.activityStreakService.hasAchievement(
            targetUser.id,
            interaction.guild.id,
            achievementId
        );

        if (!hasAchievement) {
            return interaction.editReply({
                embeds: [embeds.warn(
                    'Not Found',
                    `${targetUser.username} does not have **${achievement.emoji} ${achievement.title}**.`
                )]
            });
        }

        // Remove the achievement
        await client.activityStreakService.removeAchievement(
            targetUser.id,
            interaction.guild.id,
            achievementId
        );

        const embed = embeds.success(
            '🗑️ Achievement Removed',
            `Successfully removed **${achievement.emoji} ${achievement.title}** from ${targetUser.username}.`
        );

        embed.addFields(
            { name: 'User', value: `<@${targetUser.id}>`, inline: true },
            { name: 'Achievement', value: achievement.title, inline: true },
            { name: 'Points Removed', value: `${achievement.points}`, inline: true }
        );

        await interaction.editReply({ embeds: [embed] });

        logger.success(`${interaction.user.tag} removed ${achievement.title} from ${targetUser.tag} in ${interaction.guild.name}`);

    } catch (error) {
        logger.error('Error removing achievement:', error);
        await interaction.editReply({
            embeds: [embeds.error('Remove Failed', 'An error occurred while removing the achievement.')]
        });
    }
}
