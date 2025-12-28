const { SlashCommandBuilder, MessageFlags, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('streak')
        .setDescription('View activity streak information')
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View your or another user\'s activity streak')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('User to view (defaults to yourself)')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('leaderboard')
                .setDescription('View server streak leaderboard')
                .addStringOption(option =>
                    option
                        .setName('type')
                        .setDescription('Leaderboard type')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Current Streak', value: 'current' },
                            { name: 'Longest Streak', value: 'longest' },
                            { name: 'Achievement Count', value: 'achievements' },
                            { name: 'Achievement Points', value: 'points' },
                            { name: 'Rarest Achievements', value: 'rare' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('achievements')
                .setDescription('Browse all available achievements')
                .addStringOption(option =>
                    option
                        .setName('category')
                        .setDescription('Filter by category')
                        .setRequired(false)
                        .addChoices(
                            { name: 'All', value: 'all' },
                            { name: 'Streak', value: 'streak' },
                            { name: 'Total Days', value: 'total' },
                            { name: 'Messages', value: 'message' },
                            { name: 'Voice', value: 'voice' },
                            { name: 'Commands', value: 'command' },
                            { name: 'Special', value: 'special' },
                            { name: 'Social', value: 'social' },
                            { name: 'Combo', value: 'combo' },
                            { name: 'Meta', value: 'meta' }
                        ))
                .addStringOption(option =>
                    option
                        .setName('rarity')
                        .setDescription('Filter by rarity')
                        .setRequired(false)
                        .addChoices(
                            { name: 'All', value: 'all' },
                            { name: 'Common', value: 'common' },
                            { name: 'Uncommon', value: 'uncommon' },
                            { name: 'Rare', value: 'rare' },
                            { name: 'Epic', value: 'epic' },
                            { name: 'Legendary', value: 'legendary' },
                            { name: 'Mythic', value: 'mythic' }
                        ))
                .addStringOption(option =>
                    option
                        .setName('filter')
                        .setDescription('Show specific achievements')
                        .setRequired(false)
                        .addChoices(
                            { name: 'All', value: 'all' },
                            { name: 'Earned', value: 'earned' },
                            { name: 'Not Earned', value: 'not_earned' },
                            { name: 'With Roles', value: 'with_roles' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('progress')
                .setDescription('View your progress toward next achievements')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('User to view (defaults to yourself)')
                        .setRequired(false))),
    category: 'Utility',
    cooldown: 3,

    async execute(interaction, client) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'view') {
            await handleView(interaction, client);
        } else if (subcommand === 'leaderboard') {
            await handleLeaderboard(interaction, client);
        } else if (subcommand === 'achievements') {
            await handleAchievements(interaction, client);
        } else if (subcommand === 'progress') {
            await handleProgress(interaction, client);
        }
    }
};

/**
 * Handle /streak view
 */
async function handleView(interaction, client) {
    const targetUser = interaction.options.getUser('user') || interaction.user;

    if (!client.activityStreakService) {
        return interaction.reply({
            embeds: [embeds.error('Service Unavailable', 'The activity streak system is currently unavailable.')],
            flags: [MessageFlags.Ephemeral]
        });
    }

    try {
        const streakData = await client.activityStreakService.getUserStreak(
            targetUser.id,
            interaction.guild.id
        );

        if (!streakData || streakData.totalActiveDays === 0) {
            const noDataEmbed = embeds.info(
                'No Activity Data',
                `${targetUser.id === interaction.user.id ? 'You haven\'t' : `${targetUser.username} hasn't`} recorded any activity yet.\n\nStart your streak by:\n• Sending messages\n• Joining voice channels\n• Running commands`
            );

            return interaction.reply({
                embeds: [noDataEmbed],
                ephemeral: targetUser.id === interaction.user.id
            });
        }

        // Build streak embed
        const embed = embeds.brand(
            `${getStreakEmoji(streakData.currentStreak)} Activity Streak`,
            `Showing activity stats for ${targetUser.id === interaction.user.id ? 'you' : targetUser.username}`
        );

        embed.addFields(
            {
                name: '🔥 Current Streak',
                value: `**${streakData.currentStreak}** day${streakData.currentStreak !== 1 ? 's' : ''}`,
                inline: true
            },
            {
                name: '🏆 Longest Streak',
                value: `**${streakData.longestStreak}** day${streakData.longestStreak !== 1 ? 's' : ''}`,
                inline: true
            },
            {
                name: '📅 Total Active Days',
                value: `**${streakData.totalActiveDays}** day${streakData.totalActiveDays !== 1 ? 's' : ''}`,
                inline: true
            }
        );

        // Streak freeze info
        const freezeStatus = streakData.freezesAvailable > 0
            ? `✅ **${streakData.freezesAvailable}** freeze available`
            : '❌ No freezes available';

        embed.addFields({
            name: '🛡️ Streak Freeze',
            value: `${freezeStatus}\n*Resets monthly on the 1st*`,
            inline: false
        });

        // Show last activity date
        if (streakData.lastActivityDate) {
            const lastActive = new Date(streakData.lastActivityDate);
            const today = new Date().toISOString().split('T')[0];
            const isToday = streakData.lastActivityDate === today;

            embed.addFields({
                name: '📍 Last Active',
                value: isToday ? '**Today**' : `<t:${Math.floor(lastActive.getTime() / 1000)}:R>`,
                inline: false
            });
        }

        // Show achievements with rarity and points
        if (streakData.achievements && streakData.achievements.length > 0) {
            const totalPoints = streakData.achievements.reduce((sum, a) => sum + (a.points || 0), 0);

            const achievementList = streakData.achievements
                .slice(0, 10) // Show max 10
                .map(a => {
                    const rarityEmoji = getRarityEmoji(a.rarity);
                    const roleIndicator = a.grantRole ? ' 👑' : '';
                    return `${a.emoji} **${a.title}**${roleIndicator} - ${rarityEmoji} ${a.rarity} (${a.points}pts)`;
                })
                .join('\n');

            const moreText = streakData.achievements.length > 10
                ? `\n*...and ${streakData.achievements.length - 10} more*`
                : '';

            embed.addFields({
                name: `🏅 Achievements (${streakData.achievements.length}) • ${totalPoints.toLocaleString()} pts`,
                value: achievementList + moreText,
                inline: false
            });
        }

        // Add tips if no achievements yet
        if (!streakData.achievements || streakData.achievements.length === 0) {
            embed.addFields({
                name: '💡 Tip',
                value: 'Keep up your daily activity to unlock achievements!',
                inline: false
            });
        }

        embed.setThumbnail(targetUser.displayAvatarURL());
        embed.setFooter({ text: `Keep your streak alive by staying active daily!` });

        await interaction.reply({
            embeds: [embed],
            ephemeral: targetUser.id === interaction.user.id
        });

    } catch (error) {
        logger.error('Error viewing streak:', error);
        await interaction.reply({
            embeds: [embeds.error('Error', 'Failed to fetch streak data. Please try again.')],
            flags: [MessageFlags.Ephemeral]
        });
    }
}

/**
 * Handle /streak leaderboard
 */
async function handleLeaderboard(interaction, client) {
    const type = interaction.options.getString('type') || 'current';

    if (!client.activityStreakService) {
        return interaction.reply({
            embeds: [embeds.error('Service Unavailable', 'The activity streak system is currently unavailable.')],
            flags: [MessageFlags.Ephemeral]
        });
    }

    try {
        // Handle achievement-based leaderboards
        if (type === 'achievements' || type === 'points' || type === 'rare') {
            return await handleAchievementLeaderboard(interaction, client, type);
        }

        // Original streak leaderboards
        const leaderboard = await client.activityStreakService.getLeaderboard(
            interaction.guild.id,
            type,
            10
        );

        if (leaderboard.length === 0) {
            return interaction.reply({
                embeds: [embeds.info('No Data', 'No streak data available yet. Start your streak by being active!')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        const title = type === 'longest' ? '🏆 Longest Streaks Leaderboard' : '🔥 Current Streaks Leaderboard';
        const embed = embeds.brand(title, `Top ${leaderboard.length} members in ${interaction.guild.name}`);

        let description = '';
        for (let i = 0; i < leaderboard.length; i++) {
            const entry = leaderboard[i];
            const streakValue = type === 'longest' ? entry.longestStreak : entry.currentStreak;
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;

            // Try to fetch user
            let userMention = `<@${entry.userId}>`;
            try {
                const user = await client.users.fetch(entry.userId);
                if (user) {
                    userMention = `${user.username}`;
                }
            } catch (e) {
                // User not found or bot can't access, use mention
            }

            description += `${medal} ${userMention} - **${streakValue}** day${streakValue !== 1 ? 's' : ''}\n`;
        }

        embed.setDescription(description);
        embed.setFooter({ text: `Keep up your daily activity to climb the ranks!` });
        embed.setTimestamp();

        await interaction.reply({
            embeds: [embed]
        });

    } catch (error) {
        logger.error('Error showing leaderboard:', error);
        await interaction.reply({
            embeds: [embeds.error('Error', 'Failed to fetch leaderboard. Please try again.')],
            flags: [MessageFlags.Ephemeral]
        });
    }
}

/**
 * Handle achievement-based leaderboards
 */
async function handleAchievementLeaderboard(interaction, client, type) {
    try {
        const { db } = require('../../database');
        const { activityAchievements, achievementDefinitions } = require('../../database/schema');
        const { eq, sql } = require('drizzle-orm');

        await interaction.deferReply();

        if (type === 'achievements' || type === 'points') {
            // Query: Get top 10 users by achievement count or points
            const results = await db.all(sql`
                SELECT
                    userId,
                    COUNT(*) as achievementCount,
                    SUM(points) as totalPoints
                FROM activity_achievements
                WHERE guildId = ${interaction.guild.id}
                GROUP BY userId
                ORDER BY ${type === 'points' ? sql.raw('totalPoints') : sql.raw('achievementCount')} DESC
                LIMIT 10
            `);

            if (results.length === 0) {
                return interaction.editReply({
                    embeds: [embeds.info('No Data', 'No achievements earned yet in this server.')]
                });
            }

            const title = type === 'points'
                ? '🏆 Top Achievement Hunters (by Points)'
                : '🏆 Top Achievement Hunters (by Count)';

            const embed = embeds.brand(title, `Top ${results.length} members`);

            let description = '';
            for (let i = 0; i < results.length; i++) {
                const entry = results[i];
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;

                let displayName = `<@${entry.userId}>`;
                try {
                    const user = await client.users.fetch(entry.userId);
                    if (user) displayName = user.username;
                } catch (e) { }

                const value = type === 'points'
                    ? `${entry.totalPoints.toLocaleString()} pts`
                    : `${entry.achievementCount} achievement${entry.achievementCount !== 1 ? 's' : ''}`;

                description += `${medal} ${displayName} - **${value}**\n`;
            }

            embed.setDescription(description);
            embed.setFooter({ text: 'Keep earning achievements!' });
            embed.setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } else if (type === 'rare') {
            // Find rarest achievements (fewest holders)
            const allDefs = await db.select().from(achievementDefinitions);

            const achievementCounts = [];
            for (const def of allDefs) {
                const count = await db.all(sql`
                    SELECT COUNT(*) as count
                    FROM activity_achievements
                    WHERE guildId = ${interaction.guild.id}
                      AND achievementId = ${def.id}
                `);

                const holderCount = count[0]?.count || 0;
                if (holderCount > 0) {
                    achievementCounts.push({
                        definition: def,
                        holderCount
                    });
                }
            }

            // Sort by rarest (fewest holders)
            const sorted = achievementCounts
                .sort((a, b) => a.holderCount - b.holderCount)
                .slice(0, 10);

            if (sorted.length === 0) {
                return interaction.editReply({
                    embeds: [embeds.info('No Data', 'No achievements earned yet.')]
                });
            }

            const embed = embeds.brand('💎 Rarest Achievements', `Top ${sorted.length} in this server`);

            let description = '';
            for (let i = 0; i < sorted.length; i++) {
                const { definition, holderCount } = sorted[i];
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
                const rarityEmoji = getRarityEmoji(definition.rarity);

                description += `${medal} ${definition.emoji} **${definition.title}** ${rarityEmoji}\n`;
                description += `   *${holderCount} member${holderCount !== 1 ? 's' : ''} • ${definition.rarity}*\n\n`;
            }

            embed.setDescription(description);
            embed.setFooter({ text: 'Can you earn these rare achievements?' });
            embed.setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }

    } catch (error) {
        logger.error('Error showing achievement leaderboard:', error);
        await interaction.editReply({
            embeds: [embeds.error('Error', 'Failed to fetch leaderboard.')]
        });
    }
}

/**
 * Handle /streak achievements - Browse all achievements with pagination
 */
async function handleAchievements(interaction, client) {
    const category = interaction.options.getString('category') || 'all';
    const rarity = interaction.options.getString('rarity') || 'all';
    const filter = interaction.options.getString('filter') || 'all';

    if (!client.activityStreakService) {
        return interaction.reply({
            embeds: [embeds.error('Service Unavailable', 'The activity streak system is currently unavailable.')],
            flags: [MessageFlags.Ephemeral]
        });
    }

    try {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const manager = client.activityStreakService.achievementManager;
        await manager.loadDefinitions();

        // Get all achievements
        let achievements = Array.from(manager.achievements.values());

        // Apply category filter
        if (category !== 'all') {
            achievements = achievements.filter(a => a.category === category);
        }

        // Apply rarity filter
        if (rarity !== 'all') {
            achievements = achievements.filter(a => a.rarity === rarity);
        }

        // Apply earned/role filters
        if (filter !== 'all') {
            const { db } = require('../../database');
            const { activityAchievements } = require('../../database/schema');
            const { eq, and } = require('drizzle-orm');

            const userAchievements = await db.select()
                .from(activityAchievements)
                .where(and(
                    eq(activityAchievements.userId, interaction.user.id),
                    eq(activityAchievements.guildId, interaction.guild.id)
                ));

            const earnedIds = new Set(userAchievements.map(a => a.achievementId));

            if (filter === 'earned') {
                achievements = achievements.filter(a => earnedIds.has(a.id));
            } else if (filter === 'not_earned') {
                achievements = achievements.filter(a => !earnedIds.has(a.id));
            } else if (filter === 'with_roles') {
                achievements = achievements.filter(a => a.grantRole);
            }
        }

        if (achievements.length === 0) {
            return interaction.editReply({
                embeds: [embeds.info('No Achievements', 'No achievements match your filters.')]
            });
        }

        // Pagination
        const itemsPerPage = 5;
        const totalPages = Math.ceil(achievements.length / itemsPerPage);
        let currentPage = 0;

        const generateEmbed = async (page) => {
            const start = page * itemsPerPage;
            const end = start + itemsPerPage;
            const pageAchievements = achievements.slice(start, end);

            const embed = embeds.brand(
                '🏅 Achievement Browser',
                `Showing ${start + 1}-${Math.min(end, achievements.length)} of ${achievements.length}`
            );

            // Check which ones user has earned
            const { db } = require('../../database');
            const { activityAchievements } = require('../../database/schema');
            const { eq, and } = require('drizzle-orm');

            const userAchievements = await db.select()
                .from(activityAchievements)
                .where(and(
                    eq(activityAchievements.userId, interaction.user.id),
                    eq(activityAchievements.guildId, interaction.guild.id)
                ));

            const earnedIds = new Set(userAchievements.map(a => a.achievementId));

            for (const achievement of pageAchievements) {
                const rarityEmoji = getRarityEmoji(achievement.rarity);
                const earned = earnedIds.has(achievement.id) ? ' ✅' : '';
                const roleIndicator = achievement.grantRole ? ' 👑' : '';

                embed.addFields({
                    name: `${achievement.emoji} ${achievement.title}${earned}${roleIndicator}`,
                    value: `${achievement.description}\n${rarityEmoji} **${achievement.rarity}** • ${achievement.points} pts`,
                    inline: false
                });
            }

            embed.setFooter({ text: `Page ${page + 1}/${totalPages} • ✅ = Earned • 👑 = Grants Role` });
            return embed;
        };

        const generateButtons = (page) => {
            const prevButton = new ButtonBuilder()
                .setCustomId('achievements_prev')
                .setLabel('Previous')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(page === 0);

            const nextButton = new ButtonBuilder()
                .setCustomId('achievements_next')
                .setLabel('Next')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(page === totalPages - 1);

            return new ActionRowBuilder().addComponents(prevButton, nextButton);
        };

        const embed = await generateEmbed(currentPage);
        const buttons = generateButtons(currentPage);

        const message = await interaction.editReply({
            embeds: [embed],
            components: totalPages > 1 ? [buttons] : []
        });

        if (totalPages > 1) {
            const collector = message.createMessageComponentCollector({ time: 300000 }); // 5 min

            collector.on('collect', async (i) => {
                if (i.user.id !== interaction.user.id) {
                    return i.reply({
                        embeds: [embeds.error('Not Your Menu', 'This browser belongs to someone else.')],
                        flags: [MessageFlags.Ephemeral]
                    });
                }

                if (i.customId === 'achievements_next') {
                    currentPage++;
                } else if (i.customId === 'achievements_prev') {
                    currentPage--;
                }

                const newEmbed = await generateEmbed(currentPage);
                const newButtons = generateButtons(currentPage);

                await i.update({
                    embeds: [newEmbed],
                    components: [newButtons]
                });
            });

            collector.on('end', () => {
                message.edit({ components: [] }).catch(() => { });
            });
        }

    } catch (error) {
        logger.error('Error showing achievements:', error);
        await interaction.editReply({
            embeds: [embeds.error('Error', 'Failed to load achievements.')]
        });
    }
}

/**
 * Handle /streak progress - Show progress toward next milestones
 */
async function handleProgress(interaction, client) {
    const targetUser = interaction.options.getUser('user') || interaction.user;

    if (!client.activityStreakService) {
        return interaction.reply({
            embeds: [embeds.error('Service Unavailable', 'The activity streak system is currently unavailable.')],
            flags: [MessageFlags.Ephemeral]
        });
    }

    try {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const streakData = await client.activityStreakService.getUserStreak(
            targetUser.id,
            interaction.guild.id
        );

        const totals = await client.activityStreakService.getUserTotals(
            targetUser.id,
            interaction.guild.id
        );

        const embed = embeds.brand(
            '📊 Achievement Progress',
            `Showing progress for ${targetUser.id === interaction.user.id ? 'you' : targetUser.username}`
        );

        if (!streakData || !totals) {
            embed.setDescription('No activity data yet. Start your journey!');
            return interaction.editReply({ embeds: [embed] });
        }

        // Find next streak milestone
        const streakMilestones = [3, 5, 7, 10, 14, 21, 30, 45, 60, 90, 120, 150, 180, 270, 365, 500, 730, 1000];
        const nextStreak = streakMilestones.find(m => m > streakData.currentStreak) || 1000;
        embed.addFields({
            name: '🔥 Next Streak Milestone',
            value: `${createProgressBar(streakData.currentStreak, nextStreak)}\n**${streakData.currentStreak}** / **${nextStreak}** days`,
            inline: false
        });

        // Find next total days milestone
        const totalMilestones = [30, 50, 100, 150, 250, 365, 500, 750, 1000, 1500];
        const nextTotal = totalMilestones.find(m => m > streakData.totalActiveDays) || 1500;
        embed.addFields({
            name: '📅 Next Total Days Milestone',
            value: `${createProgressBar(streakData.totalActiveDays, nextTotal)}\n**${streakData.totalActiveDays}** / **${nextTotal}** days`,
            inline: false
        });

        // Find next message milestone
        const messageMilestones = [100, 500, 1000, 5000, 10000, 25000, 50000, 100000];
        const nextMessage = messageMilestones.find(m => m > totals.totalMessages) || 100000;
        embed.addFields({
            name: '💬 Next Message Milestone',
            value: `${createProgressBar(totals.totalMessages, nextMessage)}\n**${totals.totalMessages.toLocaleString()}** / **${nextMessage.toLocaleString()}** messages`,
            inline: false
        });

        // Find next voice milestone
        const voiceHours = Math.floor(totals.totalVoiceMinutes / 60);
        const voiceMilestones = [10, 50, 100, 250, 500, 1000, 2500, 5000];
        const nextVoice = voiceMilestones.find(m => m > voiceHours) || 5000;
        embed.addFields({
            name: '🎤 Next Voice Milestone',
            value: `${createProgressBar(voiceHours, nextVoice)}\n**${voiceHours.toLocaleString()}** / **${nextVoice.toLocaleString()}** hours`,
            inline: false
        });

        // Achievement stats
        const achievementCount = streakData.achievements?.length || 0;
        const totalPoints = streakData.achievements?.reduce((sum, a) => sum + (a.points || 0), 0) || 0;

        embed.addFields({
            name: '🏅 Overall Progress',
            value: `**${achievementCount}**/82 achievements earned\n**${totalPoints.toLocaleString()}** total points`,
            inline: false
        });

        embed.setThumbnail(targetUser.displayAvatarURL());
        embed.setFooter({ text: 'Keep up the great work!' });

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        logger.error('Error showing progress:', error);
        await interaction.editReply({
            embeds: [embeds.error('Error', 'Failed to load progress data.')]
        });
    }
}

/**
 * Get rarity emoji indicator
 * @param {string} rarity - Achievement rarity
 * @returns {string} - Emoji
 */
function getRarityEmoji(rarity) {
    const rarityEmojis = {
        common: '⚪',
        uncommon: '🟢',
        rare: '🔵',
        epic: '🟣',
        legendary: '🟠',
        mythic: '🔴'
    };
    return rarityEmojis[rarity] || '⚪';
}

/**
 * Get emoji based on streak length
 * @param {number} streak - Current streak value
 * @returns {string} - Emoji
 */
function getStreakEmoji(streak) {
    if (streak === 0) return '💤';
    if (streak < 7) return '🔥';
    if (streak < 30) return '⚡';
    if (streak < 90) return '💪';
    if (streak < 365) return '🏆';
    return '👑';
}

/**
 * Create progress bar visual
 * @param {number} current - Current value
 * @param {number} target - Target value
 * @param {number} length - Bar length (default 10)
 * @returns {string} - Progress bar
 */
function createProgressBar(current, target, length = 10) {
    const percentage = Math.min(current / target, 1);
    const filled = Math.round(percentage * length);
    const empty = length - filled;

    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const percent = Math.round(percentage * 100);

    return `${bar} ${percent}%`;
}
