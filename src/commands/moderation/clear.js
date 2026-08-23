const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const { handleCommandError } = require('../../utils/errorHandlerUtil');
const { executeRecordedAction } = require('../../services/moderationService');

module.exports = {
    register: false,
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
    longRunning: true,

    async execute(interaction) {
        const amount = interaction.options.getInteger('amount');

        try {
            const deleted = await executeRecordedAction({
                guildId: interaction.guild.id,
                targetId: interaction.channel.id,
                executorId: interaction.user.id,
                action: 'CLEAR',
                reason: `Delete up to ${amount} messages`,
                perform: async () => interaction.channel.bulkDelete(amount, true)
            });

            // Reply AFTER deletion to avoid our reply being caught in bulkDelete
            await interaction.editReply({
                embeds: [embeds.success('Messages Cleared', `Successfully deleted **${deleted.size}** messages.`)]
            });
        } catch (error) {
            await handleCommandError(error, interaction, 'clearing messages');
        }
    },
};
