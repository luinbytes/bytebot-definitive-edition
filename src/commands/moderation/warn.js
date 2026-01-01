const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const logger = require('../../utils/logger');
const { db } = require('../../database/index');
const { moderationLogs } = require('../../database/schema');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warns a member.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The member to warn')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('The reason for warning')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    permissions: [PermissionFlagsBits.ModerateMembers],

    async execute(interaction) {
        const target = interaction.options.getUser('target');
        const reason = interaction.options.getString('reason');

        try {
            // Log to database
            await db.insert(moderationLogs).values({
                guildId: interaction.guild.id,
                targetId: target.id,
                executorId: interaction.user.id,
                action: 'WARN',
                reason: reason,
                timestamp: new Date()
            });

            // Try to DM the user
            try {
                await target.send({
                    embeds: [embeds.warn('Warning received', `You have been warned in **${interaction.guild.name}**.\n**Reason:** ${reason}`)]
                });
            } catch (dmError) {
                // Ignore DM errors if user has DMs off
            }

            await interaction.reply({
                embeds: [embeds.success('Member Warned', `**${target.tag}** has been warned.\n**Reason:** ${reason}`)]
            });
        } catch (error) {
            logger.error(error);
            await interaction.reply({
                embeds: [embeds.error('Error', 'An error occurred while trying to warn this member.')],
                flags: [MessageFlags.Ephemeral]
            });
        }
    },
};
