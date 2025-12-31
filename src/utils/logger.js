const chalk = require('chalk');
const fs = require('fs');
const path = require('path');

// Load config
let config;
try {
    config = require('../../config.json');
} catch (e) {
    config = { logging: { console: true, file: false, database: true, logDirectory: 'logs' } };
}

// Ensure logs directory exists
const logDir = path.join(process.cwd(), config.logging?.logDirectory || 'logs');
if (config.logging?.file && !fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

function timestamp() {
    return new Date().toLocaleString();
}

function timestampISO() {
    return new Date().toISOString();
}

function getLogFileName() {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(logDir, `bytebot-${date}.log`);
}

function writeToFile(level, message, module = null) {
    if (!config.logging?.file) return;

    try {
        const now = new Date();
        const timeStr = now.toISOString().replace('T', ' ').split('.')[0]; // YYYY-MM-DD HH:MM:SS
        const moduleTag = module ? `[${module}]` : '';
        const logLine = `[${timeStr}] [${level}] ${moduleTag}${moduleTag ? ' ' : ''}${message}\n`;

        fs.appendFileSync(getLogFileName(), logLine, 'utf8');
    } catch (error) {
        // Fail silently to avoid recursive logging errors
        console.error('Failed to write to log file:', error.message);
    }
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
    info: (msg, module = null) => {
        const moduleTag = module ? chalk.cyan(`[${module}]`) + ' ' : '';
        if (config.logging?.console) {
            console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.blue('[INFO]')} ${moduleTag}${msg}`);
        }
        writeToFile('INFO', msg, module);
    },
    success: (msg, module = null) => {
        const moduleTag = module ? chalk.cyan(`[${module}]`) + ' ' : '';
        if (config.logging?.console) {
            console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.green('[SUCCESS]')} ${moduleTag}${msg}`);
        }
        writeToFile('SUCCESS', msg, module);
    },
    warn: (msg, module = null) => {
        const moduleTag = module ? chalk.cyan(`[${module}]`) + ' ' : '';
        if (config.logging?.console) {
            console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.yellow('[WARN]')} ${moduleTag}${msg}`);
        }
        writeToFile('WARN', msg, module);
    },
    error: (msg, module = null) => {
        const moduleTag = module ? chalk.cyan(`[${module}]`) + ' ' : '';
        // If it's an Error object, format it nicely with full details
        const formatted = msg instanceof Error ? formatError(msg) : msg;
        if (config.logging?.console) {
            console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.red('[ERROR]')} ${moduleTag}${formatted}`);
        }
        writeToFile('ERROR', formatted, module);
    },
    debug: (msg, module = null) => {
        const moduleTag = module ? chalk.cyan(`[${module}]`) + ' ' : '';
        if (config.logging?.console) {
            console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.magenta('[DEBUG]')} ${moduleTag}${msg}`);
        }
        writeToFile('DEBUG', msg, module);
    },

    /**
     * Log an error with additional context
     * @param {string} context - Description of where/what failed
     * @param {Error} error - The error object
     * @param {Object} details - Optional additional details to log
     * @param {string} module - Optional module tag
     */
    errorContext: (context, error, details = {}, module = null) => {
        const moduleTag = module ? chalk.cyan(`[${module}]`) + ' ' : '';

        if (config.logging?.console) {
            console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.red('[ERROR]')} ${moduleTag}${chalk.bold(context)}`);

            // Log any additional details
            if (Object.keys(details).length > 0) {
                console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.red('[ERROR]')} ${moduleTag}  Context Details:`);
                for (const [key, value] of Object.entries(details)) {
                    const formatted = typeof value === 'object' ? JSON.stringify(value) : value;
                    console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.red('[ERROR]')} ${moduleTag}    ${key}: ${formatted}`);
                }
            }

            // Log the full error
            if (error) {
                const formatted = error instanceof Error ? formatError(error) : error;
                console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.red('[ERROR]')} ${moduleTag}${formatted}`);
            }
        }

        // Write to file
        writeToFile('ERROR', context, module);
        if (Object.keys(details).length > 0) {
            writeToFile('ERROR', `  Context Details: ${JSON.stringify(details, null, 2)}`, module);
        }
        if (error) {
            const formatted = error instanceof Error ? formatError(error) : error;
            writeToFile('ERROR', formatted, module);
        }
    }
};

module.exports = logger;
