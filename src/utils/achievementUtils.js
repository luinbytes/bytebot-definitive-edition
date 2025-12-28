/**
 * Achievement utility functions
 * Centralized helpers for achievement display and formatting
 */

/**
 * Achievement milestone constants
 */
const MILESTONES = {
    streak: [3, 5, 7, 10, 14, 21, 30, 45, 60, 90, 120, 150, 180, 270, 365, 500, 730, 1000],
    totalDays: [30, 50, 100, 150, 250, 365, 500, 750, 1000, 1500],
    messages: [100, 500, 1000, 5000, 10000, 25000, 50000, 100000],
    voiceHours: [10, 50, 100, 250, 500, 1000, 2500, 5000],
    commands: [50, 100, 500, 1000, 2500, 5000, 10000],
    reactions: [50, 100, 500, 1000, 2500, 5000]
};

/**
 * Achievement category definitions
 */
const CATEGORIES = {
    streak: { name: 'Streak Master', emoji: '🔥', description: 'Consecutive day achievements' },
    dedication: { name: 'Dedication', emoji: '📅', description: 'Total activity achievements' },
    social: { name: 'Social', emoji: '💬', description: 'Community interaction achievements' },
    voice: { name: 'Voice Champion', emoji: '🎤', description: 'Voice channel achievements' },
    explorer: { name: 'Explorer', emoji: '🗺️', description: 'Exploration achievements' },
    special: { name: 'Special', emoji: '⭐', description: 'Unique achievements' },
    combo: { name: 'Combo Master', emoji: '🎯', description: 'Multi-activity achievements' },
    meta: { name: 'Meta', emoji: '🏆', description: 'Achievement collector achievements' },
    seasonal: { name: 'Seasonal', emoji: '🎃', description: 'Limited-time event achievements' }
};

/**
 * Get rarity emoji indicator
 * @param {string} rarity - Achievement rarity (common, uncommon, rare, epic, legendary, mythic)
 * @returns {string} - Rarity emoji
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
 * Get category badge (emoji + name)
 * @param {string} category - Achievement category
 * @returns {string} - Formatted category badge
 */
function getCategoryBadge(category) {
    const cat = CATEGORIES[category];
    if (!cat) return '❓ Unknown';
    return `${cat.emoji} ${cat.name}`;
}

/**
 * Get user tier badge based on total achievement count
 * @param {number} achievementCount - Total achievements earned
 * @returns {Object} - { tier, emoji, name, color }
 */
function getTierBadge(achievementCount) {
    if (achievementCount >= 82) return { tier: 7, emoji: '👑', name: 'Legend', color: '#FFD700' };
    if (achievementCount >= 60) return { tier: 6, emoji: '💎', name: 'Master', color: '#00FFFF' };
    if (achievementCount >= 40) return { tier: 5, emoji: '🏆', name: 'Champion', color: '#FFA500' };
    if (achievementCount >= 25) return { tier: 4, emoji: '⭐', name: 'Expert', color: '#9B59B6' };
    if (achievementCount >= 15) return { tier: 3, emoji: '🌟', name: 'Advanced', color: '#3498DB' };
    if (achievementCount >= 8) return { tier: 2, emoji: '✨', name: 'Intermediate', color: '#2ECC71' };
    if (achievementCount >= 3) return { tier: 1, emoji: '🔰', name: 'Beginner', color: '#95A5A6' };
    return { tier: 0, emoji: '🥚', name: 'Newcomer', color: '#BDC3C7' };
}

/**
 * Get emoji based on streak length
 * @param {number} streak - Current streak value
 * @returns {string} - Streak emoji
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
 * Create visual progress bar
 * @param {number} current - Current value
 * @param {number} target - Target value
 * @param {number} length - Bar length (default 10)
 * @returns {string} - Progress bar with percentage
 */
function createProgressBar(current, target, length = 10) {
    const percentage = Math.min(current / target, 1);
    const filled = Math.round(percentage * length);
    const empty = length - filled;

    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const percent = Math.round(percentage * 100);

    return `${bar} ${percent}%`;
}

/**
 * Format date as relative time (e.g., "2 days ago", "in 3 hours")
 * @param {Date|string|number} date - Date to format
 * @returns {string} - Relative time string
 */
function formatRelativeTime(date) {
    const now = new Date();
    const targetDate = new Date(date);
    const diffMs = targetDate - now;
    const diffSeconds = Math.floor(Math.abs(diffMs) / 1000);
    const isPast = diffMs < 0;

    // Less than 1 minute
    if (diffSeconds < 60) {
        return isPast ? 'just now' : 'in a few seconds';
    }

    // Minutes
    const minutes = Math.floor(diffSeconds / 60);
    if (minutes < 60) {
        const text = minutes === 1 ? '1 minute' : `${minutes} minutes`;
        return isPast ? `${text} ago` : `in ${text}`;
    }

    // Hours
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        const text = hours === 1 ? '1 hour' : `${hours} hours`;
        return isPast ? `${text} ago` : `in ${text}`;
    }

    // Days
    const days = Math.floor(hours / 24);
    if (days < 30) {
        const text = days === 1 ? '1 day' : `${days} days`;
        return isPast ? `${text} ago` : `in ${text}`;
    }

    // Months
    const months = Math.floor(days / 30);
    if (months < 12) {
        const text = months === 1 ? '1 month' : `${months} months`;
        return isPast ? `${text} ago` : `in ${text}`;
    }

    // Years
    const years = Math.floor(months / 12);
    const text = years === 1 ? '1 year' : `${years} years`;
    return isPast ? `${text} ago` : `in ${text}`;
}

/**
 * Load achievement definitions from AchievementManager
 * @param {import('discord.js').Client} client - Discord client
 * @returns {Promise<Map<string, Object>>} - Map of achievement definitions
 */
async function loadAchievementDefinitions(client) {
    if (!client.activityStreakService) {
        throw new Error('ActivityStreakService not initialized');
    }

    const achievementManager = client.activityStreakService.achievementManager;
    await achievementManager.loadDefinitions();
    return achievementManager.achievements;
}

/**
 * Find next milestone in a milestone array
 * @param {number} current - Current value
 * @param {string} type - Milestone type (streak, totalDays, messages, voiceHours, commands, reactions)
 * @returns {number} - Next milestone value
 */
function getNextMilestone(current, type) {
    const milestones = MILESTONES[type];
    if (!milestones) return current + 1;

    const next = milestones.find(m => m > current);
    return next || milestones[milestones.length - 1];
}

/**
 * Get category description
 * @param {string} category - Achievement category
 * @returns {string} - Category description
 */
function getCategoryDescription(category) {
    return CATEGORIES[category]?.description || 'Unknown category';
}

/**
 * Format points with appropriate suffix
 * @param {number} points - Points value
 * @returns {string} - Formatted points (e.g., "1.2k", "50", "2.5M")
 */
function formatPoints(points) {
    if (points >= 1000000) {
        return `${(points / 1000000).toFixed(1)}M`;
    }
    if (points >= 1000) {
        return `${(points / 1000).toFixed(1)}k`;
    }
    return points.toLocaleString();
}

module.exports = {
    // Constants
    MILESTONES,
    CATEGORIES,

    // Core helpers
    getRarityEmoji,
    getCategoryBadge,
    getTierBadge,
    getStreakEmoji,
    createProgressBar,
    formatRelativeTime,

    // Achievement loading
    loadAchievementDefinitions,

    // Utility functions
    getNextMilestone,
    getCategoryDescription,
    formatPoints
};
