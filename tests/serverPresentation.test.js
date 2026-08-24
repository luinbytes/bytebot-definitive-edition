const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const IMAGE_BUFFER = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlS4AAAAASUVORK5CYII=', 'base64');

describe('server presentation', () => {
    let tempDir;
    let database;
    let service;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-presentation-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        const { ServerPresentationService } = require('../src/services/serverPresentationService');
        service = new ServerPresentationService({
            sqlite: database.sqlite,
            now: () => 1000,
            randomUUID: () => 'preset-1',
            fetch: jest.fn(async () => ({
                ok: true,
                headers: { get: name => name === 'content-type' ? 'image/png' : String(IMAGE_BUFFER.length) },
                async *[Symbol.asyncIterator]() { yield IMAGE_BUFFER; }
            })),
            lookup: jest.fn(async () => [{ address: '93.184.216.34' }])
        });
    });

    afterEach(() => {
        database?.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('edits only the current guild-member profile within public limits', async () => {
        const editMe = jest.fn(async values => values);
        const guild = { id: 'guild1', members: { editMe } };

        await service.customize(guild, {
            nickname: 'Bytey', bio: 'Server helper',
            avatar: { url: 'https://cdn.discordapp.com/avatar.png', contentType: 'image/png', size: 4 }
        });

        expect(editMe).toHaveBeenCalledWith({
            nick: 'Bytey', bio: 'Server helper', avatar: IMAGE_BUFFER,
            reason: 'ByteBot server customization'
        });
        await expect(service.customize(guild, { nickname: 'x'.repeat(33) })).rejects.toThrow('32');
        await expect(service.customize(guild, { bio: 'x'.repeat(191) })).rejects.toThrow('190');
        await service.reset(guild);
        expect(editMe).toHaveBeenLastCalledWith({
            nick: null, avatar: null, banner: null, bio: null,
            reason: 'Reset ByteBot server customization'
        });
        await expect(service.image('http://[::ffff:127.0.0.1]/avatar.png')).rejects.toThrow('public address');
        await service.image('https://cdn.discordapp.com/avatar.png');
        expect(service.media.fetch).toHaveBeenLastCalledWith(expect.any(URL), expect.objectContaining({
            address: '93.184.216.34', family: 4
        }));
    });

    test('pins the validated address into the native HTTP lookup', async () => {
        const { pinnedFetch } = require('../src/services/serverPresentationService');
        const response = {};
        const request = { on: jest.fn() };
        const get = jest.spyOn(http, 'get').mockImplementation((_url, options, callback) => {
            const resolved = jest.fn();
            options.lookup('image.example', {}, resolved);
            expect(resolved).toHaveBeenCalledWith(null, '93.184.216.34', 4);
            callback(response);
            return request;
        });

        await expect(pinnedFetch(new URL('http://image.example/avatar.png'), {
            address: '93.184.216.34', family: 4
        })).resolves.toBe(response);
        expect(get).toHaveBeenCalledTimes(1);
        get.mockRestore();
    });

    test('creates, previews, applies, lists, and removes guild-scoped profile presets', async () => {
        const editMe = jest.fn(async values => values);
        const guild = {
            id: 'guild1',
            members: {
                me: {
                    nickname: 'Bytey', bio: 'Server helper',
                    avatarURL: jest.fn(() => 'https://cdn.discordapp.com/avatar.png'),
                    bannerURL: jest.fn(() => null)
                },
                editMe
            }
        };

        expect(service.createPreset(guild, 'Community', 'admin1')).toMatchObject({
            id: 'preset-1', guildId: 'guild1', name: 'Community', nickname: 'Bytey', bio: 'Server helper'
        });
        expect(service.listPresets('guild1')).toEqual([expect.objectContaining({ id: 'preset-1' })]);
        expect(service.previewPreset('guild1', 'preset-1')).toEqual(expect.objectContaining({
            nickname: 'Bytey', avatar: 'https://cdn.discordapp.com/avatar.png', banner: null, bio: 'Server helper'
        }));
        await expect(service.applyPreset(guild, 'preset-1', false)).rejects.toThrow('confirmation');
        await service.applyPreset(guild, 'preset-1', true);
        expect(editMe).toHaveBeenCalledWith(expect.objectContaining({ nick: 'Bytey', avatar: IMAGE_BUFFER }));
        expect(service.removePreset('guild1', 'preset-1')).toBe(true);
        expect(service.listPresets('guild1')).toEqual([]);
    });

    test('publishes only allowlisted guild data and enforces the one-hour bump cadence', async () => {
        const guild = {
            id: 'guild1', name: 'Community', description: 'A friendly server', memberCount: 42,
            iconURL: jest.fn(() => 'https://cdn.discordapp.com/icon.png')
        };

        await expect(service.publish(guild, {
            invite: 'https://discord.gg/community', inviteGuildId: 'guild1', tags: ['games', 'social'],
            banner: 'https://cdn.discordapp.com/banner.png', ownerId: 'must-not-leak'
        }, 'admin1')).resolves.toEqual(expect.objectContaining({
            guildId: 'guild1', name: 'Community', description: 'A friendly server', memberCount: 42,
            invite: 'https://discord.gg/community', tags: ['games', 'social'], bumpedAt: 1000
        }));
        expect(service.listListings('games')).toEqual([expect.not.objectContaining({ ownerId: expect.anything() })]);
        expect(() => service.bump('guild1', 'admin1')).toThrow('one hour');
        service.now = () => 3601000;
        expect(service.bump('guild1', 'admin1').bumpedAt).toBe(3601000);
        expect(service.removeListing('guild1')).toBe(true);
        expect(service.listListings()).toEqual([]);
        await expect(service.publish(guild, {
            invite: 'https://discord.gg/other', inviteGuildId: 'guild2', tags: []
        }, 'admin1')).rejects.toThrow('this server');
    });
});
