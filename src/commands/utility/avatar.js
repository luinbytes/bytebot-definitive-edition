const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const { shouldBeEphemeral } = require('../../utils/ephemeralHelper');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('avatar')
        .setDescription('View a user\'s avatar')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to view (defaults to yourself)')
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option
                .setName('private')
                .setDescription('Show response only to you (overrides your privacy preference)')
                .setRequired(false)
        )
        .setDMPermission(true),

    cooldown: 2,

    async execute(interaction, client) {
        // Get target user (self if not specified)
        const user = interaction.options.getUser('user') || interaction.user;
        const member = interaction.guild ? await interaction.guild.members.fetch(user.id).catch(() => null) : null;

        // Determine ephemeral based on user preference + command override
        const isEphemeral = await shouldBeEphemeral(interaction, {
            commandDefault: true, // Avatar viewing is personal by default
            userOverride: interaction.options.getBoolean('private'),
            targetUserId: user.id
        });

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
            flags: isEphemeral ? [MessageFlags.Ephemeral] : []
        });
    }
};
