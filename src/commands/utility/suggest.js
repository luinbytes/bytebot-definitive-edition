const { SlashCommandBuilder } = require('discord.js');
const { db } = require('../../database');
const { suggestions, suggestionConfig } = require('../../database/schema');
const { eq } = require('drizzle-orm');
const embeds = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('suggest')
        .setDescription('Submit a suggestion to the server')
        .addStringOption(opt => opt
            .setName('idea')
            .setDescription('Your suggestion')
            .setMaxLength(2000)
            .setRequired(true))
        .addBooleanOption(opt => opt
            .setName('anonymous')
            .setDescription('Submit anonymously (if enabled by admins)')
            .setRequired(false)),

    cooldown: 60, // 1 minute cooldown to prevent spam

    async execute(interaction) {
        // Defer reply as ephemeral so confirmation is private
        await interaction.deferReply({ ephemeral: true });

        const idea = interaction.options.getString('idea');
        const anonymous = interaction.options.getBoolean('anonymous') ?? false;

        // Check if suggestion system is set up
        const config = await db
            .select()
            .from(suggestionConfig)
            .where(eq(suggestionConfig.guildId, interaction.guild.id))
            .limit(1)
            .then(rows => rows[0]);

        if (!config) {
            return interaction.editReply({
                embeds: [embeds.error(
                    'Suggestion System Not Set Up',
                    'The suggestion system has not been configured yet. Ask an admin to run `/suggestion setup` first.'
                )]
            });
        }

        if (!config.enabled) {
            return interaction.editReply({
                embeds: [embeds.error(
                    'Suggestions Disabled',
                    'The suggestion system is currently disabled in this server.'
                )]
            });
        }

        // Check if anonymous suggestions are allowed
        if (anonymous && !config.allowAnonymous) {
            return interaction.editReply({
                embeds: [embeds.error(
                    'Anonymous Suggestions Disabled',
                    'Anonymous suggestions are not allowed in this server.'
                )]
            });
        }

        // Get suggestion channel
        const channel = await interaction.guild.channels.fetch(config.channelId).catch(() => null);
        if (!channel) {
            return interaction.editReply({
                embeds: [embeds.error(
                    'Channel Not Found',
                    'The suggestion channel no longer exists. Ask an admin to reconfigure the system.'
                )]
            });
        }

        // Check if bot can send messages in channel
        const permissions = channel.permissionsFor(interaction.guild.members.me);
        if (!permissions.has(['SendMessages', 'EmbedLinks', 'AddReactions'])) {
            return interaction.editReply({
                embeds: [embeds.error(
                    'Missing Permissions',
                    `I don't have permission to send messages, embeds, or add reactions in ${channel}.`
                )]
            });
        }

        // Create suggestion in database first to get ID
        const [suggestion] = await db.insert(suggestions).values({
            guildId: interaction.guild.id,
            userId: interaction.user.id,
            content: idea,
            messageId: '0', // Temporary, will update after message is sent
            channelId: config.channelId,
            status: 'pending',
            upvotes: 0,
            downvotes: 0,
            createdAt: new Date(),
            anonymous: anonymous
        }).returning();

        // Create suggestion embed
        const suggestionEmbed = embeds.base(
            `Suggestion #${suggestion.id}`,
            idea
        )
            .addFields([
                {
                    name: 'Author',
                    value: anonymous ? '🎭 Anonymous' : `${interaction.user}`,
                    inline: true
                },
                {
                    name: 'Status',
                    value: '⏳ Pending',
                    inline: true
                },
                {
                    name: 'Votes',
                    value: '👍 0 | 👎 0',
                    inline: true
                }
            ])
            .setFooter({ text: `ID: ${suggestion.id} • React to vote!` });

        // Send to suggestion channel
        const message = await channel.send({ embeds: [suggestionEmbed] });

        // Add voting reactions
        await message.react('👍');
        await message.react('👎');

        // Update suggestion with message ID
        await db.update(suggestions)
            .set({ messageId: message.id })
            .where(eq(suggestions.id, suggestion.id));

        // Reply to user (already ephemeral from defer)
        await interaction.editReply({
            embeds: [embeds.success(
                'Suggestion Submitted',
                `Your suggestion has been submitted to ${channel}!\n\n**Suggestion ID:** #${suggestion.id}\n**Status:** Pending Review`
            )]
        });
    }
};
