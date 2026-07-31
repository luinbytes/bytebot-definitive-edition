const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const { suggestions } = require('../src/database/schema');

let mockDb;
let mockChannel;
const mockDbProxy = {
    insert: (...args) => mockDb.insert(...args),
    select: (...args) => mockDb.select(...args),
    update: (...args) => mockDb.update(...args),
    delete: (...args) => mockDb.delete(...args)
};

jest.mock('../src/database', () => ({ db: mockDbProxy }));
jest.mock('../src/utils/discordApiUtil', () => ({
    fetchChannel: jest.fn().mockImplementation(() => mockChannel),
    safeMessageFetch: jest.fn()
}));

const suggestionCommand = require('../src/commands/administration/suggestion');

test('rolls back a suggestion when its Discord message cannot be sent', async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
        CREATE TABLE suggestion_config (
            guild_id TEXT PRIMARY KEY,
            channel_id TEXT NOT NULL,
            review_role_id TEXT,
            enabled INTEGER DEFAULT 1 NOT NULL,
            allow_anonymous INTEGER DEFAULT 0 NOT NULL
        );
        CREATE TABLE suggestions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            content TEXT NOT NULL,
            message_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            status TEXT DEFAULT 'pending' NOT NULL,
            upvotes INTEGER DEFAULT 0,
            downvotes INTEGER DEFAULT 0,
            reviewed_by TEXT,
            reviewed_at INTEGER,
            review_reason TEXT,
            created_at INTEGER,
            anonymous INTEGER DEFAULT 0 NOT NULL
        );
        INSERT INTO suggestion_config (guild_id, channel_id) VALUES ('guild-1', 'channel-1');
    `);
    mockDb = drizzle(sqlite);
    mockChannel = {
        permissionsFor: jest.fn().mockReturnValue({ has: jest.fn().mockReturnValue(true) }),
        send: jest.fn().mockRejectedValue(new Error('Discord unavailable')),
        toString: () => '<#channel-1>'
    };
    const interaction = {
        options: {
            getSubcommand: () => 'submit',
            getString: () => 'Make it better',
            getBoolean: () => false
        },
        guild: { id: 'guild-1', members: { me: {} } },
        user: { id: 'user-1', toString: () => '<@user-1>' },
        deferReply: jest.fn(),
        editReply: jest.fn()
    };

    await expect(suggestionCommand.execute(interaction)).rejects.toThrow('Discord unavailable');

    expect(await mockDb.select().from(suggestions)).toHaveLength(0);
    sqlite.close();
});
