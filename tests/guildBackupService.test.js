const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { PermissionFlagsBits, PermissionsBitField } = require('discord.js');

function roleGrantGuild() {
    const actor = { id: 'admin1', permissions: new PermissionsBitField([
        PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles
    ]), roles: { highest: { position: 10 } } };
    const role = { id: 'role1', name: 'Reward', position: 5, managed: false, editable: true,
        permissions: new PermissionsBitField(0n) };
    const guild = { id: 'guild1', ownerId: actor.id,
        roles: { everyone: { id: 'guild1' }, cache: new Map([[role.id, role]]), create: jest.fn().mockResolvedValue({ id: 'new-role' }) },
        channels: { cache: new Map(), create: jest.fn() }, emojis: { cache: new Map(), create: jest.fn() },
        stickers: { cache: new Map(), create: jest.fn() }, members: {
            me: { permissions: new PermissionsBitField(PermissionFlagsBits.Administrator), roles: { highest: { position: 20 } } },
            fetch: jest.fn().mockResolvedValue(actor)
        } };
    return { guild, actor, role };
}

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
            id: 'guild1', ownerId: 'admin1',
            members: { fetch: jest.fn().mockResolvedValue({ id: 'admin1' }), me: { permissions: { has: jest.fn(() => allowed) }, roles: { highest: { position: 100 } } } },
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

    test('restore rechecks the actors action permissions, role authority and current membership before any mutation', async () => {
        const role = { id: 'role1', name: 'Helpers', position: 5, managed: false,
            permissions: { bitfield: PermissionFlagsBits.BanMembers } };
        const guild = { id: 'guild1', ownerId: 'owner1', roles: { everyone: { id: 'guild1' },
            cache: new Map([[role.id, role]]), create: jest.fn().mockResolvedValue({ id: 'new-role' }) },
            channels: { cache: new Map(), create: jest.fn() }, emojis: { cache: new Map() }, stickers: { cache: new Map() },
            members: { me: { permissions: new PermissionsBitField(PermissionFlagsBits.Administrator), roles: { highest: { position: 20 } } }, fetch: jest.fn() } };
        const actor = { id: 'admin1', permissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild), roles: { highest: { position: 10 } } };
        guild.members.fetch.mockResolvedValue(actor);
        service.create({ guild, creatorId: actor.id, name: 'Authority' });
        const restore = sections => service.restore({ guild, creatorId: actor.id, id: 'backup-1', sections, confirmed: true });
        await expect(restore(['roles'])).rejects.toThrow('Manage Roles');
        actor.permissions.add(PermissionFlagsBits.ManageRoles);
        await expect(restore(['roles'])).rejects.toThrow('permissions');
        actor.permissions.add(PermissionFlagsBits.BanMembers);
        actor.roles.highest.position = role.position;
        await expect(restore(['roles'])).rejects.toThrow('highest role');
        expect(guild.roles.create).not.toHaveBeenCalled();
        actor.roles.highest.position = 10;
        await expect(restore(['roles'])).resolves.toMatchObject({ created: { roles: 1 } });
        guild.members.fetch.mockRejectedValue(new Error('Member unavailable'));
        await expect(restore(['channels'])).rejects.toThrow('member');
        expect(guild.channels.create).not.toHaveBeenCalled();
    });

    test.each([
        ['channels', PermissionFlagsBits.ManageChannels, 'Manage Channels'],
        ['emojis', PermissionFlagsBits.ManageGuildExpressions, 'Manage Expressions'],
        ['stickers', PermissionFlagsBits.ManageGuildExpressions, 'Manage Expressions']
    ])('%s restore requires the actors section permission even with bot authority', async (section, permission, message) => {
        const actor = { id: 'admin1', permissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild) };
        const guild = { id: 'guild1', ownerId: 'owner1', roles: { everyone: { id: 'guild1' }, cache: new Map() },
            channels: { cache: new Map() }, emojis: { cache: new Map() }, stickers: { cache: new Map() },
            members: { me: { permissions: new PermissionsBitField(PermissionFlagsBits.Administrator) }, fetch: jest.fn().mockResolvedValue(actor) } };
        service.create({ guild, creatorId: actor.id, name: 'Section permissions' });
        const restore = () => service.restore({ guild, creatorId: actor.id, id: 'backup-1', sections: [section], confirmed: true });
        await expect(restore()).rejects.toThrow(message);
        actor.permissions.add(permission);
        await expect(restore()).resolves.toMatchObject({ failures: [] });
    });

    test('channel overwrites and destructive role removals stay within the actors authority', async () => {
        const actor = { id: 'admin1', permissions: new PermissionsBitField([
            PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageChannels
        ]), roles: { highest: { position: 5 } } };
        const oldRole = { id: 'old-role', name: 'Old', position: 5, managed: false, editable: true,
            permissions: { bitfield: 0n }, delete: jest.fn() };
        const channel = { id: 'channel1', name: 'general', type: 0, position: 1,
            permissionOverwrites: { cache: new Map([['guild1', { id: 'guild1', type: 0,
                allow: { bitfield: PermissionFlagsBits.BanMembers }, deny: { bitfield: 0n } }]]) }, delete: jest.fn() };
        const guild = { id: 'guild1', ownerId: 'owner1', roles: { everyone: { id: 'guild1' }, cache: new Map([[oldRole.id, oldRole]]) },
            channels: { cache: new Map([[channel.id, channel]]), create: jest.fn().mockResolvedValue({ id: 'new-channel' }) },
            emojis: { cache: new Map() }, stickers: { cache: new Map() }, members: {
                me: { permissions: new PermissionsBitField(PermissionFlagsBits.Administrator), roles: { highest: { position: 20 } } }, fetch: jest.fn().mockResolvedValue(actor)
            } };
        service.create({ guild, creatorId: actor.id, name: 'Authority' });
        const restore = (sections, mode = 'merge') => service.restore({ guild, creatorId: actor.id, id: 'backup-1', sections, mode, confirmed: true });
        await expect(restore(['channels'])).rejects.toThrow('Manage Roles');
        actor.permissions.add(PermissionFlagsBits.ManageRoles);
        await expect(restore(['channels'])).rejects.toThrow('permission overwrites');
        await expect(restore(['roles', 'channels'], 'destructive')).rejects.toThrow('permission overwrites');
        expect(channel.delete).not.toHaveBeenCalled();
        actor.permissions.add(PermissionFlagsBits.BanMembers);
        await expect(restore(['roles', 'channels'], 'destructive')).rejects.toThrow('highest role');
        expect(oldRole.delete).not.toHaveBeenCalled();
        expect(channel.delete).not.toHaveBeenCalled();
        await expect(restore(['channels'])).resolves.toMatchObject({ created: { channels: 1 } });
    });

    test('role restore honors denied permissions implied by Administrator even for the owner', async () => {
        const role = { id: 'admin-role', name: 'Admin', position: 1, managed: false, permissions: { bitfield: PermissionFlagsBits.Administrator } };
        const guild = { id: 'guild1', ownerId: 'admin1', roles: { everyone: { id: 'guild1' }, cache: new Map([[role.id, role]]), create: jest.fn() },
            channels: { cache: new Map() }, emojis: { cache: new Map() }, stickers: { cache: new Map() }, members: {
                me: { permissions: new PermissionsBitField(PermissionFlagsBits.Administrator), roles: { highest: { position: 20 } } },
                fetch: jest.fn().mockResolvedValue({ id: 'admin1' })
            } };
        service.create({ guild, creatorId: 'admin1', name: 'Admin' });
        database.sqlite.prepare("INSERT INTO denied_role_permissions (guild_id, permission) VALUES ('guild1', 'BanMembers')").run();
        await expect(service.restore({ guild, creatorId: 'admin1', id: 'backup-1', sections: ['roles'], confirmed: true })).rejects.toThrow('blocked permission BanMembers');
        expect(guild.roles.create).not.toHaveBeenCalled();
    });

    test('ByteBot backup config requires the normal trusted AntiNuke manager authority', async () => {
        const actor = { id: 'admin1', permissions: new PermissionsBitField(PermissionFlagsBits.Administrator), roles: { highest: { position: 10 } } };
        const guild = { id: 'guild1', ownerId: 'owner1', roles: { everyone: { id: 'guild1' }, cache: new Map() },
            channels: { cache: new Map() }, emojis: { cache: new Map() }, stickers: { cache: new Map() },
            members: { me: { permissions: actor.permissions }, fetch: jest.fn().mockResolvedValue(actor) } };
        database.sqlite.prepare("INSERT INTO antinuke_config (guild_id, enabled) VALUES ('guild1', 1)").run();
        service.create({ guild, creatorId: actor.id, name: 'Security' });
        database.sqlite.prepare("UPDATE antinuke_config SET enabled = 0 WHERE guild_id = 'guild1'").run();
        const restore = () => service.restore({ guild, creatorId: actor.id, id: 'backup-1', sections: ['bytebot'], confirmed: true });
        await expect(restore()).rejects.toThrow('trusted');
        expect(database.sqlite.prepare("SELECT enabled FROM antinuke_config WHERE guild_id = 'guild1'").get().enabled).toBe(0);
        database.sqlite.prepare("INSERT INTO antinuke_admins (guild_id, user_id, added_by, created_at) VALUES ('guild1', 'admin1', 'owner1', 1)").run();
        await expect(restore()).resolves.toMatchObject({ created: { bytebot: 1 } });
    });

    test('ByteBot-only restore cannot reenable another actors autorole without fresh role authority', async () => {
        const actor = { id: 'admin1', permissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
            roles: { highest: { position: 10 } } };
        const role = { id: 'role1', name: 'Reward', position: 5, managed: false, editable: true,
            permissions: new PermissionsBitField(0n) };
        const guild = { id: 'guild1', ownerId: 'owner1',
            roles: { everyone: { id: 'guild1' }, cache: new Map([[role.id, role]]), create: jest.fn() },
            channels: { cache: new Map(), create: jest.fn() }, emojis: { cache: new Map(), create: jest.fn() },
            stickers: { cache: new Map(), create: jest.fn() }, members: {
                me: { permissions: new PermissionsBitField(PermissionFlagsBits.Administrator), roles: { highest: { position: 20 } } },
                fetch: jest.fn().mockResolvedValue(actor)
            } };
        database.sqlite.prepare("INSERT INTO antinuke_admins (guild_id, user_id, added_by, created_at) VALUES ('guild1', 'admin1', 'owner1', 1)").run();
        database.sqlite.prepare(`INSERT INTO automation_rules (guild_id, kind, key, config, enabled, created_by, created_at, updated_at)
            VALUES ('guild1', 'autorole', 'user:role1', '{"roleId":"role1"}', 1, 'owner1', 1, 1)`).run();
        service.create({ guild, creatorId: actor.id, name: 'Whole guild snapshot' });
        database.sqlite.prepare("UPDATE automation_rules SET enabled = 0 WHERE guild_id = 'guild1'").run();
        const changes = database.sqlite.prepare('SELECT total_changes() count').get().count;
        const restore = () => service.restore({ guild, creatorId: actor.id, id: 'backup-1', sections: ['bytebot'], confirmed: true });

        await expect(restore()).rejects.toThrow('Manage Roles');
        actor.permissions.add(PermissionFlagsBits.ManageRoles);
        actor.roles.highest.position = role.position;
        await expect(restore()).rejects.toThrow('highest role');
        expect(database.sqlite.prepare('SELECT total_changes() count').get().count).toBe(changes);
        for (const section of ['roles', 'channels', 'emojis', 'stickers']) expect(guild[section].create).not.toHaveBeenCalled();
        expect(guild.members.fetch).toHaveBeenCalledWith({ user: actor.id, force: true });

        actor.roles.highest.position = 10;
        await expect(restore()).resolves.toMatchObject({ failures: [] });
        expect(database.sqlite.prepare("SELECT enabled, created_by FROM automation_rules WHERE guild_id = 'guild1'").get())
            .toEqual({ enabled: 1, created_by: 'owner1' });
    });

    test.each([
        ['disabled autorole', 'automation_rules', { kind: 'autorole', key: 'main', config: '{"roleId":"role1"}', enabled: 0 }],
        ['vanity', 'automation_rules', { kind: 'vanity', key: 'main', config: '{"roleIds":["role1"]}' }],
        ['button role', 'automation_rules', { kind: 'button-role', key: '100:role1', config: '{"roleId":"role1"}' }],
        ['reaction role', 'automation_rules', { kind: 'reaction-role', key: '100:emoji', config: '{"roleId":"role1"}' }],
        ['booster role', 'automation_rules', { kind: 'booster-role', key: 'member1', config: '{"roleId":"role1","shares":["member2"]}' }],
        ['disabled birthday role', 'birthday_config', { channel_id: 'channel1', role_id: 'role1', enabled: 0 }],
        ['legacy responder role', 'auto_responses', { trigger: 'legacy', response: 'hello', creator_id: 'owner1', action_role_id: 'role1', action_role_mode: 'add' }],
        ['legacy responder toggle', 'auto_responses', { trigger: 'toggle', response: 'hello', creator_id: 'owner1', action_role_id: 'role1', action_role_mode: 'toggle' }],
        ['disabled responder role', 'auto_responses', { trigger: 'array', response: 'hello', creator_id: 'owner1', enabled: 0, action_roles: '[{"roleId":"role1","mode":"add"}]' }],
        ['responder toggle', 'auto_responses', { trigger: 'array', response: 'hello', creator_id: 'owner1', action_roles: '[{"roleId":"role1","mode":"toggle"}]' }],
        ['responder default action', 'auto_responses', { trigger: 'array', response: 'hello', creator_id: 'owner1', action_roles: '[{"roleId":"role1"}]' }],
        ['jail role', 'moderation_config', { jail_role_id: 'role1' }],
        ['image mute role', 'moderation_config', { image_mute_role_id: 'role1' }],
        ['reaction mute role', 'moderation_config', { reaction_mute_role_id: 'role1' }],
        ['disabled achievement rewards', 'achievement_role_config', { enabled: 0 }],
        ['custom achievement reward', 'custom_achievements', { achievement_id: 'custom1', title: 'Reward', description: 'Reward', emoji: 'x',
            rarity: 'common', check_type: 'manual', grant_role: 1, points: 1, created_by: 'owner1', enabled: 0 }]
    ])('preflights %s grants against current roles even in disabled configuration', async (name, table, values) => {
        const actor = { id: 'admin1', permissions: new PermissionsBitField([
            PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles
        ]), roles: { highest: { position: 5 } } };
        const role = { id: 'role1', name: 'Higher reward', position: 3, managed: false, editable: true,
            permissions: new PermissionsBitField(0n) };
        const guild = { id: 'guild1', ownerId: 'owner1',
            roles: { everyone: { id: 'guild1' }, cache: new Map([[role.id, role]]), create: jest.fn() },
            channels: { cache: new Map(), create: jest.fn() }, emojis: { cache: new Map() }, stickers: { cache: new Map() }, members: {
                me: { permissions: new PermissionsBitField(PermissionFlagsBits.Administrator), roles: { highest: { position: 20 } } },
                fetch: jest.fn().mockResolvedValue(actor)
            } };
        database.sqlite.prepare("INSERT INTO antinuke_admins (guild_id, user_id, added_by, created_at) VALUES ('guild1', 'admin1', 'owner1', 1)").run();
        const row = { guild_id: guild.id, ...(table === 'automation_rules' ? { created_by: 'owner1', created_at: 1, updated_at: 1 } : {}), ...values };
        database.sqlite.prepare(`INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.keys(row).map(() => '?').join(', ')})`).run(...Object.values(row));
        if (['achievement_role_config', 'custom_achievements'].includes(table)) {
            database.sqlite.prepare("INSERT INTO achievement_roles (guild_id, achievement_id, role_id) VALUES ('guild1', 'custom1', 'role1')").run();
        }
        service.create({ guild, creatorId: actor.id, name });
        role.position = 6;
        const changes = database.sqlite.prepare('SELECT total_changes() count').get().count;

        await expect(service.restore({ guild, creatorId: actor.id, id: 'backup-1', sections: ['bytebot'], confirmed: true }))
            .rejects.toThrow('highest role');
        expect(database.sqlite.prepare('SELECT total_changes() count').get().count).toBe(changes);
        expect(guild.roles.create).not.toHaveBeenCalled();
        expect(guild.channels.create).not.toHaveBeenCalled();
        actor.roles.highest.position = 10;
        await expect(service.restore({ guild, creatorId: actor.id, id: 'backup-1', sections: ['bytebot'], confirmed: true }))
            .resolves.toMatchObject({ failures: [] });
    });

    test.each([['merge', true], ['destructive', true], ['merge', false], ['destructive', false]])('authorized actor can %s historical grants with recreated roles, owner exception %s', async (mode, owner) => {
        const { guild, actor } = roleGrantGuild();
        if (owner) {
            actor.permissions = new PermissionsBitField(0n);
            actor.roles.highest.position = 1;
        } else {
            guild.ownerId = 'owner1';
            service.botOwnerIds = [actor.id];
        }
        const config = '{"roleId":"role1","unknown":{"roleId":"leave-this-alone"}}';
        database.sqlite.prepare(`INSERT INTO automation_rules (guild_id, kind, key, config, created_by, created_at, updated_at)
            VALUES ('guild1', 'autorole', 'main', ?, 'higher-actor', 1, 1)`).run(config);
        service.create({ guild, creatorId: actor.id, name: 'Historical reward' });
        guild.roles.cache.clear();
        const changes = database.sqlite.prepare('SELECT total_changes() count').get().count;
        const restore = sections => service.restore({ guild, creatorId: actor.id, id: 'backup-1', mode, sections, confirmed: true });

        await expect(restore(['bytebot'])).rejects.toThrow('missing');
        expect(database.sqlite.prepare('SELECT total_changes() count').get().count).toBe(changes);
        expect(guild.roles.create).not.toHaveBeenCalled();
        await expect(restore(['roles', 'bytebot'])).resolves.toMatchObject({ created: { roles: 1, bytebot: 1 }, failures: [] });
        expect(JSON.parse(database.sqlite.prepare("SELECT config FROM automation_rules WHERE guild_id = 'guild1'").get().config))
            .toEqual({ roleId: 'new-role', unknown: { roleId: 'leave-this-alone' } });
    });

    test.each([
        ['bot permission', ({ guild }) => guild.members.me.permissions.remove(PermissionFlagsBits.Administrator), 'Manage Roles'],
        ['bot hierarchy', ({ guild }) => { guild.members.me.roles.highest.position = 5; }, 'highest role'],
        ['managed role', ({ role }) => { role.managed = true; }, 'managed'],
        ['uneditable role', ({ role }) => { role.editable = false; }, 'above ByteBot'],
        ['everyone role', ({ guild }) => { guild.roles.cache.set(guild.id, { id: guild.id }); }, 'managed'],
        ['current denyperm', ({ role }) => { role.permissions = new PermissionsBitField(PermissionFlagsBits.Administrator); }, 'blocked permission BanMembers']
    ])('owner grant restore still enforces %s before Discord or database mutations', async (name, change, error) => {
        const fixture = roleGrantGuild();
        const { guild, actor } = fixture;
        database.sqlite.prepare(`INSERT INTO automation_rules (guild_id, kind, key, config, created_by, created_at, updated_at)
            VALUES ('guild1', 'autorole', 'main', ?, 'owner1', 1, 1)`).run(JSON.stringify({ roleId: name === 'everyone role' ? guild.id : 'role1' }));
        service.create({ guild, creatorId: actor.id, name });
        if (name === 'current denyperm') {
            database.sqlite.prepare("INSERT INTO denied_role_permissions (guild_id, permission) VALUES ('guild1', 'BanMembers')").run();
        }
        change(fixture);
        const changes = database.sqlite.prepare('SELECT total_changes() count').get().count;

        await expect(service.restore({ guild, creatorId: actor.id, id: 'backup-1', mode: 'destructive', sections: ['bytebot'], confirmed: true }))
            .rejects.toThrow(error);
        expect(database.sqlite.prepare('SELECT total_changes() count').get().count).toBe(changes);
        for (const section of ['roles', 'channels', 'emojis', 'stickers']) expect(guild[section].create).not.toHaveBeenCalled();
    });

    test('snapshot denyperm is preflighted for recreated grant roles before any selected section is mutated', async () => {
        const { guild, actor, role } = roleGrantGuild();
        role.permissions = new PermissionsBitField(PermissionFlagsBits.Administrator);
        const channel = { id: 'old-channel', name: 'general', type: 0, position: 1, delete: jest.fn() };
        guild.channels.cache.set(channel.id, channel);
        database.sqlite.prepare(`INSERT INTO automation_rules (guild_id, kind, key, config, created_by, created_at, updated_at)
            VALUES ('guild1', 'autorole', 'main', '{"roleId":"role1"}', 'owner1', 1, 1)`).run();
        database.sqlite.prepare("INSERT INTO denied_role_permissions (guild_id, permission) VALUES ('guild1', 'BanMembers')").run();
        service.create({ guild, creatorId: actor.id, name: 'Snapshot policy' });
        database.sqlite.prepare("DELETE FROM denied_role_permissions WHERE guild_id = 'guild1'").run();
        guild.roles.cache.clear();
        const changes = database.sqlite.prepare('SELECT total_changes() count').get().count;

        await expect(service.restore({ guild, creatorId: actor.id, id: 'backup-1', mode: 'destructive', sections: ['roles', 'channels', 'bytebot'], confirmed: true }))
            .rejects.toThrow('blocked permission BanMembers');
        expect(database.sqlite.prepare('SELECT total_changes() count').get().count).toBe(changes);
        expect(channel.delete).not.toHaveBeenCalled();
        expect(guild.roles.create).not.toHaveBeenCalled();
        expect(guild.channels.create).not.toHaveBeenCalled();
    });

    test('safe non-grant configuration and unknown settings remain restorable by a trusted manager without Manage Roles', async () => {
        const { guild, actor } = roleGrantGuild();
        guild.ownerId = 'owner1';
        actor.permissions.remove(PermissionFlagsBits.ManageRoles);
        database.sqlite.prepare("INSERT INTO antinuke_admins (guild_id, user_id, added_by, created_at) VALUES ('guild1', 'admin1', 'owner1', 1)").run();
        database.sqlite.prepare(`INSERT INTO automation_rules (guild_id, kind, key, config, created_by, created_at, updated_at)
            VALUES ('guild1', 'future-kind', 'main', '{unknown-format', 'owner1', 1, 1),
            ('guild1', 'autoreact', 'main', '{"roleIds":["missing-filter-role"],"unknown":true}', 'owner1', 1, 1)`).run();
        database.sqlite.prepare(`INSERT INTO auto_responses (guild_id, trigger, response, creator_id, require_role_id, role_ids, action_roles, action_role_id, action_role_mode)
            VALUES ('guild1', 'safe', 'Original', 'owner1', 'missing-filter-role', '["missing-filter-role"]',
            '[{"roleId":"missing-removal-role","mode":"remove"}]', 'legacy-removal-role', 'remove')`).run();
        const backup = service.create({ guild, creatorId: actor.id, name: 'Safe settings' });
        database.sqlite.prepare("UPDATE auto_responses SET response = 'Changed' WHERE guild_id = 'guild1'").run();

        await expect(service.restore({ guild, creatorId: actor.id, id: backup.id, sections: ['bytebot'], confirmed: true }))
            .resolves.toMatchObject({ failures: [] });
        expect(database.sqlite.prepare("SELECT response, action_roles FROM auto_responses WHERE guild_id = 'guild1'").get())
            .toEqual({ response: 'Original', action_roles: '[{"roleId":"missing-removal-role","mode":"remove"}]' });
        expect(database.sqlite.prepare("SELECT config FROM automation_rules WHERE kind = 'future-kind'").get().config).toBe('{unknown-format');
        expect(database.sqlite.prepare("SELECT config FROM automation_rules WHERE kind = 'autoreact'").get().config)
            .toBe('{"roleIds":["missing-filter-role"],"unknown":true}');
    });

    test('restoring achievement role creation requires Manage Roles even without an existing reward role', async () => {
        const { guild, actor } = roleGrantGuild();
        guild.ownerId = 'owner1';
        service.botOwnerIds = [actor.id];
        actor.permissions.remove(PermissionFlagsBits.ManageRoles);
        database.sqlite.prepare("INSERT INTO achievement_role_config (guild_id, enabled) VALUES ('guild1', 0)").run();
        service.create({ guild, creatorId: actor.id, name: 'Dynamic role rewards' });
        const changes = database.sqlite.prepare('SELECT total_changes() count').get().count;
        const restore = () => service.restore({ guild, creatorId: actor.id, id: 'backup-1', sections: ['bytebot'], confirmed: true });

        await expect(restore()).rejects.toThrow('Manage Roles');
        expect(database.sqlite.prepare('SELECT total_changes() count').get().count).toBe(changes);
        actor.permissions.add(PermissionFlagsBits.ManageRoles);
        await expect(restore()).resolves.toMatchObject({ failures: [] });
    });

    test('failed role recreation cannot redirect a validated grant to a now higher current role', async () => {
        const { guild, actor, role } = roleGrantGuild();
        guild.ownerId = 'owner1';
        service.botOwnerIds = [actor.id];
        database.sqlite.prepare(`INSERT INTO automation_rules (guild_id, kind, key, config, created_by, created_at, updated_at)
            VALUES ('guild1', 'autorole', 'main', '{"roleId":"role1"}', 'owner1', 1, 1)`).run();
        service.create({ guild, creatorId: actor.id, name: 'Recreated reward' });
        role.position = 15;
        database.sqlite.prepare("UPDATE automation_rules SET enabled = 0 WHERE guild_id = 'guild1'").run();
        const changes = database.sqlite.prepare('SELECT total_changes() count').get().count;
        guild.roles.create.mockRejectedValueOnce(new Error('Role limit reached'));
        const restore = () => service.restore({ guild, creatorId: actor.id, id: 'backup-1', sections: ['roles', 'bytebot'], confirmed: true });

        await expect(restore()).resolves.toMatchObject({ created: { bytebot: 0 }, failures: [
            { section: 'roles', error: 'Role limit reached' }, { section: 'bytebot', error: expect.stringContaining('was not restored') }
        ] });
        expect(database.sqlite.prepare('SELECT total_changes() count').get().count).toBe(changes);
        expect(database.sqlite.prepare("SELECT enabled FROM automation_rules WHERE guild_id = 'guild1'").get().enabled).toBe(0);

        await expect(restore()).resolves.toMatchObject({ created: { roles: 1, bytebot: 1 }, failures: [] });
        expect(JSON.parse(database.sqlite.prepare("SELECT config FROM automation_rules WHERE guild_id = 'guild1'").get().config))
            .toEqual({ roleId: 'new-role' });
    });

    test('destructive configuration restore authorizes achievement defaults before deleting the disabled setting', async () => {
        const { guild, actor, role } = roleGrantGuild();
        guild.ownerId = 'owner1';
        actor.permissions.remove(PermissionFlagsBits.ManageRoles);
        service.create({ guild, creatorId: actor.id, name: 'Before reward settings' });
        database.sqlite.prepare("INSERT INTO antinuke_admins (guild_id, user_id, added_by, created_at) VALUES ('guild1', 'admin1', 'owner1', 1)").run();
        database.sqlite.prepare("INSERT INTO achievement_role_config (guild_id, enabled) VALUES ('guild1', 0)").run();
        database.sqlite.prepare("INSERT INTO achievement_roles (guild_id, achievement_id, role_id) VALUES ('guild1', 'streak_7', 'role1')").run();
        const restore = mode => service.restore({ guild, creatorId: actor.id, id: 'backup-1', mode, sections: ['bytebot'], confirmed: true });

        await expect(restore('merge')).resolves.toMatchObject({ failures: [] });
        const changes = database.sqlite.prepare('SELECT total_changes() count').get().count;
        await expect(restore('destructive')).rejects.toThrow('Manage Roles');
        actor.permissions.add(PermissionFlagsBits.ManageRoles);
        actor.roles.highest.position = role.position;
        await expect(restore('destructive')).rejects.toThrow('highest role');
        expect(database.sqlite.prepare('SELECT total_changes() count').get().count).toBe(changes);
        expect(database.sqlite.prepare("SELECT enabled FROM achievement_role_config WHERE guild_id = 'guild1'").get().enabled).toBe(0);
        expect(guild.roles.create).not.toHaveBeenCalled();

        actor.roles.highest.position = 10;
        await expect(restore('destructive')).resolves.toMatchObject({ failures: [] });
        expect(database.sqlite.prepare("SELECT enabled FROM achievement_role_config WHERE guild_id = 'guild1'").get()).toBeUndefined();
        expect(database.sqlite.prepare("SELECT role_id FROM achievement_roles WHERE guild_id = 'guild1'").get().role_id).toBe(role.id);
    });

    test.each([
        ['hidden text channel', 0, PermissionFlagsBits.ViewChannel, false],
        ['voice channel without Connect', 2, PermissionFlagsBits.Connect, false],
        ['stage channel without Connect', 13, PermissionFlagsBits.Connect, false],
        ['timed-out actor', 0, 0n, true]
    ])('destructive restore rejects a %s before any channel is deleted', async (name, type, deniedPermission, timedOut) => {
        const { guild, actor } = roleGrantGuild();
        guild.ownerId = 'owner1';
        actor.permissions.add([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]);
        actor.communicationDisabledUntilTimestamp = timedOut ? Date.now() + 60_000 : null;
        const access = new PermissionsBitField(actor.permissions.bitfield).remove(deniedPermission);
        const channel = { id: 'channel1', name, type, position: 0, permissionOverwrites: { cache: new Map() },
            permissionsFor: jest.fn().mockReturnValue(access), delete: jest.fn() };
        service.create({ guild, creatorId: actor.id, name });
        guild.channels.cache.set(channel.id, channel);
        const changes = database.sqlite.prepare('SELECT total_changes() count').get().count;
        const restore = () => service.restore({ guild, creatorId: actor.id, id: 'backup-1', mode: 'destructive', sections: ['channels'], confirmed: true });

        await expect(restore()).rejects.toThrow('Manage Channels');
        expect(channel.delete).not.toHaveBeenCalled();
        expect(guild.channels.create).not.toHaveBeenCalled();
        expect(database.sqlite.prepare('SELECT total_changes() count').get().count).toBe(changes);

        access.add(deniedPermission);
        actor.communicationDisabledUntilTimestamp = null;
        await expect(restore()).resolves.toMatchObject({ removed: { channels: 1 }, failures: [] });
        expect(channel.delete).toHaveBeenCalledTimes(1);
    });

    test('destructive channel restore preflights every live channels effective actor permissions before mutation', async () => {
        const actor = { id: 'admin1', permissions: new PermissionsBitField([
            PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ViewChannel
        ]) };
        const allowed = { id: 'allowed', name: 'allowed', type: 0, position: 0, delete: jest.fn(),
            permissionOverwrites: { cache: new Map() }, permissionsFor: jest.fn().mockReturnValue(actor.permissions) };
        const denied = { id: 'denied', name: 'denied', type: 4, position: 1, delete: jest.fn(),
            permissionOverwrites: { cache: new Map() }, permissionsFor: jest.fn().mockReturnValue(new PermissionsBitField(0n)) };
        const guild = { id: 'guild1', ownerId: 'owner1',
            roles: { everyone: { id: 'guild1' }, cache: new Map(), create: jest.fn() },
            channels: { cache: new Map(), create: jest.fn() }, emojis: { cache: new Map() }, stickers: { cache: new Map() },
            members: { me: { permissions: new PermissionsBitField(PermissionFlagsBits.Administrator) }, fetch: jest.fn().mockResolvedValue(actor) } };
        service.create({ guild, creatorId: actor.id, name: 'Empty channels' });
        guild.channels.cache.set(allowed.id, allowed).set(denied.id, denied);
        const changes = database.sqlite.prepare('SELECT total_changes() count').get().count;
        const restore = () => service.restore({ guild, creatorId: actor.id, id: 'backup-1', mode: 'destructive', sections: ['channels'], confirmed: true });

        await expect(restore()).rejects.toThrow('Manage Channels');
        expect(allowed.delete).not.toHaveBeenCalled();
        expect(denied.delete).not.toHaveBeenCalled();
        expect(guild.channels.create).not.toHaveBeenCalled();
        expect(guild.roles.create).not.toHaveBeenCalled();
        expect(database.sqlite.prepare('SELECT total_changes() count').get().count).toBe(changes);
        expect(denied.permissionsFor).toHaveBeenCalledWith(actor);

        denied.permissionsFor.mockReturnValue(actor.permissions);
        await expect(restore()).resolves.toMatchObject({ removed: { channels: 2 }, failures: [] });
        expect(allowed.delete).toHaveBeenCalledTimes(1);
        expect(denied.delete).toHaveBeenCalledTimes(1);

        guild.ownerId = actor.id;
        denied.permissionsFor.mockReturnValue(null);
        await expect(restore()).resolves.toMatchObject({ removed: { channels: 2 }, failures: [] });
        denied.deletable = false;
        await expect(restore()).rejects.toThrow('cannot be removed by ByteBot');
        expect(denied.delete).toHaveBeenCalledTimes(2);
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
            id: 'guild1', ownerId: 'admin1', members: { fetch: jest.fn().mockResolvedValue({ id: 'admin1' }), me: { permissions: { has: jest.fn(() => true) }, roles: { highest: { position: 100 } } } },
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
            id: 'guild1', ownerId: 'admin1', members: { fetch: jest.fn().mockResolvedValue({ id: 'admin1' }), me: { permissions: { has: () => true }, roles: { highest: { position: 100 } } } },
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
            id: 'guild1', ownerId: 'admin1', members: { fetch: jest.fn().mockResolvedValue({ id: 'admin1' }), me: { permissions: { has: jest.fn(() => true) }, roles: { highest: { position: 100 } } } },
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
