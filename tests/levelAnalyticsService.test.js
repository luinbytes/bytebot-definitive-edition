const fs = require('fs');
const os = require('os');
const path = require('path');
const { PermissionFlagsBits } = require('discord.js');

describe('LevelAnalyticsService', () => {
    let tempDir;
    let database;
    let service;
    let now;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-level-service-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        const LevelAnalyticsService = require('../src/services/levelAnalyticsService');
        now = Date.UTC(2026, 7, 24, 12);
        service = new LevelAnalyticsService({
            sqlite: database.sqlite,
            now: () => now
        });
    });

    afterEach(() => {
        database?.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('a message is counted and awarded once even when Discord replays the event', () => {
        const message = {
            id: 'message1',
            content: 'hello there',
            webhookId: null,
            guild: { id: 'guild1' },
            channelId: 'channel1',
            author: { id: 'user1', bot: false },
            member: { roles: { cache: new Map() } }
        };

        expect(service.recordMessage(message)).toEqual(expect.objectContaining({
            accepted: true,
            duplicate: false,
            xpAwarded: 20,
            level: 0
        }));
        expect(service.recordMessage(message)).toEqual(expect.objectContaining({
            accepted: false,
            duplicate: true,
            xpAwarded: 0
        }));
        expect(database.sqlite.prepare(`
            SELECT xp, level, text_xp, message_count FROM member_levels
            WHERE guild_id = 'guild1' AND user_id = 'user1'
        `).get()).toEqual({ xp: 20, level: 0, text_xp: 20, message_count: 1 });
        expect(database.sqlite.prepare(`
            SELECT message_count FROM activity_logs
            WHERE guild_id = 'guild1' AND user_id = 'user1'
        `).get().message_count).toBe(1);
        expect(database.sqlite.prepare(`
            SELECT message_count FROM server_daily_metrics WHERE guild_id = 'guild1'
        `).get().message_count).toBe(1);
    });

    test('text XP stops at the fixed daily cap while analytics keeps counting', () => {
        database.sqlite.prepare(`
            INSERT INTO level_configs (guild_id, base_multiplier, updated_at)
            VALUES ('guild1', 10, 1)
        `).run();
        let result;
        for (let index = 0; index < 101; index += 1) {
            result = service.recordMessage({
                id: `message${index}`,
                content: 'eligible',
                webhookId: null,
                guild: { id: 'guild1' },
                channelId: 'channel1',
                author: { id: 'user1', bot: false },
                member: { roles: { cache: new Map() } }
            });
            now += 61_000;
        }

        expect(result.xpAwarded).toBe(0);
        expect(database.sqlite.prepare(`
            SELECT xp FROM member_levels WHERE guild_id = 'guild1' AND user_id = 'user1'
        `).get().xp).toBe(20_000);
        expect(database.sqlite.prepare(`
            SELECT message_count FROM server_daily_metrics WHERE guild_id = 'guild1'
        `).get().message_count).toBe(101);
    });

    test('reaction placement transitions count add, remove, and re-add once each', () => {
        const reaction = {
            message: { id: 'message1', guild: { id: 'guild1' } },
            emoji: { id: null, name: '👍' }
        };
        const user = { id: 'user1', bot: false };

        expect(service.recordReactionChange(reaction, user, true)).toEqual({ accepted: true, counted: true });
        expect(service.recordReactionChange(reaction, user, true)).toEqual({ accepted: false, counted: false });
        expect(service.recordReactionChange(reaction, user, false)).toEqual({ accepted: true, counted: false });
        expect(service.recordReactionChange(reaction, user, false)).toEqual({ accepted: false, counted: false });
        expect(service.recordReactionChange(reaction, user, true)).toEqual({ accepted: true, counted: true });

        expect(database.sqlite.prepare(`
            SELECT reactions_given FROM activity_logs WHERE guild_id = 'guild1' AND user_id = 'user1'
        `).get().reactions_given).toBe(2);
        expect(database.sqlite.prepare(`
            SELECT reaction_count FROM server_daily_metrics WHERE guild_id = 'guild1'
        `).get().reaction_count).toBe(2);
        expect(service.clearReactionPlacements(reaction.message)).toBe(1);
        expect(service.recordReactionChange(reaction, user, true)).toEqual({ accepted: true, counted: true });
    });

    test('membership counters change only when persisted presence changes', () => {
        const member = { id: 'user1', user: { bot: false }, guild: { id: 'guild1' } };

        expect(service.recordMembership(member, true)).toEqual({ accepted: true, joined: 1, left: 0 });
        expect(service.recordMembership(member, true)).toEqual({ accepted: false, joined: 0, left: 0 });
        expect(service.recordMembership(member, false)).toEqual({ accepted: true, joined: 0, left: 1 });
        expect(service.recordMembership(member, false)).toEqual({ accepted: false, joined: 0, left: 0 });
        expect(service.recordMembership({ ...member, id: 'bot1', user: { bot: true } }, true))
            .toEqual({ accepted: false, joined: 0, left: 0 });

        expect(database.sqlite.prepare(`
            SELECT joins, leaves, member_count FROM server_daily_metrics WHERE guild_id = 'guild1'
        `).get()).toEqual({ joins: 1, leaves: 1, member_count: 0 });
    });

    test('startup baselines humans and current voice without inventing offline activity', () => {
        database.sqlite.prepare(`
            INSERT INTO member_presence (guild_id, user_id, present, last_observed_at)
            VALUES ('guild1', 'departed', 1, 1)
        `).run();
        database.sqlite.prepare(`
            INSERT INTO level_voice_sessions
                (guild_id, user_id, channel_id, eligible_since, last_observed_at)
            VALUES ('guild1', 'departed', 'voice1', 1, 1)
        `).run();
        const first = { id: 'user1', user: { bot: false } };
        const second = { id: 'user2', user: { bot: false } };
        const bot = { id: 'bot1', user: { bot: true } };
        const guild = {
            id: 'guild1',
            members: { cache: new Map([[first.id, first], [second.id, second], [bot.id, bot]]) },
            voiceStates: { cache: new Map([
                [first.id, { member: first, channelId: 'voice1', mute: false, deaf: false }],
                [second.id, { member: second, channelId: 'voice1', mute: false, deaf: false }]
            ]) }
        };

        expect(service.reconcileGuild(guild)).toEqual({ members: 2, voiceSessions: 2 });
        expect(database.sqlite.prepare(`
            SELECT joins, leaves, member_count FROM server_daily_metrics WHERE guild_id = 'guild1'
        `).get()).toEqual({ joins: 0, leaves: 0, member_count: 2 });
        expect(database.sqlite.prepare(`
            SELECT user_id, present FROM member_presence WHERE guild_id = 'guild1' ORDER BY user_id
        `).all()).toEqual([
            { user_id: 'departed', present: 0 },
            { user_id: 'user1', present: 1 },
            { user_id: 'user2', present: 1 }
        ]);
        expect(database.sqlite.prepare(`
            SELECT user_id, eligible_since, last_observed_at FROM level_voice_sessions
            WHERE guild_id = 'guild1' ORDER BY user_id
        `).all()).toEqual([
            { user_id: 'user1', eligible_since: now, last_observed_at: now },
            { user_id: 'user2', eligible_since: now, last_observed_at: now }
        ]);
    });

    test('voice transitions settle eligible peer time exactly once', () => {
        const first = { id: 'user1', user: { id: 'user1', bot: false }, roles: { cache: new Map() } };
        const second = { id: 'user2', user: { id: 'user2', bot: false }, roles: { cache: new Map() } };
        const cache = new Map();
        const guild = { id: 'guild1', voiceStates: { cache } };
        const firstState = { guild, member: first, channelId: 'voice1', mute: false, deaf: false };
        const secondState = { guild, member: second, channelId: 'voice1', mute: false, deaf: false };
        cache.set(first.id, firstState);
        service.reconcileVoiceState({ guild, member: first, channelId: null }, firstState);
        cache.set(second.id, secondState);
        service.reconcileVoiceState({ guild, member: second, channelId: null }, secondState);

        now += 61_000;
        cache.delete(second.id);
        service.reconcileVoiceState(secondState, { guild, member: second, channelId: null, mute: false, deaf: false });
        service.reconcileVoiceState(secondState, { guild, member: second, channelId: null, mute: false, deaf: false });

        expect(database.sqlite.prepare(`
            SELECT user_id, xp, voice_xp, voice_seconds FROM member_levels
            WHERE guild_id = 'guild1' ORDER BY user_id
        `).all()).toEqual([
            { user_id: 'user1', xp: 5, voice_xp: 5, voice_seconds: 61 },
            { user_id: 'user2', xp: 5, voice_xp: 5, voice_seconds: 61 }
        ]);
        expect(database.sqlite.prepare(`
            SELECT voice_seconds FROM server_daily_metrics WHERE guild_id = 'guild1'
        `).get().voice_seconds).toBe(122);
    });

    test('voice XP honors the configured minimum and channel exclusions', () => {
        database.sqlite.prepare(`
            INSERT INTO level_configs (guild_id, voice_min_seconds, updated_at)
            VALUES ('guild1', 120, 1)
        `).run();
        const first = { id: 'user1', user: { bot: false }, roles: { cache: new Map() } };
        const second = { id: 'user2', user: { bot: false }, roles: { cache: new Map() } };
        const cache = new Map();
        const guild = { id: 'guild1', voiceStates: { cache } };
        const firstState = { guild, member: first, channelId: 'voice1', mute: false, deaf: false };
        const secondState = { guild, member: second, channelId: 'voice1', mute: false, deaf: false };
        cache.set(first.id, firstState); cache.set(second.id, secondState);
        service.reconcileVoiceState({ guild, member: first, channelId: null }, firstState);
        service.reconcileVoiceState({ guild, member: second, channelId: null }, secondState);
        now += 121_000;
        cache.delete(second.id);
        service.reconcileVoiceState(secondState, { guild, member: second, channelId: null, mute: false, deaf: false });
        expect(database.sqlite.prepare(`SELECT xp FROM member_levels WHERE guild_id = 'guild1' ORDER BY user_id`).all())
            .toEqual([{ xp: 10 }, { xp: 10 }]);

        database.sqlite.prepare(`INSERT INTO level_ignores (guild_id, target_type, target_id, created_at) VALUES ('guild1', 'channel', 'voice2', 1)`).run();
        const ignored = { guild, member: first, channelId: 'voice2', mute: false, deaf: false };
        cache.set(first.id, ignored); cache.set(second.id, { ...ignored, member: second });
        service.reconcileVoiceState(firstState, ignored);
        now += 121_000;
        expect(service.reconcileVoiceState(ignored, ignored).xpAwarded).toBe(0);
    });

    test('/levels config rate enforces Manage Server and persists the bounded value', async () => {
        const interaction = canManage => ({
            guildId: 'guild1',
            guild: { id: 'guild1' },
            user: { id: 'admin1' },
            member: { permissions: { has: permission => canManage && permission === PermissionFlagsBits.ManageGuild } },
            options: {
                getSubcommandGroup: () => 'config',
                getSubcommand: () => 'rate',
                getNumber: name => name === 'multiplier' ? 2.5 : null
            },
            reply: jest.fn()
        });

        await expect(service.execute(interaction(false))).rejects.toThrow('Manage Server');
        const allowed = interaction(true);
        await service.execute(allowed);

        expect(database.sqlite.prepare(`
            SELECT base_multiplier FROM level_configs WHERE guild_id = 'guild1'
        `).get().base_multiplier).toBe(2.5);
        expect(allowed.reply.mock.calls[0][0].embeds[0].data.description)
            .toBe('XP gain multiplier has been set to **2.5x**.');
    });

    test('/levels config switches persist explicit state instead of ambiguous toggles', async () => {
        const interaction = {
            guildId: 'guild1',
            guild: { id: 'guild1' },
            member: { permissions: { has: permission => permission === PermissionFlagsBits.ManageGuild } },
            options: {
                getSubcommandGroup: () => 'config',
                getSubcommand: () => 'text',
                getBoolean: name => name === 'enabled' ? false : null
            },
            reply: jest.fn()
        };

        await service.execute(interaction);

        expect(database.sqlite.prepare(`
            SELECT text_enabled FROM level_configs WHERE guild_id = 'guild1'
        `).get().text_enabled).toBe(0);
        expect(interaction.reply.mock.calls[0][0].embeds[0].data.description)
            .toBe('Text XP is now **disabled**.');
    });

    test('/levels boost requires exactly one typed target and persists its multiplier', async () => {
        const values = { role: { id: 'role1' }, channel: null };
        const interaction = {
            guildId: 'guild1',
            member: { permissions: { has: permission => permission === PermissionFlagsBits.ManageGuild } },
            options: {
                getSubcommandGroup: () => 'boost',
                getSubcommand: () => 'add',
                getRole: () => values.role,
                getChannel: () => values.channel,
                getNumber: () => 1.5
            },
            reply: jest.fn()
        };

        await service.execute(interaction);
        expect(database.sqlite.prepare(`
            SELECT target_type, target_id, multiplier FROM level_boosts WHERE guild_id = 'guild1'
        `).get()).toEqual({ target_type: 'role', target_id: 'role1', multiplier: 1.5 });
        values.channel = { id: 'channel1' };
        await expect(service.execute(interaction)).rejects.toThrow('exactly one');
    });

    test('/levels admin setxp explicitly replaces a legacy floor without corrupting tracks', async () => {
        database.sqlite.prepare(`
            INSERT INTO member_levels
                (guild_id, user_id, xp, level, text_xp, voice_xp, manual_adjustment,
                 level_floor, message_count, voice_seconds, updated_at)
            VALUES ('guild1', 'user1', 4321, 17, 0, 0, 4321, 17, 0, 0, 1)
        `).run();
        const interaction = {
            guildId: 'guild1',
            member: { permissions: { has: permission => permission === PermissionFlagsBits.ManageGuild } },
            options: {
                getSubcommandGroup: () => 'admin',
                getSubcommand: () => 'setxp',
                getUser: () => ({ id: 'user1' }),
                getInteger: name => name === 'xp' ? 100 : null
            },
            reply: jest.fn()
        };

        await service.execute(interaction);

        expect(database.sqlite.prepare(`
            SELECT xp, level, text_xp, voice_xp, manual_adjustment, level_floor
            FROM member_levels WHERE guild_id = 'guild1' AND user_id = 'user1'
        `).get()).toEqual({
            xp: 100, level: 1, text_xp: 0, voice_xp: 0,
            manual_adjustment: 100, level_floor: 0
        });
    });

    test('XP administration requires Manage Roles when reward roles can change', async () => {
        database.sqlite.prepare(`
            INSERT INTO level_role_rewards (guild_id, level, role_id, created_at)
            VALUES ('guild1', 1, 'reward1', 1)
        `).run();
        const interaction = {
            guildId: 'guild1',
            guild: { members: { me: { permissions: { has: () => true } } } },
            member: { permissions: { has: permission => permission === PermissionFlagsBits.ManageGuild } },
            options: {
                getSubcommandGroup: () => 'admin', getSubcommand: () => 'setxp',
                getUser: () => ({ id: 'user1' }), getInteger: () => 100
            }
        };

        await expect(service.execute(interaction)).rejects.toThrow('Manage Roles');
        expect(database.sqlite.prepare(`SELECT 1 FROM member_levels`).get()).toBeUndefined();
    });

    test('/levels ignore blocks XP but keeps accepted messages in analytics', async () => {
        const interaction = {
            guildId: 'guild1',
            member: { permissions: { has: permission => permission === PermissionFlagsBits.ManageGuild } },
            options: {
                getSubcommandGroup: () => 'ignore',
                getSubcommand: () => 'channel',
                getChannel: () => ({ id: 'channel1' })
            },
            reply: jest.fn()
        };
        await service.execute(interaction);
        const result = service.recordMessage({
            id: 'ignored-message', content: 'still activity', webhookId: null,
            guild: { id: 'guild1' }, channelId: 'channel1',
            author: { id: 'user1', bot: false }, member: { roles: { cache: new Map() } }
        });

        expect(result).toEqual(expect.objectContaining({ accepted: true, xpAwarded: 0 }));
        expect(database.sqlite.prepare(`
            SELECT message_count FROM server_daily_metrics WHERE guild_id = 'guild1'
        `).get().message_count).toBe(1);
    });

    test('/levels rank and leaderboard read the canonical lossless totals', async () => {
        database.sqlite.prepare(`
            INSERT INTO member_levels
                (guild_id, user_id, xp, level, text_xp, voice_xp, manual_adjustment,
                 level_floor, message_count, voice_seconds, updated_at)
            VALUES ('guild1', 'user1', 400, 2, 300, 50, 50, 0, 7, 125, 1)
        `).run();
        const reply = jest.fn();
        const options = {
            getSubcommandGroup: () => null,
            getSubcommand: () => 'rank',
            getUser: () => ({ id: 'user1', username: 'Member' }),
            getBoolean: () => true
        };
        const guild = { id: 'guild1', members: { cache: new Map(), fetch: jest.fn(async () => null) } };
        await service.execute({ guildId: 'guild1', guild, user: { id: 'viewer' }, options, reply });
        expect(reply.mock.calls[0][0].files[0].name).toBe('rank-user1.png');

        options.getSubcommand = () => 'leaderboard';
        options.getString = () => 'text';
        options.getInteger = () => 1;
        await service.execute({ guildId: 'guild1', guild, user: { id: 'viewer' }, options, reply });
        expect(reply.mock.calls[1][0].embeds[0].data.description).toContain('**300** text XP');
    });

    test('/levels reward enforces hierarchy and reconciles non-stacking roles', async () => {
        const reward = { id: 'reward1', managed: false };
        const highest = { comparePositionTo: () => 1 };
        const permissions = { has: permission => [PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles].includes(permission) };
        const interaction = {
            guildId: 'guild1',
            guild: {
                id: 'guild1', members: { me: { permissions, roles: { highest } } },
                roles: { cache: new Map([[reward.id, reward]]) }
            },
            member: { permissions, roles: { highest } },
            options: {
                getSubcommandGroup: () => 'reward', getSubcommand: () => 'add',
                getRole: () => reward, getInteger: () => 2
            },
            reply: jest.fn()
        };
        await service.execute(interaction);
        expect(database.sqlite.prepare(`SELECT level, role_id FROM level_role_rewards WHERE guild_id = 'guild1'`).get())
            .toEqual({ level: 2, role_id: 'reward1' });

        database.sqlite.prepare(`
            INSERT INTO member_levels
                (guild_id, user_id, xp, level, text_xp, voice_xp, manual_adjustment,
                 level_floor, message_count, voice_seconds, updated_at)
            VALUES ('guild1', 'user1', 400, 2, 400, 0, 0, 0, 0, 0, 1)
        `).run();
        const add = jest.fn();
        const member = {
            id: 'user1', user: { bot: false }, guild: interaction.guild,
            roles: { cache: new Map(), add, remove: jest.fn() }
        };
        await service.reconcileMemberRoles(member);
        expect(add).toHaveBeenCalledWith(['reward1'], 'Level reward reconciliation');
    });

    test('role reconciliation survives a Discord failure and service restart', async () => {
        database.sqlite.prepare(`INSERT INTO level_configs (guild_id, updated_at) VALUES ('guild1', 1)`).run();
        database.sqlite.prepare(`
            INSERT INTO level_role_rewards (guild_id, level, role_id, created_at)
            VALUES ('guild1', 1, 'reward1', 1)
        `).run();
        database.sqlite.prepare(`
            INSERT INTO member_levels
                (guild_id, user_id, xp, level, text_xp, voice_xp, manual_adjustment,
                 level_floor, message_count, voice_seconds, updated_at)
            VALUES ('guild1', 'user1', 100, 1, 100, 0, 0, 0, 0, 0, 1)
        `).run();
        const add = jest.fn().mockRejectedValueOnce(new Error('Discord unavailable')).mockResolvedValue(undefined);
        const highest = { comparePositionTo: () => 1 };
        const member = {
            id: 'user1', user: { bot: false },
            roles: { cache: new Map(), add, remove: jest.fn() }
        };
        const guild = {
            id: 'guild1', roles: { cache: new Map([['reward1', { id: 'reward1', managed: false }]]) },
            members: {
                me: { permissions: { has: () => true }, roles: { highest } },
                cache: new Map([['user1', member]]), fetch: jest.fn()
            }
        };
        member.guild = guild;
        service.client = { guilds: { cache: new Map([['guild1', guild]]) } };
        service.enqueueRoleReconcile('guild1', 'user1');

        expect((await service.processRoleJobs()).failures).toHaveLength(1);
        now += 3000;
        const LevelAnalyticsService = require('../src/services/levelAnalyticsService');
        service = new LevelAnalyticsService({ sqlite: database.sqlite, client: service.client, now: () => now });
        expect((await service.processRoleJobs()).processed).toBe(1);
        expect(add).toHaveBeenCalledTimes(2);
        expect(database.sqlite.prepare(`SELECT 1 FROM level_role_jobs`).get()).toBeUndefined();
    });

    test('a finishing role worker cannot delete a newer reconciliation request', async () => {
        database.sqlite.prepare(`INSERT INTO level_configs (guild_id, updated_at) VALUES ('guild1', 1)`).run();
        database.sqlite.prepare(`
            INSERT INTO level_role_rewards (guild_id, level, role_id, created_at)
            VALUES ('guild1', 1, 'reward1', 1)
        `).run();
        database.sqlite.prepare(`
            INSERT INTO member_levels
                (guild_id, user_id, xp, level, text_xp, voice_xp, manual_adjustment,
                 level_floor, message_count, voice_seconds, updated_at)
            VALUES ('guild1', 'user1', 100, 1, 100, 0, 0, 0, 0, 0, 1)
        `).run();
        let finishAdd;
        const add = jest.fn(() => new Promise(resolve => { finishAdd = resolve; }));
        const highest = { comparePositionTo: () => 1 };
        const member = { id: 'user1', user: { bot: false }, roles: { cache: new Map(), add, remove: jest.fn() } };
        const guild = {
            id: 'guild1', roles: { cache: new Map([['reward1', { id: 'reward1', managed: false }]]) },
            members: {
                me: { permissions: { has: () => true }, roles: { highest } },
                cache: new Map([['user1', member]]), fetch: jest.fn()
            }
        };
        member.guild = guild;
        service.client = { guilds: { cache: new Map([['guild1', guild]]) } };
        service.enqueueRoleReconcile('guild1', 'user1');

        const processing = service.processRoleJobs();
        await Promise.resolve();
        now += 5 * 60 * 1000 + 1;
        expect(await service.processRoleJobs()).toEqual({ processed: 0, failures: [] });
        expect(add).toHaveBeenCalledTimes(1);
        service.enqueueRoleReconcile('guild1', 'user1');
        finishAdd();
        await processing;

        expect(database.sqlite.prepare(`SELECT generation, claim_token FROM level_role_jobs`).get())
            .toEqual({ generation: 2, claim_token: null });
    });

    test('an expired role-job claim is reclaimed after a worker crash', async () => {
        database.sqlite.prepare(`
            INSERT INTO level_role_jobs
                (guild_id, user_id, claim_token, claim_expires_at, next_attempt_at, updated_at)
            VALUES ('guild1', 'user1', 'dead-worker', ?, ?, ?)
        `).run(now + 5 * 60 * 1000, now, now);
        service.client = { guilds: { cache: new Map() } };

        await service.processRoleJobs();
        expect(database.sqlite.prepare(`SELECT attempts, claim_token FROM level_role_jobs`).get())
            .toEqual({ attempts: 0, claim_token: 'dead-worker' });
        now += 5 * 60 * 1000 + 1;
        await service.processRoleJobs();

        expect(database.sqlite.prepare(`SELECT attempts, claim_token, claim_expires_at FROM level_role_jobs`).get())
            .toEqual({ attempts: 1, claim_token: null, claim_expires_at: null });
    });

    test('a transient member fetch failure keeps the role job retryable', async () => {
        database.sqlite.prepare(`
            INSERT INTO level_role_jobs (guild_id, user_id, next_attempt_at, updated_at)
            VALUES ('guild1', 'user1', ?, ?)
        `).run(now, now);
        const fetch = jest.fn().mockRejectedValue(new Error('connection reset'));
        service.client = { guilds: { cache: new Map([['guild1', {
            id: 'guild1', members: { cache: new Map(), fetch }
        }]]) } };

        const result = await service.processRoleJobs();

        expect(result.failures).toHaveLength(1);
        expect(database.sqlite.prepare(`SELECT attempts, claim_token FROM level_role_jobs`).get())
            .toEqual({ attempts: 1, claim_token: null });
    });

    test('configured level-up scripts are validated and delivered only on a level increase', async () => {
        const payload = { content: '<@user1> reached 1', allowedMentions: { parse: [] } };
        const send = jest.fn();
        service.client = { richContentService: { renderLevel: jest.fn(() => payload) } };
        const interaction = {
            guildId: 'guild1', guild: { id: 'guild1' }, user: { id: 'admin1' },
            member: { permissions: { has: permission => permission === PermissionFlagsBits.ManageGuild } },
            options: {
                getSubcommandGroup: () => 'message', getSubcommand: () => 'set',
                getString: () => '{content: {user} reached {level}}'
            },
            reply: jest.fn()
        };
        await service.execute(interaction);
        database.sqlite.prepare(`UPDATE level_configs SET award_channel_id = 'awards' WHERE guild_id = 'guild1'`).run();
        database.sqlite.prepare(`
            INSERT INTO member_levels
                (guild_id, user_id, xp, level, text_xp, voice_xp, manual_adjustment,
                 level_floor, message_count, voice_seconds, updated_at)
            VALUES ('guild1', 'user1', 100, 1, 100, 0, 0, 0, 5, 0, 1)
        `).run();
        const message = {
            author: { id: 'user1' }, member: { id: 'user1' },
            guild: {
                id: 'guild1', channels: {
                    cache: new Map([['awards', { send }]]), fetch: jest.fn()
                }
            }
        };
        await service.announceLevel(message, { accepted: true, previousLevel: 0, level: 1 });
        await service.announceLevel(message, { accepted: true, previousLevel: 1, level: 1 });
        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith(payload);
    });

    test('setup is actor-bound and reset-all consumes one confirmation', async () => {
        database.sqlite.prepare(`
            INSERT INTO member_levels
                (guild_id, user_id, xp, level, text_xp, voice_xp, manual_adjustment,
                 level_floor, message_count, voice_seconds, updated_at)
            VALUES ('guild1', 'user1', 100, 1, 100, 0, 0, 0, 1, 0, 1)
        `).run();
        const permissions = { has: permission => permission === PermissionFlagsBits.ManageGuild };
        const reply = jest.fn();
        const guild = { id: 'guild1', members: { fetch: jest.fn(async () => new Map()) } };
        await service.execute({
            guildId: 'guild1', guild, user: { id: 'admin1' }, member: { permissions }, reply,
            options: { getSubcommandGroup: () => null, getSubcommand: () => 'setup' }
        });
        expect(reply.mock.calls[0][0].components[0].components[0].data.custom_id).toBe('levels:setup:text:admin1');

        await service.execute({
            guildId: 'guild1', guild, user: { id: 'admin1' }, member: { permissions }, reply,
            options: { getSubcommandGroup: () => 'reset', getSubcommand: () => 'all' }
        });
        const customId = reply.mock.calls[1][0].components[0].components[0].data.custom_id;
        const confirmation = {
            customId, guildId: 'guild1', guild, user: { id: 'admin1' }, member: { permissions },
            update: jest.fn(), deferUpdate: jest.fn(), editReply: jest.fn(),
            isModalSubmit: () => false, isChannelSelectMenu: () => false
        };
        await service.handleInteraction(confirmation);
        expect(confirmation.deferUpdate.mock.invocationCallOrder[0])
            .toBeLessThan(guild.members.fetch.mock.invocationCallOrder[0]);
        expect(confirmation.editReply).toHaveBeenCalled();
        expect(database.sqlite.prepare(`SELECT 1 FROM member_levels WHERE guild_id = 'guild1'`).get()).toBeUndefined();
        await expect(service.handleInteraction(confirmation)).rejects.toThrow('expired');
    });

    test('setup acknowledges reward removal before member-wide Discord work', async () => {
        database.sqlite.prepare(`INSERT INTO level_configs (guild_id, updated_at) VALUES ('guild1', 1)`).run();
        database.sqlite.prepare(`
            INSERT INTO level_role_rewards (guild_id, level, role_id, created_at)
            VALUES ('guild1', 1, 'reward1', 1)
        `).run();
        const highest = { comparePositionTo: () => 1 };
        const permissions = { has: permission => [PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles].includes(permission) };
        const affected = {
            id: 'user1', user: { bot: false },
            roles: { cache: new Map([['reward1', {}]]), remove: jest.fn(), add: jest.fn() }
        };
        const guild = {
            id: 'guild1', roles: { cache: new Map([['reward1', { id: 'reward1', managed: false }]]) },
            members: {
                me: { permissions, roles: { highest } },
                fetch: jest.fn(async () => new Map([['user1', affected]]))
            }
        };
        affected.guild = guild;
        const interaction = {
            customId: 'levels:setup:role-remove:admin1', guildId: 'guild1', guild,
            user: { id: 'admin1' }, member: { permissions, roles: { highest } },
            fields: { getTextInputValue: name => name === 'role' ? 'reward1' : '1' },
            isModalSubmit: () => true, isChannelSelectMenu: () => false,
            deferReply: jest.fn(), editReply: jest.fn(), reply: jest.fn()
        };

        await service.handleInteraction(interaction);

        expect(interaction.deferReply.mock.invocationCallOrder[0])
            .toBeLessThan(guild.members.fetch.mock.invocationCallOrder[0]);
        expect(interaction.editReply).toHaveBeenCalled();
    });

    test('rank-card color and layout are ungated and render a PNG', async () => {
        const values = { action: 'color', color: '#12abef', layout: null, border: null };
        const interaction = {
            guildId: 'guild1', user: { id: 'user1', username: 'Member' },
            guild: { id: 'guild1', members: { cache: new Map(), fetch: jest.fn(async () => null) } },
            options: {
                getSubcommandGroup: () => 'rankcard', getSubcommand: () => values.action,
                getString: name => name === 'color' ? values.color : name === 'layout' ? values.layout : null,
                getInteger: () => values.border, getAttachment: () => null, getUser: () => null
            },
            reply: jest.fn(), deferReply: jest.fn(), editReply: jest.fn()
        };
        await service.execute(interaction);
        values.action = 'style'; values.color = null; values.layout = 'compact'; values.border = 9;
        await service.execute(interaction);
        values.action = 'view';
        await service.execute(interaction);

        expect(database.sqlite.prepare(`SELECT accent, layout, avatar_border FROM level_rank_cards WHERE user_id = 'user1'`).get())
            .toEqual({ accent: '#12ABEF', layout: 'compact', avatar_border: 9 });
        const metadata = await require('sharp')(interaction.editReply.mock.calls[0][0].files[0].attachment).metadata();
        expect(metadata).toEqual(expect.objectContaining({ format: 'png', width: 760, height: 220 }));
    });

    test('live boards persist and recreate a missing bot message', async () => {
        const send = jest.fn()
            .mockResolvedValueOnce({ id: 'board1' })
            .mockResolvedValueOnce({ id: 'board2' });
        const channel = {
            id: 'channel1', send,
            messages: { fetch: jest.fn(async () => null) }
        };
        const guild = {
            id: 'guild1', channels: { cache: new Map([['channel1', channel]]), fetch: jest.fn() },
            members: {
                me: {
                    permissionsIn: () => ({ has: () => true })
                }
            }
        };
        const interaction = {
            guildId: 'guild1', guild, channel,
            member: { permissions: { has: permission => permission === PermissionFlagsBits.ManageGuild } },
            options: {
                getSubcommandGroup: () => 'live', getSubcommand: () => 'text', getChannel: () => null
            },
            reply: jest.fn(), deferReply: jest.fn(), editReply: jest.fn()
        };
        await service.execute(interaction);
        service.client = { guilds: { cache: new Map([['guild1', guild]]) } };
        await service.refreshLiveBoards();

        expect(send).toHaveBeenCalledTimes(2);
        expect(interaction.deferReply.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
        expect(interaction.editReply).toHaveBeenCalled();
        expect(send.mock.calls[0][0]).toEqual(expect.objectContaining({ enforceNonce: true, nonce: expect.any(String) }));
        expect(send.mock.calls[1][0].nonce).toBe(send.mock.calls[0][0].nonce);
        expect(database.sqlite.prepare(`SELECT message_id, revision FROM level_live_boards WHERE guild_id = 'guild1'`).get())
            .toEqual({ message_id: 'board2', revision: 2 });
    });

    test('live boards do not resend after the nonce recovery window expires', async () => {
        const send = jest.fn().mockResolvedValue({ id: 'replacement' });
        const channel = { id: 'channel1', send, messages: { fetch: jest.fn() } };
        const guild = {
            id: 'guild1', channels: { cache: new Map([['channel1', channel]]), fetch: jest.fn() },
            members: { me: { permissionsIn: () => ({ has: () => true }) } }
        };
        database.sqlite.prepare(`
            INSERT INTO level_live_boards
                (guild_id, channel_id, metric, create_token, create_status, create_started_at, revision, updated_at)
            VALUES ('guild1', 'channel1', 'text', 'token', 'creating', ?, 0, 1)
        `).run(now - 5 * 60 * 1000 - 1);
        service.client = { guilds: { cache: new Map([['guild1', guild]]) } };

        const result = await service.refreshLiveBoards();

        expect(result).toEqual(expect.objectContaining({ updated: 0, failures: [expect.objectContaining({
            error: expect.stringContaining('administrator recovery')
        })] }));
        expect(send).not.toHaveBeenCalled();

        const listReply = jest.fn();
        await service.execute({
            guildId: 'guild1', guild, member: {
                permissions: { has: () => true }, permissionsIn: () => ({ has: () => true })
            },
            options: {
                getSubcommandGroup: () => 'live', getSubcommand: () => 'recover',
                getString: () => 'list'
            },
            reply: listReply
        });
        expect(listReply.mock.calls[0][0].embeds[0].data.description).toContain('channel1');

        const interaction = {
            guildId: 'guild1', guild, member: { permissions: { has: () => true } },
            options: {
                getSubcommandGroup: () => 'live', getSubcommand: () => 'recover',
                getString: name => name === 'action' ? 'force' : 'text',
                getChannel: () => channel, getBoolean: () => true
            },
            deferReply: jest.fn(), editReply: jest.fn(), reply: jest.fn()
        };
        await service.execute(interaction);

        expect(send).toHaveBeenCalledTimes(1);
        expect(database.sqlite.prepare(`SELECT message_id, create_status FROM level_live_boards`).get())
            .toEqual({ message_id: 'replacement', create_status: 'active' });
    });

    test('a definite live-board send rejection remains retryable', async () => {
        const error = Object.assign(new Error('forbidden'), { status: 403 });
        const channel = { id: 'channel1', send: jest.fn().mockRejectedValue(error), messages: { fetch: jest.fn() } };
        const guild = { id: 'guild1', channels: { cache: new Map([['channel1', channel]]), fetch: jest.fn() } };
        database.sqlite.prepare(`
            INSERT INTO level_live_boards
                (guild_id, channel_id, metric, create_token, revision, updated_at)
            VALUES ('guild1', 'channel1', 'text', 'token', 0, 1)
        `).run();
        service.client = { guilds: { cache: new Map([['guild1', guild]]) } };

        await service.refreshLiveBoards();

        expect(database.sqlite.prepare(`SELECT create_status, create_started_at FROM level_live_boards`).get())
            .toEqual({ create_status: 'active', create_started_at: null });
    });

    test('a transient live-board fetch failure cannot create a duplicate message', async () => {
        const send = jest.fn();
        const channel = {
            id: 'channel1', send,
            messages: { fetch: jest.fn().mockRejectedValue(new Error('connection reset')) }
        };
        const guild = { id: 'guild1', channels: { cache: new Map([['channel1', channel]]), fetch: jest.fn() } };
        database.sqlite.prepare(`
            INSERT INTO level_live_boards
                (guild_id, channel_id, message_id, metric, create_token, revision, updated_at)
            VALUES ('guild1', 'channel1', 'board1', 'text', 'token', 1, 1)
        `).run();
        service.client = { guilds: { cache: new Map([['guild1', guild]]) } };

        const result = await service.refreshLiveBoards();

        expect(result.updated).toBe(0);
        expect(result.failures).toHaveLength(1);
        expect(send).not.toHaveBeenCalled();
    });

    test('voice accounting splits real seconds at UTC midnight', () => {
        const { levelForXp, utcSegments } = require('../src/services/levelAnalyticsService');
        expect(utcSegments(Date.UTC(2026, 7, 24, 23, 59, 30), 61)).toEqual([
            { day: '2026-08-24', seconds: 30 },
            { day: '2026-08-25', seconds: 31 }
        ]);
        expect([0, 99, 100, 399, 100_000, Number.MAX_SAFE_INTEGER].map(levelForXp))
            .toEqual([0, 0, 1, 1, 31, 999]);
    });

    test('analytics retention prunes history without deleting XP balances', () => {
        service.recordMessage({
            id: 'old-message', content: 'old', webhookId: null,
            guild: { id: 'guild1' }, channelId: 'channel1',
            author: { id: 'user1', bot: false }, member: { roles: { cache: new Map() } }
        });
        database.sqlite.prepare(`UPDATE server_daily_metrics SET activity_date = '2020-01-01'`).run();
        database.sqlite.prepare(`UPDATE activity_logs SET activity_date = '2020-01-01'`).run();
        database.sqlite.prepare(`UPDATE analytics_events SET occurred_at = 1`).run();

        expect(service.pruneAnalytics()).toEqual({ daily: 1, activity: 1, dedupe: 1, reactions: 0 });
        expect(database.sqlite.prepare(`SELECT xp FROM member_levels WHERE guild_id = 'guild1'`).get().xp).toBe(20);
    });
});
