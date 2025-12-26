const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { db } = require('../../database/index');
const { guilds } = require('../../database/schema');
const { eq } = require('drizzle-orm');
const embeds = require('../../utils/embeds');
const logger = require('../../utils/logger');

/**
 * Get ordinal suffix for a number (1st, 2nd, 3rd, etc.)
 * @param {number} num - The number
 * @returns {string}
 */
function getOrdinalSuffix(num) {
    const j = num % 10;
    const k = num % 100;
    if (j === 1 && k !== 11) return num + 'st';
    if (j === 2 && k !== 12) return num + 'nd';
    if (j === 3 && k !== 13) return num + 'rd';
    return num + 'th';
}

/**
 * Parse welcome message variables
 * @param {string} message - Message template with variables
 * @param {GuildMember} member - The member who joined
 * @param {Guild} guild - The guild the member joined
 * @returns {string}
 */
function parseWelcomeMessage(message, member, guild) {
    const now = new Date();
    const accountCreated = member.user.createdAt;
    const accountAgeDays = Math.floor((now - accountCreated) / (1000 * 60 * 60 * 24));
    const accountAgeMonths = Math.floor(accountAgeDays / 30);
    const joinedAt = member.joinedAt || now;

    // Format dates
    const joinedAtFormatted = joinedAt.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    const createdAtFormatted = accountCreated.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    // Relative timestamps for Discord (will show as "X days ago", "X months ago", etc.)
    const joinedTimestamp = `<t:${Math.floor(joinedAt.getTime() / 1000)}:R>`;
    const createdTimestamp = `<t:${Math.floor(accountCreated.getTime() / 1000)}:R>`;
    const joinedTimestampFull = `<t:${Math.floor(joinedAt.getTime() / 1000)}:F>`;
    const createdTimestampFull = `<t:${Math.floor(accountCreated.getTime() / 1000)}:F>`;

    return message
        // User mentions
        .replace(/{user}/g, `<@${member.id}>`)
        .replace(/{mention}/g, `<@${member.id}>`)
        .replace(/{username}/g, member.user.username)
        .replace(/{tag}/g, member.user.tag)
        .replace(/{displayname}/g, member.displayName)

        // Server info
        .replace(/{server}/g, guild.name)
        .replace(/{memberCount}/g, guild.memberCount.toString())
        .replace(/{membercount}/g, guild.memberCount.toString())
        .replace(/{memberNumber}/g, getOrdinalSuffix(guild.memberCount))
        .replace(/{membernumber}/g, getOrdinalSuffix(guild.memberCount))

        // Join date/time
        .replace(/{joinedAt}/g, joinedAtFormatted)
        .replace(/{joinedat}/g, joinedAtFormatted)
        .replace(/{joinedRelative}/g, joinedTimestamp)
        .replace(/{joinedrelative}/g, joinedTimestamp)
        .replace(/{joinedFull}/g, joinedTimestampFull)
        .replace(/{joinedfull}/g, joinedTimestampFull)

        // Account creation
        .replace(/{createdAt}/g, createdAtFormatted)
        .replace(/{createdat}/g, createdAtFormatted)
        .replace(/{createdRelative}/g, createdTimestamp)
        .replace(/{createdrelative}/g, createdTimestamp)
        .replace(/{createdFull}/g, createdTimestampFull)
        .replace(/{createdfull}/g, createdTimestampFull)

        // Account age
        .replace(/{accountAgeDays}/g, accountAgeDays.toString())
        .replace(/{accountagedays}/g, accountAgeDays.toString())
        .replace(/{accountAgeMonths}/g, accountAgeMonths.toString())
        .replace(/{accountagemonths}/g, accountAgeMonths.toString());
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('Manage welcome messages for new members.')
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Set the welcome channel.')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('The channel to send welcome messages to')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('message')
                .setDescription('Set the welcome message template.')
                .addStringOption(option =>
                    option.setName('text')
                        .setDescription('Message template (use {user} {username} {server} {memberCount})')
                        .setRequired(true)
                        .setMinLength(1)
                        .setMaxLength(2000)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('toggle')
                .setDescription('Enable or disable welcome messages.')
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setDescription('Enable or disable')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('embed')
                .setDescription('Toggle whether to use an embed for welcome messages.')
                .addBooleanOption(option =>
                    option.setName('use_embed')
                        .setDescription('Use embed format')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('test')
                .setDescription('Send a test welcome message to see how it looks.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View current welcome message configuration.')),

    permissions: [PermissionFlagsBits.ManageGuild],
    cooldown: 3,

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        try {
            // Fetch current config
            const [config] = await db.select().from(guilds).where(eq(guilds.id, interaction.guild.id));

            if (!config) {
                return interaction.reply({
                    embeds: [embeds.error('Error', 'Configuration not found for this server.')],
                    flags: [MessageFlags.Ephemeral]
                });
            }

            switch (subcommand) {
                case 'setup':
                    await handleSetup(interaction, config);
                    break;

                case 'message':
                    await handleMessage(interaction, config);
                    break;

                case 'toggle':
                    await handleToggle(interaction, config);
                    break;

                case 'embed':
                    await handleEmbed(interaction, config);
                    break;

                case 'test':
                    await handleTest(interaction, config);
                    break;

                case 'view':
                    await handleView(interaction, config);
                    break;
            }

        } catch (error) {
            logger.error('Welcome command error:', error);
            const reply = {
                embeds: [embeds.error('Error', 'An error occurred while processing your request.')],
                flags: [MessageFlags.Ephemeral]
            };

            if (interaction.deferred) {
                return interaction.editReply(reply);
            } else {
                return interaction.reply(reply);
            }
        }
    },
};

/**
 * Handle setup subcommand
 */
async function handleSetup(interaction, config) {
    const channel = interaction.options.getChannel('channel');

    // Check bot permissions in the target channel
    const botPermissions = channel.permissionsFor(interaction.guild.members.me);
    if (!botPermissions.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
        return interaction.reply({
            embeds: [embeds.error('Missing Permissions', `I need **Send Messages** and **Embed Links** permissions in ${channel}.`)],
            flags: [MessageFlags.Ephemeral]
        });
    }

    await db.update(guilds)
        .set({ welcomeChannel: channel.id })
        .where(eq(guilds.id, interaction.guild.id));

    return interaction.reply({
        embeds: [embeds.success('Welcome Channel Set', `Welcome messages will be sent to ${channel}.\n\nUse \`/welcome message\` to set a custom message, then \`/welcome toggle\` to enable.`)]
    });
}

/**
 * Handle message subcommand
 */
async function handleMessage(interaction, config) {
    const message = interaction.options.getString('text');

    await db.update(guilds)
        .set({ welcomeMessage: message })
        .where(eq(guilds.id, interaction.guild.id));

    // Parse the message to show a preview
    const preview = parseWelcomeMessage(message, interaction.member, interaction.guild);

    const embed = embeds.success('Welcome Message Updated', 'Your welcome message has been set!')
        .addFields(
            { name: 'Template', value: `\`\`\`${message}\`\`\``, inline: false },
            { name: 'Preview', value: preview.length > 1024 ? preview.substring(0, 1021) + '...' : preview, inline: false },
            { name: 'Available Variables', value: '**User:** `{user}` `{username}` `{tag}` `{displayname}`\n**Server:** `{server}` `{memberCount}` `{memberNumber}`\n**Dates:** `{joinedAt}` `{joinedRelative}` `{createdAt}` `{accountAgeDays}`', inline: false }
        );

    return interaction.reply({ embeds: [embed] });
}

/**
 * Handle toggle subcommand
 */
async function handleToggle(interaction, config) {
    const enabled = interaction.options.getBoolean('enabled');

    // Check if channel is configured
    if (enabled && !config.welcomeChannel) {
        return interaction.reply({
            embeds: [embeds.error('Channel Not Set', 'Please use `/welcome setup` to set a welcome channel first.')],
            flags: [MessageFlags.Ephemeral]
        });
    }

    await db.update(guilds)
        .set({ welcomeEnabled: enabled })
        .where(eq(guilds.id, interaction.guild.id));

    const statusText = enabled ? 'enabled' : 'disabled';
    const emoji = enabled ? '✅' : '❌';

    return interaction.reply({
        embeds: [embeds.success(`Welcome Messages ${enabled ? 'Enabled' : 'Disabled'}`, `${emoji} Welcome messages are now **${statusText}**.`)]
    });
}

/**
 * Handle embed subcommand
 */
async function handleEmbed(interaction, config) {
    const useEmbed = interaction.options.getBoolean('use_embed');

    await db.update(guilds)
        .set({ welcomeUseEmbed: useEmbed })
        .where(eq(guilds.id, interaction.guild.id));

    const formatText = useEmbed ? 'branded embed' : 'plain text';

    return interaction.reply({
        embeds: [embeds.success('Welcome Format Updated', `Welcome messages will now be sent as **${formatText}**.`)]
    });
}

/**
 * Handle test subcommand
 */
async function handleTest(interaction, config) {
    // Check if channel is configured
    if (!config.welcomeChannel) {
        return interaction.reply({
            embeds: [embeds.error('Channel Not Set', 'Please use `/welcome setup` to set a welcome channel first.')],
            flags: [MessageFlags.Ephemeral]
        });
    }

    const channel = await interaction.guild.channels.fetch(config.welcomeChannel).catch(() => null);
    if (!channel) {
        return interaction.reply({
            embeds: [embeds.error('Channel Not Found', 'The configured welcome channel no longer exists. Please run `/welcome setup` again.')],
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Use custom message or default
    const messageTemplate = config.welcomeMessage || 'Welcome to **{server}**, {user}! You are member #{memberCount}.';
    const parsedMessage = parseWelcomeMessage(messageTemplate, interaction.member, interaction.guild);

    try {
        // Send test message based on embed preference
        if (config.welcomeUseEmbed) {
            const welcomeEmbed = embeds.brand('Welcome!', parsedMessage)
                .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true, size: 256 }))
                .setFooter({ text: 'This is a test message' });

            await channel.send({ embeds: [welcomeEmbed] });
        } else {
            await channel.send(`${parsedMessage}\n\n*This is a test message*`);
        }

        return interaction.reply({
            embeds: [embeds.success('Test Sent', `A test welcome message has been sent to ${channel}.`)],
            flags: [MessageFlags.Ephemeral]
        });

    } catch (error) {
        logger.error('Failed to send test welcome message:', error);

        return interaction.reply({
            embeds: [embeds.error('Send Failed', `Could not send message to ${channel}. Please check my permissions.`)],
            flags: [MessageFlags.Ephemeral]
        });
    }
}

/**
 * Handle view subcommand
 */
async function handleView(interaction, config) {
    const embed = embeds.brand('Welcome Message Configuration', null)
        .addFields(
            {
                name: 'Status',
                value: config.welcomeEnabled ? '✅ Enabled' : '❌ Disabled',
                inline: true
            },
            {
                name: 'Channel',
                value: config.welcomeChannel ? `<#${config.welcomeChannel}>` : 'Not set',
                inline: true
            },
            {
                name: 'Format',
                value: config.welcomeUseEmbed ? 'Branded Embed' : 'Plain Text',
                inline: true
            },
            {
                name: 'Message Template',
                value: config.welcomeMessage
                    ? `\`\`\`${config.welcomeMessage}\`\`\``
                    : '*Default: Welcome to **{server}**, {user}! You are member #{memberCount}.*',
                inline: false
            },
            {
                name: 'Available Variables',
                value: '**User:** `{user}` `{username}` `{tag}` `{displayname}`\n' +
                       '**Server:** `{server}` `{memberCount}` `{memberNumber}`\n' +
                       '**Joined:** `{joinedAt}` `{joinedRelative}` `{joinedFull}`\n' +
                       '**Account:** `{createdAt}` `{createdRelative}` `{accountAgeDays}` `{accountAgeMonths}`',
                inline: false
            }
        );

    return interaction.reply({ embeds: [embed] });
}
