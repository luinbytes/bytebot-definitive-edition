const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const { handleCommandError } = require('../../utils/errorHandlerUtil');
const { executeModerationAction } = require('../../utils/moderationUtil');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kicks a member from the server.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The member to kick')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('The reason for kicking'))
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

    permissions: [PermissionFlagsBits.KickMembers],

    async execute(interaction) {
        const target = interaction.options.getMember('target');
        const reason = interaction.options.getString('reason') ?? 'No reason provided';

        if (!target) {
            return interaction.reply({
                embeds: [embeds.error('Error', 'Target member not found.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        if (!target.kickable) {
            return interaction.reply({
                embeds: [embeds.error('Error', 'I cannot kick this user. They might have a higher role than me.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        try {
            // Execute moderation action (log to DB + send DM notification)
            await executeModerationAction({
                guildId: interaction.guild.id,
                guildName: interaction.guild.name,
                target: target.user,
                executor: interaction.member,
                action: 'KICK',
                reason
            });

            // Perform the kick
            await target.kick(reason);

            await interaction.reply({
                embeds: [embeds.success('Member Kicked', `**${target.user.tag}** has been kicked.\n**Reason:** ${reason}`)]
            });
        } catch (error) {
            await handleCommandError(error, interaction, 'kicking member');
        }
    },
};
