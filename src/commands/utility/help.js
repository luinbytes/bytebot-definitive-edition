const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('List all commands or get info about a specific command'),

    cooldown: 5,

    async execute(interaction, client) {
        const commands = client.commands;

        const embed = embeds.brand('ByteBot Help', 'Here is a list of all available commands:')
            .setThumbnail(client.user.displayAvatarURL());

        const categories = {};

        commands.forEach(command => {
            // In a more complex bot, we might have categories based on folder names.
            // For now, let's just list them.
            const category = 'Utility'; // Default to utility for now or try to find it
            if (!categories[category]) categories[category] = [];
            categories[category].push(`\`/${command.data.name}\` - ${command.data.description}`);
        });

        for (const [category, cmds] of Object.entries(categories)) {
            embed.addFields({ name: `🛠️ ${category}`, value: cmds.join('\n') });
        }

        embed.setFooter({ text: `ByteBot v${require('../../../package.json').version} • Type / to see all commands` });

        await interaction.reply({ embeds: [embed] });
    },
};
