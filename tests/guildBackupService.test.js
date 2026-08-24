const fs = require('fs');
const os = require('os');
const path = require('path');

describe('guild backups', () => {
    let tempDir;
    let database;
    let service;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-backups-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        const { GuildBackupService } = require('../src/services/guildBackupService');
        service = new GuildBackupService({ sqlite: database.sqlite, now: () => 1000, randomUUID: () => 'backup-1' });
    });

    afterEach(() => {
        database?.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('creates a versioned guild-scoped snapshot that can be listed and viewed', () => {
        const guild = {
            id: 'guild1',
            roles: { cache: new Map([
                ['guild1', { id: 'guild1', name: '@everyone', managed: false, position: 0, color: 0, permissions: { bitfield: 0n } }],
                ['role1', { id: 'role1', name: 'Helpers', managed: false, position: 1, color: 0x123456,
                    permissions: { bitfield: 8n }, hoist: true, mentionable: false, icon: null }],
                ['bot-role', { id: 'bot-role', name: 'ByteBot', managed: true, position: 2, permissions: { bitfield: 0n } }]
            ]) },
            channels: { cache: new Map() },
            emojis: { cache: new Map() },
            stickers: { cache: new Map() }
        };

        const created = service.create({ guild, creatorId: 'admin1', name: 'Before changes', description: 'Known-good setup' });

        expect(created).toMatchObject({
            id: 'backup-1', guildId: 'guild1', creatorId: 'admin1', name: 'Before changes',
            description: 'Known-good setup', schemaVersion: 1, createdAt: 1000, updatedAt: 1000
        });
        expect(created.payload.roles).toEqual([
            expect.objectContaining({ sourceId: 'role1', name: 'Helpers', permissions: '8', position: 1 })
        ]);
        expect(created.digest).toMatch(/^[a-f0-9]{64}$/);
        expect(service.list('guild1', 'admin1')).toEqual([
            expect.objectContaining({ id: 'backup-1', name: 'Before changes', size: expect.any(Number) })
        ]);
        expect(service.view('guild1', 'admin1', 'backup-1')).toEqual(created);
        expect(service.view('guild1', 'other-admin', 'backup-1')).toBeNull();
    });

    test('renames and deletes only the creators guild-scoped backup', () => {
        const guild = {
            id: 'guild1', roles: { cache: new Map() }, channels: { cache: new Map() },
            emojis: { cache: new Map() }, stickers: { cache: new Map() }
        };
        service.create({ guild, creatorId: 'admin1', name: 'Original' });

        expect(service.rename('guild1', 'other-admin', 'backup-1', 'Stolen')).toBeNull();
        expect(service.rename('guild1', 'admin1', 'backup-1', 'Renamed')).toMatchObject({ name: 'Renamed', updatedAt: 1000 });
        expect(service.delete('guild1', 'other-admin', 'backup-1')).toBe(false);
        expect(service.delete('guild1', 'admin1', 'backup-1')).toBe(true);
        expect(service.view('guild1', 'admin1', 'backup-1')).toBeNull();
    });

    test('previews the selected restorable Discord structure without mutating it', () => {
        const overwrite = { id: 'role1', type: 0, allow: { bitfield: 1024n }, deny: { bitfield: 2048n } };
        const guild = {
            id: 'guild1',
            roles: { cache: new Map([
                ['role1', { id: 'role1', name: 'Helpers', managed: false, position: 1, color: 0,
                    permissions: { bitfield: 0n }, hoist: false, mentionable: false }]
            ]) },
            channels: { cache: new Map([
                ['category1', { id: 'category1', type: 4, name: 'Community', position: 0, parentId: null,
                    permissionOverwrites: { cache: new Map() } }],
                ['channel1', { id: 'channel1', type: 0, name: 'general', position: 1, parentId: 'category1',
                    topic: 'Welcome', rateLimitPerUser: 5, nsfw: false,
                    permissionOverwrites: { cache: new Map([['role1', overwrite]]) } }]
            ]) },
            emojis: { cache: new Map([
                ['emoji1', { id: 'emoji1', name: 'wave', animated: false, url: 'https://cdn.example/wave.png', roles: { cache: new Map() } }]
            ]) },
            stickers: { cache: new Map([
                ['sticker1', { id: 'sticker1', name: 'hello', description: 'Hello', tags: 'wave', url: 'https://cdn.example/hello.png' }]
            ]) }
        };
        service.create({ guild, creatorId: 'admin1', name: 'Structure' });

        expect(service.preview({ guild, creatorId: 'admin1', id: 'backup-1', mode: 'merge', sections: ['roles', 'channels'] }))
            .toEqual({
                backupId: 'backup-1', mode: 'merge', sections: ['roles', 'channels'],
                create: { roles: 1, channels: 2, emojis: 0, stickers: 0, bytebot: 0 },
                remove: { roles: 0, channels: 0, emojis: 0, stickers: 0, bytebot: 0 }
            });
        const stored = service.view('guild1', 'admin1', 'backup-1').payload;
        expect(stored.channels[1]).toEqual(expect.objectContaining({
            sourceId: 'channel1', parentSourceId: 'category1', topic: 'Welcome', slowmode: 5,
            overwrites: [{ sourceId: 'role1', type: 0, allow: '1024', deny: '2048' }]
        }));
        expect(stored.emojis).toEqual([expect.objectContaining({ name: 'wave', url: 'https://cdn.example/wave.png' })]);
        expect(stored.stickers).toEqual([expect.objectContaining({ name: 'hello', tags: 'wave' })]);
    });
});
