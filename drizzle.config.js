/** @type { import("drizzle-kit").Config } */
module.exports = {
    schema: "./src/database/schema.js",
    out: "./drizzle",
    dialect: "sqlite",
    dbCredentials: {
        url: "sqlite.db",
    }
};
