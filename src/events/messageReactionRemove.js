const { Events } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    name: Events.MessageReactionRemove,
    async execute(reaction, user, client) {
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

            // Check starboard
            if (client.starboardService) {
                await client.starboardService.handleReactionRemove(reaction, user);
            }

            // Check suggestion votes
            if (reaction.emoji.name === '👍' || reaction.emoji.name === '👎') {
                const { db } = require('../database');
                const { suggestions } = require('../database/schema');
                const { eq } = require('drizzle-orm');
                const embeds = require('../utils/embeds');

                // Check if this message is a suggestion
                const suggestion = await db
                    .select()
                    .from(suggestions)
                    .where(eq(suggestions.messageId, reaction.message.id))
                    .limit(1)
                    .then(rows => rows[0]);

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

                    await db.update(suggestions)
                        .set({ upvotes, downvotes })
                        .where(eq(suggestions.id, suggestion.id));

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
            logger.error('Error in messageReactionRemove:', error);
        }
    }
};
