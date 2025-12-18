const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('guilds')
        .setDescription('Lists all guilds the bot is in.')
        .setDMPermission(true),
    devOnly: true,
    async execute(interaction, client) {
        const guilds = client.guilds.cache;

        if (guilds.size === 0) {
            return await interaction.reply({
                embeds: [embeds.warn('No Guilds', 'The bot is not in any guilds yet.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        let description = `Total Guilds: **${guilds.size}**\n\n`;

        const guildList = guilds.map(guild => `**${guild.name}** \`(${guild.id})\` - ${guild.memberCount} members`).join('\n');

        description += guildList;

        // Discord embed description limit is 4096 characters
        if (description.length > 4096) {
            description = description.slice(0, 4092) + '...';
        }

        const embed = embeds.brand('Connected Guilds', description);

        await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
    },
};
