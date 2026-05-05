/**
 * Database Schema Synchronization Test
 * Ensures expectedSchema in database/index.js matches schema.js definitions
 */

const fs = require('fs');
const path = require('path');

// Parse the schema.js file to extract table names
function extractTableNamesFromSchema() {
    const schemaPath = path.join(__dirname, '../src/database/schema.js');
    const content = fs.readFileSync(schemaPath, 'utf8');

    // Match all sqliteTable definitions
    const tableMatches = content.matchAll(/const (\w+) = sqliteTable\('(\w+)'/g);
    const tables = {};

    for (const match of tableMatches) {
        tables[match[1]] = match[2]; // variableName -> tableName
    }

    return tables;
}

// Extract exported table names from schema.js
function extractExportedTables() {
    const schemaPath = path.join(__dirname, '../src/database/schema.js');
    const content = fs.readFileSync(schemaPath, 'utf8');

    // Match module.exports = { ... }
    const exportMatch = content.match(/module\.exports\s*=\s*\{([^}]+)\}/);
    if (!exportMatch) return [];

    // Extract exported variable names
    return exportMatch[1].split(',').map(s => s.trim()).filter(Boolean);
}

// Extract table names from expectedSchema in database/index.js
function extractExpectedSchemaTables() {
    const indexPath = path.join(__dirname, '../src/database/index.js');
    const content = fs.readFileSync(indexPath, 'utf8');

    // Match all table keys in expectedSchema
    const schemaMatch = content.match(/const expectedSchema\s*=\s*\{([\s\S]*?)\n\};/);
    if (!schemaMatch) return [];

    const tableMatches = schemaMatch[1].matchAll(/^\s{4}(\w+):\s*\{/gm);
    return Array.from(tableMatches).map(m => m[1]);
}

function extractSchemaTableColumns() {
    const schema = require('../src/database/schema');
    const tableNameSymbol = Symbol.for('drizzle:Name');
    const columnsSymbol = Symbol.for('drizzle:Columns');
    const tables = {};

    for (const exportedValue of Object.values(schema)) {
        if (!exportedValue || !exportedValue[tableNameSymbol] || !exportedValue[columnsSymbol]) {
            continue;
        }

        tables[exportedValue[tableNameSymbol]] = Object.values(exportedValue[columnsSymbol])
            .map(column => column.name)
            .sort();
    }

    return tables;
}

function extractExpectedSchemaColumns() {
    const indexPath = path.join(__dirname, '../src/database/index.js');
    const content = fs.readFileSync(indexPath, 'utf8');
    const schemaMatch = content.match(/const expectedSchema\s*=\s*\{([\s\S]*?)\n\};/);
    if (!schemaMatch) return {};

    const expected = {};
    const tableRegex = /^\s{4}(\w+):\s*\{([\s\S]*?)^\s{4}\},?/gm;
    let tableMatch;
    while ((tableMatch = tableRegex.exec(schemaMatch[1])) !== null) {
        const [, tableName, tableBody] = tableMatch;
        expected[tableName] = Array.from(tableBody.matchAll(/^\s{8}(\w+):\s*['"]/gm))
            .map(match => match[1])
            .sort();
    }

    return expected;
}

describe('Database Schema Synchronization', () => {
    test('expectedSchema should contain all tables from schema.js', () => {
        const schemaTables = extractTableNamesFromSchema();
        const expectedTables = extractExpectedSchemaTables();

        const schemaTableNames = Object.values(schemaTables);
        const missingTables = schemaTableNames.filter(t => !expectedTables.includes(t));

        if (missingTables.length > 0) {
            console.error('Tables in schema.js but missing from expectedSchema in database/index.js:');
            missingTables.forEach(t => console.error(`- ${t}`));
            console.error('Please add these tables to expectedSchema to enable auto-migration.');
        }

        expect(missingTables.length).toBe(0);
    });

    test('expectedSchema should not have extra tables not in schema.js', () => {
        const schemaTables = extractTableNamesFromSchema();
        const expectedTables = extractExpectedSchemaTables();

        const schemaTableNames = Object.values(schemaTables);
        const extraTables = expectedTables.filter(t => !schemaTableNames.includes(t));

        if (extraTables.length > 0) {
            console.error('Tables in expectedSchema but not in schema.js:');
            extraTables.forEach(t => console.error(`- ${t}`));
            console.error('Please remove these tables from expectedSchema or add them to schema.js.');
        }

        expect(extraTables.length).toBe(0);
    });

    test('expectedSchema object should exist in database/index.js', () => {
        const indexPath = path.join(__dirname, '../src/database/index.js');
        const content = fs.readFileSync(indexPath, 'utf8');

        expect(content).toContain('const expectedSchema');
        expect(content).toContain('validateAndFixSchema');
    });

    test('expectedSchema should contain all columns from schema.js', () => {
        const schemaColumns = extractSchemaTableColumns();
        const expectedColumns = extractExpectedSchemaColumns();

        const missing = [];
        for (const [tableName, columns] of Object.entries(schemaColumns)) {
            const expectedTableColumns = expectedColumns[tableName] || [];
            for (const columnName of columns) {
                if (!expectedTableColumns.includes(columnName)) {
                    missing.push(`${tableName}.${columnName}`);
                }
            }
        }

        if (missing.length > 0) {
            console.error('Columns in schema.js but missing from expectedSchema in database/index.js:');
            missing.forEach(column => console.error(`- ${column}`));
            console.error('Please add these columns to expectedSchema so existing databases can be auto-fixed.');
        }

        expect(missing).toEqual([]);
    });

    test('expectedSchema should not have extra columns not in schema.js', () => {
        const schemaColumns = extractSchemaTableColumns();
        const expectedColumns = extractExpectedSchemaColumns();

        const extra = [];
        for (const [tableName, columns] of Object.entries(expectedColumns)) {
            const schemaTableColumns = schemaColumns[tableName] || [];
            for (const columnName of columns) {
                if (!schemaTableColumns.includes(columnName)) {
                    extra.push(`${tableName}.${columnName}`);
                }
            }
        }

        if (extra.length > 0) {
            console.error('Columns in expectedSchema but not in schema.js:');
            extra.forEach(column => console.error(`- ${column}`));
            console.error('Please remove these columns from expectedSchema or add them to schema.js.');
        }

        expect(extra).toEqual([]);
    });
});
