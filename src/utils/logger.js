const chalk = require('chalk');

function timestamp() {
    return new Date().toLocaleString();
}

/**
 * Format an error for detailed logging
 * Extracts message, stack trace, and any extra properties (like Discord API error details)
 */
function formatError(err) {
    if (!(err instanceof Error)) {
        return String(err);
    }

    const lines = [];

    // Main error message
    lines.push(`${err.name}: ${err.message}`);

    // Discord API error details
    if (err.code) lines.push(`  Code: ${err.code}`);
    if (err.status) lines.push(`  Status: ${err.status}`);
    if (err.method) lines.push(`  Method: ${err.method}`);
    if (err.url) lines.push(`  URL: ${err.url}`);
    if (err.requestBody?.json) {
        try {
            lines.push(`  Request Body: ${JSON.stringify(err.requestBody.json, null, 2).split('\n').map((l, i) => i === 0 ? l : '    ' + l).join('\n')}`);
        } catch { }
    }

    // Axios error details
    if (err.response?.status) lines.push(`  Response Status: ${err.response.status}`);
    if (err.response?.statusText) lines.push(`  Response Text: ${err.response.statusText}`);
    if (err.response?.data) {
        try {
            const data = typeof err.response.data === 'string' ? err.response.data : JSON.stringify(err.response.data);
            lines.push(`  Response Data: ${data.slice(0, 500)}`);
        } catch { }
    }

    // AggregateError (Promise.all rejections)
    if (err.errors && Array.isArray(err.errors)) {
        lines.push(`  Aggregated Errors (${err.errors.length}):`);
        err.errors.forEach((e, i) => {
            lines.push(`    [${i + 1}] ${e.name || 'Error'}: ${e.message}`);
            if (e.code) lines.push(`        Code: ${e.code}`);
            if (e.status) lines.push(`        Status: ${e.status}`);
        });
    }

    // Stack trace
    if (err.stack) {
        const stackLines = err.stack.split('\n').slice(1); // Skip first line (already have message)
        lines.push('  Stack Trace:');
        stackLines.forEach(line => lines.push(`  ${line}`));
    }

    return lines.join('\n');
}

const logger = {
    info: (msg) => console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.blue('[INFO]')} ${msg}`),
    success: (msg) => console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.green('[SUCCESS]')} ${msg}`),
    warn: (msg) => console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.yellow('[WARN]')} ${msg}`),
    error: (msg) => {
        // If it's an Error object, format it nicely with full details
        const formatted = msg instanceof Error ? formatError(msg) : msg;
        console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.red('[ERROR]')} ${formatted}`);
    },
    debug: (msg) => console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.magenta('[DEBUG]')} ${msg}`),

    /**
     * Log an error with additional context
     * @param {string} context - Description of where/what failed
     * @param {Error} error - The error object
     * @param {Object} details - Optional additional details to log
     */
    errorContext: (context, error, details = {}) => {
        console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.red('[ERROR]')} ${chalk.bold(context)}`);

        // Log any additional details
        if (Object.keys(details).length > 0) {
            console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.red('[ERROR]')}   Context Details:`);
            for (const [key, value] of Object.entries(details)) {
                const formatted = typeof value === 'object' ? JSON.stringify(value) : value;
                console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.red('[ERROR]')}     ${key}: ${formatted}`);
            }
        }

        // Log the full error
        if (error) {
            const formatted = error instanceof Error ? formatError(error) : error;
            console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.red('[ERROR]')} ${formatted}`);
        }
    }
};

module.exports = logger;
