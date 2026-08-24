const fs = require('fs');
const os = require('os');
const path = require('path');
const { Events, PermissionFlagsBits } = require('discord.js');

describe('EventLoggingService', () => {
    let database;
    let service;
    let tempDir;
    let now;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-event-logs-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        now = Date.UTC(2026, 7, 24, 12);
        const EventLoggingService = require('../src/services/eventLoggingService');
        service = new EventLoggingService({
            sqlite: database.sqlite,
            client: { guilds: { cache: new Map() } },
            now: () => now
        });
    });

    afterEach(() => {
        database.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function guild(channels) {
        return {
            id: 'guild1',
            members: { me: { permissions: { has: () => true }, permissionsIn: () => ({ has: () => true }) } },
            channels: { cache: new Map(channels.map(channel => [channel.id, channel])), fetch: jest.fn() }
        };
    }

    test('same-module fan-out delivers each event once per configured channel', async () => {
        const first = { id: 'channel1', send: jest.fn().mockResolvedValue({}) };
        const second = { id: 'channel2', send: jest.fn().mockResolvedValue({}) };
        const server = guild([first, second]);
        service.client.guilds.cache.set(server.id, server);
        service.add(server, first, 'message');
        service.add(server, second, 'messages');

        await service.log(server, 'messages', 'messageDelete:1', { title: 'Deleted', description: 'content' });
        await service.log(server, 'messages', 'messageDelete:1', { title: 'Deleted', description: 'content' });

        expect(first.send).toHaveBeenCalledTimes(1);
        expect(second.send).toHaveBeenCalledTimes(1);
        expect(database.sqlite.prepare(`SELECT status, COUNT(*) AS count FROM event_log_outbox GROUP BY status`).get())
            .toEqual({ status: 'sent', count: 2 });
    });

    test('typed ignores suppress matching events and the channel cap counts distinct channels', async () => {
        const channels = Array.from({ length: 16 }, (_, index) => ({ id: `channel${index}`, send: jest.fn() }));
        const server = guild(channels);
        for (const channel of channels.slice(0, 15)) service.add(server, channel, 'messages');
        service.add(server, channels[0], 'members');
        expect(() => service.add(server, channels[15], 'messages')).toThrow('15');

        database.sqlite.prepare(`
            INSERT INTO event_log_ignores (guild_id, target_type, target_id, created_at)
            VALUES ('guild1', 'member', 'user1', 1)
        `).run();
        expect(await service.log(server, 'messages', 'message:ignored', { actorId: 'user1' })).toBe(0);
        expect(database.sqlite.prepare(`SELECT 1 FROM event_log_outbox WHERE event_key = 'message:ignored'`).get()).toBeUndefined();
    });

    test('remove-all confirmation is actor-bound, one-use, and bound to its exact plan', async () => {
        const channel = { id: 'channel1', send: jest.fn() };
        const addedLater = { id: 'channel2', send: jest.fn() };
        const server = guild([channel, addedLater]);
        service.add(server, channel, 'messages');
        const permissions = { has: permission => permission === PermissionFlagsBits.ManageGuild };
        const reply = jest.fn();
        await service.execute({
            guildId: 'guild1', guild: server, user: { id: 'admin1' }, member: { permissions }, reply,
            options: { getSubcommand: () => 'remove', getChannel: () => null, getString: () => null }
        });
        const customId = reply.mock.calls[0][0].components[0].components[0].data.custom_id;
        service.add(server, addedLater, 'members');
        const component = { customId, guildId: 'guild1', user: { id: 'admin1' }, member: { permissions }, update: jest.fn() };
        await service.handleInteraction(component);
        expect(database.sqlite.prepare(`SELECT module, channel_id FROM event_log_channels`).all())
            .toEqual([{ module: 'members', channel_id: 'channel2' }]);
        await expect(service.handleInteraction(component)).rejects.toThrow('expired');
    });

    test('the shared adapter routes human events and rejects bot-authored loops', async () => {
        const adapter = require('../src/events/eventLogging');
        const log = jest.fn();
        const guild = { id: 'guild1' };
        const client = { eventLoggingService: { log }, guilds: { cache: new Map() } };
        const message = {
            id: 'message1', guild, guildId: guild.id, channelId: 'channel1', content: 'deleted',
            author: { id: 'user1', bot: false }
        };
        await adapter.execute(Events.MessageDelete, message, client);
        expect(log).toHaveBeenCalledWith(guild, 'messages', 'messageDelete:message1', expect.objectContaining({
            actorId: 'user1', channelId: 'channel1'
        }));
        message.author.bot = true;
        await adapter.execute(Events.MessageDelete, message, client);
        expect(log).toHaveBeenCalledTimes(1);
    });

    test('membership event keys distinguish later rejoin cycles', async () => {
        const adapter = require('../src/events/eventLogging');
        const log = jest.fn();
        const guild = { id: 'guild1' };
        const client = { eventLoggingService: { log }, guilds: { cache: new Map() } };
        await adapter.execute(Events.GuildMemberAdd, { id: 'user1', joinedTimestamp: 100, guild, user: { bot: false } }, client);
        await adapter.execute(Events.GuildMemberRemove, { id: 'user1', joinedTimestamp: 100, guild, user: { bot: false } }, client);
        await adapter.execute(Events.GuildMemberAdd, { id: 'user1', joinedTimestamp: 200, guild, user: { bot: false } }, client);

        expect(log.mock.calls.map(call => call[2])).toEqual([
            'guildMemberAdd:user1:100', 'guildMemberRemove:user1:100', 'guildMemberAdd:user1:200'
        ]);
    });

    test('startup safely retries an ambiguously claimed delivery with the stable nonce', async () => {
        const channel = { id: 'channel1', send: jest.fn().mockResolvedValue({}) };
        const server = guild([channel]);
        service.client.guilds.cache.set(server.id, server);
        database.sqlite.prepare(`
            INSERT INTO event_log_outbox
                (guild_id, event_key, channel_id, module, payload, attempts, next_attempt_at, status, created_at)
            VALUES ('guild1', 'event1', 'channel1', 'messages', '{"title":"Event","description":"Body","color":"#8A2BE2"}', 1, 1, 'sending', 1)
        `).run();
        const EventLoggingService = require('../src/services/eventLoggingService');
        const recovered = new EventLoggingService({ sqlite: database.sqlite, client: service.client, now: () => now });
        await recovered.processOutbox();
        expect(channel.send).toHaveBeenCalledWith(expect.objectContaining({
            enforceNonce: true, nonce: expect.any(String)
        }));
        expect(database.sqlite.prepare(`SELECT status FROM event_log_outbox WHERE event_key = 'event1'`).get())
            .toEqual({ status: 'sent' });
    });

    test('failed deliveries stop after three exponential retry attempts', async () => {
        const channel = { id: 'channel1', send: jest.fn().mockRejectedValue(new Error('no access')) };
        const server = guild([channel]);
        service.client.guilds.cache.set(server.id, server);
        service.add(server, channel, 'messages');
        await service.log(server, 'messages', 'message:retry', {});
        now += 1000;
        await service.processOutbox();
        now += 2000;
        await service.processOutbox();

        expect(channel.send).toHaveBeenCalledTimes(3);
        expect(database.sqlite.prepare(`SELECT status, attempts FROM event_log_outbox WHERE event_key = 'message:retry'`).get())
            .toEqual({ status: 'failed', attempts: 3 });
    });
});
