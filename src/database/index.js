const { drizzle } = require('drizzle-orm/better-sqlite3');
const Database = require('better-sqlite3');
const schema = require('./schema');
require('dotenv').config();

const { migrate } = require('drizzle-orm/better-sqlite3/migrator');

const sqlite = new Database(process.env.DATABASE_URL || 'sqlite.db');
const db = drizzle(sqlite, { schema });

const runMigrations = async () => {
    // This will run migrations on the database, skipping the ones already applied
    await migrate(db, { migrationsFolder: './drizzle' });
};

module.exports = { db, sqlite, runMigrations };
