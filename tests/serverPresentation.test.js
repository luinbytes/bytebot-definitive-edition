const fs = require('fs');
const os = require('os');
const path = require('path');

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
                headers: { get: name => name === 'content-type' ? 'image/png' : '4' },
                arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer
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
            nick: 'Bytey', bio: 'Server helper', avatar: Buffer.from([1, 2, 3, 4]),
            reason: 'ByteBot server customization'
        });
        await expect(service.customize(guild, { nickname: 'x'.repeat(33) })).rejects.toThrow('32');
        await expect(service.customize(guild, { bio: 'x'.repeat(191) })).rejects.toThrow('190');
        await service.reset(guild);
        expect(editMe).toHaveBeenLastCalledWith({
            nick: null, avatar: null, banner: null, bio: null,
            reason: 'Reset ByteBot server customization'
        });
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
        expect(editMe).toHaveBeenCalledWith(expect.objectContaining({ nick: 'Bytey', avatar: Buffer.from([1, 2, 3, 4]) }));
        expect(service.removePreset('guild1', 'preset-1')).toBe(true);
        expect(service.listPresets('guild1')).toEqual([]);
    });

    test('publishes only allowlisted guild data and enforces the one-hour bump cadence', () => {
        const guild = {
            id: 'guild1', name: 'Community', description: 'A friendly server', memberCount: 42,
            iconURL: jest.fn(() => 'https://cdn.discordapp.com/icon.png')
        };

        expect(service.publish(guild, {
            invite: 'https://discord.gg/community', inviteGuildId: 'guild1', tags: ['games', 'social'],
            banner: 'https://cdn.discordapp.com/banner.png', ownerId: 'must-not-leak'
        }, 'admin1')).toEqual(expect.objectContaining({
            guildId: 'guild1', name: 'Community', description: 'A friendly server', memberCount: 42,
            invite: 'https://discord.gg/community', tags: ['games', 'social'], bumpedAt: 1000
        }));
        expect(service.listListings('games')).toEqual([expect.not.objectContaining({ ownerId: expect.anything() })]);
        expect(() => service.bump('guild1', 'admin1')).toThrow('one hour');
        service.now = () => 3601000;
        expect(service.bump('guild1', 'admin1').bumpedAt).toBe(3601000);
        expect(service.removeListing('guild1')).toBe(true);
        expect(service.listListings()).toEqual([]);
        expect(() => service.publish(guild, {
            invite: 'https://discord.gg/other', inviteGuildId: 'guild2', tags: []
        }, 'admin1')).toThrow('this server');
    });
});
