const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unlock')
        .setDescription('Unlocks the current channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        try {
            await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
                SendMessages: null
            });

            await interaction.reply({
                embeds: [embeds.success('Channel Unlocked', 'The @everyone role can now send messages in this channel again.')]
            });
        } catch (error) {
            console.error(error);
            await interaction.reply({
                embeds: [embeds.error('Error', 'An error occurred while trying to unlock the channel.')],
                flags: [MessageFlags.Ephemeral]
            });
        }
    },
};
