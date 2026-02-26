const embeds = require('./embeds');

/**
 * Format duration in human-readable format
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration (e.g., "2h 34m", "45m", "30s")
 */
function formatDuration(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
    return `${minutes}m`;
}

/**
 * Generate a session summary embed for a BytePod
 * @param {Object} data - Session data
 * @param {string} data.podName - Name of the pod
 * @param {string} data.ownerId - Final owner ID
 * @param {string} data.guildId - Guild ID
 * @param {Date} data.startedAt - When the pod was created
 * @param {Date} data.endedAt - When the pod was deleted
 * @param {number} data.peakUsers - Peak concurrent users
 * @param {number} data.uniqueVisitors - Unique visitor count
 * @param {Array<{userId: string, durationSeconds: number}>} data.userDurations - Per-user durations
 * @returns {import('discord.js').EmbedBuilder}
 */
function createSummaryEmbed(data) {
    // Convert both to timestamps (handle both Date objects and Unix timestamps)
    const startTime = data.startedAt instanceof Date ? data.startedAt.getTime() : data.startedAt;
    const endTime = data.endedAt instanceof Date ? data.endedAt.getTime() : data.endedAt;
    const duration = Math.floor((endTime - startTime) / 1000);

    // Sort users by duration (top 5)
    const sortedUsers = [...data.userDurations].sort((a, b) => b.durationSeconds - a.durationSeconds);

    // Build top talkers list (max 5)
    let topTalkersText = '';
    for (let i = 0; i < Math.min(5, sortedUsers.length); i++) {
        const { userId, durationSeconds } = sortedUsers[i];
        topTalkersText += `• <@${userId}> - ${formatDuration(durationSeconds)}\n`;
    }

    const embed = embeds.brand('BytePod Session Summary', `Your pod "${data.podName}" has ended.`);
    embed.addFields(
        { name: 'Duration', value: formatDuration(duration), inline: true },
        { name: 'Unique Visitors', value: `${data.uniqueVisitors}`, inline: true },
        { name: 'Peak Users', value: `${data.peakUsers}`, inline: true }
    );

    if (topTalkersText) {
        embed.addFields({ name: 'Top Talkers', value: topTalkersText, inline: false });
    }

    embed.setFooter({ text: 'Thanks for using BytePods!' });
    embed.setTimestamp(data.endedAt);

    return embed;
}

module.exports = { createSummaryEmbed, formatDuration };
