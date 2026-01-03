const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lockchannel')
        .setDescription('Lock or unlock the current channel')
        .addSubcommand(subcommand =>
            subcommand
                .setName('lock')
                .setDescription('Lock the current channel (prevents @everyone from sending messages)'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('unlock')
                .setDescription('Unlock the current channel (allows @everyone to send messages)'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    permissions: [PermissionFlagsBits.ManageChannels],

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        try {
            if (subcommand === 'lock') {
                await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
                    SendMessages: false
                });

                await interaction.reply({
                    embeds: [embeds.success('Channel Locked', 'The @everyone role can no longer send messages in this channel.')]
                });
            } else if (subcommand === 'unlock') {
                await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
                    SendMessages: null
                });

                await interaction.reply({
                    embeds: [embeds.success('Channel Unlocked', 'The @everyone role can now send messages in this channel again.')]
                });
            }
        } catch (error) {
            logger.error(error);
            await interaction.reply({
                embeds: [embeds.error('Error', `An error occurred while trying to ${subcommand} the channel.`)],
                flags: [MessageFlags.Ephemeral]
            });
        }
    },
};
