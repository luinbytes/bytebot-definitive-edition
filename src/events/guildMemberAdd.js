const { Events } = require('discord.js');
const { db } = require('../database');
const { guilds } = require('../database/schema');
const { eq } = require('drizzle-orm');
const embeds = require('../utils/embeds');
const logger = require('../utils/logger');
const { dbLog } = require('../utils/dbLogger');

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
    name: Events.GuildMemberAdd,

    async execute(member) {
        try {
            // Fetch guild config
            const [config] = await dbLog.select('guilds',
                () => db.select()
                    .from(guilds)
                    .where(eq(guilds.id, member.guild.id)),
                { guildId: member.guild.id }
            );

            // Check if welcome messages are enabled and configured
            if (!config || !config.welcomeEnabled || !config.welcomeChannel) {
                return; // Welcome messages not configured or disabled
            }

            // Fetch the welcome channel
            const channel = await member.guild.channels.fetch(config.welcomeChannel).catch(() => null);
            if (!channel) {
                logger.warn(`Welcome channel ${config.welcomeChannel} not found in guild ${member.guild.id}`);
                return;
            }

            // Use custom message or default
            const messageTemplate = config.welcomeMessage || 'Welcome to **{server}**, {user}! You are member #{memberCount}.';
            const parsedMessage = parseWelcomeMessage(messageTemplate, member, member.guild);

            // Send welcome message based on embed preference
            if (config.welcomeUseEmbed) {
                const welcomeEmbed = embeds.brand('Welcome!', parsedMessage)
                    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }));

                await channel.send({ embeds: [welcomeEmbed] });
            } else {
                await channel.send(parsedMessage);
            }

            logger.debug(`Welcome message sent for ${member.user.tag} in ${member.guild.name}`);

        } catch (error) {
            // Don't crash on welcome message errors
            if (error.code === 50013) {
                logger.warn(`Missing permissions to send welcome message in guild ${member.guild.id}`);
            } else if (error.code === 10003) {
                logger.warn(`Welcome channel deleted in guild ${member.guild.id}`);
            } else {
                logger.error(`Failed to send welcome message in guild ${member.guild.id}:`, error);
            }
        }
    },
};
