const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lock')
        .setDescription('Locks the current channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    permissions: [PermissionFlagsBits.ManageChannels],

    async execute(interaction) {
        try {
            await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
                SendMessages: false
            });

            await interaction.reply({
                embeds: [embeds.success('Channel Locked', 'The @everyone role can no longer send messages in this channel.')]
            });
        } catch (error) {
            logger.error(error);
            await interaction.reply({
                embeds: [embeds.error('Error', 'An error occurred while trying to lock the channel.')],
                flags: [MessageFlags.Ephemeral]
            });
        }
    },
};
