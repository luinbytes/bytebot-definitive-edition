const { ContextMenuCommandBuilder, ApplicationCommandType, MessageFlags } = require('discord.js');

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Copy User ID')
        .setType(ApplicationCommandType.User)
        .setDMPermission(true), // Works in DMs

    cooldown: 1,

    async execute(interaction, client) {
        const user = interaction.targetUser;

        return interaction.reply({
            content: `**User ID for ${user.tag}:**\n\`\`\`\n${user.id}\n\`\`\`\nClick to select and copy!`,
            flags: [MessageFlags.Ephemeral]
        });
    }
};
