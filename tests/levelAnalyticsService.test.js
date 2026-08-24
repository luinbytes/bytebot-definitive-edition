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
            SELECT joins, leaves FROM server_daily_metrics WHERE guild_id = 'guild1'
        `).get()).toEqual({ joins: 1, leaves: 1 });
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
        expect(allowed.reply).toHaveBeenCalledWith(expect.objectContaining({
            content: 'XP gain multiplier has been set to **2.5x**.'
        }));
    });
});
