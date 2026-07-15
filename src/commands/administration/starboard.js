const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { db } = require('../../database');
const { starboardConfig, starboardMessages } = require('../../database/schema');
const { eq, desc } = require('drizzle-orm');
const embeds = require('../../utils/embeds');
const { dbLog } = require('../../utils/dbLogger');
const { handleCommandError } = require('../../utils/errorHandlerUtil');

// The public Community Hub must not turn a leaderboard request into an
// unbounded database read or one channel fetch per historical starboard row.
const MAX_PUBLIC_STARBOARD_CANDIDATES = 100;

module.exports = {
    register: false,
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
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

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
    },

    getTopStarboardEmbed
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
        const results = await dbLog.select('starboardConfig',
            () => db.select()
                .from(starboardConfig)
                .where(eq(starboardConfig.guildId, interaction.guild.id))
                .limit(1),
            { guildId: interaction.guild.id }
        );
        const existingConfig = results[0];

        if (existingConfig) {
            // Update existing config
            await dbLog.update('starboardConfig',
                () => db.update(starboardConfig)
                    .set({
                        channelId: channel.id,
                        threshold: threshold,
                        emoji: emoji,
                        enabled: true
                    })
                    .where(eq(starboardConfig.guildId, interaction.guild.id)),
                { guildId: interaction.guild.id, channelId: channel.id, threshold }
            );
        } else {
            // Insert new config
            await dbLog.insert('starboardConfig',
                () => db.insert(starboardConfig).values({
                    guildId: interaction.guild.id,
                    channelId: channel.id,
                    threshold: threshold,
                    emoji: emoji,
                    enabled: true
                }),
                { guildId: interaction.guild.id, channelId: channel.id, threshold }
            );
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
        await handleCommandError(error, interaction, 'setting up starboard');
    }
}

/**
 * Handle /starboard config
 */
async function handleConfig(interaction, client) {
    const results = await dbLog.select('starboardConfig',
        () => db.select()
            .from(starboardConfig)
            .where(eq(starboardConfig.guildId, interaction.guild.id))
            .limit(1),
        { guildId: interaction.guild.id }
    );
    const config = results[0];

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
    const stats = await dbLog.select('starboardMessages',
        () => db.select()
            .from(starboardMessages)
            .where(eq(starboardMessages.guildId, interaction.guild.id))
            .all(),
        { guildId: interaction.guild.id }
    );

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
    const results = await dbLog.select('starboardConfig',
        () => db.select()
            .from(starboardConfig)
            .where(eq(starboardConfig.guildId, interaction.guild.id))
            .limit(1),
        { guildId: interaction.guild.id }
    );
    const config = results[0];

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
        await dbLog.update('starboardConfig',
            () => db.update(starboardConfig)
                .set({ enabled: false })
                .where(eq(starboardConfig.guildId, interaction.guild.id)),
            { guildId: interaction.guild.id, enabled: false }
        );

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
        await handleCommandError(error, interaction, 'disabling starboard');
    }
}

/**
 * Handle /starboard enable
 */
async function handleEnable(interaction, client) {
    const results = await dbLog.select('starboardConfig',
        () => db.select()
            .from(starboardConfig)
            .where(eq(starboardConfig.guildId, interaction.guild.id))
            .limit(1),
        { guildId: interaction.guild.id }
    );
    const config = results[0];

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
        await dbLog.update('starboardConfig',
            () => db.update(starboardConfig)
                .set({ enabled: true })
                .where(eq(starboardConfig.guildId, interaction.guild.id)),
            { guildId: interaction.guild.id, enabled: true }
        );

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
        await handleCommandError(error, interaction, 'enabling starboard');
    }
}

/**
 * Handle /starboard top
 */
async function handleTop(interaction, client) {
    const limit = interaction.options.getInteger('limit') || 10;
    const embed = await getTopStarboardEmbed(interaction.guild, client, limit);
    await interaction.editReply({ embeds: [embed] });
}

async function getTopStarboardEmbed(guild, client, limit = 10, requester = null) {
    const results = await dbLog.select('starboardConfig',
        () => db.select()
            .from(starboardConfig)
            .where(eq(starboardConfig.guildId, guild.id))
            .limit(1),
        { guildId: guild.id }
    );
    const config = results[0];

    // The public Community Hub only exposes an actively published starboard.
    // The legacy administrator command deliberately continues to show its
    // historical records while disabled, so admins can inspect them.
    if (!config || (requester && !config.enabled)) {
        return embeds.warn('Starboard Unavailable', 'This server has not published any starred messages.');
    }

    const messagesQuery = db.select()
        .from(starboardMessages)
        .where(eq(starboardMessages.guildId, guild.id))
        .orderBy(desc(starboardMessages.starCount));
    const candidateLimit = Math.min(MAX_PUBLIC_STARBOARD_CANDIDATES, Math.max(limit, limit * 10));
    const topMessages = await dbLog.select('starboardMessages',
        () => requester ? messagesQuery.limit(candidateLimit).all() : messagesQuery.limit(limit).all(),
        { guildId: guild.id, ...(requester ? { limit: candidateLimit } : { limit }) }
    );

    if (topMessages.length === 0) {
        return embeds.warn('No Starred Messages', 'No messages have been starred yet.');
    }

    const embed = embeds.brand(`${config.emoji} Top Starred Messages`, null);
    let visibleMessages;
    if (requester) {
        const channelById = new Map();
        visibleMessages = [];

        for (const msg of topMessages) {
            if (visibleMessages.length >= limit) break;

            let channel = channelById.get(msg.originalChannelId);
            if (!channelById.has(msg.originalChannelId)) {
                channel = guild.channels.cache?.get(msg.originalChannelId)
                    || await guild.channels.fetch(msg.originalChannelId).catch(() => null);
                channelById.set(msg.originalChannelId, channel);
            }

            // The public Community Hub must not reveal any detail from a channel the
            // requesting member cannot view or read. The admin command intentionally
            // omits requester context and retains its existing operational behavior.
            const permissions = channel?.permissionsFor(requester);
            if (!channel || !permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.ReadMessageHistory)) continue;

            visibleMessages.push({ msg, channel });
        }
    } else {
        visibleMessages = await Promise.all(topMessages.map(async msg => ({
            msg,
            channel: await guild.channels.fetch(msg.originalChannelId).catch(() => null)
        })));
    }

    const leaderboard = await Promise.all(visibleMessages.map(async ({ msg, channel }, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `**${index + 1}.**`;
        const author = await client.users.fetch(msg.authorId).catch(() => null);
        const authorDisplay = author ? author.tag : 'Unknown User';
        const channelDisplay = channel ? `#${channel.name}` : 'deleted-channel';
        const messageLink = `https://discord.com/channels/${guild.id}/${msg.originalChannelId}/${msg.originalMessageId}`;

        return `${medal} **${msg.starCount}** ${config.emoji} • ${authorDisplay} in ${channelDisplay}\n[Jump to message](${messageLink})`;
    }));

    if (leaderboard.length === 0) {
        return embeds.warn('No Visible Starred Messages', 'There are no starred messages you can view.');
    }

    embed.setDescription(leaderboard.join('\n\n'));
    embed.setFooter({ text: `Showing top ${leaderboard.length} starred messages` });
    return embed;
}
