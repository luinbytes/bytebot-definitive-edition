const { sqliteTable, text, integer } = require('drizzle-orm/sqlite-core');

const guilds = sqliteTable('guilds', {
    id: text('id').primaryKey(), // Guild ID
    prefix: text('prefix').default('!'),
    logChannel: text('log_channel'),
    welcomeChannel: text('welcome_channel'),
    joinedAt: integer('joined_at', { mode: 'timestamp' }),
});

module.exports = { guilds };
