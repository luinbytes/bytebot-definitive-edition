const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');

let mockDb;
let rawSqlite;
const mockDbProxy = {
    insert: (...args) => mockDb.insert(...args),
    select: (...args) => mockDb.select(...args),
    update: (...args) => mockDb.update(...args),
    delete: (...args) => mockDb.delete(...args)
};

const sqliteProxy = { prepare: (...args) => rawSqlite.prepare(...args) };

jest.mock('../src/database', () => ({ db: mockDbProxy, sqlite: sqliteProxy }));

const modactions = require('../src/commands/context-menus/modactions');

describe('moderation history context menu', () => {
    let sqlite;

    beforeEach(() => {
        sqlite = new Database(':memory:');
        rawSqlite = sqlite;
        sqlite.exec(`
            CREATE TABLE moderation_cases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                case_number INTEGER NOT NULL,
                guild_id TEXT NOT NULL,
                target_id TEXT NOT NULL,
                executor_id TEXT NOT NULL,
                action TEXT NOT NULL,
                reason TEXT,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            INSERT INTO moderation_cases
                (case_number, guild_id, target_id, executor_id, action, reason, status, created_at)
            VALUES
                (1, 'guild-a', 'target-1', 'mod-a', 'WARN', 'Guild A reason', 'completed', 1000),
                (1, 'guild-b', 'target-1', 'mod-b', 'BAN', 'Guild B secret', 'completed', 2000);
        `);
        mockDb = drizzle(sqlite);
    });

    afterEach(() => sqlite.close());

    test('shows only history from the current guild', async () => {
        const editReply = jest.fn();
        await modactions.handleButton({
            customId: 'mod_history_target-1',
            guild: { id: 'guild-a' },
            deferReply: jest.fn(),
            editReply
        });

        const embed = editReply.mock.calls[0][0].embeds[0];
        expect(embed.data.fields).toHaveLength(1);
        expect(embed.data.fields[0].value).toContain('Guild A reason');
        expect(embed.data.fields[0].value).not.toContain('Guild B secret');
    });
});
