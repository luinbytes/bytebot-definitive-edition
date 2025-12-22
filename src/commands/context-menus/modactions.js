const { ContextMenuCommandBuilder, ApplicationCommandType, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const { db } = require('../../database');
const { moderationLogs } = require('../../database/schema');
const { eq, desc } = require('drizzle-orm');
const logger = require('../../utils/logger');

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Moderate User')
        .setType(ApplicationCommandType.User)
        .setDMPermission(false), // Guild only

    permissions: [PermissionFlagsBits.ManageMessages], // Require mod permissions
    cooldown: 3,

    async execute(interaction, client) {
        const target = interaction.targetUser;
        const targetMember = interaction.targetMember;
        const executor = interaction.member;

        // Can't moderate self
        if (target.id === interaction.user.id) {
            return interaction.reply({
                embeds: [embeds.error('Invalid Target', 'You cannot moderate yourself.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        // Can't moderate bots (unless you're admin)
        if (target.bot && !executor.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                embeds: [embeds.error('Invalid Target', 'Only administrators can moderate bots.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        // User must be in guild
        if (!targetMember) {
            return interaction.reply({
                embeds: [embeds.error('User Not Found', 'This user is no longer in the server.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        // Role hierarchy check
        if (executor.roles.highest.position <= targetMember.roles.highest.position && !executor.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                embeds: [embeds.error('Insufficient Permissions', 'You cannot moderate users with equal or higher roles than you.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        // Build action buttons
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`mod_warn_${target.id}`)
                    .setLabel('Warn')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('⚠️'),
                new ButtonBuilder()
                    .setCustomId(`mod_kick_${target.id}`)
                    .setLabel('Kick')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('👢')
                    .setDisabled(!interaction.guild.members.me.permissions.has(PermissionFlagsBits.KickMembers)),
                new ButtonBuilder()
                    .setCustomId(`mod_ban_${target.id}`)
                    .setLabel('Ban')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔨')
                    .setDisabled(!interaction.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)),
                new ButtonBuilder()
                    .setCustomId(`mod_history_${target.id}`)
                    .setLabel('History')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📋')
            );

        const embed = embeds.brand(
            'Moderation Actions',
            `**Target:** ${target.tag}\n**ID:** \`${target.id}\`\n\nSelect an action below:`
        );

        embed.setThumbnail(target.displayAvatarURL({ size: 128 }));

        // Add warnings if bot lacks permissions
        const warnings = [];
        if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.KickMembers)) {
            warnings.push('Bot lacks **Kick Members** permission');
        }
        if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
            warnings.push('Bot lacks **Ban Members** permission');
        }

        if (warnings.length > 0) {
            embed.setFooter({ text: warnings.join(' • ') });
        }

        return interaction.reply({
            embeds: [embed],
            components: [row],
            flags: [MessageFlags.Ephemeral]
        });
    },

    // Handler for button interactions
    async handleButton(interaction, client) {
        const [action, type, userId] = interaction.customId.split('_');

        if (action !== 'mod') return;

        switch (type) {
            case 'warn':
                await showReasonModal(interaction, userId, 'warn', 'Warn User');
                break;

            case 'kick':
                await showReasonModal(interaction, userId, 'kick', 'Kick User');
                break;

            case 'ban':
                await showReasonModal(interaction, userId, 'ban', 'Ban User');
                break;

            case 'history':
                await showHistory(interaction, userId);
                break;
        }
    },

    // Handler for modal submissions
    async handleModal(interaction, client) {
        const [modalType, action, userId] = interaction.customId.split('_');

        if (modalType !== 'modal') return;

        const reason = interaction.fields.getTextInputValue('reason');
        const target = await client.users.fetch(userId);
        const guild = interaction.guild;
        const executor = interaction.member;

        // Re-validate hierarchy (user might have left or role changed)
        const targetMember = await guild.members.fetch(userId).catch(() => null);

        if (!targetMember && action !== 'ban') {
            return interaction.reply({
                embeds: [embeds.error('User Not Found', 'This user is no longer in the server.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        if (targetMember && executor.roles.highest.position <= targetMember.roles.highest.position && !executor.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                embeds: [embeds.error('Insufficient Permissions', 'You cannot moderate users with equal or higher roles.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        try {
            switch (action) {
                case 'warn':
                    // Log to database
                    await db.insert(moderationLogs).values({
                        guildId: guild.id,
                        targetId: userId,
                        executorId: executor.id,
                        action: 'WARN',
                        reason: reason,
                        timestamp: new Date()
                    });

                    // Try to DM user
                    try {
                        const warnEmbed = embeds.warn(
                            `Warning from ${guild.name}`,
                            `You have been warned by ${executor.user.tag}.\n\n**Reason:** ${reason}`
                        );
                        await target.send({ embeds: [warnEmbed] });
                    } catch (e) {
                        // User has DMs disabled, continue anyway
                    }

                    logger.info(`${executor.user.tag} warned ${target.tag} in ${guild.name}: ${reason}`);

                    return interaction.reply({
                        embeds: [embeds.success('User Warned', `${target.tag} has been warned.\n\n**Reason:** ${reason}`)],
                        flags: [MessageFlags.Ephemeral]
                    });

                case 'kick':
                    // Log to database first
                    await db.insert(moderationLogs).values({
                        guildId: guild.id,
                        targetId: userId,
                        executorId: executor.id,
                        action: 'KICK',
                        reason: reason,
                        timestamp: new Date()
                    });

                    // Try to DM user before kicking
                    try {
                        const kickEmbed = embeds.error(
                            `Kicked from ${guild.name}`,
                            `You have been kicked by ${executor.user.tag}.\n\n**Reason:** ${reason}`
                        );
                        await target.send({ embeds: [kickEmbed] });
                    } catch (e) {
                        // Continue even if DM fails
                    }

                    // Kick
                    await targetMember.kick(reason);

                    logger.info(`${executor.user.tag} kicked ${target.tag} from ${guild.name}: ${reason}`);

                    return interaction.reply({
                        embeds: [embeds.success('User Kicked', `${target.tag} has been kicked from the server.\n\n**Reason:** ${reason}`)],
                        flags: [MessageFlags.Ephemeral]
                    });

                case 'ban':
                    // Log to database first
                    await db.insert(moderationLogs).values({
                        guildId: guild.id,
                        targetId: userId,
                        executorId: executor.id,
                        action: 'BAN',
                        reason: reason,
                        timestamp: new Date()
                    });

                    // Try to DM user before banning
                    try {
                        const banEmbed = embeds.error(
                            `Banned from ${guild.name}`,
                            `You have been banned by ${executor.user.tag}.\n\n**Reason:** ${reason}`
                        );
                        await target.send({ embeds: [banEmbed] });
                    } catch (e) {
                        // Continue even if DM fails
                    }

                    // Ban
                    await guild.members.ban(userId, { reason: reason, deleteMessageSeconds: 0 });

                    logger.info(`${executor.user.tag} banned ${target.tag} from ${guild.name}: ${reason}`);

                    return interaction.reply({
                        embeds: [embeds.success('User Banned', `${target.tag} has been banned from the server.\n\n**Reason:** ${reason}`)],
                        flags: [MessageFlags.Ephemeral]
                    });
            }
        } catch (error) {
            logger.errorContext(`Error executing moderation action: ${action}`, error, {
                action: action,
                targetId: userId,
                executorId: executor.id,
                guildId: guild.id
            });

            return interaction.reply({
                embeds: [embeds.error('Action Failed', `Failed to ${action} user. The bot may lack permissions or the user may have left.`)],
                flags: [MessageFlags.Ephemeral]
            });
        }
    }
};

/**
 * Show modal for reason input
 */
async function showReasonModal(interaction, userId, action, title) {
    const modal = new ModalBuilder()
        .setCustomId(`modal_${action}_${userId}`)
        .setTitle(title);

    const reasonInput = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Reason')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500)
        .setPlaceholder('Enter the reason for this action...');

    modal.addComponents(
        new ActionRowBuilder().addComponents(reasonInput)
    );

    await interaction.showModal(modal);
}

/**
 * Show moderation history
 */
async function showHistory(interaction, userId) {
    const logs = await db.select()
        .from(moderationLogs)
        .where(eq(moderationLogs.targetId, userId))
        .orderBy(desc(moderationLogs.timestamp))
        .limit(10)
        .all();

    if (logs.length === 0) {
        return interaction.reply({
            embeds: [embeds.info('No History', 'This user has no moderation history.')],
            flags: [MessageFlags.Ephemeral]
        });
    }

    const historyEmbed = embeds.info(
        'Moderation History',
        `Showing last ${logs.length} action(s) for <@${userId}>`
    );

    for (const log of logs) {
        const timestamp = Math.floor(new Date(log.timestamp).getTime() / 1000);
        const actionEmoji = {
            'WARN': '⚠️',
            'KICK': '👢',
            'BAN': '🔨',
            'CLEAR': '🗑️'
        };

        historyEmbed.addFields({
            name: `${actionEmoji[log.action] || '•'} ${log.action} - <t:${timestamp}:R>`,
            value: `**By:** <@${log.executorId}>\n**Reason:** ${log.reason || '*No reason provided*'}`,
            inline: false
        });
    }

    return interaction.reply({
        embeds: [historyEmbed],
        flags: [MessageFlags.Ephemeral]
    });
}
