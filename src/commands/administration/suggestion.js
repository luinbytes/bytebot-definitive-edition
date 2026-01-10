const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { db } = require('../../database');
const { suggestions, suggestionConfig } = require('../../database/schema');
const { eq, and, desc } = require('drizzle-orm');
const embeds = require('../../utils/embeds');
const { dbLog } = require('../../utils/dbLogger');
const { fetchChannel, safeMessageFetch } = require('../../utils/discordApiUtil');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('suggestion')
        .setDescription('Manage the suggestion system')
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Configure the suggestion system (Admin only)')
                .addChannelOption(opt => opt
                    .setName('channel')
                    .setDescription('Channel where suggestions will be posted')
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true))
                .addRoleOption(opt => opt
                    .setName('review_role')
                    .setDescription('Role that can approve/deny suggestions (defaults to Admin only)'))
                .addBooleanOption(opt => opt
                    .setName('allow_anonymous')
                    .setDescription('Allow users to submit anonymous suggestions (default: false)')))
        .addSubcommand(sub =>
            sub.setName('approve')
                .setDescription('Approve a suggestion')
                .addIntegerOption(opt => opt
                    .setName('id')
                    .setDescription('Suggestion ID to approve')
                    .setRequired(true))
                .addStringOption(opt => opt
                    .setName('reason')
                    .setDescription('Optional reason for approval')
                    .setMaxLength(500)))
        .addSubcommand(sub =>
            sub.setName('deny')
                .setDescription('Deny a suggestion')
                .addIntegerOption(opt => opt
                    .setName('id')
                    .setDescription('Suggestion ID to deny')
                    .setRequired(true))
                .addStringOption(opt => opt
                    .setName('reason')
                    .setDescription('Optional reason for denial')
                    .setMaxLength(500)))
        .addSubcommand(sub =>
            sub.setName('implement')
                .setDescription('Mark a suggestion as implemented')
                .addIntegerOption(opt => opt
                    .setName('id')
                    .setDescription('Suggestion ID to mark as implemented')
                    .setRequired(true))
                .addStringOption(opt => opt
                    .setName('note')
                    .setDescription('Optional implementation note')
                    .setMaxLength(500)))
        .addSubcommand(sub =>
            sub.setName('view')
                .setDescription('View a specific suggestion')
                .addIntegerOption(opt => opt
                    .setName('id')
                    .setDescription('Suggestion ID to view')
                    .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('List suggestions by status')
                .addStringOption(opt => opt
                    .setName('status')
                    .setDescription('Filter by status')
                    .addChoices(
                        { name: 'Pending', value: 'pending' },
                        { name: 'Approved', value: 'approved' },
                        { name: 'Denied', value: 'denied' },
                        { name: 'Implemented', value: 'implemented' }
                    ))
                .addIntegerOption(opt => opt
                    .setName('limit')
                    .setDescription('Number of suggestions to show (default: 10)')
                    .setMinValue(1)
                    .setMaxValue(25)))
        .addSubcommand(sub =>
            sub.setName('leaderboard')
                .setDescription('View top suggestions by votes')
                .addIntegerOption(opt => opt
                    .setName('limit')
                    .setDescription('Number of suggestions to show (default: 10)')
                    .setMinValue(1)
                    .setMaxValue(25)))
        .addSubcommand(sub =>
            sub.setName('submit')
                .setDescription('Submit a suggestion to the server')
                .addStringOption(opt => opt
                    .setName('idea')
                    .setDescription('Your suggestion')
                    .setMaxLength(2000)
                    .setRequired(true))
                .addBooleanOption(opt => opt
                    .setName('anonymous')
                    .setDescription('Submit anonymously (if enabled by admins)')
                    .setRequired(false))),

    cooldown: 5,

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        // Submit is user-facing (ephemeral confirmation), others are admin (ephemeral)
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });


        switch (subcommand) {
            case 'setup':
                await this.handleSetup(interaction);
                break;

            case 'approve':
                await this.handleApprove(interaction);
                break;

            case 'deny':
                await this.handleDeny(interaction);
                break;

            case 'implement':
                await this.handleImplement(interaction);
                break;

            case 'view':
                await this.handleView(interaction);
                break;

            case 'list':
                await this.handleList(interaction);
                break;

            case 'leaderboard':
                await this.handleLeaderboard(interaction);
                break;

            case 'submit':
                await this.handleSubmit(interaction);
                break;
        }
    },

    async handleSetup(interaction) {
        // Check admin permission
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.editReply({
                embeds: [embeds.error(
                    'Missing Permissions',
                    'You need **Manage Server** permission to configure the suggestion system.'
                )]
            });
        }

        const channel = interaction.options.getChannel('channel');
        const reviewRole = interaction.options.getRole('review_role');
        const allowAnonymous = interaction.options.getBoolean('allow_anonymous') ?? false;

        // Verify bot permissions in channel
        const permissions = channel.permissionsFor(interaction.guild.members.me);
        if (!permissions.has(['SendMessages', 'EmbedLinks', 'AddReactions'])) {
            return interaction.editReply({
                embeds: [embeds.error(
                    'Missing Permissions',
                    `I don't have permission to send messages, embeds, or add reactions in ${channel}.`
                )]
            });
        }

        // Check if already configured
        const existing = await db
            .select()
            .from(suggestionConfig)
            .where(eq(suggestionConfig.guildId, interaction.guild.id))
            .limit(1)
            .then(rows => rows[0]);

        if (existing) {
            // Update existing config
            await dbLog.update('suggestionConfig',
                () => db.update(suggestionConfig)
                    .set({
                        channelId: channel.id,
                        reviewRoleId: reviewRole?.id || null,
                        allowAnonymous: allowAnonymous,
                        enabled: true
                    })
                    .where(eq(suggestionConfig.guildId, interaction.guild.id)),
                { guildId: interaction.guild.id, channelId: channel.id }
            );
        } else {
            // Create new config
            await dbLog.insert('suggestionConfig',
                () => db.insert(suggestionConfig).values({
                    guildId: interaction.guild.id,
                    channelId: channel.id,
                    reviewRoleId: reviewRole?.id || null,
                    enabled: true,
                    allowAnonymous: allowAnonymous
                }),
                { guildId: interaction.guild.id, channelId: channel.id }
            );
        }

        const setupEmbed = embeds.success(
            'Suggestion System Configured',
            `The suggestion system has been ${existing ? 'updated' : 'set up'} successfully!`
        )
            .addFields([
                { name: 'Suggestion Channel', value: `${channel}`, inline: true },
                { name: 'Review Role', value: reviewRole ? `${reviewRole}` : 'Admins Only', inline: true },
                { name: 'Anonymous Submissions', value: allowAnonymous ? '✅ Enabled' : '❌ Disabled', inline: true }
            ])
            .setFooter({ text: 'Users can now submit suggestions with /suggest' });

        await interaction.editReply({ embeds: [setupEmbed] });
    },

    async handleApprove(interaction) {
        await this.handleReview(interaction, 'approved');
    },

    async handleDeny(interaction) {
        await this.handleReview(interaction, 'denied');
    },

    async handleImplement(interaction) {
        await this.handleReview(interaction, 'implemented');
    },

    async handleReview(interaction, newStatus) {
        const id = interaction.options.getInteger('id');
        const reason = interaction.options.getString('reason') || interaction.options.getString('note');

        // Check if user can review suggestions
        const canReview = await this.checkReviewPermission(interaction);
        if (!canReview) {
            return interaction.editReply({
                embeds: [embeds.error(
                    'Missing Permissions',
                    'You don\'t have permission to review suggestions.'
                )]
            });
        }

        // Get suggestion
        const suggestion = await db
            .select()
            .from(suggestions)
            .where(and(
                eq(suggestions.id, id),
                eq(suggestions.guildId, interaction.guild.id)
            ))
            .limit(1)
            .then(rows => rows[0]);

        if (!suggestion) {
            return interaction.editReply({
                embeds: [embeds.error(
                    'Suggestion Not Found',
                    `No suggestion with ID #${id} was found in this server.`
                )]
            });
        }

        if (suggestion.status !== 'pending') {
            return interaction.editReply({
                embeds: [embeds.warn(
                    'Already Reviewed',
                    `This suggestion has already been ${suggestion.status}.`
                )]
            });
        }

        // Update suggestion status
        await dbLog.update('suggestions',
            () => db.update(suggestions)
                .set({
                    status: newStatus,
                    reviewedBy: interaction.user.id,
                    reviewedAt: new Date(),
                    reviewReason: reason
                })
                .where(eq(suggestions.id, id)),
            { suggestionId: id, newStatus, reviewedBy: interaction.user.id }
        );

        // Update the suggestion message
        await this.updateSuggestionMessage(interaction.guild, suggestion, newStatus, reason);

        // Try to DM the suggester
        try {
            const suggester = await interaction.client.users.fetch(suggestion.userId);
            const statusEmojis = {
                approved: '✅',
                denied: '❌',
                implemented: '🎉'
            };
            const statusColors = {
                approved: 'success',
                denied: 'error',
                implemented: 'brand'
            };

            const dmEmbed = embeds[statusColors[newStatus]](
                `Suggestion ${newStatus.charAt(0).toUpperCase() + newStatus.slice(1)}`,
                `Your suggestion in **${interaction.guild.name}** has been ${newStatus}!`
            )
                .addFields([
                    { name: 'Suggestion', value: suggestion.content.substring(0, 1000) },
                    { name: 'Reviewed By', value: `${interaction.user.tag}`, inline: true },
                    { name: 'Status', value: statusEmojis[newStatus] + ' ' + newStatus.charAt(0).toUpperCase() + newStatus.slice(1), inline: true }
                ]);

            if (reason) {
                dmEmbed.addFields({ name: 'Reason', value: reason });
            }

            await suggester.send({ embeds: [dmEmbed] });
        } catch (error) {
            // User has DMs disabled or blocked the bot
        }

        // Reply to command
        const statusEmojis = {
            approved: '✅',
            denied: '❌',
            implemented: '🎉'
        };

        await interaction.editReply({
            embeds: [embeds.success(
                `Suggestion ${newStatus.charAt(0).toUpperCase() + newStatus.slice(1)}`,
                `Suggestion #${id} has been ${newStatus}.${reason ? `\n\n**Reason:** ${reason}` : ''}`
            )]
        });
    },

    async handleView(interaction) {
        const id = interaction.options.getInteger('id');

        const suggestion = await db
            .select()
            .from(suggestions)
            .where(and(
                eq(suggestions.id, id),
                eq(suggestions.guildId, interaction.guild.id)
            ))
            .limit(1)
            .then(rows => rows[0]);

        if (!suggestion) {
            return interaction.editReply({
                embeds: [embeds.error(
                    'Suggestion Not Found',
                    `No suggestion with ID #${id} was found in this server.`
                )]
            });
        }

        const statusEmojis = {
            pending: '⏳',
            approved: '✅',
            denied: '❌',
            implemented: '🎉'
        };

        const suggester = suggestion.anonymous
            ? '🎭 Anonymous'
            : `<@${suggestion.userId}>`;

        const viewEmbed = embeds.base(
            `Suggestion #${suggestion.id}`,
            suggestion.content
        )
            .addFields([
                { name: 'Author', value: suggester, inline: true },
                { name: 'Status', value: `${statusEmojis[suggestion.status]} ${suggestion.status.charAt(0).toUpperCase() + suggestion.status.slice(1)}`, inline: true },
                { name: 'Votes', value: `👍 ${suggestion.upvotes} | 👎 ${suggestion.downvotes}`, inline: true },
                { name: 'Submitted', value: `<t:${Math.floor(suggestion.createdAt.getTime() / 1000)}:R>`, inline: true }
            ]);

        if (suggestion.reviewedBy) {
            viewEmbed.addFields([
                { name: 'Reviewed By', value: `<@${suggestion.reviewedBy}>`, inline: true },
                { name: 'Reviewed', value: `<t:${Math.floor(suggestion.reviewedAt.getTime() / 1000)}:R>`, inline: true }
            ]);

            if (suggestion.reviewReason) {
                viewEmbed.addFields({ name: 'Review Reason', value: suggestion.reviewReason });
            }
        }

        // Add jump link to original message
        const jumpLink = `https://discord.com/channels/${suggestion.guildId}/${suggestion.channelId}/${suggestion.messageId}`;
        viewEmbed.addFields({ name: 'Original Message', value: `[Jump to Suggestion](${jumpLink})` });

        await interaction.editReply({ embeds: [viewEmbed] });
    },

    async handleList(interaction) {
        const status = interaction.options.getString('status');
        const limit = interaction.options.getInteger('limit') ?? 10;

        let query = db
            .select()
            .from(suggestions)
            .where(eq(suggestions.guildId, interaction.guild.id))
            .orderBy(desc(suggestions.createdAt))
            .limit(limit);

        if (status) {
            query = db
                .select()
                .from(suggestions)
                .where(and(
                    eq(suggestions.guildId, interaction.guild.id),
                    eq(suggestions.status, status)
                ))
                .orderBy(desc(suggestions.createdAt))
                .limit(limit);
        }

        const results = await query;

        if (results.length === 0) {
            return interaction.editReply({
                embeds: [embeds.info(
                    'No Suggestions Found',
                    status
                        ? `No ${status} suggestions found.`
                        : 'No suggestions have been submitted yet.'
                )]
            });
        }

        const statusEmojis = {
            pending: '⏳',
            approved: '✅',
            denied: '❌',
            implemented: '🎉'
        };

        const listEmbed = embeds.base(
            status
                ? `${status.charAt(0).toUpperCase() + status.slice(1)} Suggestions`
                : 'All Suggestions',
            results.map(s =>
                `**#${s.id}** ${statusEmojis[s.status]} ${s.content.substring(0, 60)}${s.content.length > 60 ? '...' : ''} (👍 ${s.upvotes} | 👎 ${s.downvotes})`
            ).join('\n\n')
        )
            .setFooter({ text: `Showing ${results.length} of ${results.length} suggestions • Use /suggestion view <id> for details` });

        await interaction.editReply({ embeds: [listEmbed] });
    },

    async handleLeaderboard(interaction) {
        const limit = interaction.options.getInteger('limit') ?? 10;

        const results = await db
            .select()
            .from(suggestions)
            .where(eq(suggestions.guildId, interaction.guild.id))
            .orderBy(desc(suggestions.upvotes))
            .limit(limit);

        if (results.length === 0) {
            return interaction.editReply({
                embeds: [embeds.info(
                    'No Suggestions',
                    'No suggestions have been submitted yet.'
                )]
            });
        }

        const medals = ['🥇', '🥈', '🥉'];
        const statusEmojis = {
            pending: '⏳',
            approved: '✅',
            denied: '❌',
            implemented: '🎉'
        };

        const leaderboardEmbed = embeds.base(
            'Top Suggestions',
            results.map((s, i) => {
                const medal = i < 3 ? medals[i] : `**#${i + 1}**`;
                const preview = s.content.substring(0, 50) + (s.content.length > 50 ? '...' : '');
                return `${medal} **ID #${s.id}** ${statusEmojis[s.status]}\n${preview}\n👍 ${s.upvotes} | 👎 ${s.downvotes}`;
            }).join('\n\n')
        )
            .setFooter({ text: `Top ${results.length} suggestions by upvotes` });

        await interaction.editReply({ embeds: [leaderboardEmbed] });
    },

    async checkReviewPermission(interaction) {
        // Check if user has admin permission
        if (interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return true;
        }

        // Check if review role is configured
        const config = await db
            .select()
            .from(suggestionConfig)
            .where(eq(suggestionConfig.guildId, interaction.guild.id))
            .limit(1)
            .then(rows => rows[0]);

        if (!config || !config.reviewRoleId) {
            return false; // No review role set, admin only
        }

        // Check if user has the review role
        return interaction.member.roles.cache.has(config.reviewRoleId);
    },

    async updateSuggestionMessage(guild, suggestion, newStatus, reason) {
        try {
            const channel = await fetchChannel(guild, suggestion.channelId, { logContext: 'suggestion-update' });
            if (!channel) return;

            const message = await safeMessageFetch(channel, suggestion.messageId, { logContext: 'suggestion-update' });
            if (!message) return;

            const statusEmojis = {
                pending: '⏳',
                approved: '✅',
                denied: '❌',
                implemented: '🎉'
            };

            const statusNames = {
                pending: 'Pending',
                approved: 'Approved',
                denied: 'Denied',
                implemented: 'Implemented'
            };

            // Fetch current reactions to update vote counts
            const thumbsUp = message.reactions.cache.get('👍');
            const thumbsDown = message.reactions.cache.get('👎');
            const upvotes = thumbsUp ? thumbsUp.count - 1 : 0; // -1 for bot's reaction
            const downvotes = thumbsDown ? thumbsDown.count - 1 : 0;

            // Update vote counts in database
            await dbLog.update('suggestions',
                () => db.update(suggestions)
                    .set({ upvotes, downvotes })
                    .where(eq(suggestions.id, suggestion.id)),
                { suggestionId: suggestion.id, upvotes, downvotes }
            );

            const updatedEmbed = embeds.base(
                `Suggestion #${suggestion.id}`,
                suggestion.content
            )
                .addFields([
                    {
                        name: 'Author',
                        value: suggestion.anonymous ? '🎭 Anonymous' : `<@${suggestion.userId}>`,
                        inline: true
                    },
                    {
                        name: 'Status',
                        value: `${statusEmojis[newStatus]} ${statusNames[newStatus]}`,
                        inline: true
                    },
                    {
                        name: 'Votes',
                        value: `👍 ${upvotes} | 👎 ${downvotes}`,
                        inline: true
                    }
                ]);

            if (reason) {
                updatedEmbed.addFields({ name: 'Review Note', value: reason });
            }

            updatedEmbed.setFooter({ text: `ID: ${suggestion.id} • ${statusNames[newStatus]}` });

            await message.edit({ embeds: [updatedEmbed] });
        } catch (error) {
            // Message might be deleted, that's okay
        }
    },

    /**
     * Handle /suggestion submit - User-facing suggestion submission
     */
    async handleSubmit(interaction) {
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
        const channel = await fetchChannel(interaction.guild, config.channelId, { logContext: 'suggestion-submit' });
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

        // Reply to user
        await interaction.editReply({
            embeds: [embeds.success(
                'Suggestion Submitted',
                `Your suggestion has been submitted to ${channel}!\n\n**Suggestion ID:** #${suggestion.id}\n**Status:** Pending Review`
            )]
        });
    }
};
