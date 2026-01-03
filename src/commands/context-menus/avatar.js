const { ContextMenuCommandBuilder, ApplicationCommandType, MessageFlags } = require('discord.js');
const { buildAvatarEmbed } = require('../../utils/avatarUtil');

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('View Avatar')
        .setType(ApplicationCommandType.User)
        .setDMPermission(true), // Works in DMs

    cooldown: 2,

    async execute(interaction, client) {
        const user = interaction.targetUser;
        const member = interaction.targetMember; // null if in DMs

        // Build avatar embed using shared utility
        const embed = buildAvatarEmbed(user, member);

        return interaction.reply({
            embeds: [embed],
            flags: [MessageFlags.Ephemeral]
        });
    }
};
