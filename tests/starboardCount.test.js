const mockDbLog = {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
};

jest.mock('../src/database', () => {
    const sqlite = new (require('better-sqlite3'))(':memory:');
    sqlite.exec(`
        CREATE TABLE starboard_config (
            guild_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL,
            threshold INTEGER NOT NULL, emoji TEXT NOT NULL, enabled INTEGER NOT NULL
        );
        CREATE TABLE starboard_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL,
            original_message_id TEXT NOT NULL UNIQUE, original_channel_id TEXT NOT NULL,
            starboard_message_id TEXT, author_id TEXT NOT NULL, star_count INTEGER NOT NULL,
            content TEXT, image_url TEXT, posted_at INTEGER NOT NULL
        );
    `);
    return { db: require('drizzle-orm/better-sqlite3').drizzle(sqlite), sqlite };
});
jest.mock('../src/utils/dbLogger', () => ({ dbLog: mockDbLog }));
jest.mock('../src/utils/logger', () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), success: jest.fn()
}));

const { Collection, ReactionUserManager } = require('discord.js');
const { db, sqlite } = require('../src/database');
const { starboardConfig, starboardMessages } = require('../src/database/schema');
const StarboardService = require('../src/services/starboardService');

function deferred() {
    let resolve;
    const promise = new Promise(res => { resolve = res; });
    return { promise, resolve };
}

function createStarboard() {
    const users = Array.from({ length: 3 }, (_, index) => ({ id: String(index + 10), bot: false }));
    const guild = { id: 'guild-1', name: 'Test guild', fetchOwner: jest.fn().mockResolvedValue(null) };
    const source = { id: 'channel-1', name: 'general', guild, isTextBased: () => true };
    const posted = { id: 'posted-1', edit: jest.fn().mockResolvedValue(undefined), embeds: [] };
    const board = {
        id: 'board-1',
        send: jest.fn().mockResolvedValue(posted),
        messages: {
            fetch: jest.fn().mockResolvedValue(posted),
            delete: jest.fn().mockResolvedValue(undefined)
        }
    };
    const client = {
        options: { makeCache: () => new Collection() },
        users: { _add: jest.fn(user => user) },
        channels: { fetch: jest.fn(async id => id === board.id ? board : source) },
        rest: { get: jest.fn(async (_route, { query }) => users
            .filter(user => !query.has('after') || BigInt(user.id) > BigInt(query.get('after')))
            .slice(0, Number(query.get('limit')))) }
    };
    const message = {
        id: 'message-1', guild, channel: source, channelId: source.id,
        author: { id: '1', tag: 'Author', displayAvatarURL: () => 'https://example.com/avatar.png' },
        content: 'A starred message', attachments: new Collection(),
        url: 'https://discord.com/channels/guild-1/channel-1/message-1', createdAt: new Date(),
        reactions: { cache: new Collection() }
    };
    const reaction = { message, client, emoji: { name: '⭐', identifier: encodeURIComponent('⭐') } };
    reaction.users = new ReactionUserManager(reaction);
    message.reactions.cache.set('⭐', reaction);
    source.messages = { fetch: jest.fn().mockResolvedValue(message) };
    db.insert(starboardConfig).values({
        guildId: guild.id, channelId: board.id, enabled: true, emoji: '⭐', threshold: 3
    }).run();
    return { service: new StarboardService(client), client, source, board, posted, message, reaction, users };
}

function seedEntry(starCount = 7, starboardMessageId = 'posted-1') {
    db.insert(starboardMessages).values({
        guildId: 'guild-1', originalMessageId: 'message-1', originalChannelId: 'channel-1',
        starboardMessageId, authorId: '1', starCount, postedAt: new Date()
    }).run();
    return db.select().from(starboardMessages).get();
}

describe('starboard updates through Discord and disposable database boundaries', () => {
    let fixture;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        sqlite.exec('DELETE FROM starboard_config; DELETE FROM starboard_messages;');
        for (const operation of Object.values(mockDbLog)) {
            operation.mockImplementation(async (_table, run) => run());
        }
        fixture = createStarboard();
    });

    afterEach(async () => {
        await fixture.service.cleanup();
        jest.useRealTimers();
    });

    test('coalesces new events during a deferred post into one serial recount', async () => {
        const { service, reaction, board, posted, users } = fixture;
        const send = deferred();
        board.send.mockReturnValueOnce(send.promise);
        try {
            await service.handleReactionAdd(reaction, users[0]);
            await jest.advanceTimersByTimeAsync(2000);
            expect(board.send).toHaveBeenCalledTimes(1);

            users.push({ id: '99', bot: false });
            for (let index = 0; index < 20; index++) {
                await service.handleReactionAdd(reaction, users[0]);
            }
            await jest.advanceTimersByTimeAsync(2000);
            expect(board.send).toHaveBeenCalledTimes(1);

            send.resolve(posted);
            await jest.advanceTimersByTimeAsync(0);
            expect(board.send).toHaveBeenCalledTimes(1);
            expect(posted.edit).toHaveBeenCalledTimes(1);
            expect(posted.edit.mock.calls[0][0].embeds[0].toJSON().title).toContain('⭐ 4');
            expect(db.select().from(starboardMessages).all()).toHaveLength(1);
        } finally {
            send.resolve(posted);
            await jest.advanceTimersByTimeAsync(0);
        }
    });

    test('counts more than 100 users without retaining pages in SDK caches', async () => {
        const { service, message, users, client, reaction, board } = fixture;
        users.splice(0, users.length, ...Array.from({ length: 205 }, (_, index) => ({
            id: String(index + 1), bot: index === 5 || index === 105
        })));

        await service.updateStarboardMessage(message.id, message.channel.id);

        expect(db.select().from(starboardMessages).get().starCount).toBe(202);
        expect(board.send.mock.calls[0][0].embeds[0].toJSON().title).toContain('⭐ 202');
        expect(client.rest.get).toHaveBeenCalledTimes(3);
        expect(client.rest.get.mock.calls.map(([, { query }]) => query.get('after'))).toEqual([null, '100', '200']);
        expect(reaction.users.cache.size).toBe(0);
        expect(client.users._add).not.toHaveBeenCalled();
    });

    test('continues beyond a full page of bots and ends an exact page boundary with large snowflakes', async () => {
        const { service, message, users, client } = fixture;
        const firstId = 9007199254740993n;
        users.splice(0, users.length, ...Array.from({ length: 200 }, (_, index) => ({
            id: String(firstId + BigInt(index)), bot: index < 100
        })));

        await expect(service.countValidStars(message, '⭐')).resolves.toBe(100);

        expect(client.rest.get).toHaveBeenCalledTimes(3);
        expect(client.rest.get.mock.calls.map(([, { query }]) => query.get('after'))).toEqual([
            null, String(firstId + 99n), String(firstId + 199n)
        ]);
        for (const [route, { query }] of client.rest.get.mock.calls) {
            expect(route).toBe('/channels/channel-1/messages/message-1/reactions/%E2%AD%90');
            expect(query.get('limit')).toBe('100');
            expect(query.get('type')).toBe('0');
        }
    });

    test('rejects a non-advancing page without changing a saved count or post', async () => {
        const { service, message, client, board, posted } = fixture;
        const saved = seedEntry();
        const stalePage = Array.from({ length: 100 }, (_, index) => ({ id: String(index + 10) }));
        client.rest.get.mockResolvedValue(stalePage);

        await service.updateStarboardMessage(message.id, message.channel.id);

        expect(client.rest.get).toHaveBeenCalledTimes(2);
        expect(db.select().from(starboardMessages).get()).toEqual(saved);
        expect(board.messages.delete).not.toHaveBeenCalled();
        expect(posted.edit).not.toHaveBeenCalled();
    });

    test.each([1, 2])('preserves the saved post and count when reaction user page %i fails', async failurePage => {
        const { service, message, client, board, posted, users } = fixture;
        const saved = seedEntry();
        users.splice(0, users.length, ...Array.from({ length: 105 }, (_, index) => ({ id: String(index + 10) })));
        const readPage = client.rest.get.getMockImplementation();
        if (failurePage === 2) client.rest.get.mockImplementationOnce(readPage);
        client.rest.get.mockRejectedValueOnce(new Error('Discord temporarily unavailable'));

        await service.updateStarboardMessage(message.id, message.channel.id);

        expect(db.select().from(starboardMessages).get()).toEqual(saved);
        expect(board.messages.delete).not.toHaveBeenCalled();
        expect(board.send).not.toHaveBeenCalled();
        expect(posted.edit).not.toHaveBeenCalled();
        expect(require('../src/utils/logger').error).toHaveBeenCalled();
    });

    test('bounds admission, timers, and concurrent REST work during a distinct-message burst', async () => {
        const { service, client } = fixture;
        const reads = Array.from({ length: 4 }, () => deferred());
        let active = 0;
        let peak = 0;
        client.channels.fetch.mockImplementation(() => {
            const read = reads[client.channels.fetch.mock.calls.length - 1];
            active++;
            peak = Math.max(peak, active);
            return (read ? read.promise : Promise.resolve(null)).finally(() => { active--; });
        });
        const admitted = Array.from({ length: 600 }, (_, index) => service.queueStarboardUpdate(`burst-${index}`, 'channel-1'));
        try {
            expect(service.updateQueue.size).toBe(500);
            expect(admitted.filter(Boolean)).toHaveLength(500);
            expect(jest.getTimerCount()).toBe(1);
            await jest.advanceTimersByTimeAsync(2000);
            expect(client.channels.fetch).toHaveBeenCalledTimes(4);
            expect(service.queueStarboardUpdate('burst-0', 'channel-1')).toBe(true);
            expect(service.queueStarboardUpdate('overflow', 'channel-1')).toBe(false);
            await jest.advanceTimersByTimeAsync(60000);
            expect(client.channels.fetch).toHaveBeenCalledTimes(4);
            expect(jest.getTimerCount()).toBe(0);

            reads.forEach(read => read.resolve(null));
            await jest.advanceTimersByTimeAsync(1000);
            expect(peak).toBe(4);
            expect(client.channels.fetch).toHaveBeenCalledTimes(501);
            expect(jest.getTimerCount()).toBe(0);
            expect(require('../src/utils/logger').warn).toHaveBeenCalledTimes(1);

            expect(service.queueStarboardUpdate('overflow', 'channel-1')).toBe(true);
            await jest.advanceTimersByTimeAsync(2000);
            expect(client.channels.fetch).toHaveBeenCalledTimes(502);
        } finally {
            reads.forEach(read => read.resolve(null));
            await jest.advanceTimersByTimeAsync(0);
        }
    });

    test('gives waiting messages a slot before repeating a dirty running message', async () => {
        const { service, source, message, board, posted } = fixture;
        const sends = Array.from({ length: 4 }, () => deferred());
        source.messages.fetch.mockImplementation(async id => ({ ...message, id }));
        sends.forEach(send => board.send.mockReturnValueOnce(send.promise));
        try {
            for (let index = 0; index < 6; index++) service.queueStarboardUpdate(`message-${index}`, source.id);
            await jest.advanceTimersByTimeAsync(2000);
            expect(board.send).toHaveBeenCalledTimes(4);
            service.queueStarboardUpdate('message-0', source.id);
            await jest.advanceTimersByTimeAsync(2000);
            sends[0].resolve(posted);
            await jest.advanceTimersByTimeAsync(1);

            expect(source.messages.fetch.mock.calls[4][0]).toBe('message-4');
        } finally {
            sends.forEach(send => send.resolve(posted));
            await jest.advanceTimersByTimeAsync(10);
        }
    });

    test('cleanup cancels pending work, drains running work, and refuses late admission', async () => {
        const { service, reaction, client, users } = fixture;
        const read = deferred();
        client.channels.fetch.mockReturnValueOnce(read.promise);
        await service.handleReactionAdd(reaction, users[0]);
        await jest.advanceTimersByTimeAsync(2000);
        expect(client.channels.fetch).toHaveBeenCalledTimes(1);
        service.queueStarboardUpdate('pending', 'channel-1');
        await service.handleReactionRemove(reaction, users[0]);
        let drained = false;
        const cleanup = service.cleanup().then(() => { drained = true; });
        try {
            expect(service.queueStarboardUpdate('late', 'channel-1')).toBe(false);
            await jest.advanceTimersByTimeAsync(10000);
            expect(jest.getTimerCount()).toBe(0);
            expect(client.channels.fetch).toHaveBeenCalledTimes(1);
            expect(drained).toBe(false);
        } finally {
            read.resolve(null);
            await cleanup;
        }
        await jest.advanceTimersByTimeAsync(10000);
        expect(drained).toBe(true);
        expect(client.channels.fetch).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('a config read completing after cleanup cannot restore cache or schedule work', async () => {
        const { service, reaction, users, client } = fixture;
        const read = deferred();
        mockDbLog.select.mockReturnValueOnce(read.promise);
        const event = service.handleReactionAdd(reaction, users[0]);
        await service.cleanup();
        read.resolve({ enabled: true, emoji: '⭐', channelId: 'board-1', threshold: 3 });
        await event;
        await jest.advanceTimersByTimeAsync(2000);

        expect(client.channels.fetch).not.toHaveBeenCalled();
        expect(service.configCache.size).toBe(0);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('keeps a recount debounced when an older post completes before newer events', async () => {
        const { service, reaction, board, posted, users, source } = fixture;
        const send = deferred();
        board.send.mockReturnValueOnce(send.promise);
        try {
            await service.handleReactionAdd(reaction, users[0]);
            await jest.advanceTimersByTimeAsync(2000);
            await jest.advanceTimersByTimeAsync(100);
            await service.handleReactionRemove(reaction, users[0]);
            send.resolve(posted);
            await jest.advanceTimersByTimeAsync(0);
            await jest.advanceTimersByTimeAsync(100);
            await service.handleReactionAdd(reaction, users[0]);

            await jest.advanceTimersByTimeAsync(1999);
            expect(source.messages.fetch).toHaveBeenCalledTimes(1);
            await jest.advanceTimersByTimeAsync(1);
            expect(source.messages.fetch).toHaveBeenCalledTimes(2);
            expect(posted.edit).toHaveBeenCalledTimes(1);
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            send.resolve(posted);
            await jest.advanceTimersByTimeAsync(0);
        }
    });

    test('posts, edits, removes below threshold, and reposts after gaining stars again', async () => {
        const { service, reaction, board, posted, users } = fixture;
        await service.handleReactionAdd(reaction, users[0]);
        await jest.advanceTimersByTimeAsync(1999);
        expect(board.send).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1);
        expect(board.send).toHaveBeenCalledTimes(1);
        expect(db.select().from(starboardMessages).get()).toMatchObject({ starCount: 3, starboardMessageId: posted.id });

        users.push({ id: '13' });
        await service.handleReactionAdd(reaction, users[0]);
        await jest.advanceTimersByTimeAsync(2000);
        expect(board.send).toHaveBeenCalledTimes(1);
        expect(posted.edit.mock.calls[0][0].embeds[0].toJSON().title).toContain('⭐ 4');

        users.length = 2;
        await service.handleReactionRemove(reaction, users[0]);
        await jest.advanceTimersByTimeAsync(2000);
        expect(board.messages.delete).toHaveBeenCalledWith(posted.id);
        expect(db.select().from(starboardMessages).get()).toMatchObject({ starCount: 2, starboardMessageId: null });

        users.push({ id: '13' });
        board.send.mockResolvedValueOnce({ id: 'posted-2' });
        await service.handleReactionAdd(reaction, users[0]);
        await jest.advanceTimersByTimeAsync(2000);
        expect(board.send).toHaveBeenCalledTimes(2);
        expect(db.select().from(starboardMessages).all()).toHaveLength(1);
        expect(db.select().from(starboardMessages).get()).toMatchObject({ starCount: 3, starboardMessageId: 'posted-2' });
    });

    test('retains below-threshold counts and retries a transient removal failure on another event', async () => {
        const { service, reaction, users, board, message } = fixture;
        seedEntry(4);
        users.length = 2;
        board.messages.delete.mockRejectedValueOnce(new Error('Discord temporarily unavailable'));

        await service.handleReactionRemove(reaction, users[0]);
        await jest.advanceTimersByTimeAsync(2000);
        expect(db.select().from(starboardMessages).get()).toMatchObject({ starCount: 2, starboardMessageId: 'posted-1' });

        await service.handleReactionRemove(reaction, users[0]);
        await jest.advanceTimersByTimeAsync(2000);
        expect(db.select().from(starboardMessages).get()).toMatchObject({ starCount: 2, starboardMessageId: null });

        message.reactions.cache.clear();
        await service.handleReactionRemove(reaction, users[0]);
        await jest.advanceTimersByTimeAsync(2000);
        expect(db.select().from(starboardMessages).get()).toMatchObject({ starCount: 0, starboardMessageId: null });
    });

    test('reconciles all-reaction removal that arrives while a post is still being sent', async () => {
        const { service, reaction, board, posted, message, users } = fixture;
        const send = deferred();
        board.send.mockReturnValueOnce(send.promise);
        try {
            await service.handleReactionAdd(reaction, users[0]);
            await jest.advanceTimersByTimeAsync(2000);
            message.reactions.cache.clear();
            await service.handleReactionRemoveAll(message, new Collection());
            send.resolve(posted);
            await jest.advanceTimersByTimeAsync(2000);

            expect(board.send).toHaveBeenCalledTimes(1);
            expect(board.messages.delete).toHaveBeenCalledWith(posted.id);
            expect(db.select().from(starboardMessages).get()).toMatchObject({ starCount: 0, starboardMessageId: null });
        } finally {
            send.resolve(posted);
            await jest.advanceTimersByTimeAsync(0);
        }
    });

    test('keeps NSFW filtering and recreates a manually deleted starboard post', async () => {
        const { service, reaction, users, source, board } = fixture;
        source.nsfw = true;
        board.nsfw = false;
        await service.handleReactionAdd(reaction, users[0]);
        await jest.advanceTimersByTimeAsync(2000);
        expect(board.send).not.toHaveBeenCalled();
        expect(db.select().from(starboardMessages).all()).toHaveLength(0);

        board.nsfw = true;
        await service.handleReactionAdd(reaction, users[0]);
        await jest.advanceTimersByTimeAsync(2000);
        expect(board.send).toHaveBeenCalledTimes(1);

        board.messages.fetch.mockResolvedValueOnce(null);
        board.send.mockResolvedValueOnce({ id: 'replacement-post' });
        await service.handleReactionAdd(reaction, users[0]);
        await jest.advanceTimersByTimeAsync(2000);
        expect(board.send).toHaveBeenCalledTimes(2);
        expect(db.select().from(starboardMessages).get().starboardMessageId).toBe('replacement-post');
    });

    test('preserves the original-message deletion warning', async () => {
        const { service, message, posted } = fixture;
        seedEntry();
        posted.embeds = [{ title: 'Stored starboard post' }];

        await service.handleMessageDelete(message);

        expect(posted.edit.mock.calls[0][0].embeds[0].toJSON()).toMatchObject({
            title: 'Stored starboard post', footer: { text: '⚠️ Original message deleted' }
        });
        expect(db.select().from(starboardMessages).get().starboardMessageId).toBe('posted-1');
    });
});
