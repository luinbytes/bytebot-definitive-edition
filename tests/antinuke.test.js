const fs = require('fs');
const os = require('os');
const path = require('path');
const { AuditLogEvent, PermissionFlagsBits } = require('discord.js');

function permissions(granted = true) {
    return { has: jest.fn(() => granted) };
}

function makeGuild({ attackerPosition = 5, logSend } = {}) {
    const guild = {
        id: 'guild1',
        name: 'Guild',
        ownerId: 'owner1',
        channels: {
            cache: new Map(),
            fetch: jest.fn().mockResolvedValue(null)
        },
        members: {
            me: {
                id: 'bot1',
                user: { id: 'bot1', bot: true, tag: 'ByteBot' },
                permissions: permissions(),
                roles: { highest: { position: 20 } }
            },
            fetch: jest.fn()
        }
    };
    const dangerousRole = {
        id: 'danger1',
        name: 'Danger',
        position: attackerPosition,
        managed: false,
        permissions: { has: jest.fn(value => value === PermissionFlagsBits.Administrator) }
    };
    const attacker = {
        id: 'actor1',
        guild,
        user: { id: 'actor1', bot: false, tag: 'Actor' },
        permissions: permissions(),
        roles: {
            highest: dangerousRole,
            cache: new Map([[dangerousRole.id, dangerousRole]]),
            remove: jest.fn().mockResolvedValue({}),
            add: jest.fn().mockResolvedValue({})
        },
        timeout: jest.fn().mockResolvedValue({}),
        kick: jest.fn().mockResolvedValue({})
    };
    guild.members.fetch.mockImplementation(id => Promise.resolve(id === attacker.id ? attacker : null));
    if (logSend) guild.channels.cache.set('logs1', { id: 'logs1', send: logSend });
    return { guild, attacker };
}

function audit(id, action = AuditLogEvent.ChannelDelete, timestamp = Date.now(), changes = []) {
    return { id, action, executorId: 'actor1', createdTimestamp: timestamp, changes };
}

function securityInteraction(guild, userId, subcommand, values = {}) {
    return {
        guild,
        user: { id: userId },
        options: {
            getSubcommandGroup: jest.fn().mockReturnValue('security'),
            getSubcommand: jest.fn().mockReturnValue(subcommand),
            getBoolean: jest.fn(name => values[name] ?? null),
            getInteger: jest.fn(name => values[name] ?? null),
            getString: jest.fn(name => values[name] ?? null),
            getUser: jest.fn(name => values[name] ?? null),
            getChannel: jest.fn(name => values[name] ?? null)
        },
        reply: jest.fn().mockResolvedValue({})
    };
}

describe('Greed-compatible AntiNuke', () => {
    let tempDir;
    let database;
    let service;
    let event;
    let server;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-antinuke-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        service = require('../src/services/antinukeService');
        event = require('../src/events/guildAuditLogEntryCreate');
        server = require('../src/commands/administration/server');
    });

    afterEach(() => {
        database.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function enable(module = 'channeldelete', { threshold = 2, punishment = 'strip', logChannelId = null } = {}) {
        service.ensureConfig('guild1');
        database.sqlite.prepare(`
            UPDATE antinuke_config SET enabled = 1, punishment = ?, log_channel_id = ? WHERE guild_id = 'guild1'
        `).run(punishment, logChannelId);
        service.upsertModule('guild1', module, { enabled: 1, threshold });
    }

    test('exposes all 27 documented modules and six current punishments under /server security', () => {
        const json = server.data.toJSON();
        const security = json.options.find(option => option.name === 'security');
        const module = security.options.find(option => option.name === 'antinuke-module');
        const moduleOption = module.options.find(option => option.name === 'module');
        const defaultPunishment = security.options.find(option => option.name === 'antinuke-punishment')
            .options.find(option => option.name === 'punishment');

        expect(service.MODULES).toHaveLength(27);
        expect(new Set(service.MODULES).size).toBe(27);
        expect(service.PUNISHMENTS).toEqual(['ban', 'kick', 'timeout', 'strip', 'stripstaff', 'jail']);
        expect(moduleOption.autocomplete).toBe(true);
        expect(defaultPunishment.choices.map(choice => choice.value)).toEqual(service.PUNISHMENTS);
    });

    test('module autocomplete keeps all modules discoverable within Discord\'s 25-result cap', async () => {
        const respond = jest.fn();
        await server.autocomplete({
            options: {
                getSubcommandGroup: jest.fn().mockReturnValue('security'),
                getFocused: jest.fn(detailed => detailed ? { name: 'module', value: 'invite' } : 'invite')
            },
            respond
        }, {});
        expect(respond.mock.calls[0][0]).toEqual([
            { name: 'invitecreate', value: 'invitecreate' },
            { name: 'invitedelete', value: 'invitedelete' }
        ]);
    });

    test('maps every documented destructive audit action and distinguishes vanity updates', () => {
        const expected = new Map([
            [AuditLogEvent.WebhookCreate, 'webhooks'], [AuditLogEvent.WebhookUpdate, 'webhooks'], [AuditLogEvent.WebhookDelete, 'webhooks'],
            [AuditLogEvent.IntegrationCreate, 'integrationcreate'], [AuditLogEvent.IntegrationUpdate, 'integrationupdate'], [AuditLogEvent.IntegrationDelete, 'integrationdelete'],
            [AuditLogEvent.BotAdd, 'botadd'], [AuditLogEvent.MemberKick, 'kick'], [AuditLogEvent.MemberBanAdd, 'ban'], [AuditLogEvent.MemberPrune, 'memberprune'],
            [AuditLogEvent.RoleCreate, 'rolecreate'], [AuditLogEvent.RoleUpdate, 'roleupdate'], [AuditLogEvent.RoleDelete, 'roledelete'],
            [AuditLogEvent.ChannelCreate, 'channelcreate'], [AuditLogEvent.ChannelUpdate, 'channelupdate'], [AuditLogEvent.ChannelDelete, 'channeldelete'],
            [AuditLogEvent.EmojiCreate, 'emojicreate'], [AuditLogEvent.EmojiUpdate, 'emojiupdate'], [AuditLogEvent.EmojiDelete, 'emojidelete'],
            [AuditLogEvent.StickerCreate, 'stickercreate'], [AuditLogEvent.StickerUpdate, 'stickerupdate'], [AuditLogEvent.StickerDelete, 'stickerdelete'],
            [AuditLogEvent.SoundboardSoundCreate, 'soundboardcreate'], [AuditLogEvent.SoundboardSoundUpdate, 'soundboardupdate'], [AuditLogEvent.SoundboardSoundDelete, 'soundboarddelete'],
            [AuditLogEvent.InviteCreate, 'invitecreate'], [AuditLogEvent.InviteDelete, 'invitedelete']
        ]);
        for (const [action, module] of expected) expect(service.moduleForAuditEntry({ action })).toBe(module);
        expect(service.moduleForAuditEntry({ action: AuditLogEvent.GuildUpdate, changes: [] })).toBe('guildupdate');
        expect(service.moduleForAuditEntry({ action: AuditLogEvent.GuildUpdate, changes: [{ key: 'vanity_url_code' }] })).toBe('vanityurl');
    });

    test('uses a durable per-actor rolling threshold and ignores duplicate events', async () => {
        const { guild, attacker } = makeGuild();
        enable();
        const now = Date.now();

        await event.execute(audit('audit1', AuditLogEvent.ChannelDelete, now), guild);
        expect(attacker.roles.remove).not.toHaveBeenCalled();
        await event.execute(audit('audit1', AuditLogEvent.ChannelDelete, now), guild);
        expect(attacker.roles.remove).not.toHaveBeenCalled();
        await event.execute(audit('audit2', AuditLogEvent.ChannelDelete, now + 1000), guild);

        expect(attacker.roles.remove).toHaveBeenCalledTimes(1);
        expect(database.sqlite.prepare('SELECT status FROM antinuke_incidents').get().status).toBe('punished');

        await event.execute(audit('audit2', AuditLogEvent.ChannelDelete, now + 1000), guild);
        await event.execute(audit('audit3', AuditLogEvent.ChannelDelete, now + 2000), guild);
        expect(attacker.roles.remove).toHaveBeenCalledTimes(1);
    });

    test('does not combine a delayed older event with future actions', () => {
        const now = Date.now();
        const base = {
            guildId: 'guild1', actorId: 'actor1', module: 'ban',
            windowSeconds: 60, threshold: 2, punishment: 'strip'
        };
        expect(service.claimIncident({ ...base, auditEntryId: 'newer', occurredAt: now + 10000 })).toBeNull();
        expect(service.claimIncident({ ...base, auditEntryId: 'older', occurredAt: now })).toBeNull();
    });

    test('owner, bot, and explicit whitelist are exempt while admins only gain configuration trust', async () => {
        const { guild, attacker } = makeGuild();
        enable(undefined, { threshold: 1 });
        database.sqlite.prepare(`
            INSERT INTO antinuke_admins (guild_id, user_id, added_by, created_at) VALUES ('guild1', 'actor1', 'owner1', 1)
        `).run();
        expect(service.isTrustedManager(guild, 'actor1')).toBe(true);
        await event.execute(audit('admin-action'), guild);
        expect(attacker.roles.remove).toHaveBeenCalledTimes(1);

        database.sqlite.prepare(`
            INSERT INTO antinuke_whitelist (guild_id, user_id, added_by, created_at) VALUES ('guild1', 'actor1', 'owner1', 1)
        `).run();
        await event.execute(audit('whitelisted-action'), guild);
        await event.execute({ ...audit('owner-action'), executorId: guild.ownerId }, guild);
        await event.execute({ ...audit('bot-action'), executorId: guild.members.me.id }, guild);
        expect(attacker.roles.remove).toHaveBeenCalledTimes(1);
    });

    test('falls back to dangerous-role stripping once and persists total containment failure', async () => {
        const first = makeGuild();
        enable(undefined, { threshold: 1, punishment: 'jail' });
        const fallback = await service.evaluateAuditEntry(audit('fallback'), first.guild);
        expect(fallback.status).toBe('fallback_strip');
        expect(first.attacker.roles.remove).toHaveBeenCalledTimes(1);

        database.sqlite.exec('DELETE FROM antinuke_actions; DELETE FROM antinuke_incidents');
        const second = makeGuild({ attackerPosition: 25 });
        const failed = await service.evaluateAuditEntry(audit('failed'), second.guild);
        expect(failed.status).toBe('containment_failed');
        expect(failed.error).toContain('strip failed');
        expect(second.attacker.roles.remove).not.toHaveBeenCalled();
        expect(database.sqlite.prepare('SELECT status FROM antinuke_incidents').get().status).toBe('containment_failed');
    });

    test('logging failure cannot erase a completed incident', async () => {
        const send = jest.fn().mockRejectedValue(new Error('Discord unavailable'));
        const { guild } = makeGuild({ logSend: send });
        enable(undefined, { threshold: 1, logChannelId: 'logs1' });

        const incident = await service.evaluateAuditEntry(audit('logged'), guild);
        expect(incident.status).toBe('punished');
        expect(send).toHaveBeenCalledTimes(1);
        expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM antinuke_incidents').get().count).toBe(1);
    });

    test('recovers an applying threshold claim once across concurrent startup workers', async () => {
        const { guild, attacker } = makeGuild();
        enable(undefined, { threshold: 1 });
        const claimed = service.claimIncident({
            guildId: guild.id,
            actorId: attacker.id,
            module: 'channeldelete',
            auditEntryId: 'crashed-audit',
            occurredAt: Date.now(),
            windowSeconds: 60,
            threshold: 1,
            punishment: 'strip'
        });
        expect(database.sqlite.prepare('SELECT status FROM antinuke_incidents WHERE id = ?').get(claimed.id).status).toBe('pending');
        database.sqlite.prepare("UPDATE antinuke_incidents SET status = 'applying', applying_at = 1 WHERE id = ?").run(claimed.id);

        const client = { guilds: { cache: new Map([[guild.id, guild]]), fetch: jest.fn() } };
        const [first, second] = await Promise.all([
            service.recoverPendingIncidents(client),
            service.recoverPendingIncidents(client)
        ]);

        expect(first.recovered + second.recovered).toBe(1);
        expect(Math.min(first.remaining, second.remaining)).toBe(0);
        expect([...first.failures, ...second.failures]).toEqual([]);
        expect(attacker.roles.remove).toHaveBeenCalledTimes(1);
        expect(database.sqlite.prepare('SELECT status FROM antinuke_incidents WHERE id = ?').get(claimed.id).status).toBe('punished');
    });

    test('an active applying lease blocks overlapping recovery workers', async () => {
        const { guild, attacker } = makeGuild();
        enable(undefined, { threshold: 1 });
        const claimed = service.claimIncident({
            guildId: guild.id, actorId: attacker.id, module: 'channeldelete', auditEntryId: 'leased-audit',
            occurredAt: Date.now(), windowSeconds: 60, threshold: 1, punishment: 'strip'
        });
        database.sqlite.prepare("UPDATE antinuke_incidents SET status = 'applying', applying_at = ? WHERE id = ?")
            .run(Date.now(), claimed.id);
        const client = { guilds: { cache: new Map([[guild.id, guild]]), fetch: jest.fn() } };

        const [first, second] = await Promise.all([
            service.recoverPendingIncidents(client), service.recoverPendingIncidents(client)
        ]);

        expect(attacker.roles.remove).not.toHaveBeenCalled();
        expect(first.recovered + second.recovered).toBe(0);
        expect(first.remaining).toBe(1);
        expect(first.retryAfterMs).toBeGreaterThan(0);
    });

    test('renews the lease while a Discord punishment is still running', async () => {
        jest.useFakeTimers({ now: Date.now() });
        try {
            const { guild, attacker } = makeGuild();
            enable(undefined, { threshold: 1 });
            const claimed = service.claimIncident({
                guildId: guild.id, actorId: attacker.id, module: 'channeldelete', auditEntryId: 'slow-audit',
                occurredAt: Date.now(), windowSeconds: 60, threshold: 1, punishment: 'strip'
            });
            database.sqlite.prepare("UPDATE antinuke_incidents SET status = 'applying', applying_at = 1 WHERE id = ?")
                .run(claimed.id);
            let release;
            attacker.roles.remove.mockImplementation(() => new Promise(resolve => { release = resolve; }));
            const client = { guilds: { cache: new Map([[guild.id, guild]]), fetch: jest.fn() } };

            const firstRun = service.recoverPendingIncidents(client);
            for (let index = 0; index < 5 && !release; index++) await Promise.resolve();
            expect(release).toBeDefined();
            await jest.advanceTimersByTimeAsync(31000);
            const overlapRun = service.recoverPendingIncidents(client);
            await jest.advanceTimersByTimeAsync(0);
            const overlap = await overlapRun;

            expect(attacker.roles.remove).toHaveBeenCalledTimes(1);
            expect(overlap.recovered).toBe(0);
            expect(overlap.retryAfterMs).toBeGreaterThan(0);
            release({});
            await Promise.resolve();
            await jest.advanceTimersByTimeAsync(0);
            await firstRun;
            expect(database.sqlite.prepare('SELECT status FROM antinuke_incidents WHERE id = ?').get(claimed.id).status).toBe('punished');
        } finally {
            jest.useRealTimers();
        }
    });

    test('configuration is owner/admin-only and changes are moderation cases', async () => {
        const { guild } = makeGuild();
        const denied = securityInteraction(guild, 'ordinary-admin', 'antinuke-settings');
        await server.execute(denied, {});
        expect(denied.reply.mock.calls[0][0].embeds[0].data.title).toContain('Access Denied');

        const add = securityInteraction(guild, guild.ownerId, 'antinuke-admin', {
            action: 'add', user: { id: 'trusted1' }
        });
        await server.execute(add, {});
        expect(service.isTrustedManager(guild, 'trusted1')).toBe(true);
        expect(database.sqlite.prepare("SELECT action, status FROM moderation_cases WHERE action = 'ANTINUKE_ADMIN_ADD'").get())
            .toEqual(expect.objectContaining({ status: 'completed' }));

        const toggle = securityInteraction(guild, 'trusted1', 'antinuke-toggle', { enabled: true });
        await server.execute(toggle, {});
        expect(database.sqlite.prepare("SELECT enabled FROM antinuke_config WHERE guild_id = 'guild1'").get().enabled).toBe(1);

        const insert = database.sqlite.prepare(`
            INSERT INTO antinuke_whitelist (guild_id, user_id, added_by, created_at) VALUES ('guild1', ?, 'owner1', 1)
        `);
        for (let index = 0; index < 55; index++) insert.run(`user${String(index).padStart(2, '0')}`);
        const list = securityInteraction(guild, guild.ownerId, 'antinuke-whitelist', { action: 'list' });
        await server.execute(list, {});
        expect(list.reply.mock.calls[0][0].embeds[0].data.description).toContain('and 5 more');
    });
});
