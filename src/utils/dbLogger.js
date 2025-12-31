const logger = require('./logger');

// Load config with local overrides
const config = require('./config');

/**
 * Database Logger Wrapper
 *
 * Provides logging for all database operations to aid in debugging and monitoring.
 * Logs operation type, table name, success/failure, and execution time.
 *
 * Logging can be toggled via config.json > logging.database
 *
 * Usage:
 *   const { logDbOperation } = require('./utils/dbLogger');
 *
 *   // Wrap any database operation
 *   const result = await logDbOperation(
 *       'SELECT',
 *       'users',
 *       () => db.select().from(users).where(eq(users.id, userId))
 *   );
 */

/**
 * Log and execute a database operation
 *
 * @param {string} operation - Operation type (SELECT, INSERT, UPDATE, DELETE, etc.)
 * @param {string} table - Table name being operated on
 * @param {Function} dbFunction - Async function that performs the database operation
 * @param {Object} context - Additional context for logging (userId, guildId, etc.)
 * @returns {Promise<any>} - Result from the database operation
 */
async function logDbOperation(operation, table, dbFunction, context = {}) {
    const startTime = Date.now();
    const operationId = Math.random().toString(36).substring(2, 9);
    const dbLoggingEnabled = config.logging?.database !== false;

    try {
        // Log the start of the operation (if enabled)
        if (dbLoggingEnabled) {
            const contextStr = Object.keys(context).length > 0
                ? ` | Context: ${JSON.stringify(context)}`
                : '';

            logger.debug(
                `[${operationId}] ${operation} on ${table}${contextStr}`,
                'DB'
            );
        }

        // Execute the database operation
        const result = dbFunction();

        // Check if it's a promise (async operation)
        if (result && typeof result.then === 'function') {
            const awaitedResult = await result;
            const duration = Date.now() - startTime;

            // Log successful completion with timing (if enabled)
            if (dbLoggingEnabled) {
                const resultInfo = Array.isArray(awaitedResult)
                    ? `${awaitedResult.length} rows`
                    : awaitedResult
                        ? '1 row'
                        : 'null';

                logger.debug(
                    `[${operationId}] ${operation} on ${table} ✓ (${duration}ms) - ${resultInfo}`,
                    'DB'
                );
            }

            return awaitedResult;
        } else {
            // Synchronous operation
            const duration = Date.now() - startTime;
            if (dbLoggingEnabled) {
                logger.debug(
                    `[${operationId}] ${operation} on ${table} ✓ (${duration}ms)`,
                    'DB'
                );
            }
            return result;
        }
    } catch (error) {
        const duration = Date.now() - startTime;

        // Log the error with full context (if enabled)
        if (dbLoggingEnabled) {
            logger.errorContext(
                `Database ${operation} failed on ${table}`,
                error,
                {
                    operationId,
                    duration: `${duration}ms`,
                    table,
                    operation,
                    ...context
                },
                'DB'
            );
        }

        // Re-throw the error to maintain normal error flow
        throw error;
    }
}

/**
 * Quick helper for SELECT operations
 */
async function logSelect(table, dbFunction, context) {
    return logDbOperation('SELECT', table, dbFunction, context);
}

/**
 * Quick helper for INSERT operations
 */
async function logInsert(table, dbFunction, context) {
    return logDbOperation('INSERT', table, dbFunction, context);
}

/**
 * Quick helper for UPDATE operations
 */
async function logUpdate(table, dbFunction, context) {
    return logDbOperation('UPDATE', table, dbFunction, context);
}

/**
 * Quick helper for DELETE operations
 */
async function logDelete(table, dbFunction, context) {
    return logDbOperation('DELETE', table, dbFunction, context);
}

/**
 * Convenience wrapper for common patterns
 *
 * @example
 * // Instead of:
 * const user = await db.select().from(users).where(eq(users.id, userId)).get();
 *
 * // Use:
 * const user = await dbLog.select('users',
 *     () => db.select().from(users).where(eq(users.id, userId)).get(),
 *     { userId }
 * );
 */
const dbLog = {
    select: logSelect,
    insert: logInsert,
    update: logUpdate,
    delete: logDelete,
    operation: logDbOperation
};

module.exports = {
    logDbOperation,
    logSelect,
    logInsert,
    logUpdate,
    logDelete,
    dbLog
};
