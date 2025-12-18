const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('serverinfo')
        .setDescription('Displays information about the server.'),

    async execute(interaction) {
        const { guild } = interaction;
        const { members, channels, roles, emojis } = guild;

        const embed = embeds.brand(`${guild.name} Info`, '')
            .setThumbnail(guild.iconURL({ dynamic: true }))
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

        if (guild.description) {
            embed.setDescription(guild.description);
        }

        await interaction.reply({ embeds: [embed] });
    },
};
