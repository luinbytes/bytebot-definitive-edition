const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');

let mockDb;
const mockDbProxy = {
    insert: (...args) => mockDb.insert(...args),
    select: (...args) => mockDb.select(...args),
    update: (...args) => mockDb.update(...args),
    delete: (...args) => mockDb.delete(...args)
};

jest.mock('../src/database', () => ({ db: mockDbProxy }));

const modactions = require('../src/commands/context-menus/modactions');

describe('moderation history context menu', () => {
    let sqlite;

    beforeEach(() => {
        sqlite = new Database(':memory:');
        sqlite.exec(`
            CREATE TABLE moderation_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                target_id TEXT NOT NULL,
                executor_id TEXT NOT NULL,
                action TEXT NOT NULL,
                reason TEXT,
                timestamp INTEGER
            );
            INSERT INTO moderation_logs
                (guild_id, target_id, executor_id, action, reason, timestamp)
            VALUES
                ('guild-a', 'target-1', 'mod-a', 'WARN', 'Guild A reason', 1000),
                ('guild-b', 'target-1', 'mod-b', 'BAN', 'Guild B secret', 2000);
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
