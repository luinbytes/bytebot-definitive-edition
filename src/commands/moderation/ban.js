const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const { handleCommandError } = require('../../utils/errorHandlerUtil');
const { executeModerationAction } = require('../../utils/moderationUtil');

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

    permissions: [PermissionFlagsBits.BanMembers],

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
            // Execute moderation action (log to DB + send DM notification)
            await executeModerationAction({
                guildId: interaction.guild.id,
                guildName: interaction.guild.name,
                target: target.user,
                executor: interaction.member,
                action: 'BAN',
                reason
            });

            // Perform the ban
            await target.ban({ reason });

            await interaction.reply({
                embeds: [embeds.success('Member Banned', `**${target.user.tag}** has been banned.\n**Reason:** ${reason}`)]
            });
        } catch (error) {
            await handleCommandError(error, interaction, 'banning member');
        }
    },
};
