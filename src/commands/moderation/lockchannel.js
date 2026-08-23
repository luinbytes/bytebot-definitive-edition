const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const { handleCommandError } = require('../../utils/errorHandlerUtil');
const { PermissionOverwriteManager } = require('../../utils/discordApiUtil');
const { executeRecordedAction } = require('../../services/moderationService');

module.exports = {
    register: false,
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
    longRunning: true,

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        try {
            await executeRecordedAction({
                guildId: interaction.guild.id,
                targetId: interaction.channel.id,
                executorId: interaction.user.id,
                action: subcommand === 'lock' ? 'CHANNEL_LOCK' : 'CHANNEL_UNLOCK',
                reason: `Channel ${subcommand}ed by ${interaction.user.tag}`,
                perform: async () => {
                    const result = await PermissionOverwriteManager[subcommand === 'lock' ? 'lockChannel' : 'unlockChannel'](
                        interaction.channel,
                        interaction.guild.id,
                        { reason: `Channel ${subcommand}ed by ${interaction.user.tag}`, logContext: `lockchannel-${subcommand}` }
                    );
                    if (!result.success) throw new Error(result.error);
                }
            });
            if (subcommand === 'lock') {
                await interaction.editReply({
                    embeds: [embeds.success('Channel Locked', 'The @everyone role can no longer send messages in this channel.')]
                });
            } else {
                await interaction.editReply({
                    embeds: [embeds.success('Channel Unlocked', 'The @everyone role can now send messages in this channel again.')]
                });
            }
        } catch (error) {
            await handleCommandError(error, interaction, `${subcommand}ing the channel`, { ephemeral: false });
        }
    },
};
