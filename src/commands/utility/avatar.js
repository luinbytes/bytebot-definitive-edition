const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { buildAvatarEmbed } = require('../../utils/avatarUtil');
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

        // Build avatar embed using shared utility
        const embed = buildAvatarEmbed(user, member);

        return interaction.reply({
            embeds: [embed],
            flags: isEphemeral ? [MessageFlags.Ephemeral] : []
        });
    }
};
