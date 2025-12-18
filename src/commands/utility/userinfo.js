const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('userinfo')
        .setDescription('Displays information about a user.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user to get info about')),

    async execute(interaction) {
        const user = interaction.options.getUser('target') ?? interaction.user;
        const member = await interaction.guild.members.fetch(user.id);

        const embed = embeds.brand(`${user.username}'s Info`, '')
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'ID', value: user.id, inline: true },
                { name: 'Tag', value: user.tag, inline: true },
                { name: 'Bot', value: user.bot ? 'Yes' : 'No', inline: true },
                { name: 'Joined Discord', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
                { name: 'Joined Server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
                { name: 'Roles', value: member.roles.cache.size > 1 ? member.roles.cache.filter(role => role.name !== '@everyone').map(role => role).join(', ') : 'No roles', inline: false }
            );

        await interaction.reply({ embeds: [embed] });
    },
};
