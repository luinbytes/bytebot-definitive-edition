const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const { handleCommandError } = require('../../utils/errorHandlerUtil');
const { PermissionOverwriteManager } = require('../../utils/discordApiUtil');

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
                const result = await PermissionOverwriteManager.lockChannel(
                    interaction.channel,
                    interaction.guild.id,
                    { reason: `Channel locked by ${interaction.user.tag}`, logContext: 'lockchannel-lock' }
                );

                if (!result.success) {
                    return await handleCommandError(new Error(result.error), interaction, 'locking the channel', { ephemeral: false });
                }

                await interaction.reply({
                    embeds: [embeds.success('Channel Locked', 'The @everyone role can no longer send messages in this channel.')]
                });
            } else if (subcommand === 'unlock') {
                const result = await PermissionOverwriteManager.unlockChannel(
                    interaction.channel,
                    interaction.guild.id,
                    { reason: `Channel unlocked by ${interaction.user.tag}`, logContext: 'lockchannel-unlock' }
                );

                if (!result.success) {
                    return await handleCommandError(new Error(result.error), interaction, 'unlocking the channel', { ephemeral: false });
                }

                await interaction.reply({
                    embeds: [embeds.success('Channel Unlocked', 'The @everyone role can now send messages in this channel again.')]
                });
            }
        } catch (error) {
            await handleCommandError(error, interaction, `${subcommand}ing the channel`, { ephemeral: false });
        }
    },
};
