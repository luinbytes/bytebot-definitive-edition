const { ContextMenuCommandBuilder, ApplicationCommandType, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('View Avatar')
        .setType(ApplicationCommandType.User)
        .setDMPermission(true), // Works in DMs

    cooldown: 2,

    async execute(interaction, client) {
        const user = interaction.targetUser;
        const member = interaction.targetMember; // null if in DMs

        // Get avatar URLs
        const userAvatar = user.displayAvatarURL({ size: 4096, extension: 'png' });
        const userAvatarWebP = user.displayAvatarURL({ size: 4096, extension: 'webp' });

        // Check for animated avatar (GIF)
        const userAvatarGIF = user.avatarURL({ size: 4096, extension: 'gif' });
        const isAnimated = userAvatarGIF && userAvatarGIF.includes('.gif');

        // Get guild avatar if different
        const guildAvatar = member?.avatarURL({ size: 4096, extension: 'png' });
        const guildAvatarWebP = member?.avatarURL({ size: 4096, extension: 'webp' });
        const hasGuildAvatar = guildAvatar && guildAvatar !== userAvatar;

        // Build embed
        const embed = embeds.brand(
            `${user.tag}'s Avatar`,
            hasGuildAvatar
                ? '**Server Avatar** (below) • [User Avatar](' + userAvatar + ')'
                : null
        );

        // Show guild avatar if different, else user avatar
        embed.setImage(hasGuildAvatar ? guildAvatar : userAvatar);

        // Build download links
        const links = [];

        if (hasGuildAvatar) {
            links.push(`[Server PNG](${guildAvatar})`);
            links.push(`[Server WebP](${guildAvatarWebP})`);
            links.push(''); // Separator
        }

        links.push(`[User PNG](${userAvatar})`);
        links.push(`[User WebP](${userAvatarWebP})`);

        if (isAnimated) {
            links.push(`[User GIF](${userAvatarGIF})`);
        }

        embed.addFields({
            name: 'Download Links',
            value: links.filter(l => l).join(' • ')
        });

        // Add notice if showing default avatar
        if (user.displayAvatarURL().includes('embed/avatars')) {
            embed.setFooter({ text: 'This user is using a default Discord avatar' });
        }

        return interaction.reply({
            embeds: [embed],
            flags: [MessageFlags.Ephemeral]
        });
    }
};
