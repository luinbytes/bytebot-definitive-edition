const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const logger = require('../../utils/logger');
const { db } = require('../../database/index');
const { moderationLogs } = require('../../database/schema');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Bans a member from the server.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The member to ban')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('The reason for banning'))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    async execute(interaction) {
        const target = interaction.options.getMember('target');
        const reason = interaction.options.getString('reason') ?? 'No reason provided';

        if (!target) {
            return interaction.reply({
                embeds: [embeds.error('Error', 'Target member not found.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        if (!target.bannable) {
            return interaction.reply({
                embeds: [embeds.error('Error', 'I cannot ban this user. They might have a higher role than me.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        try {
            await target.ban({ reason });

            // Log to database
            await db.insert(moderationLogs).values({
                guildId: interaction.guild.id,
                targetId: target.id,
                executorId: interaction.user.id,
                action: 'BAN',
                reason: reason,
                timestamp: new Date()
            });

            await interaction.reply({
                embeds: [embeds.success('Member Banned', `**${target.user.tag}** has been banned.\n**Reason:** ${reason}`)]
            });
        } catch (error) {
            logger.error(error);
            await interaction.reply({
                embeds: [embeds.error('Error', 'An error occurred while trying to ban this member.')],
                flags: [MessageFlags.Ephemeral]
            });
        }
    },
};
