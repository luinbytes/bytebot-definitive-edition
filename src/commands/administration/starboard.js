const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { db } = require('../../database');
const { starboardConfig, starboardMessages } = require('../../database/schema');
const { eq, desc } = require('drizzle-orm');
const embeds = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('starboard')
        .setDescription('Configure the starboard system for popular messages')
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Set up the starboard channel')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Channel where starred messages will be posted')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
                .addIntegerOption(option =>
                    option.setName('threshold')
                        .setDescription('Number of stars needed to be featured (default: 5)')
                        .setMinValue(1)
                        .setMaxValue(50)
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option.setName('emoji')
                        .setDescription('Emoji to track for starring (default: ⭐)')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('config')
                .setDescription('View current starboard configuration')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('disable')
                .setDescription('Disable the starboard system')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('enable')
                .setDescription('Enable the starboard system')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('top')
                .setDescription('View the top starred messages')
                .addIntegerOption(option =>
                    option.setName('limit')
                        .setDescription('Number of messages to show (default: 10)')
                        .setMinValue(1)
                        .setMaxValue(25)
                        .setRequired(false)
                )
        ),
    permissions: [PermissionFlagsBits.ManageGuild],
    longRunning: true,

    async execute(interaction, client) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'setup':
                await handleSetup(interaction, client);
                break;
            case 'config':
                await handleConfig(interaction, client);
                break;
            case 'disable':
                await handleDisable(interaction, client);
                break;
            case 'enable':
                await handleEnable(interaction, client);
                break;
            case 'top':
                await handleTop(interaction, client);
                break;
        }
    }
};

/**
 * Handle /starboard setup
 */
async function handleSetup(interaction, client) {
    const channel = interaction.options.getChannel('channel');
    const threshold = interaction.options.getInteger('threshold') || 5;
    const emoji = interaction.options.getString('emoji') || '⭐';

    // Validate emoji (basic check - single emoji or default)
    if (emoji !== '⭐' && emoji.length > 10) {
        return interaction.editReply({
            embeds: [embeds.error('Invalid Emoji', 'Please provide a valid emoji (e.g., ⭐, 🌟, 💫)')]
        });
    }

    // Check if bot has permissions in the channel
    const botMember = await interaction.guild.members.fetch(client.user.id);
    const permissions = channel.permissionsFor(botMember);

    if (!permissions.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
        return interaction.editReply({
            embeds: [embeds.error(
                'Missing Permissions',
                `I need **Send Messages** and **Embed Links** permissions in ${channel}.`
            )]
        });
    }

    try {
        // Check if config exists
        const existingConfig = await db.select()
            .from(starboardConfig)
            .where(eq(starboardConfig.guildId, interaction.guild.id))
            .get();

        if (existingConfig) {
            // Update existing config
            await db.update(starboardConfig)
                .set({
                    channelId: channel.id,
                    threshold: threshold,
                    emoji: emoji,
                    enabled: true
                })
                .where(eq(starboardConfig.guildId, interaction.guild.id));
        } else {
            // Insert new config
            await db.insert(starboardConfig).values({
                guildId: interaction.guild.id,
                channelId: channel.id,
                threshold: threshold,
                emoji: emoji,
                enabled: true
            });
        }

        // Invalidate cache
        if (client.starboardService) {
            client.starboardService.invalidateCache(interaction.guild.id);
        }

        const embed = embeds.success(
            'Starboard Configured',
            `**Channel:** ${channel}\n**Threshold:** ${threshold} ${emoji}\n**Emoji:** ${emoji}\n\nMessages with ${threshold}+ reactions of ${emoji} will be featured in ${channel}.`
        );

        await interaction.editReply({
            embeds: [embed],
            flags: [MessageFlags.Ephemeral]
        });

    } catch (error) {
        logger.error('Error setting up starboard:', error);
        return interaction.editReply({
            embeds: [embeds.error('Setup Failed', 'Failed to configure starboard. Please try again.')]
        });
    }
}

/**
 * Handle /starboard config
 */
async function handleConfig(interaction, client) {
    const config = await db.select()
        .from(starboardConfig)
        .where(eq(starboardConfig.guildId, interaction.guild.id))
        .get();

    if (!config) {
        return interaction.editReply({
            embeds: [embeds.warn(
                'Starboard Not Configured',
                'Use `/starboard setup` to configure the starboard system.'
            )]
        });
    }

    const channel = await interaction.guild.channels.fetch(config.channelId).catch(() => null);
    const statusEmoji = config.enabled ? '✅ Enabled' : '❌ Disabled';
    const channelDisplay = channel ? channel.toString() : `\`${config.channelId}\` (Deleted)`;

    const embed = embeds.brand('Starboard Configuration', null);
    embed.addFields(
        { name: 'Status', value: statusEmoji, inline: true },
        { name: 'Channel', value: channelDisplay, inline: true },
        { name: 'Threshold', value: `${config.threshold} ${config.emoji}`, inline: true },
        { name: 'Emoji', value: config.emoji, inline: true }
    );

    // Get stats
    const stats = await db.select()
        .from(starboardMessages)
        .where(eq(starboardMessages.guildId, interaction.guild.id))
        .all();

    const totalStarred = stats.length;
    const currentlyShown = stats.filter(s => s.starboardMessageId !== null).length;

    embed.addFields(
        { name: 'Total Starred Messages', value: totalStarred.toString(), inline: true },
        { name: 'Currently Shown', value: currentlyShown.toString(), inline: true }
    );

    await interaction.editReply({
        embeds: [embed],
        flags: [MessageFlags.Ephemeral]
    });
}

/**
 * Handle /starboard disable
 */
async function handleDisable(interaction, client) {
    const config = await db.select()
        .from(starboardConfig)
        .where(eq(starboardConfig.guildId, interaction.guild.id))
        .get();

    if (!config) {
        return interaction.editReply({
            embeds: [embeds.warn(
                'Starboard Not Configured',
                'Use `/starboard setup` to configure the starboard system first.'
            )]
        });
    }

    if (!config.enabled) {
        return interaction.editReply({
            embeds: [embeds.warn('Already Disabled', 'The starboard is already disabled.')]
        });
    }

    try {
        await db.update(starboardConfig)
            .set({ enabled: false })
            .where(eq(starboardConfig.guildId, interaction.guild.id));

        // Invalidate cache
        if (client.starboardService) {
            client.starboardService.invalidateCache(interaction.guild.id);
        }

        await interaction.editReply({
            embeds: [embeds.success(
                'Starboard Disabled',
                'The starboard has been disabled. Existing starred messages will remain visible.'
            )],
            flags: [MessageFlags.Ephemeral]
        });

    } catch (error) {
        logger.error('Error disabling starboard:', error);
        return interaction.editReply({
            embeds: [embeds.error('Failed', 'Failed to disable starboard. Please try again.')]
        });
    }
}

/**
 * Handle /starboard enable
 */
async function handleEnable(interaction, client) {
    const config = await db.select()
        .from(starboardConfig)
        .where(eq(starboardConfig.guildId, interaction.guild.id))
        .get();

    if (!config) {
        return interaction.editReply({
            embeds: [embeds.warn(
                'Starboard Not Configured',
                'Use `/starboard setup` to configure the starboard system first.'
            )]
        });
    }

    if (config.enabled) {
        return interaction.editReply({
            embeds: [embeds.warn('Already Enabled', 'The starboard is already enabled.')]
        });
    }

    try {
        await db.update(starboardConfig)
            .set({ enabled: true })
            .where(eq(starboardConfig.guildId, interaction.guild.id));

        // Invalidate cache
        if (client.starboardService) {
            client.starboardService.invalidateCache(interaction.guild.id);
        }

        await interaction.editReply({
            embeds: [embeds.success(
                'Starboard Enabled',
                'The starboard has been enabled. Messages will now be tracked.'
            )],
            flags: [MessageFlags.Ephemeral]
        });

    } catch (error) {
        logger.error('Error enabling starboard:', error);
        return interaction.editReply({
            embeds: [embeds.error('Failed', 'Failed to enable starboard. Please try again.')]
        });
    }
}

/**
 * Handle /starboard top
 */
async function handleTop(interaction, client) {
    const limit = interaction.options.getInteger('limit') || 10;

    const config = await db.select()
        .from(starboardConfig)
        .where(eq(starboardConfig.guildId, interaction.guild.id))
        .get();

    if (!config) {
        return interaction.editReply({
            embeds: [embeds.warn(
                'Starboard Not Configured',
                'Use `/starboard setup` to configure the starboard system.'
            )]
        });
    }

    // Get top starred messages
    const topMessages = await db.select()
        .from(starboardMessages)
        .where(eq(starboardMessages.guildId, interaction.guild.id))
        .orderBy(desc(starboardMessages.starCount))
        .limit(limit)
        .all();

    if (topMessages.length === 0) {
        return interaction.editReply({
            embeds: [embeds.warn(
                'No Starred Messages',
                'No messages have been starred yet.'
            )]
        });
    }

    const embed = embeds.brand(`${config.emoji} Top Starred Messages`, null);

    // Build leaderboard
    const leaderboard = await Promise.all(topMessages.map(async (msg, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `**${index + 1}.**`;
        const author = await client.users.fetch(msg.authorId).catch(() => null);
        const authorDisplay = author ? author.tag : 'Unknown User';
        const channel = await interaction.guild.channels.fetch(msg.originalChannelId).catch(() => null);
        const channelDisplay = channel ? `#${channel.name}` : 'deleted-channel';

        // Create message link
        const messageLink = `https://discord.com/channels/${interaction.guild.id}/${msg.originalChannelId}/${msg.originalMessageId}`;

        return `${medal} **${msg.starCount}** ${config.emoji} • ${authorDisplay} in ${channelDisplay}\n[Jump to message](${messageLink})`;
    }));

    embed.setDescription(leaderboard.join('\n\n'));
    embed.setFooter({ text: `Showing top ${topMessages.length} starred messages` });

    await interaction.editReply({ embeds: [embed] });
}
