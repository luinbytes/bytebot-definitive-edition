/**
 * Validation Utility Tests
 * Tests input validation functions for security
 */

const { isValidSQLIdentifier, isValidSQLType, isValidSnowflake } = require('../src/utils/validationUtil');

describe('Validation Utility', () => {
    describe('isValidSQLIdentifier', () => {
        test('should accept valid table/column names', () => {
            expect(isValidSQLIdentifier('users')).toBe(true);
            expect(isValidSQLIdentifier('guild_members')).toBe(true);
            expect(isValidSQLIdentifier('_internal')).toBe(true);
            expect(isValidSQLIdentifier('table123')).toBe(true);
        });

        test('should reject SQL injection attempts', () => {
            expect(isValidSQLIdentifier('users; DROP TABLE users--')).toBe(false);
            expect(isValidSQLIdentifier('users OR 1=1')).toBe(false);
            expect(isValidSQLIdentifier('users/*comment*/')).toBe(false);
        });

        test('should reject names starting with numbers', () => {
            expect(isValidSQLIdentifier('123users')).toBe(false);
        });

        test('should reject names with special characters', () => {
            expect(isValidSQLIdentifier('users-table')).toBe(false);
            expect(isValidSQLIdentifier('users.table')).toBe(false);
            expect(isValidSQLIdentifier('users@table')).toBe(false);
        });

        test('should reject empty strings', () => {
            expect(isValidSQLIdentifier('')).toBe(false);
        });
    });

    describe('isValidSQLType', () => {
        test('should accept standard SQLite storage classes', () => {
            expect(isValidSQLType('TEXT')).toBe(true);
            expect(isValidSQLType('INTEGER')).toBe(true);
            expect(isValidSQLType('REAL')).toBe(true);
            expect(isValidSQLType('BLOB')).toBe(true);
            expect(isValidSQLType('BOOLEAN')).toBe(true);
            expect(isValidSQLType('TIMESTAMP')).toBe(true);
        });

        test('should accept types with constraints', () => {
            expect(isValidSQLType('TEXT NOT NULL')).toBe(true);
            expect(isValidSQLType('INTEGER PRIMARY KEY')).toBe(true);
            expect(isValidSQLType('TEXT UNIQUE')).toBe(true);
            expect(isValidSQLType('INTEGER DEFAULT 0')).toBe(true);
        });

        test('should reject non-SQLite types like VARCHAR and NUMERIC', () => {
            // SQLite doesn't have VARCHAR or NUMERIC as storage classes
            // (they're type affinities but not valid in our strict validation)
            expect(isValidSQLType('VARCHAR(255)')).toBe(false);
            expect(isValidSQLType('NUMERIC')).toBe(false);
        });

        test('should reject SQL injection in types', () => {
            expect(isValidSQLType('TEXT; DROP TABLE users--')).toBe(false);
            expect(isValidSQLType('INTEGER OR 1=1')).toBe(false);
        });

        test('should reject invalid type names', () => {
            expect(isValidSQLType('INVALID_TYPE')).toBe(false);
            expect(isValidSQLType('123')).toBe(false);
            expect(isValidSQLType('')).toBe(false);
        });
    });

    describe('isValidSnowflake', () => {
        test('should accept valid Discord snowflakes (17-19 digits)', () => {
            expect(isValidSnowflake('12345678901234567')).toBe(true); // 17 digits
            expect(isValidSnowflake('123456789012345678')).toBe(true); // 18 digits
            expect(isValidSnowflake('1234567890123456789')).toBe(true); // 19 digits
        });

        test('should reject snowflakes that are too short', () => {
            expect(isValidSnowflake('1234567890123456')).toBe(false); // 16 digits
            expect(isValidSnowflake('123')).toBe(false);
        });

        test('should reject snowflakes that are too long', () => {
            expect(isValidSnowflake('12345678901234567890')).toBe(false); // 20 digits
        });

        test('should reject non-numeric strings', () => {
            expect(isValidSnowflake('abc123')).toBe(false);
            expect(isValidSnowflake('123abc456')).toBe(false);
            expect(isValidSnowflake('123-456-789')).toBe(false);
        });

        test('should reject empty strings', () => {
            expect(isValidSnowflake('')).toBe(false);
        });

        test('should reject SQL injection attempts', () => {
            expect(isValidSnowflake('123456789012345678; DROP TABLE users')).toBe(false);
        });
    });
});
