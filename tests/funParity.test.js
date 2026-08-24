const fs = require('fs');
const os = require('os');
const path = require('path');

describe('snipe, roleplay, and persistent fun state', () => {
    let tempDir;
    let database;
    let service;
    let now;
    let http;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-fun-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        now = Date.UTC(2026, 0, 1, 12);
        http = { get: jest.fn() };
        const { FunService } = require('../src/services/funService');
        service = new FunService({ sqlite: database.sqlite, now: () => now, http });
    });

    afterEach(() => {
        service?.cleanup();
        database?.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('keeps only bounded, unprotected, recent snipe entries', () => {
        const message = index => ({
            id: `message-${index}`,
            guild: { id: 'guild1' },
            channelId: 'channel1',
            content: `message ${index}`,
            createdTimestamp: now - 1000,
            author: { id: 'user1', bot: false, username: 'User', displayAvatarURL: () => 'https://cdn.discordapp.com/a.png' },
            member: { displayName: 'Display' },
            webhookId: null,
            partial: false,
            system: false
        });

        for (let index = 0; index < 12; index++) service.captureDeleted(message(index));
        expect(service.getSnipe('channel1', 'deleted', 1).content).toBe('message 11');
        expect(service.getSnipe('channel1', 'deleted', 10).content).toBe('message 2');
        expect(service.getSnipe('channel1', 'deleted', 11)).toBeNull();

        service.setSnipeProtection('user1', true);
        expect(service.getSnipe('channel1', 'deleted', 1)).toBeNull();
        service.captureDeleted(message(13));
        expect(service.getSnipe('channel1', 'deleted', 1)).toBeNull();
        service.setSnipeProtection('user1', false);
        service.captureDeleted(message(14));
        now += 15 * 60 * 1000 + 1;
        expect(service.getSnipe('channel1', 'deleted', 1)).toBeNull();
    });

    test('captures pre-edit text and removed reactions while respecting both members', () => {
        const oldMessage = {
            id: 'message1', guild: { id: 'guild1' }, channelId: 'channel1', content: 'before',
            author: { id: 'author1', bot: false, username: 'Author', displayAvatarURL: () => null },
            member: { displayName: 'Author' }, partial: false, webhookId: null, system: false
        };
        service.captureEdited(oldMessage, { ...oldMessage, content: 'after' });
        expect(service.getSnipe('channel1', 'edited', 1)).toMatchObject({ content: 'before', editedContent: 'after' });

        const reaction = {
            emoji: { toString: () => '🔥' },
            message: { ...oldMessage, url: 'https://discord.com/channels/guild1/channel1/message1' }
        };
        service.captureReaction(reaction, { id: 'reactor1', bot: false, username: 'Reactor' });
        expect(service.getSnipe('channel1', 'reaction', 1)).toMatchObject({ emoji: '🔥', actorId: 'reactor1' });

        service.setSnipeProtection('reactor1', true);
        expect(service.getSnipe('channel1', 'reaction', 1)).toBeNull();
    });

    test('persists roleplay toggles and atomic action counts', () => {
        expect(service.isRoleplayEnabled('guild1', 'hug')).toBe(true);
        expect(service.toggleRoleplay('guild1', 'hug', 'admin1')).toBe(false);
        expect(service.isRoleplayEnabled('guild1', 'hug')).toBe(false);
        expect(service.toggleRoleplay('guild1', 'hug', 'admin1')).toBe(true);
        expect(service.recordRoleplay('guild1', 'actor1', 'target1', 'hug')).toBe(1);
        expect(service.recordRoleplay('guild1', 'actor1', 'target1', 'hug')).toBe(2);
    });

    test('validates and attributes provider responses without following returned URLs', async () => {
        http.get.mockResolvedValue({
            data: { results: [{ url: 'https://nekos.best/api/v2/hug/12345678-1234-1234-1234-123456789012.gif', anime_name: 'Example' }] }
        });
        await expect(service.fetchRoleplay('hug')).resolves.toEqual({
            url: 'https://nekos.best/api/v2/hug/12345678-1234-1234-1234-123456789012.gif',
            credit: 'NEKOSBEST • Example'
        });
        expect(http.get).toHaveBeenCalledWith('https://nekos.best/api/v2/hug?amount=1', expect.objectContaining({
            timeout: 5000,
            maxContentLength: 65536,
            headers: { 'User-Agent': 'ByteBot (https://github.com/luinbytes/bytebot-definitive-edition)' }
        }));

        http.get.mockResolvedValue({ data: { results: [{ url: 'https://evil.example/image.gif' }] } });
        await expect(service.fetchRoleplay('hug')).rejects.toThrow('invalid media');
        await expect(service.fetchRoleplay('fuck')).rejects.toThrow('unavailable');
    });

    test('persists bounded blunt and guild vape transitions', () => {
        expect(service.sparkBlunt('user1')).toMatchObject({ taps: 0 });
        expect(service.smokeBlunt('user1').taps).toBe(1);
        expect(service.bluntTaps('user1')).toBe(1);
        expect(() => service.sparkBlunt('user1')).toThrow('already sparked');
        now += 10 * 60 * 1000 + 1;
        expect(service.sparkBlunt('user1')).toMatchObject({ taps: 1 });

        expect(service.stealVape('guild1', 'user1')).toMatchObject({ holderId: 'user1', stolenFrom: null });
        expect(service.setVapeFlavor('guild1', 'user1', 'mint').flavor).toBe('mint');
        expect(service.hitVape('guild1', 'user1').hits).toBe(1);
        expect(service.stealVape('guild1', 'user2')).toMatchObject({ holderId: 'user2', stolenFrom: 'user1' });
        expect(() => service.hitVape('guild1', 'user1')).toThrow('not the current');
        expect(service.vapeHits('guild1')).toBe(1);
    });
});
