// Check media_gallery_config table schema
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DATABASE_URL || path.join(__dirname, 'sqlite.db');
const db = new Database(dbPath);

console.log('Checking media_gallery_config table schema...\n');

try {
    const tableInfo = db.prepare("PRAGMA table_info(media_gallery_config)").all();

    console.log('Columns in media_gallery_config table:');
    tableInfo.forEach(col => {
        console.log(`  ${col.cid}. ${col.name} (${col.type}) ${col.notnull ? 'NOT NULL' : 'NULL'} ${col.dflt_value ? `DEFAULT ${col.dflt_value}` : ''}`);
    });
} catch (error) {
    console.error('Error:', error.message);
}

db.close();
