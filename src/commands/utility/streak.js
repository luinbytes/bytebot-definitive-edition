const { SlashCommandBuilder } = require('discord.js');
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
                            { name: 'Longest Streak', value: 'longest' }
                        ))),
    category: 'Utility',
    cooldown: 3,

    async execute(interaction, client) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'view') {
            await handleView(interaction, client);
        } else if (subcommand === 'leaderboard') {
            await handleLeaderboard(interaction, client);
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
            ephemeral: true
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

        // Show achievements
        if (streakData.achievements && streakData.achievements.length > 0) {
            const achievementList = streakData.achievements
                .map(a => `${a.emoji} **${a.title}** - ${a.description}`)
                .join('\n');

            embed.addFields({
                name: `🏅 Achievements (${streakData.achievements.length})`,
                value: achievementList,
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
            ephemeral: true
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
            ephemeral: true
        });
    }

    try {
        const leaderboard = await client.activityStreakService.getLeaderboard(
            interaction.guild.id,
            type,
            10
        );

        if (leaderboard.length === 0) {
            return interaction.reply({
                embeds: [embeds.info('No Data', 'No streak data available yet. Start your streak by being active!')],
                ephemeral: true
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
            ephemeral: true
        });
    }
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
