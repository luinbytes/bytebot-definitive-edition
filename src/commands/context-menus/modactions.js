const { ContextMenuCommandBuilder, ApplicationCommandType, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const { sqlite } = require('../../database');
const { validateHierarchy, validateProtectedTarget } = require('../../utils/moderationUtil');
const { executeMemberAction, executeUserAction } = require('../../services/moderationService');
const { handleCommandError } = require('../../utils/errorHandlerUtil');
const { fetchMember } = require('../../utils/discordApiUtil');

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Moderate User')
        .setType(ApplicationCommandType.User)
        .setDMPermission(false), // Guild only

    permissions: [PermissionFlagsBits.ModerateMembers],
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
                    .setDisabled(!executor.permissions.has(PermissionFlagsBits.KickMembers)
                        || !interaction.guild.members.me.permissions.has(PermissionFlagsBits.KickMembers)),
                new ButtonBuilder()
                    .setCustomId(`mod_ban_${target.id}`)
                    .setLabel('Ban')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔨')
                    .setDisabled(!executor.permissions.has(PermissionFlagsBits.BanMembers)
                        || !interaction.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)),
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

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const target = await client.users.fetch(userId);
        const guild = interaction.guild;
        const executor = interaction.member;

        // Re-validate hierarchy (user might have left or role changed)
        let targetMember;
        try {
            targetMember = await fetchMember(guild, userId, {
                logContext: 'modactions-revalidate',
                cache: false,
                force: true,
                throwOnError: true
            });
        } catch (error) {
            return interaction.editReply({
                embeds: [embeds.error('Moderation Check Failed', 'I could not safely re-check this member. Try again.')]
            });
        }

        if (!targetMember && action !== 'ban') {
            return interaction.editReply({
                embeds: [embeds.error('User Not Found', 'This user is no longer in the server.')]
            });
        }

        // Validate hierarchy using centralized utility. Member protection still
        // applies if a user leaves between opening the menu and submitting it.
        const validation = targetMember
            ? validateHierarchy(executor, targetMember)
            : validateProtectedTarget(guild.id, userId);
        if (!validation.valid) {
            return interaction.editReply({
                embeds: [embeds.error('Cannot Moderate', validation.error)]
            });
        }

        try {
            const permission = {
                warn: PermissionFlagsBits.ModerateMembers,
                kick: PermissionFlagsBits.KickMembers,
                ban: PermissionFlagsBits.BanMembers
            }[action];
            if (!executor.permissions.has(permission)) {
                return interaction.editReply({ embeds: [embeds.error('Insufficient Permissions', 'Your Discord permissions no longer allow this action.')] });
            }

            switch (action) {
                case 'warn':
                {
                    const moderationCase = await executeMemberAction({
                        guild,
                        target: targetMember,
                        executor,
                        action: 'WARN',
                        reason
                    });

                    return interaction.editReply({
                        embeds: [moderationCase.punishmentError
                            ? embeds.warn('User Warned; Punishment Failed', `${target.tag} was warned, but automatic punishment failed: ${moderationCase.punishmentError}`)
                            : embeds.success('User Warned', `${target.tag} has been warned.\n\n**Reason:** ${reason}`)]
                    });
                }

                case 'kick':
                    await executeMemberAction({
                        guild,
                        target: targetMember,
                        executor,
                        action: 'KICK',
                        reason
                    });

                    return interaction.editReply({
                        embeds: [embeds.success('User Kicked', `${target.tag} has been kicked from the server.\n\n**Reason:** ${reason}`)]
                    });

                case 'ban':
                    if (targetMember) {
                        await executeMemberAction({ guild, target: targetMember, executor, action: 'BAN', reason });
                    } else {
                        await executeUserAction({ guild, targetId: userId, targetUser: target, executor, action: 'BAN', reason });
                    }

                    return interaction.editReply({
                        embeds: [embeds.success('User Banned', `${target.tag} has been banned from the server.\n\n**Reason:** ${reason}`)]
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
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const logs = sqlite.prepare(`
        SELECT * FROM moderation_cases WHERE guild_id = ? AND target_id = ?
        ORDER BY case_number DESC LIMIT 10
    `).all(interaction.guild.id, userId);

    if (logs.length === 0) {
        return interaction.editReply({
            embeds: [embeds.info('No History', 'This user has no moderation history.')]
        });
    }

    const historyEmbed = embeds.info(
        'Moderation History',
        `Showing last ${logs.length} action(s) for <@${userId}>`
    );

    for (const log of logs) {
        const timestamp = Math.floor(log.created_at / 1000);
        const actionEmoji = {
            'WARN': '⚠️',
            'KICK': '👢',
            'BAN': '🔨',
            'CLEAR': '🗑️'
        };

        historyEmbed.addFields({
            name: `${actionEmoji[log.action] || '•'} #${log.case_number} ${log.action} (${log.status}) - <t:${timestamp}:R>`,
            value: `**By:** <@${log.executor_id}>\n**Reason:** ${log.reason || '*No reason provided*'}`,
            inline: false
        });
    }

    return interaction.editReply({
        embeds: [historyEmbed]
    });
}
