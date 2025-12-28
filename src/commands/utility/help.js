const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
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
        .setDescription('Browse all commands or get info about a specific command')
        .addStringOption(option =>
            option.setName('command')
                .setDescription('The command to get more info about')
                .setRequired(false)),

    cooldown: 5,

    async execute(interaction, client) {
        const commandName = interaction.options.getString('command');

        // If specific command requested, show command details
        if (commandName) {
            return await showCommandDetails(interaction, client, commandName);
        }

        // Show overview page (page 0) with navigation
        await showHelpPage(interaction, client, 0);
    },

    // Handle button interactions for pagination
    async handleInteraction(interaction, client) {
        if (interaction.isButton() && interaction.customId.startsWith('help_page_')) {
            // Parse customId: help_page_{pageNumber}
            const pageNumber = parseInt(interaction.customId.split('_')[2]);

            await interaction.deferUpdate();
            await showHelpPage(interaction, client, pageNumber);
        }
    }
};

/**
 * Show specific command details
 */
async function showCommandDetails(interaction, client, commandName) {
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
        const optionsList = command.data.options.map(opt => {
            const required = opt.required ? '(required)' : '(optional)';
            return `\`${opt.name}\` ${required} - ${opt.description}`;
        }).join('\n');
        embed.addFields({ name: 'Options', value: optionsList });
    }

    return interaction.reply({
        embeds: [embed],
        flags: [MessageFlags.Ephemeral]
    });
}

/**
 * Show help page (overview or category)
 */
async function showHelpPage(interaction, client, pageNumber) {
    const commands = client.commands;

    // Group commands by category
    const categories = {};
    commands.forEach(command => {
        const category = command.category || 'Other';
        if (!categories[category]) categories[category] = [];
        categories[category].push(command);
    });

    // Sort categories in a specific order
    const categoryOrder = ['Administration', 'Moderation', 'Utility', 'Fun', 'Games', 'Developer'];
    const sortedCategories = Object.keys(categories).sort((a, b) => {
        return categoryOrder.indexOf(a) - categoryOrder.indexOf(b);
    });

    const totalPages = sortedCategories.length + 1; // +1 for overview page

    let embed;

    if (pageNumber === 0) {
        // Overview page
        embed = buildOverviewEmbed(client, commands, sortedCategories, categories);
    } else {
        // Category page
        const categoryIndex = pageNumber - 1;
        const categoryName = sortedCategories[categoryIndex];
        const categoryCommands = categories[categoryName];
        embed = buildCategoryEmbed(categoryName, categoryCommands);
    }

    // Add navigation buttons
    const buttons = new ActionRowBuilder();

    buttons.addComponents(
        new ButtonBuilder()
            .setCustomId(`help_page_${pageNumber - 1}`)
            .setLabel('◀ Previous')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(pageNumber === 0)
    );

    buttons.addComponents(
        new ButtonBuilder()
            .setCustomId('help_page_indicator')
            .setLabel(`${pageNumber + 1}/${totalPages}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
    );

    buttons.addComponents(
        new ButtonBuilder()
            .setCustomId(`help_page_${pageNumber + 1}`)
            .setLabel('Next ▶')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(pageNumber === totalPages - 1)
    );

    // Update or reply
    if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
            embeds: [embed],
            components: [buttons]
        });
    } else {
        await interaction.reply({
            embeds: [embed],
            components: [buttons]
        });
    }
}

/**
 * Build overview embed (page 0)
 */
function buildOverviewEmbed(client, commands, sortedCategories, categories) {
    const totalCommands = commands.size;

    const embed = embeds.brand('ByteBot Help', 'Your feature-rich Discord companion with neon purple style!')
        .setThumbnail(client.user.displayAvatarURL())
        .setDescription(
            '**Welcome to ByteBot!**\n\n' +
            'A feature-rich Discord bot with moderation, utilities, and unique community engagement systems.\n\n' +
            `📊 **${totalCommands}** commands • **${sortedCategories.length}** categories`
        )
        .addFields(
            {
                name: '🎯 Key Features',
                value:
                    '**🎤 BytePods** - Ephemeral voice channels\n' +
                    'Create temporary VCs with lock, whitelist, and templates.\n\n' +
                    '**🏆 Achievement System** - Track engagement\n' +
                    '87+ achievements with auto-tracking and role rewards.\n\n' +
                    '**📸 Media Gallery** - Archive server media\n' +
                    'Auto-capture with persistent archival (500 items/user).\n\n' +
                    '**🔥 Activity Streaks** - Daily tracking\n' +
                    'Build streaks with freeze protection and leaderboards.\n\n' +
                    '**💡 Suggestions** - Community feedback\n' +
                    'Submit ideas with voting and review workflow.\n\n' +
                    '**🎂 Birthdays** - Automated celebrations\n' +
                    'Privacy-focused with daily announcements.',
                inline: false
            },
            {
                name: '🔧 Also Includes',
                value:
                    '• **Moderation** - Ban, kick, warn, audit logs\n' +
                    '• **Auto-Responders** - Keyword responses\n' +
                    '• **Bookmarks** - Save messages with search\n' +
                    '• **Welcome Messages** - Custom greetings\n' +
                    '• **Permission System** - Role-based access\n' +
                    '• **War Thunder Stats** - Player statistics',
                inline: false
            }
        );

    // Add category overview
    if (sortedCategories.length > 0) {
        const categoryList = sortedCategories.map(categoryName => {
            const meta = categoryMetadata[categoryName] || { icon: '📁', description: '' };
            const count = categories[categoryName]?.length || 0;
            return `${meta.icon} **${categoryName}** - ${count} command${count !== 1 ? 's' : ''}`;
        }).join('\n');

        embed.addFields({
            name: '📂 Browse Commands by Category',
            value: categoryList + '\n\n💡 Use the **Next** button below to browse each category',
            inline: false
        });
    }

    embed.setFooter({ text: 'Type /help [command] for detailed command info' });

    return embed;
}

/**
 * Build category embed
 */
function buildCategoryEmbed(categoryName, categoryCommands) {
    const meta = categoryMetadata[categoryName] || { icon: '📁', description: 'Commands in this category.' };

    const embed = embeds.brand(
        `${meta.icon} ${categoryName}`,
        meta.description
    );

    // Add each command with its description
    const commandList = categoryCommands
        .map(cmd => {
            // Get command description
            let desc = cmd.data.description || 'No description available.';

            // Truncate if too long
            if (desc.length > 100) {
                desc = desc.substring(0, 97) + '...';
            }

            // Check for subcommands
            const hasSubcommands = cmd.data.options && cmd.data.options.length > 0 &&
                                   cmd.data.options[0].type === 1; // Type 1 = Subcommand

            if (hasSubcommands) {
                const subcommands = cmd.data.options
                    .filter(opt => opt.type === 1)
                    .map(sub => sub.name)
                    .join(', ');
                return `**/${cmd.data.name}** \`${subcommands}\`\n${desc}`;
            }

            return `**/${cmd.data.name}**\n${desc}`;
        })
        .join('\n\n');

    embed.setDescription(commandList || 'No commands in this category.');

    embed.setFooter({
        text: `${categoryCommands.length} command${categoryCommands.length !== 1 ? 's' : ''} • Type /help [command] for detailed info`
    });

    return embed;
}
