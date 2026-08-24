const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

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
        service = new GuildBackupService({
            sqlite: database.sqlite, now: () => 1000, randomUUID: () => 'backup-1', sleep: async () => {}
        });
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

    test('restores selected roles and channels only after confirmation and permission preflight', async () => {
        const source = {
            id: 'guild1',
            roles: { cache: new Map([
                ['role1', { id: 'role1', name: 'Helpers', managed: false, position: 1, color: 0,
                    permissions: { bitfield: 8n }, hoist: false, mentionable: true }]
            ]) },
            channels: { cache: new Map([
                ['category1', { id: 'category1', type: 4, name: 'Community', position: 0, parentId: null,
                    permissionOverwrites: { cache: new Map() } }],
                ['channel1', { id: 'channel1', type: 0, name: 'general', position: 1, parentId: 'category1',
                    topic: 'Welcome', rateLimitPerUser: 5, nsfw: false,
                    permissionOverwrites: { cache: new Map([
                        ['role1', { id: 'role1', type: 0, allow: { bitfield: 1024n }, deny: { bitfield: 0n } }]
                    ]) } }]
            ]) },
            emojis: { cache: new Map() }, stickers: { cache: new Map() }
        };
        service.create({ guild: source, creatorId: 'admin1', name: 'Structure' });
        const roleCreate = jest.fn(async options => ({ id: 'new-role', ...options }));
        const channelCreate = jest.fn(async options => ({ id: options.type === 4 ? 'new-category' : 'new-channel', ...options }));
        let allowed = false;
        const guild = {
            id: 'guild1',
            members: { me: { permissions: { has: jest.fn(() => allowed) } } },
            roles: { everyone: { id: 'guild1' }, cache: new Map(), create: roleCreate },
            channels: { cache: new Map(), create: channelCreate },
            emojis: { cache: new Map(), create: jest.fn() },
            stickers: { cache: new Map(), create: jest.fn() }
        };

        await expect(service.restore({ guild, creatorId: 'admin1', id: 'backup-1', sections: ['roles', 'channels'] }))
            .rejects.toThrow('confirmation');
        await expect(service.restore({ guild, creatorId: 'admin1', id: 'backup-1', sections: ['roles', 'channels'], confirmed: true }))
            .rejects.toThrow('Manage Roles');
        expect(roleCreate).not.toHaveBeenCalled();

        allowed = true;
        await expect(service.restore({ guild, creatorId: 'admin1', id: 'backup-1', sections: ['roles', 'channels'], confirmed: true }))
            .resolves.toEqual({
                backupId: 'backup-1', mode: 'merge', created: { roles: 1, channels: 2, emojis: 0, stickers: 0, bytebot: 0 },
                removed: { roles: 0, channels: 0, emojis: 0, stickers: 0, bytebot: 0 }, failures: []
            });
        expect(channelCreate).toHaveBeenLastCalledWith(expect.objectContaining({
            name: 'general', parent: 'new-category', permissionOverwrites: [
                { id: 'new-role', type: 0, allow: '1024', deny: '0' }
            ]
        }));
    });

    test('destructive restore removes selected structure and reports expression failures', async () => {
        const source = {
            id: 'guild1', roles: { cache: new Map() }, channels: { cache: new Map() },
            emojis: { cache: new Map([
                ['emoji1', { id: 'emoji1', name: 'wave', animated: false, url: 'https://cdn.example/wave.png', roles: { cache: new Map() } }]
            ]) },
            stickers: { cache: new Map([
                ['sticker1', { id: 'sticker1', name: 'hello', description: 'Hello', tags: 'wave', url: 'https://cdn.example/hello.png' }]
            ]) }
        };
        service.create({ guild: source, creatorId: 'admin1', name: 'Expressions' });
        const oldRole = { id: 'old-role', name: 'Old', managed: false, position: 1, permissions: { bitfield: 0n },
            delete: jest.fn(async () => {}) };
        const oldChannel = { id: 'old-channel', name: 'old', type: 0, position: 0, parentId: null,
            permissionOverwrites: { cache: new Map() }, delete: jest.fn(async () => {}) };
        const oldEmoji = { id: 'old-emoji', name: 'old', managed: false, roles: { cache: new Map() },
            delete: jest.fn(async () => {}) };
        const oldSticker = { id: 'old-sticker', name: 'old', delete: jest.fn(async () => {}) };
        const guild = {
            id: 'guild1', members: { me: { permissions: { has: jest.fn(() => true) } } },
            roles: { everyone: { id: 'guild1' }, cache: new Map([[oldRole.id, oldRole]]), create: jest.fn() },
            channels: { cache: new Map([[oldChannel.id, oldChannel]]), create: jest.fn() },
            emojis: { cache: new Map([[oldEmoji.id, oldEmoji]]), create: jest.fn(async () => ({ id: 'new-emoji' })) },
            stickers: { cache: new Map([[oldSticker.id, oldSticker]]), create: jest.fn(async () => { throw new Error('slot unavailable'); }) }
        };

        const result = await service.restore({
            guild, creatorId: 'admin1', id: 'backup-1', mode: 'destructive',
            sections: ['roles', 'channels', 'emojis', 'stickers'], confirmed: true
        });

        expect(result).toMatchObject({
            created: { roles: 0, channels: 0, emojis: 1, stickers: 0, bytebot: 0 },
            removed: { roles: 1, channels: 1, emojis: 1, stickers: 1, bytebot: 0 },
            failures: [{ section: 'stickers', name: 'hello', error: 'slot unavailable' }]
        });
        expect(oldChannel.delete).toHaveBeenCalled();
        expect(oldRole.delete).toHaveBeenCalled();
        expect(oldEmoji.delete).toHaveBeenCalled();
        expect(oldSticker.delete).toHaveBeenCalled();
    });

    test('rejects an unmanageable destructive target before deleting anything', async () => {
        const source = {
            id: 'guild1', roles: { cache: new Map() }, channels: { cache: new Map() },
            emojis: { cache: new Map() }, stickers: { cache: new Map() }
        };
        service.create({ guild: source, creatorId: 'admin1', name: 'Empty' });
        const deleteRole = jest.fn();
        const deleteChannel = jest.fn();
        const guild = {
            id: 'guild1', members: { me: { permissions: { has: () => true } } },
            roles: { everyone: { id: 'guild1' }, cache: new Map([
                ['protected', { id: 'protected', name: 'Protected', managed: false, editable: false, position: 1,
                    permissions: { bitfield: 0n }, delete: deleteRole }]
            ]), create: jest.fn() },
            channels: { cache: new Map([
                ['channel1', { id: 'channel1', name: 'general', type: 0, position: 0, parentId: null,
                    permissionOverwrites: { cache: new Map() }, delete: deleteChannel }]
            ]), create: jest.fn() },
            emojis: { cache: new Map(), create: jest.fn() }, stickers: { cache: new Map(), create: jest.fn() }
        };

        await expect(service.restore({
            guild, creatorId: 'admin1', id: 'backup-1', mode: 'destructive',
            sections: ['roles', 'channels'], confirmed: true
        })).rejects.toThrow('Protected');
        expect(deleteRole).not.toHaveBeenCalled();
        expect(deleteChannel).not.toHaveBeenCalled();
    });

    test('restores allowlisted ByteBot configuration without touching moderation evidence', async () => {
        database.sqlite.prepare(`INSERT INTO lifecycle_messages
            (guild_id, type, channel_id, template, enabled, format, updated_at)
            VALUES ('guild1', 'welcome', 'channel1', 'Original', 1, 'text', 1)`).run();
        database.sqlite.prepare(`INSERT INTO moderation_logs
            (guild_id, target_id, executor_id, action, reason, timestamp)
            VALUES ('guild1', 'member1', 'admin1', 'WARN', 'Keep this', 1)`).run();
        const guild = {
            id: 'guild1', members: { me: { permissions: { has: jest.fn(() => true) } } },
            roles: { everyone: { id: 'guild1' }, cache: new Map(), create: jest.fn() },
            channels: { cache: new Map(), create: jest.fn() },
            emojis: { cache: new Map(), create: jest.fn() }, stickers: { cache: new Map(), create: jest.fn() }
        };
        service.create({ guild, creatorId: 'admin1', name: 'ByteBot config' });
        database.sqlite.prepare("UPDATE lifecycle_messages SET template = 'Changed' WHERE guild_id = 'guild1'").run();

        const result = await service.restore({
            guild, creatorId: 'admin1', id: 'backup-1', sections: ['bytebot'], confirmed: true
        });

        expect(result.created.bytebot).toBe(1);
        expect(database.sqlite.prepare("SELECT template FROM lifecycle_messages WHERE guild_id = 'guild1'").get().template)
            .toBe('Original');
        expect(database.sqlite.prepare("SELECT reason FROM moderation_logs WHERE guild_id = 'guild1'").get().reason)
            .toBe('Keep this');
        const payload = service.view('guild1', 'admin1', 'backup-1').payload.bytebot;
        expect(payload.moderation_logs).toBeUndefined();
        expect(payload.forced_nicknames).toBeUndefined();
        expect(payload.uwu_lock_members).toBeUndefined();
        expect(payload.server_listings).toBeUndefined();
    });

    test('requires a fresh preview code bound to the exact restore plan', () => {
        let now = 1000;
        const timers = [];
        service.now = () => now;
        service.setTimeout = jest.fn((callback, delay) => {
            timers.push(callback);
            return { unref: jest.fn() };
        });
        const guild = {
            id: 'guild1', roles: { cache: new Map() }, channels: { cache: new Map() },
            emojis: { cache: new Map() }, stickers: { cache: new Map() }
        };
        service.create({ guild, creatorId: 'admin1', name: 'Previewed' });
        const values = { guild, creatorId: 'admin1', id: 'backup-1', mode: 'merge', sections: ['roles'] };
        const preview = service.issuePreview(values);

        expect(() => service.consumePreview(values, 'wrong-code')).toThrow('valid confirmation code');
        expect(service.consumePreview(values, preview.confirmationCode)).toEqual(expect.objectContaining({
            backupId: 'backup-1', sections: ['roles']
        }));
        expect(() => service.consumePreview(values, preview.confirmationCode)).toThrow('valid confirmation code');

        const expiring = service.issuePreview(values);
        now += 10 * 60 * 1000 + 1;
        expect(() => service.consumePreview(values, expiring.confirmationCode)).toThrow('valid confirmation code');

        now += 1;
        const changedValues = { ...values, mode: 'destructive' };
        const changed = service.issuePreview(changedValues);
        guild.roles.cache.set('role1', {
            id: 'role1', name: 'New', managed: false, position: 1, color: 0,
            permissions: { bitfield: 0n }, hoist: false, mentionable: false
        });
        expect(() => service.consumePreview(changedValues, changed.confirmationCode)).toThrow('plan changed');
        expect(service.setTimeout).toHaveBeenCalledWith(expect.any(Function), 10 * 60 * 1000);
        timers.at(-1)();
    });

    test('rejects corrupted or unknown payloads and enforces five backups per creator', () => {
        let nextId = 0;
        const { GuildBackupService } = require('../src/services/guildBackupService');
        service = new GuildBackupService({
            sqlite: database.sqlite, now: () => 1000, randomUUID: () => `backup-${++nextId}`, sleep: async () => {}
        });
        const guild = {
            id: 'guild1', roles: { cache: new Map() }, channels: { cache: new Map() },
            emojis: { cache: new Map() }, stickers: { cache: new Map() }
        };
        for (let index = 1; index <= 5; index++) service.create({ guild, creatorId: 'admin1', name: `Backup ${index}` });
        expect(() => service.create({ guild, creatorId: 'admin1', name: 'Backup 6' })).toThrow('five backups');

        database.sqlite.prepare("UPDATE guild_backups SET payload = '{}' WHERE id = 'backup-1'").run();
        expect(() => service.view('guild1', 'admin1', 'backup-1')).toThrow('integrity');
        const row = database.sqlite.prepare("SELECT payload FROM guild_backups WHERE id = 'backup-2'").get();
        const payload = JSON.parse(row.payload);
        payload.bytebot.unknown_table = [];
        const serialized = JSON.stringify(payload);
        const digest = crypto.createHash('sha256').update(serialized).digest('hex');
        database.sqlite.prepare("UPDATE guild_backups SET payload = ?, digest = ? WHERE id = 'backup-2'").run(serialized, digest);
        expect(() => service.view('guild1', 'admin1', 'backup-2')).toThrow('invalid');
    });
});
