const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { db } = require('../../database');
const { achievementRoleConfig, achievementRoles } = require('../../database/schema');
const { eq } = require('drizzle-orm');
const embeds = require('../../utils/embeds');
const logger = require('../../utils/logger');

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
                .setDescription('List all achievement roles with member counts')),

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
        const existing = await db.select()
            .from(achievementRoleConfig)
            .where(eq(achievementRoleConfig.guildId, interaction.guild.id))
            .get();

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
            await db.update(achievementRoleConfig)
                .set(updates)
                .where(eq(achievementRoleConfig.guildId, interaction.guild.id));
        } else {
            // Create new config with defaults
            await db.insert(achievementRoleConfig).values({
                guildId: interaction.guild.id,
                enabled: enabled ?? true,
                rolePrefix: prefix ?? '🏆',
                useRarityColors: useRarityColors ?? true,
                cleanupOrphaned: cleanupOrphaned ?? true,
                notifyOnEarn: notifyOnEarn ?? true,
                createdAt: new Date(),
                updatedAt: new Date()
            });
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
        const config = await db.select()
            .from(achievementRoleConfig)
            .where(eq(achievementRoleConfig.guildId, interaction.guild.id))
            .get();

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
        const guildRoles = await db.select()
            .from(achievementRoles)
            .where(eq(achievementRoles.guildId, interaction.guild.id));

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
