const { Events } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    name: Events.MessageReactionAdd,
    async execute(reaction, user) {
        // Get the actual client from the reaction object (more reliable than passed parameter)
        const client = reaction.client;

        try {
            // Handle partials
            if (reaction.partial) {
                try {
                    await reaction.fetch();
                } catch (error) {
                    logger.error('Failed to fetch partial reaction:', error);
                    return;
                }
            }

            if (reaction.message.partial) {
                try {
                    await reaction.message.fetch();
                } catch (error) {
                    logger.error('Failed to fetch partial message:', error);
                    return;
                }
            }

            // Ignore bots
            if (user.bot) return;

            // Ignore DMs
            if (!reaction.message.guild) return;

            // Track reaction for achievements
            if (client.activityStreakService) {
                try {
                    await client.activityStreakService.recordReaction(
                        user.id,
                        reaction.message.guild.id
                    );
                } catch (trackError) {
                    logger.debug('Failed to track reaction for achievements:', trackError);
                    // Don't crash on tracking errors, just log
                }
            }

            // Check starboard
            if (client.starboardService) {
                await client.starboardService.handleReactionAdd(reaction, user);
            }

            // Check suggestion votes
            if (reaction.emoji.name === '👍' || reaction.emoji.name === '👎') {
                const { db } = require('../database');
                const { suggestions } = require('../database/schema');
                const { eq } = require('drizzle-orm');
                const embeds = require('../utils/embeds');
                const { dbLog } = require('../utils/dbLogger');

                // Check if this message is a suggestion
                const suggestion = await dbLog.select('suggestions',
                    () => db
                        .select()
                        .from(suggestions)
                        .where(eq(suggestions.messageId, reaction.message.id))
                        .limit(1)
                        .then(rows => rows[0]),
                    { messageId: reaction.message.id, guildId: reaction.message.guild.id }
                );

                if (suggestion) {
                    // Only count votes if suggestion is still pending
                    if (suggestion.status !== 'pending') {
                        return;
                    }

                    // Update vote counts
                    const message = reaction.message;
                    const thumbsUp = message.reactions.cache.get('👍');
                    const thumbsDown = message.reactions.cache.get('👎');

                    const upvotes = thumbsUp ? thumbsUp.count - 1 : 0; // -1 for bot's reaction
                    const downvotes = thumbsDown ? thumbsDown.count - 1 : 0;

                    await dbLog.update('suggestions',
                        () => db.update(suggestions)
                            .set({ upvotes, downvotes })
                            .where(eq(suggestions.id, suggestion.id)),
                        { suggestionId: suggestion.id, upvotes, downvotes, operation: 'updateVotes' }
                    );

                    // Update the embed
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
                                value: `${statusEmojis[suggestion.status]} ${statusNames[suggestion.status]}`,
                                inline: true
                            },
                            {
                                name: 'Votes',
                                value: `👍 ${upvotes} | 👎 ${downvotes}`,
                                inline: true
                            }
                        ]);

                    if (suggestion.reviewedBy) {
                        updatedEmbed.addFields([
                            { name: 'Reviewed By', value: `<@${suggestion.reviewedBy}>`, inline: true }
                        ]);
                    }

                    if (suggestion.reviewReason) {
                        updatedEmbed.addFields({ name: 'Review Note', value: suggestion.reviewReason });
                    }

                    updatedEmbed.setFooter({ text: `ID: ${suggestion.id} • ${statusNames[suggestion.status]}` });

                    try {
                        await message.edit({ embeds: [updatedEmbed] });
                    } catch (error) {
                        logger.debug(`Failed to update suggestion embed: ${error.message}`);
                    }
                }
            }

        } catch (error) {
            logger.error('Error in messageReactionAdd:', error);
        }
    }
};
