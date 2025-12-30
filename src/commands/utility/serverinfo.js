const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const { shouldBeEphemeral } = require('../../utils/ephemeralHelper');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('serverinfo')
        .setDescription('Displays information about the server.')
        .addBooleanOption(option =>
            option
                .setName('private')
                .setDescription('Make response visible only to you')
                .setRequired(false)),

    async execute(interaction) {
        const { guild } = interaction;
        const { members, channels, roles, emojis } = guild;

        const embed = embeds.brand(`${guild.name} Info`, null)
            .addFields(
                { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
                { name: 'ID', value: guild.id, inline: true },
                { name: 'Created At', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
                { name: 'Members', value: members.cache.size.toString(), inline: true },
                { name: 'Channels', value: channels.cache.size.toString(), inline: true },
                { name: 'Roles', value: roles.cache.size.toString(), inline: true },
                { name: 'Emojis', value: emojis.cache.size.toString(), inline: true },
                { name: 'Boost Level', value: `Level ${guild.premiumTier}`, inline: true },
                { name: 'Verification', value: guild.verificationLevel.toString(), inline: true }
            );

        if (guild.iconURL()) {
            embed.setThumbnail(guild.iconURL({ dynamic: true }));
        }

        if (guild.description) {
            embed.setDescription(guild.description);
        }

        const isEphemeral = await shouldBeEphemeral(interaction, {
            commandDefault: false, // Server info defaults to public
            userOverride: interaction.options.getBoolean('private')
        });

        await interaction.reply({
            embeds: [embed],
            flags: isEphemeral ? [MessageFlags.Ephemeral] : []
        });
    },
};
