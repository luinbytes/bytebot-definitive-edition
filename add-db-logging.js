/**
 * Script to add database logging to all files
 *
 * Usage: node add-db-logging.js <file-path>
 *
 * This script:
 * 1. Adds dbLog import if missing
 * 2. Wraps db.select/insert/update/delete calls with dbLog wrappers
 */

const fs = require('fs');
const path = require('path');

const filePath = process.argv[2];

if (!filePath) {
    console.error('Usage: node add-db-logging.js <file-path>');
    process.exit(1);
}

if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
}

let content = fs.readFileSync(filePath, 'utf8');
let modified = false;

// Step 1: Add dbLog import if missing
if (!content.includes("require('../../utils/dbLogger')") &&
    !content.includes("require('../utils/dbLogger')") &&
    !content.includes("require('./utils/dbLogger')")) {

    // Find the last require statement before module.exports
    const requireRegex = /const .+ = require\(['"](\.\.\/|\.\/)[^'"]+['"]\);/g;
    let lastRequireMatch;
    let match;

    while ((match = requireRegex.exec(content)) !== null) {
        if (content.indexOf('module.exports', match.index) > match.index) {
            lastRequireMatch = match;
        }
    }

    if (lastRequireMatch) {
        // Determine correct path based on file location
        let dbLoggerPath;
        if (filePath.includes('src\\commands\\')) {
            dbLoggerPath = '../../utils/dbLogger';
        } else if (filePath.includes('src\\events\\') || filePath.includes('src\\services\\')) {
            dbLoggerPath = '../utils/dbLogger';
        } else if (filePath.includes('src\\utils\\')) {
            dbLoggerPath = './dbLogger';
        } else {
            dbLoggerPath = '../../utils/dbLogger';
        }

        const insertPos = lastRequireMatch.index + lastRequireMatch[0].length;
        content = content.slice(0, insertPos) +
                  `\nconst { dbLog } = require('${dbLoggerPath}');` +
                  content.slice(insertPos);
        modified = true;
        console.log(`✓ Added dbLog import`);
    }
}

// Step 2: Count database operations
const dbOperations = {
    select: (content.match(/await db\.select\(\)/g) || []).length,
    insert: (content.match(/await db\.insert\(/g) || []).length,
    update: (content.match(/await db\.update\(/g) || []).length,
    delete: (content.match(/await db\.delete\(/g) || []).length
};

const total = Object.values(dbOperations).reduce((a, b) => a + b, 0);

if (total === 0) {
    console.log('No database operations found in this file.');
} else {
    console.log(`\nFound ${total} database operations:`);
    console.log(`  - SELECT: ${dbOperations.select}`);
    console.log(`  - INSERT: ${dbOperations.insert}`);
    console.log(`  - UPDATE: ${dbOperations.update}`);
    console.log(`  - DELETE: ${dbOperations.delete}`);
    console.log(`\nNote: This file requires MANUAL review to:`);
    console.log(`  1. Wrap each db operation with appropriate dbLog wrapper`);
    console.log(`  2. Add meaningful context (userId, guildId, etc.)`);
    console.log(`  3. Determine table name from the operation`);
}

if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`\n✓ File updated: ${filePath}`);
}

process.exit(0);
