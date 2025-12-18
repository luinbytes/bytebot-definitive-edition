/** @type { import("drizzle-kit").Config } */
module.exports = {
    schema: "./src/database/schema.js",
    out: "./drizzle",
    driver: 'better-sqlite',
    dbCredentials: {
        url: "sqlite.db",
    }
};
