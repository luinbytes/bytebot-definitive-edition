const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const logger = require('../../utils/logger');
const { db } = require('../../database/index');
const { moderationLogs } = require('../../database/schema');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Deletes a specified amount of messages.')
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Number of messages to delete (1-100)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    permissions: [PermissionFlagsBits.ManageMessages],

    async execute(interaction) {
        const amount = interaction.options.getInteger('amount');

        try {
            // Delete messages first (before replying to avoid deleting our own reply)
            const deleted = await interaction.channel.bulkDelete(amount, true);

            // Log to database
            await db.insert(moderationLogs).values({
                guildId: interaction.guild.id,
                targetId: interaction.channel.id, // Using channel ID as target for CLEAR
                executorId: interaction.user.id,
                action: 'CLEAR',
                reason: `Deleted ${deleted.size} messages`,
                timestamp: new Date()
            });

            // Reply AFTER deletion to avoid our reply being caught in bulkDelete
            await interaction.reply({
                embeds: [embeds.success('Messages Cleared', `Successfully deleted **${deleted.size}** messages.`)]
            });
        } catch (error) {
            logger.error(error);

            // Check if we've already replied (shouldn't happen in this flow)
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({
                    embeds: [embeds.error('Error', 'An error occurred while trying to clear messages. Note: Messages older than 14 days cannot be bulk deleted.')]
                });
            } else {
                await interaction.reply({
                    embeds: [embeds.error('Error', 'An error occurred while trying to clear messages. Note: Messages older than 14 days cannot be bulk deleted.')],
                    flags: [MessageFlags.Ephemeral]
                });
            }
        }
    },
};
