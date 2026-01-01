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

        await interaction.deferReply(); // Public for transparency

        try {
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

            await interaction.editReply({
                embeds: [embeds.success('Messages Cleared', `Successfully deleted **${deleted.size}** messages.`)]
            });
        } catch (error) {
            logger.error(error);
            await interaction.editReply({
                embeds: [embeds.error('Error', 'An error occurred while trying to clear messages. Note: Messages older than 14 days cannot be bulk deleted.')]
            });
        }
    },
};
