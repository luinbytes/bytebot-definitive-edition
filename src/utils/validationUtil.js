/**
 * Input Validation Utilities
 * Provides validation functions to prevent SQL injection, path traversal, and other security issues
 */

/**
 * Validates SQL identifiers (table/column names) to prevent injection
 * Only allows alphanumeric characters and underscores, must start with letter or underscore
 *
 * @param {string} identifier - Table or column name to validate
 * @returns {boolean} - True if valid SQL identifier
 *
 * @example
 * isValidSQLIdentifier('users')        // true
 * isValidSQLIdentifier('user_table')   // true
 * isValidSQLIdentifier('users; DROP')  // false
 */
function isValidSQLIdentifier(identifier) {
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier);
}

/**
 * Validates SQL type definitions against whitelist
 * Prevents arbitrary SQL injection through column type definitions
 *
 * @param {string} type - SQL type definition to validate
 * @returns {boolean} - True if valid SQL type
 *
 * @example
 * isValidSQLType('INTEGER')                    // true
 * isValidSQLType('TEXT NOT NULL')              // true
 * isValidSQLType('TEXT; DROP TABLE users')     // false
 */
function isValidSQLType(type) {
    const allowedTypes = /^(INTEGER|TEXT|REAL|BLOB|BOOLEAN|TIMESTAMP)(\s+(PRIMARY KEY|NOT NULL|DEFAULT .+|UNIQUE|CHECK\(.+\)))*$/i;
    return allowedTypes.test(type.trim());
}

/**
 * Validates Discord snowflake IDs (user, channel, guild, message IDs)
 * Snowflakes are 17-19 digit integers
 *
 * @param {string} id - Snowflake ID to validate
 * @returns {boolean} - True if valid snowflake
 *
 * @example
 * isValidSnowflake('208026791749746690')  // true
 * isValidSnowflake('123abc')              // false
 * isValidSnowflake('12345')               // false (too short)
 */
function isValidSnowflake(id) {
    return /^\d{17,19}$/.test(id);
}

/**
 * Validates Discord channel ID
 * Alias for isValidSnowflake for semantic clarity
 *
 * @param {string} id - Channel ID to validate
 * @returns {boolean} - True if valid channel ID
 */
function isValidChannelId(id) {
    return isValidSnowflake(id);
}

/**
 * Validates Discord role ID
 * Alias for isValidSnowflake for semantic clarity
 *
 * @param {string} id - Role ID to validate
 * @returns {boolean} - True if valid role ID
 */
function isValidRoleId(id) {
    return isValidSnowflake(id);
}

/**
 * Validates hex color codes
 * Format: #RRGGBB (case-insensitive)
 *
 * @param {string} color - Color code to validate
 * @returns {boolean} - True if valid hex color
 *
 * @example
 * isValidHexColor('#8A2BE2')  // true
 * isValidHexColor('#fff')     // false (must be 6 digits)
 * isValidHexColor('8A2BE2')   // false (missing #)
 */
function isValidHexColor(color) {
    return /^#[0-9A-F]{6}$/i.test(color);
}

/**
 * Validates URLs
 * Uses native URL parser for comprehensive validation
 *
 * @param {string} url - URL to validate
 * @returns {boolean} - True if valid URL
 *
 * @example
 * isValidURL('https://example.com')        // true
 * isValidURL('not a url')                  // false
 */
function isValidURL(url) {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

/**
 * Sanitizes user input to prevent markdown injection
 * Escapes Discord markdown characters so user input displays literally
 *
 * @param {string} input - User input to sanitize
 * @returns {string} - Sanitized input safe for embed display
 *
 * @example
 * sanitizeInput('**bold**')     // '\\*\\*bold\\*\\*'
 * sanitizeInput('`code`')       // '\\`code\\`'
 */
function sanitizeInput(input) {
    if (typeof input !== 'string') return '';

    return input
        .replace(/\\/g, '\\\\')  // Backslash
        .replace(/\*/g, '\\*')   // Bold/italic
        .replace(/_/g, '\\_')    // Italic/underline
        .replace(/~/g, '\\~')    // Strikethrough
        .replace(/`/g, '\\`')    // Code
        .replace(/\|/g, '\\|');  // Spoiler
}

/**
 * Validates ISO 8601 date strings
 * Ensures date string is valid and properly formatted
 *
 * @param {string} dateStr - Date string to validate
 * @returns {boolean} - True if valid ISO date
 *
 * @example
 * isValidISODate('2026-01-04T12:00:00.000Z')  // true
 * isValidISODate('not a date')                // false
 */
function isValidISODate(dateStr) {
    const date = new Date(dateStr);
    return date instanceof Date && !isNaN(date) && dateStr === date.toISOString();
}

module.exports = {
    isValidSQLIdentifier,
    isValidSQLType,
    isValidSnowflake,
    isValidChannelId,
    isValidRoleId,
    isValidHexColor,
    isValidURL,
    sanitizeInput,
    isValidISODate
};
