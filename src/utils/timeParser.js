/**
 * Time Parser Utility
 *
 * Parses simple duration strings into timestamps
 * Supported formats: 10s, 30m, 2h, 5d, 1w, or compound like "2h 30m"
 */

const ONE_SECOND = 1000;
const ONE_MINUTE = 60000;
const ONE_HOUR = 3600000;
const ONE_DAY = 86400000;
const ONE_WEEK = 604800000;
const ONE_YEAR = 31536000000;

/**
 * Parse a time string into a future timestamp
 * @param {string} input - Duration string (e.g., "10m", "2h 30m")
 * @returns {Object} - { success: boolean, timestamp?: number, duration?: number, error?: string }
 */
function parseTime(input) {
    const regex = /(\d+)([smhdw])/g;
    let totalMs = 0;
    let match;

    while ((match = regex.exec(input.toLowerCase())) !== null) {
        const value = parseInt(match[1]);
        const unit = match[2];

        switch (unit) {
            case 's': totalMs += value * ONE_SECOND; break;
            case 'm': totalMs += value * ONE_MINUTE; break;
            case 'h': totalMs += value * ONE_HOUR; break;
            case 'd': totalMs += value * ONE_DAY; break;
            case 'w': totalMs += value * ONE_WEEK; break;
        }
    }

    // Validation: must have parsed something
    if (totalMs === 0) {
        return {
            success: false,
            error: 'Invalid time format. Examples: `10m`, `2h`, `3d`, `1w`, `2h 30m`'
        };
    }

    // Validation: max 1 year
    if (totalMs > ONE_YEAR) {
        return {
            success: false,
            error: 'Maximum reminder duration is 1 year.'
        };
    }

    const timestamp = Date.now() + totalMs;

    return {
        success: true,
        timestamp,
        duration: totalMs
    };
}

/**
 * Format a duration in milliseconds to a human-readable string
 * @param {number} ms - Duration in milliseconds
 * @returns {string} - Formatted string (e.g., "2 hours 30 minutes")
 */
function formatDuration(ms) {
    const parts = [];

    const weeks = Math.floor(ms / ONE_WEEK);
    if (weeks > 0) {
        parts.push(`${weeks} week${weeks > 1 ? 's' : ''}`);
        ms -= weeks * ONE_WEEK;
    }

    const days = Math.floor(ms / ONE_DAY);
    if (days > 0) {
        parts.push(`${days} day${days > 1 ? 's' : ''}`);
        ms -= days * ONE_DAY;
    }

    const hours = Math.floor(ms / ONE_HOUR);
    if (hours > 0) {
        parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
        ms -= hours * ONE_HOUR;
    }

    const minutes = Math.floor(ms / ONE_MINUTE);
    if (minutes > 0) {
        parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
        ms -= minutes * ONE_MINUTE;
    }

    const seconds = Math.floor(ms / ONE_SECOND);
    if (seconds > 0) {
        parts.push(`${seconds} second${seconds > 1 ? 's' : ''}`);
    }

    if (parts.length === 0) return '0 seconds';
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;

    // Join all but last with commas, then add "and" before last
    const last = parts.pop();
    return `${parts.join(', ')}, and ${last}`;
}

module.exports = {
    parseTime,
    formatDuration
};
