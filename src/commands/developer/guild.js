const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, StringSelectMenuBuilder, ComponentType } = require('discord.js');
const embeds = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('guild')
        .setDescription('View and manage guilds the bot is in')
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all guilds the bot is in'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('manage')
                .setDescription('Manage guilds (leave guilds via select menu)'))
        .setDMPermission(true),

    devOnly: true,

    async execute(interaction, client) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'list') {
            return handleGuildList(interaction, client);
        } else if (subcommand === 'manage') {
            return handleGuildManage(interaction, client);
        }
    },
};

/**
 * Handle /guild list subcommand
 */
async function handleGuildList(interaction, client) {
    const guilds = client.guilds.cache.sort((a, b) => b.memberCount - a.memberCount);

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
}

/**
 * Handle /guild manage subcommand
 */
async function handleGuildManage(interaction, client) {
    const guilds = client.guilds.cache.sort((a, b) => b.memberCount - a.memberCount);

    if (guilds.size === 0) {
        return await interaction.reply({
            embeds: [embeds.warn('No Guilds', 'The bot is not in any guilds yet.')],
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Build the guild list description
    let description = `Total Guilds: **${guilds.size}**\n\n`;
    const guildList = guilds.map(guild => `**${guild.name}** \`(${guild.id})\` - ${guild.memberCount} members`).join('\n');
    description += guildList;

    // Discord embed description limit is 4096 characters
    if (description.length > 4096) {
        description = description.slice(0, 4092) + '...';
    }

    // Build select menu options - Discord limits to 25 options
    const guildOptions = guilds.first(25).map(guild => ({
        label: guild.name.slice(0, 100), // Label limit is 100 chars
        description: `${guild.memberCount} members`,
        value: guild.id
    }));

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('manageguilds_leave_select')
        .setPlaceholder('Select guilds to leave...')
        .setMinValues(1)
        .setMaxValues(guildOptions.length)
        .addOptions(guildOptions);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const embed = embeds.brand('Guild Management', description + '\n\n⚠️ **Select guilds below to remove the bot from them.**');

    const response = await interaction.reply({
        embeds: [embed],
        components: [row],
        flags: [MessageFlags.Ephemeral]
    });

    // Create a collector for the select menu
    const collector = response.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        time: 60_000 // 60 seconds timeout
    });

    collector.on('collect', async (selectInteraction) => {
        const selectedGuildIds = selectInteraction.values;
        const leftGuilds = [];
        const failedGuilds = [];
        const totalGuilds = selectedGuildIds.length;

        await selectInteraction.deferUpdate();

        // Show initial progress
        const progressEmbed = embeds.info('Leaving Guilds...', `Processing 0/${totalGuilds} guilds...\n\n⏳ Please wait...`);
        await selectInteraction.editReply({
            embeds: [progressEmbed],
            components: []
        });

        for (let i = 0; i < selectedGuildIds.length; i++) {
            const guildId = selectedGuildIds[i];
            const guild = client.guilds.cache.get(guildId);
            const currentProgress = i + 1;

            // Update progress indicator
            const progressBar = '█'.repeat(Math.floor((currentProgress / totalGuilds) * 10)) + '░'.repeat(10 - Math.floor((currentProgress / totalGuilds) * 10));
            const progressText = `[${progressBar}] ${currentProgress}/${totalGuilds}`;

            const currentGuildName = guild ? guild.name : guildId;
            const updateEmbed = embeds.info('Leaving Guilds...', `${progressText}\n\n⏳ Leaving **${currentGuildName}**...`);
            await selectInteraction.editReply({ embeds: [updateEmbed] }).catch(() => { });

            if (guild) {
                try {
                    const guildName = guild.name;
                    await guild.leave();
                    leftGuilds.push(guildName);
                } catch (error) {
                    failedGuilds.push({ name: guild.name, error: error.message });
                }
            } else {
                failedGuilds.push({ name: guildId, error: 'Guild not found in cache' });
            }
        }

        // Build result message
        let resultDescription = `**Completed!** Processed ${totalGuilds} guild(s).\n\n`;

        if (leftGuilds.length > 0) {
            resultDescription += `✅ **Successfully left ${leftGuilds.length} guild(s):**\n`;
            resultDescription += leftGuilds.map(name => `• ${name}`).join('\n');
            resultDescription += '\n\n';
        }

        if (failedGuilds.length > 0) {
            resultDescription += `❌ **Failed to leave ${failedGuilds.length} guild(s):**\n`;
            resultDescription += failedGuilds.map(g => `• ${g.name}: ${g.error}`).join('\n');
        }

        const resultEmbed = leftGuilds.length > 0 && failedGuilds.length === 0
            ? embeds.success('Guild Removal Complete', resultDescription)
            : failedGuilds.length > 0 && leftGuilds.length === 0
                ? embeds.error('Guild Removal Failed', resultDescription)
                : embeds.warn('Partial Success', resultDescription);

        await selectInteraction.editReply({
            embeds: [resultEmbed],
            components: []
        });

        collector.stop();
    });

    collector.on('end', async (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            const timeoutEmbed = embeds.warn('Timed Out', 'No selection was made within 60 seconds.');
            await interaction.editReply({
                embeds: [timeoutEmbed],
                components: []
            }).catch(() => { }); // Ignore errors if message was deleted
        }
    });
}
