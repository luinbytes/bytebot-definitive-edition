const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const { Collection, ChannelType } = require('discord.js');

let mockDb;
const mockDbProxy = {
    insert: (...args) => mockDb.insert(...args),
    select: (...args) => mockDb.select(...args),
    update: (...args) => mockDb.update(...args),
    delete: (...args) => mockDb.delete(...args)
};

jest.mock('../src/database', () => ({ db: mockDbProxy }));
jest.mock('../src/utils/ephemeralHelper', () => ({
    shouldBeEphemeral: jest.fn().mockResolvedValue(false)
}));

const statsCommand = require('../src/commands/utility/stats');

describe('/stats server', () => {
    let sqlite;

    beforeEach(() => {
        sqlite = new Database(':memory:');
        sqlite.exec(`
            CREATE TABLE users (
                id TEXT PRIMARY KEY,
                guild_id TEXT NOT NULL,
                commands_run INTEGER DEFAULT 0
            );
            CREATE TABLE activity_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                guild_id TEXT NOT NULL,
                activity_date TEXT NOT NULL,
                message_count INTEGER DEFAULT 0 NOT NULL,
                voice_minutes INTEGER DEFAULT 0 NOT NULL,
                commands_run INTEGER DEFAULT 0 NOT NULL
                ,reactions_given INTEGER DEFAULT 0 NOT NULL
            );
            CREATE TABLE moderation_cases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                case_number INTEGER NOT NULL,
                target_id TEXT NOT NULL,
                executor_id TEXT NOT NULL,
                action TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE bytepods (
                channel_id TEXT PRIMARY KEY,
                guild_id TEXT NOT NULL,
                owner_id TEXT NOT NULL
            );
            CREATE TABLE bytepod_voice_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                guild_id TEXT NOT NULL,
                total_seconds INTEGER DEFAULT 0,
                session_count INTEGER DEFAULT 0
            );
            CREATE TABLE server_daily_metrics (
                guild_id TEXT NOT NULL,
                activity_date TEXT NOT NULL,
                message_count INTEGER DEFAULT 0 NOT NULL,
                reaction_count INTEGER DEFAULT 0 NOT NULL,
                voice_seconds INTEGER DEFAULT 0 NOT NULL,
                joins INTEGER DEFAULT 0 NOT NULL,
                leaves INTEGER DEFAULT 0 NOT NULL,
                member_count INTEGER,
                baseline_at INTEGER,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (guild_id, activity_date)
            );

            INSERT INTO users (id, guild_id, commands_run) VALUES
                ('user-1', 'guild-a', 9),
                ('user-2', 'guild-b', 4);
            INSERT INTO activity_logs
                (user_id, guild_id, activity_date, message_count, voice_minutes, commands_run, reactions_given)
            VALUES
                ('user-1', 'guild-a', '2026-07-30', 12, 5, 2, 4),
                ('user-2', 'guild-a', '2026-07-30', 8, 3, 1, 2),
                ('user-1', 'guild-b', '2026-07-30', 99, 90, 7, 50);
            INSERT INTO server_daily_metrics
                (guild_id, activity_date, message_count, reaction_count, voice_seconds,
                 joins, leaves, member_count, baseline_at, updated_at)
            VALUES
                ('guild-a', '2026-07-30', 20, 6, 480, 2, 1, 2, 1, 1),
                ('guild-b', '2026-07-30', 99, 50, 5400, 0, 0, 1, 1, 1);
        `);
        mockDb = drizzle(sqlite);
    });

    afterEach(() => sqlite.close());

    test('reports command activity from only the current guild', async () => {
        const channels = new Collection([
            ['text', { type: ChannelType.GuildText }],
            ['voice', { type: ChannelType.GuildVoice }]
        ]);
        const editReply = jest.fn();
        const interaction = {
            options: {
                getSubcommand: () => 'server',
                getBoolean: () => null,
                getInteger: () => 60,
                getString: () => 'all'
            },
            guild: {
                id: 'guild-a',
                name: 'Guild A',
                memberCount: 2,
                channels: { cache: channels },
                roles: { cache: new Collection([['everyone', {}]]) },
                emojis: { cache: new Collection() },
                premiumTier: 0,
                premiumSubscriptionCount: 0,
                verificationLevel: 0,
                createdTimestamp: Date.UTC(2020, 0, 1),
                iconURL: () => null,
                fetchOwner: jest.fn().mockResolvedValue(null)
            },
            client: { users: { fetch: jest.fn() } },
            deferReply: jest.fn(),
            editReply
        };

        await statsCommand.execute(interaction);

        const embed = editReply.mock.calls[0][0].embeds[0];
        const commandsField = embed.data.fields.find(field => field.name === 'Commands Run');
        expect(commandsField.value).toBe('3 (2 users)');
        expect(embed.data.fields.find(field => field.name === 'Messages').value).toBe('20');
        expect(embed.data.fields.find(field => field.name === 'Reactions').value).toBe('6');
        expect(embed.data.fields.find(field => field.name === 'Voice').value).toBe('8 minutes');
        expect(embed.data.fields.find(field => field.name === 'Last 60 Days · stored since 2026-07-30').value)
            .toBe('3 commands');
    });
});
