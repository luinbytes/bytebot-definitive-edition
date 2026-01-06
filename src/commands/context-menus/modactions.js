const { ContextMenuCommandBuilder, ApplicationCommandType, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const { db } = require('../../database');
const { moderationLogs } = require('../../database/schema');
const { eq, desc } = require('drizzle-orm');
const { executeModerationAction, validateHierarchy } = require('../../utils/moderationUtil');
const { handleCommandError } = require('../../utils/errorHandlerUtil');
const { fetchMember } = require('../../utils/discordApiUtil');

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

        // User must be in guild
        if (!targetMember) {
            return interaction.reply({
                embeds: [embeds.error('User Not Found', 'This user is no longer in the server.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        // Validate moderation permissions using centralized hierarchy checker
        const validation = validateHierarchy(executor, targetMember);
        if (!validation.valid) {
            return interaction.reply({
                embeds: [embeds.error('Cannot Moderate', validation.error)],
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
        const targetMember = await fetchMember(guild, userId, { logContext: 'modactions-revalidate' });

        if (!targetMember && action !== 'ban') {
            return interaction.reply({
                embeds: [embeds.error('User Not Found', 'This user is no longer in the server.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        // Validate hierarchy using centralized utility
        if (targetMember) {
            const validation = validateHierarchy(executor, targetMember);
            if (!validation.valid) {
                return interaction.reply({
                    embeds: [embeds.error('Cannot Moderate', validation.error)],
                    flags: [MessageFlags.Ephemeral]
                });
            }
        }

        try {
            switch (action) {
                case 'warn':
                    // Execute moderation action (log + notify)
                    await executeModerationAction({
                        guildId: guild.id,
                        guildName: guild.name,
                        target,
                        executor,
                        action: 'WARN',
                        reason
                    });

                    return interaction.reply({
                        embeds: [embeds.success('User Warned', `${target.tag} has been warned.\n\n**Reason:** ${reason}`)],
                        flags: [MessageFlags.Ephemeral]
                    });

                case 'kick':
                    // Execute moderation action (log + notify)
                    await executeModerationAction({
                        guildId: guild.id,
                        guildName: guild.name,
                        target,
                        executor,
                        action: 'KICK',
                        reason
                    });

                    // Perform the kick
                    await targetMember.kick(reason);

                    return interaction.reply({
                        embeds: [embeds.success('User Kicked', `${target.tag} has been kicked from the server.\n\n**Reason:** ${reason}`)],
                        flags: [MessageFlags.Ephemeral]
                    });

                case 'ban':
                    // Execute moderation action (log + notify)
                    await executeModerationAction({
                        guildId: guild.id,
                        guildName: guild.name,
                        target,
                        executor,
                        action: 'BAN',
                        reason
                    });

                    // Perform the ban
                    await guild.members.ban(userId, { reason: reason, deleteMessageSeconds: 0 });

                    return interaction.reply({
                        embeds: [embeds.success('User Banned', `${target.tag} has been banned from the server.\n\n**Reason:** ${reason}`)],
                        flags: [MessageFlags.Ephemeral]
                    });
            }
        } catch (error) {
            await handleCommandError(error, interaction, `executing ${action} action`);
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
