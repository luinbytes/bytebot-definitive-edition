const { db } = require('../database');
const { sql } = require('drizzle-orm');
const { dbLog } = require('./dbLogger');
const logger = require('./logger');

/**
 * Database Utility Functions
 *
 * Consolidates common database operation patterns to reduce code duplication
 * and provide consistent error handling across the application.
 *
 * Key patterns:
 * - upsert: Get-or-create/conditional update
 * - insertIfNotExists: Duplicate prevention
 * - deleteIfOwner: Ownership verification
 * - getCount: Efficient SQL COUNT(*)
 * - getPaginatedResults: Unified pagination
 */

/**
 * Safely get table name for logging (prevents errors in error handlers)
 * @param {Object} table - Drizzle table reference
 * @returns {string} Table name or 'unknown'
 */
function getTableName(table) {
    try {
        return table?._config?.name || 'unknown';
    } catch {
        return 'unknown';
    }
}

/**
 * Upsert operation - Update if exists, insert if not
 *
 * @param {Object} table - Drizzle table reference
 * @param {Function} whereClause - Function that returns where condition (e.g., () => eq(table.id, value))
 * @param {Object} updateValues - Values to set on update
 * @param {Object} insertValues - Values to use on insert (defaults to updateValues if not provided)
 * @param {Object} metadata - Optional metadata for dbLog
 * @returns {Promise<Object>} { success: boolean, record: Object, created: boolean }
 */
async function upsert(table, whereClause, updateValues, insertValues = null, metadata = {}) {
    try {
        // Check if record exists
        const existing = await dbLog.select(getTableName(table),
            () => db.select()
                .from(table)
                .where(whereClause())
                .get(),
            { ...metadata, operation: 'upsert-check' }
        );

        if (existing) {
            // Update existing record
            await dbLog.update(getTableName(table),
                () => db.update(table)
                    .set(updateValues)
                    .where(whereClause()),
                { ...metadata, operation: 'upsert-update' }
            );

            return {
                success: true,
                record: { ...existing, ...updateValues },
                created: false
            };
        } else {
            // Insert new record
            const valuesToInsert = insertValues || updateValues;
            const result = await dbLog.insert(getTableName(table),
                () => db.insert(table)
                    .values(valuesToInsert)
                    .returning(),
                { ...metadata, operation: 'upsert-insert' }
            );

            return {
                success: true,
                record: result[0] || valuesToInsert,
                created: true
            };
        }
    } catch (error) {
        logger.error(`Failed to upsert in ${getTableName(table)}:`, error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Insert if record doesn't already exist (duplicate prevention)
 *
 * @param {Object} table - Drizzle table reference
 * @param {Function} whereClause - Function that returns where condition for duplicate check
 * @param {Object} values - Values to insert if not exists
 * @param {Object} metadata - Optional metadata for dbLog
 * @param {string} duplicateMessage - Optional custom duplicate error message
 * @returns {Promise<Object>} { success: boolean, record?: Object, duplicate?: boolean, error?: string }
 */
async function insertIfNotExists(table, whereClause, values, metadata = {}, duplicateMessage = null) {
    try {
        // Check for existing record
        const existing = await dbLog.select(getTableName(table),
            () => db.select()
                .from(table)
                .where(whereClause())
                .get(),
            { ...metadata, operation: 'duplicate-check' }
        );

        if (existing) {
            return {
                success: false,
                duplicate: true,
                error: duplicateMessage || 'A record with these criteria already exists.'
            };
        }

        // Insert new record
        const result = await dbLog.insert(getTableName(table),
            () => db.insert(table)
                .values(values)
                .returning(),
            { ...metadata, operation: 'insert-if-not-exists' }
        );

        return {
            success: true,
            record: result[0] || values,
            duplicate: false
        };
    } catch (error) {
        logger.error(`Failed to insert into ${getTableName(table)}:`, error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Delete record with ownership verification
 *
 * @param {Object} table - Drizzle table reference
 * @param {Function} whereClause - Function that returns where condition including ownership check
 * @param {string} recordId - ID of record being deleted (for logging)
 * @param {string} userId - User ID attempting deletion
 * @param {Object} metadata - Optional metadata for dbLog
 * @returns {Promise<Object>} { success: boolean, deleted?: boolean, error?: string }
 */
async function deleteIfOwner(table, whereClause, recordId, userId, metadata = {}) {
    try {
        // Verify record exists and user owns it
        const record = await dbLog.select(getTableName(table),
            () => db.select()
                .from(table)
                .where(whereClause())
                .get(),
            { ...metadata, recordId, userId, operation: 'ownership-check' }
        );

        if (!record) {
            return {
                success: false,
                deleted: false,
                error: 'Record not found or you do not have permission to delete it.'
            };
        }

        // Delete the record
        await dbLog.delete(getTableName(table),
            () => db.delete(table)
                .where(whereClause()),
            { ...metadata, recordId, userId, operation: 'delete-if-owner' }
        );

        return {
            success: true,
            deleted: true
        };
    } catch (error) {
        logger.error(`Failed to delete from ${getTableName(table)}:`, error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Get record count using efficient SQL COUNT(*)
 *
 * PERFORMANCE CRITICAL: Use this instead of .all().then(arr => arr.length)
 * Can be 10-100x faster for large result sets
 *
 * @param {Object} table - Drizzle table reference
 * @param {Function} whereClause - Function that returns where condition (optional)
 * @param {Object} metadata - Optional metadata for dbLog
 * @returns {Promise<number>} Count of matching records
 */
async function getCount(table, whereClause = null, metadata = {}) {
    try {
        let query = db.select({ count: sql`count(*)` }).from(table);

        if (whereClause) {
            query = query.where(whereClause());
        }

        const result = await dbLog.select(getTableName(table),
            () => query.get(),
            { ...metadata, operation: 'count' }
        );

        return result?.count || 0;
    } catch (error) {
        logger.error(`Failed to count in ${getTableName(table)}:`, error);
        return 0;
    }
}

/**
 * Get paginated results with total count
 *
 * @param {Object} table - Drizzle table reference
 * @param {Function} whereClause - Function that returns where condition (optional)
 * @param {Function} orderBy - Function that returns order by clause
 * @param {number} limit - Number of records per page
 * @param {number} offset - Number of records to skip
 * @param {Object} metadata - Optional metadata for dbLog
 * @returns {Promise<Object>} { results: Array, total: number, hasMore: boolean }
 */
async function getPaginatedResults(table, whereClause = null, orderBy, limit, offset, metadata = {}) {
    try {
        // Build base query
        let resultsQuery = db.select().from(table);

        if (whereClause) {
            resultsQuery = resultsQuery.where(whereClause());
        }

        if (orderBy) {
            resultsQuery = resultsQuery.orderBy(orderBy());
        }

        resultsQuery = resultsQuery.limit(limit).offset(offset);

        // Get results
        const results = await dbLog.select(getTableName(table),
            () => resultsQuery.all(),
            { ...metadata, limit, offset, operation: 'paginated-results' }
        );

        // Get total count efficiently
        const total = await getCount(table, whereClause, { ...metadata, operation: 'paginated-count' });

        return {
            results,
            total,
            hasMore: (offset + results.length) < total
        };
    } catch (error) {
        logger.error(`Failed to get paginated results from ${getTableName(table)}:`, error);
        return {
            results: [],
            total: 0,
            hasMore: false,
            error: error.message
        };
    }
}

/**
 * Get a single record by where clause
 *
 * @param {Object} table - Drizzle table reference
 * @param {Function} whereClause - Function that returns where condition
 * @param {Object} metadata - Optional metadata for dbLog
 * @returns {Promise<Object|null>} Record or null if not found
 */
async function getOne(table, whereClause, metadata = {}) {
    try {
        return await dbLog.select(getTableName(table),
            () => db.select()
                .from(table)
                .where(whereClause())
                .get(),
            { ...metadata, operation: 'get-one' }
        );
    } catch (error) {
        logger.error(`Failed to get record from ${getTableName(table)}:`, error);
        return null;
    }
}

/**
 * Get multiple records by where clause
 *
 * @param {Object} table - Drizzle table reference
 * @param {Function} whereClause - Function that returns where condition (optional)
 * @param {Function} orderBy - Function that returns order by clause (optional)
 * @param {number} limit - Optional limit (optional)
 * @param {Object} metadata - Optional metadata for dbLog
 * @returns {Promise<Array>} Array of records
 */
async function getMany(table, whereClause = null, orderBy = null, limit = null, metadata = {}) {
    try {
        let query = db.select().from(table);

        if (whereClause) {
            query = query.where(whereClause());
        }

        if (orderBy) {
            query = query.orderBy(orderBy());
        }

        if (limit) {
            query = query.limit(limit);
        }

        return await dbLog.select(getTableName(table),
            () => query.all(),
            { ...metadata, operation: 'get-many' }
        );
    } catch (error) {
        logger.error(`Failed to get records from ${getTableName(table)}:`, error);
        return [];
    }
}

module.exports = {
    upsert,
    insertIfNotExists,
    deleteIfOwner,
    getCount,
    getPaginatedResults,
    getOne,
    getMany
};
