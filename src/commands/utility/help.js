const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');

const categoryMetadata = {
    'Administration': { icon: '⚙️', description: 'Configure bot settings for your server.' },
    'Moderation': { icon: '🛡️', description: 'Commands to manage and protect your server.' },
    'Utility': { icon: '🔧', description: 'Useful tools and information commands.' },
    'Fun': { icon: '🎉', description: 'Games and entertainment for everyone.' },
    'Games': { icon: '🎮', description: 'Game-specific statistics and tools.' },
    'Developer': { icon: '💻', description: 'Specialized tools for bot developers.' },
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('List all commands or get info about a specific command')
        .addStringOption(option =>
            option.setName('command')
                .setDescription('The command to get more info about')
                .setRequired(false)),

    cooldown: 5,

    async execute(interaction, client) {
        const commandName = interaction.options.getString('command');

        if (commandName) {
            const command = client.commands.get(commandName.toLowerCase());

            if (!command) {
                return interaction.reply({
                    embeds: [embeds.error('Command Not Found', `The command \`/${commandName}\` does not exist.`)],
                    flags: [MessageFlags.Ephemeral]
                });
            }

            const embed = embeds.brand(`Command: /${command.data.name}`, command.data.description)
                .addFields(
                    { name: 'Category', value: `${categoryMetadata[command.category]?.icon || '📁'} ${command.category}`, inline: true },
                    { name: 'Cooldown', value: `${command.cooldown || 3} seconds`, inline: true }
                );

            if (command.data.options && command.data.options.length > 0) {
                const optionsList = command.data.options.map(opt => `\`${opt.name}\` - ${opt.description}`).join('\n');
                embed.addFields({ name: 'Options', value: optionsList });
            }

            return interaction.reply({
                embeds: [embed],
                flags: [MessageFlags.Ephemeral]
            });
        }

        // General Help
        const commands = client.commands;
        const embed = embeds.brand('ByteBot Help', 'Browse through all available commands by category.')
            .setThumbnail(client.user.displayAvatarURL());

        const categories = {};

        commands.forEach(command => {
            const category = command.category || 'Other';
            if (!categories[category]) categories[category] = [];
            categories[category].push(`\`/${command.data.name}\``);
        });

        // Ensure categories are added in a specific order if defined in metadata
        const sortedCategories = Object.keys(categories).sort((a, b) => {
            const order = ['Administration', 'Moderation', 'Utility', 'Fun', 'Games', 'Developer'];
            return order.indexOf(a) - order.indexOf(b);
        });

        for (const category of sortedCategories) {
            const cmds = categories[category];
            const meta = categoryMetadata[category] || { icon: '📁', description: '' };
            embed.addFields({
                name: `${meta.icon} ${category}`,
                value: cmds.join(' ') || 'No commands in this category.',
                inline: false
            });
        }

        embed.setFooter({ text: `ByteBot • Type /help [command] for details` });

        await interaction.reply({ embeds: [embed] });
    },
};
