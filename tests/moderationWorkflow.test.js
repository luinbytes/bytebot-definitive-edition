const fs = require('fs');
const os = require('os');
const path = require('path');
const { PermissionFlagsBits } = require('discord.js');

function moderator() {
    return {
        id: 'mod1',
        user: { id: 'mod1', tag: 'Moderator' },
        roles: { cache: new Map(), highest: { position: 10 } },
        permissions: {
            has: jest.fn(permission => {
                const granted = [
                    PermissionFlagsBits.ModerateMembers,
                    PermissionFlagsBits.BanMembers,
                    PermissionFlagsBits.KickMembers,
                    PermissionFlagsBits.ManageRoles,
                    PermissionFlagsBits.ManageGuild,
                    PermissionFlagsBits.ViewAuditLog
                ];
                return Array.isArray(permission)
                    ? permission.every(value => granted.includes(value))
                    : granted.includes(permission);
            })
        }
    };
}

function targetMember(guild) {
    const user = {
        id: 'user1',
        tag: 'Target',
        username: 'Target',
        bot: false,
        send: jest.fn().mockResolvedValue({})
    };
    return {
        id: user.id,
        user,
        guild,
        roles: { cache: new Map(), highest: { position: 1 } },
        timeout: jest.fn().mockResolvedValue({})
    };
}

function interaction({ guild, member, group = 'user', subcommand, values = {} }) {
    return {
        commandName: 'mod',
        guild,
        channelId: 'channel1',
        user: member.user,
        member,
        options: {
            getSubcommandGroup: jest.fn().mockReturnValue(group),
            getSubcommand: jest.fn().mockReturnValue(subcommand),
            getString: jest.fn(name => values[name] ?? null),
            getInteger: jest.fn(name => values[name] ?? null),
            getBoolean: jest.fn(name => values[name] ?? null),
            getMember: jest.fn(name => values[name] ?? null),
            getUser: jest.fn(name => values[name]?.user || values[name] || null),
            getRole: jest.fn(name => values[name] ?? null),
            getChannel: jest.fn(name => values[name] ?? null)
        },
        deferReply: jest.fn(function defer() { this.deferred = true; }),
        editReply: jest.fn(),
        reply: jest.fn(),
        deferred: false,
        replied: false
    };
}

describe('core moderation workflow', () => {
    let tempDir;
    let database;
    let mod;
    let guild;
    let actor;
    let target;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-moderation-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        mod = require('../src/commands/moderation/mod');
        guild = {
            id: 'guild1',
            name: 'Guild',
            ownerId: 'owner1',
            members: {
                me: {
                    id: 'bot1',
                    roles: { highest: { position: 20 } },
                    permissions: { has: jest.fn().mockReturnValue(true) }
                },
                fetch: jest.fn(),
                ban: jest.fn().mockResolvedValue({}),
                unban: jest.fn().mockResolvedValue({})
            }
        };
        actor = moderator();
        target = targetMember(guild);
        guild.members.fetch.mockResolvedValue(target);
    });

    afterEach(() => {
        database.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('timeout creates an inspectable case that can be undone', async () => {
        const timeout = interaction({
            guild,
            member: actor,
            subcommand: 'timeout',
            values: { target, duration: '10m', reason: 'cool down' }
        });
        await mod.execute(timeout, {});

        expect(target.timeout).toHaveBeenCalledWith(600000, 'cool down');
        expect(timeout.editReply.mock.calls[0][0].embeds[0].data.description).toContain('Case #1');

        guild.members.fetch.mockResolvedValueOnce(new Map([[target.id, { ...target, communicationDisabledUntilTimestamp: Date.now() + 600000 }]]));
        const timeoutList = interaction({ guild, member: actor, group: 'status', subcommand: 'timeouts' });
        await mod.execute(timeoutList, {});
        expect(timeoutList.editReply.mock.calls[0][0].embeds[0].data.description).toContain('<@user1>');

        const view = interaction({
            guild,
            member: actor,
            group: 'case',
            subcommand: 'view',
            values: { number: 1 }
        });
        await mod.execute(view, {});
        expect(view.editReply.mock.calls[0][0].embeds[0].data.description).toContain('TIMEOUT');
        expect(view.editReply.mock.calls[0][0].embeds[0].data.description).toContain('completed');

        const undo = interaction({
            guild,
            member: actor,
            group: 'case',
            subcommand: 'undo',
            values: { number: 1, reason: 'appeal accepted' }
        });
        await mod.execute(undo, {});

        expect(target.timeout).toHaveBeenLastCalledWith(null, 'appeal accepted');
        expect(undo.editReply.mock.calls[0][0].embeds[0].data.description).toContain('Case #1');
    });

    test('timeouts over Discord maximum are rejected before a case or mutation', async () => {
        const timeout = interaction({ guild, member: actor, subcommand: 'timeout', values: { target, duration: '29d', reason: 'too long' } });
        await mod.execute(timeout, {});
        expect(target.timeout).not.toHaveBeenCalled();
        expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM moderation_cases').get().count).toBe(0);
        expect(timeout.editReply.mock.calls[0][0].embeds[0].data.description).toContain('27 days');

        const tooShort = interaction({ guild, member: actor, subcommand: 'timeout', values: { target, duration: '30s', reason: 'too short' } });
        await mod.execute(tooShort, {});
        expect(target.timeout).not.toHaveBeenCalled();
    });

    test('only one concurrent case undo can claim the Discord mutation', async () => {
        await mod.execute(interaction({ guild, member: actor, subcommand: 'timeout', values: { target, duration: '10m' } }), {});
        let release;
        target.timeout.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const first = interaction({ guild, member: actor, group: 'case', subcommand: 'undo', values: { number: 1, reason: 'first' } });
        const second = interaction({ guild, member: actor, group: 'case', subcommand: 'undo', values: { number: 1, reason: 'second' } });
        const firstRun = mod.execute(first, {});
        await new Promise(resolve => setImmediate(resolve));
        await mod.execute(second, {});
        release({});
        await firstRun;

        expect(target.timeout).toHaveBeenCalledTimes(2);
        expect(second.editReply.mock.calls[0][0].embeds[0].data.description).toContain('already');
        expect(database.sqlite.prepare('SELECT status FROM moderation_cases WHERE case_number = 1').get().status).toBe('undone');
    });

    test('ban is recorded only after Discord accepts the action', async () => {
        target.bannable = true;
        target.ban = jest.fn().mockResolvedValue({});
        const ban = interaction({
            guild,
            member: actor,
            subcommand: 'ban',
            values: { target, reason: 'raid account' }
        });
        await mod.execute(ban, {});

        expect(target.ban).toHaveBeenCalledWith({ reason: 'raid account' });
        const view = interaction({
            guild,
            member: actor,
            group: 'case',
            subcommand: 'view',
            values: { number: 1 }
        });
        await mod.execute(view, {});
        expect(view.editReply.mock.calls[0][0].embeds[0].data.description).toContain('BAN');
        expect(view.editReply.mock.calls[0][0].embeds[0].data.description).toContain('completed');
    });

    test('action-specific Discord permissions cannot be bypassed by root command access', async () => {
        target.bannable = true;
        target.ban = jest.fn().mockResolvedValue({});
        actor.permissions.has = jest.fn(permission => Array.isArray(permission)
            ? permission.every(value => value === PermissionFlagsBits.ModerateMembers)
            : permission === PermissionFlagsBits.ModerateMembers);

        const ban = interaction({ guild, member: actor, subcommand: 'ban', values: { target, reason: 'test' } });
        await mod.execute(ban, {});

        expect(target.ban).not.toHaveBeenCalled();
        expect(ban.reply.mock.calls[0][0].embeds[0].data.title).toContain('Insufficient Permissions');
    });

    test('kick and warning cases share one guild-local sequence', async () => {
        target.kickable = true;
        target.kick = jest.fn().mockResolvedValue({});
        await mod.execute(interaction({
            guild,
            member: actor,
            subcommand: 'kick',
            values: { target, reason: 'disruption' }
        }), {});
        await mod.execute(interaction({
            guild,
            member: actor,
            subcommand: 'warn',
            values: { target, reason: 'final warning' }
        }), {});

        const viewKick = interaction({ guild, member: actor, group: 'case', subcommand: 'view', values: { number: 1 } });
        const viewWarn = interaction({ guild, member: actor, group: 'case', subcommand: 'view', values: { number: 2 } });
        await mod.execute(viewKick, {});
        await mod.execute(viewWarn, {});

        expect(viewKick.editReply.mock.calls[0][0].embeds[0].data.description).toContain('KICK');
        expect(viewWarn.editReply.mock.calls[0][0].embeds[0].data.description).toContain('WARN');
    });

    test('softban, hardban, and unban execute their distinct Discord operations', async () => {
        target.bannable = true;
        target.ban = jest.fn().mockResolvedValue({});

        await mod.execute(interaction({ guild, member: actor, subcommand: 'softban', values: { target, reason: 'cleanup' } }), {});
        await mod.execute(interaction({ guild, member: actor, subcommand: 'unban', values: { user_id: 'user1', reason: 'appeal' } }), {});
        await mod.execute(interaction({ guild, member: actor, subcommand: 'hardban', values: { target, reason: 'harmful history' } }), {});

        expect(guild.members.ban).toHaveBeenCalledWith('user1', { reason: 'cleanup', deleteMessageSeconds: 86400 });
        expect(guild.members.unban).toHaveBeenNthCalledWith(1, 'user1', 'Softban cleanup');
        expect(target.ban).toHaveBeenCalledWith({ reason: 'harmful history' });
        expect(guild.members.unban).toHaveBeenLastCalledWith('user1', 'appeal');

        for (const [number, action] of [[1, 'SOFTBAN'], [2, 'UNBAN'], [3, 'HARDBAN']]) {
            const view = interaction({ guild, member: actor, group: 'case', subcommand: 'view', values: { number } });
            await mod.execute(view, {});
            expect(view.editReply.mock.calls[0][0].embeds[0].data.description).toContain(action);
        }
    });

    test('unban resolves the user so its invoke template is delivered', async () => {
        guild.client = { users: { fetch: jest.fn().mockResolvedValue(target.user) } };
        database.sqlite.prepare(`
            INSERT INTO moderation_templates (guild_id, action, message_type, template) VALUES (?, 'UNBAN', 'dm', ?)
        `).run(guild.id, 'Appeal accepted: {reason}');

        await mod.execute(interaction({ guild, member: actor, subcommand: 'unban', values: { user_id: target.id, reason: 'reviewed' } }), {});
        expect(guild.client.users.fetch).toHaveBeenCalledWith(target.id);
        expect(target.user.send).toHaveBeenCalledWith(expect.objectContaining({ content: 'Appeal accepted: reviewed' }));
    });

    test('hardban accepts bounded message history and appears in the active list', async () => {
        target.ban = jest.fn().mockResolvedValue({});
        await mod.execute(interaction({
            guild,
            member: actor,
            subcommand: 'hardban',
            values: { target, reason: 'persistent threat', history: 2 }
        }), {});
        expect(target.ban).toHaveBeenCalledWith({ reason: 'persistent threat', deleteMessageSeconds: 172800 });

        const duplicate = interaction({ guild, member: actor, subcommand: 'hardban', values: { target, reason: 'duplicate' } });
        await mod.execute(duplicate, {});
        expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM moderation_cases').get().count).toBe(1);
        expect(database.sqlite.prepare('SELECT case_number FROM moderation_hardbans WHERE user_id = ?').get(target.id).case_number).toBe(1);

        const list = interaction({ guild, member: actor, group: 'status', subcommand: 'hardbans' });
        await mod.execute(list, {});
        expect(list.editReply.mock.calls[0][0].embeds[0].data.description).toContain('<@user1>');

        guild.members.unban.mockClear();
        const rejected = interaction({ guild, member: actor, subcommand: 'unban', values: { user_id: target.id, reason: 'unauthorized' } });
        await mod.execute(rejected, {});
        expect(guild.members.unban).not.toHaveBeenCalled();
        expect(rejected.editReply.mock.calls[0][0].embeds[0].data.description).toContain('server owner');
    });

    test('hardban is re-applied after an external unban until its case is undone', async () => {
        guild.ownerId = actor.id;
        target.bannable = true;
        target.ban = jest.fn().mockResolvedValue({});
        await mod.execute(interaction({ guild, member: actor, subcommand: 'hardban', values: { target, reason: 'persistent threat' } }), {});

        const event = require('../src/events/guildBanRemove');
        guild.members.ban.mockClear();
        await event.execute({ guild, user: target.user });
        expect(guild.members.ban).toHaveBeenCalledWith(target.id, { reason: 'Active hardban case #1' });

        await mod.execute(interaction({ guild, member: actor, group: 'case', subcommand: 'undo', values: { number: 1, reason: 'appeal accepted' } }), {});
        expect(database.sqlite.prepare('SELECT status FROM moderation_cases WHERE case_number = 1').get().status).toBe('undone');
        expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM moderation_hardbans').get().count).toBe(0);
        guild.members.ban.mockClear();
        await event.execute({ guild, user: target.user });
        expect(guild.members.ban).not.toHaveBeenCalled();
    });

    test('case reset does not disable active hardban state and owner unban removes it', async () => {
        guild.ownerId = actor.id;
        target.ban = jest.fn().mockResolvedValue({});
        await mod.execute(interaction({ guild, member: actor, subcommand: 'hardban', values: { target, reason: 'persistent threat' } }), {});
        await mod.execute(interaction({ guild, member: actor, group: 'case', subcommand: 'reset', values: { confirm: true } }), {});
        expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM moderation_cases').get().count).toBe(0);
        expect(database.sqlite.prepare(`SELECT state FROM moderation_hardbans WHERE user_id = ?`).get(target.id).state).toBe('active');

        const event = require('../src/events/guildBanRemove');
        guild.members.ban.mockClear();
        await event.execute({ guild, user: target.user });
        expect(guild.members.ban).toHaveBeenCalled();

        await mod.execute(interaction({ guild, member: actor, subcommand: 'unban', values: { user_id: target.id, reason: 'owner appeal' } }), {});
        expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM moderation_hardbans').get().count).toBe(0);
    });

    test('a failed softban cleanup remains visible and can be reconciled with case undo', async () => {
        guild.members.unban.mockRejectedValueOnce(new Error('Discord unavailable'));
        await mod.execute(interaction({ guild, member: actor, subcommand: 'softban', values: { target, reason: 'cleanup' } }), {});

        expect(database.sqlite.prepare('SELECT status FROM moderation_cases WHERE case_number = 1').get().status).toBe('cleanup_required');
        await mod.execute(interaction({ guild, member: actor, group: 'case', subcommand: 'undo', values: { number: 1, reason: 'finish cleanup' } }), {});
        expect(guild.members.unban).toHaveBeenLastCalledWith(target.id, 'finish cleanup');
        expect(database.sqlite.prepare('SELECT status FROM moderation_cases WHERE case_number = 1').get().status).toBe('undone');
    });

    test('configured mute and jail roles are applied, removed, and reversible', async () => {
        const imageRole = { id: 'image-role', name: 'Image Muted', position: 2 };
        const jailRole = { id: 'jail-role', name: 'Jailed', position: 2 };
        const jailChannel = { id: 'jail-channel' };
        guild.roles = { cache: new Map([[imageRole.id, imageRole], [jailRole.id, jailRole]]) };
        target.roles.add = jest.fn().mockResolvedValue({});
        target.roles.remove = jest.fn().mockResolvedValue({});
        target.roles.set = jest.fn().mockResolvedValue({});

        await mod.execute(interaction({ guild, member: actor, group: 'config', subcommand: 'imuted', values: { role: imageRole } }), {});
        await mod.execute(interaction({ guild, member: actor, group: 'config', subcommand: 'jail', values: { role: jailRole, channel: jailChannel } }), {});
        await mod.execute(interaction({ guild, member: actor, subcommand: 'imute', values: { target, reason: 'image spam' } }), {});
        target.roles.cache.set('member-role', { id: 'member-role', managed: false });
        await mod.execute(interaction({ guild, member: actor, subcommand: 'jail', values: { target, reason: 'raid review' } }), {});

        expect(target.roles.add).toHaveBeenNthCalledWith(1, imageRole, 'image spam');
        expect(target.roles.set).toHaveBeenNthCalledWith(1, [jailRole.id], 'raid review');

        target.roles.cache.set(jailRole.id, jailRole);
        await mod.execute(interaction({ guild, member: actor, group: 'case', subcommand: 'undo', values: { number: 2, reason: 'review complete' } }), {});
        expect(target.roles.set).toHaveBeenNthCalledWith(2, ['member-role'], 'review complete');

        target.roles.cache.set(imageRole.id, imageRole);
        await mod.execute(interaction({ guild, member: actor, subcommand: 'iunmute', values: { target, reason: 'served' } }), {});
        expect(target.roles.remove).toHaveBeenCalledWith(imageRole, 'served');

        const configured = database.sqlite.prepare('SELECT * FROM moderation_config WHERE guild_id = ?').get(guild.id);
        expect(configured.image_mute_role_id).toBe(imageRole.id);
        expect(configured.jail_role_id).toBe(jailRole.id);
        expect(configured.jail_channel_id).toBe(jailChannel.id);
    });

    test('jail list and confirmed unjail-all operate on current case state', async () => {
        const jailRole = { id: 'jail-role', name: 'Jailed', position: 2 };
        guild.roles = { cache: new Map([[jailRole.id, jailRole]]) };
        target.roles.add = jest.fn().mockResolvedValue({});
        target.roles.remove = jest.fn().mockResolvedValue({});
        target.roles.set = jest.fn().mockResolvedValue({});
        await mod.execute(interaction({ guild, member: actor, group: 'config', subcommand: 'jail', values: { role: jailRole } }), {});
        await mod.execute(interaction({ guild, member: actor, subcommand: 'jail', values: { target, reason: 'review' } }), {});
        target.roles.cache.set(jailRole.id, jailRole);

        const list = interaction({ guild, member: actor, group: 'status', subcommand: 'jailed' });
        await mod.execute(list, {});
        expect(list.editReply.mock.calls[0][0].embeds[0].data.description).toContain('<@user1>');

        await mod.execute(interaction({
            guild,
            member: actor,
            group: 'bulk', subcommand: 'unjail-all',
            values: { confirm: true, reason: 'review complete' }
        }), {});
        expect(target.roles.set).toHaveBeenLastCalledWith([], 'review complete');
        expect(database.sqlite.prepare(`SELECT action FROM moderation_cases ORDER BY case_number DESC LIMIT 1`).get().action).toBe('UNJAIL');
    });

    test('confirmed bulk unban and untimeout create one case per changed user', async () => {
        guild.bans = { fetch: jest.fn().mockResolvedValue(new Map([[target.id, { user: target.user }]])) };
        await mod.execute(interaction({
            guild, member: actor, group: 'bulk', subcommand: 'unban-all',
            values: { confirm: true, reason: 'amnesty' }
        }), {});
        expect(guild.members.unban).toHaveBeenCalledWith(target.id, 'amnesty');

        guild.members.fetch.mockResolvedValueOnce(new Map([[
            target.id,
            { ...target, communicationDisabledUntilTimestamp: Date.now() + 60000 }
        ]]));
        await mod.execute(interaction({
            guild, member: actor, group: 'bulk', subcommand: 'untimeout-all',
            values: { confirm: true, reason: 'incident over' }
        }), {});
        expect(target.timeout).toHaveBeenCalledWith(null, 'incident over');
        expect(database.sqlite.prepare(`SELECT GROUP_CONCAT(action, ',') AS actions FROM moderation_cases ORDER BY case_number`).get().actions).toBe('UNBAN,UNTIMEOUT');
    });

    test('audit reads Discord audit entries after actor and bot permission checks', async () => {
        guild.fetchAuditLogs = jest.fn().mockResolvedValue({ entries: new Map([['entry1', {
            action: 'MemberBanAdd', executorId: actor.id, targetId: target.id, reason: 'raid'
        }]]) });
        const audit = interaction({ guild, member: actor, group: 'logs', subcommand: 'audit', values: { limit: 5 } });
        await mod.execute(audit, {});
        expect(guild.fetchAuditLogs).toHaveBeenCalledWith({ limit: 5 });
        expect(audit.editReply.mock.calls[0][0].embeds[0].data.description).toContain('MemberBanAdd');
    });

    test('warning thresholds persist and trigger their configured punishment', async () => {
        await mod.execute(interaction({
            guild,
            member: actor,
            group: 'config',
            subcommand: 'warn-add',
            values: { threshold: 2, action: 'timeout', duration: '5m' }
        }), {});

        await mod.execute(interaction({ guild, member: actor, subcommand: 'warn', values: { target, reason: 'first' } }), {});
        await mod.execute(interaction({ guild, member: actor, subcommand: 'warn', values: { target, reason: 'second' } }), {});

        expect(target.timeout).toHaveBeenCalledWith(300000, 'Automatic punishment at 2 warnings');
        const cases = database.sqlite.prepare(`
            SELECT case_number, action, status FROM moderation_cases WHERE guild_id = ? ORDER BY case_number
        `).all(guild.id);
        expect(cases).toEqual([
            { case_number: 1, action: 'WARN', status: 'completed' },
            { case_number: 2, action: 'WARN', status: 'completed' },
            { case_number: 3, action: 'TIMEOUT', status: 'completed' }
        ]);

        const invalid = interaction({
            guild, member: actor, group: 'config', subcommand: 'warn-add',
            values: { threshold: 3, action: 'timeout', duration: '30s' }
        });
        await mod.execute(invalid, {});
        expect(invalid.editReply.mock.calls[0][0].embeds[0].data.description).toContain('60 seconds');
        expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM warning_punishments WHERE threshold = 3').get().count).toBe(0);
    });

    test('invoke templates persist per guild and render to DM and the configured modlog', async () => {
        const channel = { id: 'log1', name: 'modlog', send: jest.fn().mockResolvedValue({}) };
        guild.channels = { cache: new Map([[channel.id, channel]]) };
        await mod.execute(interaction({ guild, member: actor, group: 'config', subcommand: 'modlog', values: { channel } }), {});
        await mod.execute(interaction({ guild, member: actor, group: 'template', subcommand: 'set', values: {
            action: 'warn', type: 'dm', message: 'Warning {warning_count} in {guild.name}: {reason}'
        } }), {});
        await mod.execute(interaction({ guild, member: actor, group: 'template', subcommand: 'set', values: {
            action: 'warn', type: 'message', message: '{target_user.mention} warned by {moderator.mention}'
        } }), {});

        await mod.execute(interaction({ guild, member: actor, subcommand: 'warn', values: { target, reason: 'spam' } }), {});

        expect(target.user.send).toHaveBeenCalledWith({ content: 'Warning 1 in Guild: spam', allowedMentions: { parse: [] } });
        expect(channel.send).toHaveBeenCalledWith({ content: '<@user1> warned by <@mod1>', allowedMentions: { parse: [] } });
    });

    test('invoke template previews render documented embed tags and reject unknown variables', async () => {
        const set = interaction({ guild, member: actor, group: 'template', subcommand: 'set', values: {
            action: 'ban', type: 'message',
            message: '{embed}{title: User Banned}{description: {target_user.mention} for {reason}}{field: Moderator|{moderator.mention}}'
        } });
        await mod.execute(set, {});
        const preview = interaction({ guild, member: actor, group: 'template', subcommand: 'test', values: { action: 'ban', target } });
        await mod.execute(preview, {});
        expect(preview.editReply.mock.calls[0][0].embeds[0].data).toEqual(expect.objectContaining({
            title: 'User Banned',
            description: '<@user1> for Preview reason'
        }));
        expect(preview.editReply.mock.calls[0][0].embeds[0].data.fields[0].value).toBe('<@mod1>');

        const invalid = interaction({ guild, member: actor, group: 'template', subcommand: 'set', values: {
            action: 'ban', type: 'dm', message: 'Hello {user.mention}'
        } });
        await mod.execute(invalid, {});
        expect(invalid.editReply.mock.calls[0][0].embeds[0].data.title).toContain('Invalid Template');
    });

    test('warning removal preserves an undone case in member history', async () => {
        await mod.execute(interaction({ guild, member: actor, subcommand: 'warn', values: { target, reason: 'spam' } }), {});
        await mod.execute(interaction({
            guild,
            member: actor,
            subcommand: 'unwarn',
            values: { target, id: 1, reason: 'warning overturned' }
        }), {});

        const history = interaction({ guild, member: actor, subcommand: 'history', values: { target, limit: 10 } });
        await mod.execute(history, {});
        const description = history.editReply.mock.calls[0][0].embeds[0].data.description;
        expect(description).toContain('#1');
        expect(description).toContain('WARN** · undone');
        expect(database.sqlite.prepare('SELECT status FROM moderation_cases WHERE guild_id = ? AND case_number = 1').get(guild.id).status).toBe('undone');
    });

    test('warning removal rechecks the target hierarchy', async () => {
        await mod.execute(interaction({ guild, member: actor, subcommand: 'warn', values: { target, reason: 'spam' } }), {});
        target.roles.highest.position = actor.roles.highest.position;
        const { undoCase } = require('../src/services/moderationService');

        await expect(undoCase({ guild, executor: actor, caseNumber: 1, reason: 'attempt' }))
            .rejects.toThrow('equal or higher role');
        expect(database.sqlite.prepare('SELECT status FROM moderation_cases WHERE case_number = 1').get().status).toBe('completed');
    });

    test('strip removes dangerous roles as one reversible case', async () => {
        const dangerous = {
            id: 'dangerous', name: 'Dangerous', position: 2,
            permissions: { has: jest.fn(permission => permission === PermissionFlagsBits.Administrator) }
        };
        const harmless = {
            id: 'harmless', name: 'Harmless', position: 1,
            permissions: { has: jest.fn().mockReturnValue(false) }
        };
        guild.roles = { cache: new Map([[dangerous.id, dangerous], [harmless.id, harmless]]) };
        target.roles.cache = new Map([[dangerous.id, dangerous], [harmless.id, harmless]]);
        target.roles.remove = jest.fn().mockResolvedValue({});
        target.roles.add = jest.fn().mockResolvedValue({});

        await mod.execute(interaction({ guild, member: actor, subcommand: 'strip', values: { target, reason: 'account compromised' } }), {});
        expect(target.roles.remove).toHaveBeenCalledTimes(1);
        expect(target.roles.remove).toHaveBeenCalledWith(dangerous, 'account compromised');

        target.roles.cache.delete(dangerous.id);
        await mod.execute(interaction({ guild, member: actor, group: 'case', subcommand: 'undo', values: { number: 1, reason: 'account recovered' } }), {});
        expect(target.roles.add).toHaveBeenCalledWith(dangerous, 'account recovered');
    });

    test('strip undo records cleanup_required when its rollback is partial', async () => {
        const roles = ['dangerous-1', 'dangerous-2'].map(id => ({
            id, name: id, position: 2,
            permissions: { has: jest.fn(permission => permission === PermissionFlagsBits.Administrator) }
        }));
        guild.roles = { cache: new Map(roles.map(role => [role.id, role])) };
        target.roles.cache = new Map(roles.map(role => [role.id, role]));
        target.roles.remove = jest.fn().mockResolvedValue({});
        target.roles.add = jest.fn(async role => {
            if (role.id === 'dangerous-2') throw new Error('restore failed');
            target.roles.cache.set(role.id, role);
        });
        await mod.execute(interaction({ guild, member: actor, subcommand: 'strip', values: { target } }), {});
        target.roles.cache.clear();
        target.roles.remove.mockRejectedValueOnce(new Error('rollback failed'));

        await mod.execute(interaction({ guild, member: actor, group: 'case', subcommand: 'undo', values: { number: 1, reason: 'restore' } }), {});
        const stored = database.sqlite.prepare('SELECT status, metadata FROM moderation_cases WHERE case_number = 1').get();
        expect(stored.status).toBe('cleanup_required');
        expect(JSON.parse(stored.metadata).phase).toBe('undo_rollback_failed');
    });

    test('staff roles and warning punishments can be listed and removed per guild', async () => {
        const staffRole = { id: 'staff1' };
        await mod.execute(interaction({ guild, member: actor, group: 'config', subcommand: 'staff-add', values: { role: staffRole } }), {});
        await mod.execute(interaction({ guild, member: actor, group: 'config', subcommand: 'warn-add', values: { threshold: 3, action: 'ban' } }), {});

        const staffList = interaction({ guild, member: actor, group: 'config', subcommand: 'staff-list' });
        const warnList = interaction({ guild, member: actor, group: 'config', subcommand: 'warn-list' });
        await mod.execute(staffList, {});
        await mod.execute(warnList, {});
        expect(staffList.editReply.mock.calls[0][0].embeds[0].data.description).toContain('<@&staff1>');
        expect(warnList.editReply.mock.calls[0][0].embeds[0].data.description).toContain('3 — ban');

        await mod.execute(interaction({ guild, member: actor, group: 'config', subcommand: 'staff-remove', values: { role: staffRole } }), {});
        await mod.execute(interaction({ guild, member: actor, group: 'config', subcommand: 'warn-remove', values: { threshold: 3 } }), {});
        expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM moderation_staff_roles').get().count).toBe(0);
        expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM warning_punishments').get().count).toBe(0);
    });

    test('staffstrip removes only configured staff roles and warning clear preserves cases', async () => {
        const staffRole = { id: 'staff1', name: 'Staff', position: 2, permissions: { has: jest.fn().mockReturnValue(false) } };
        const memberRole = { id: 'member1', name: 'Member', position: 1, permissions: { has: jest.fn().mockReturnValue(false) } };
        guild.roles = { cache: new Map([[staffRole.id, staffRole], [memberRole.id, memberRole]]) };
        target.roles.cache = new Map([[staffRole.id, staffRole], [memberRole.id, memberRole]]);
        target.roles.remove = jest.fn().mockResolvedValue({});
        await mod.execute(interaction({ guild, member: actor, group: 'config', subcommand: 'staff-add', values: { role: staffRole } }), {});
        await mod.execute(interaction({ guild, member: actor, subcommand: 'staffstrip', values: { target, reason: 'offboarded' } }), {});
        expect(target.roles.remove).toHaveBeenCalledTimes(1);
        expect(target.roles.remove).toHaveBeenCalledWith(staffRole, 'offboarded');

        await mod.execute(interaction({ guild, member: actor, subcommand: 'warn', values: { target, reason: 'one' } }), {});
        await mod.execute(interaction({ guild, member: actor, subcommand: 'warn', values: { target, reason: 'two' } }), {});
        await mod.execute(interaction({ guild, member: actor, subcommand: 'warn-clear', values: { target, reason: 'amnesty' } }), {});
        expect(database.sqlite.prepare(`SELECT COUNT(*) AS count FROM moderation_cases WHERE action = 'WARN' AND status = 'completed'`).get().count).toBe(0);
        expect(database.sqlite.prepare(`SELECT COUNT(*) AS count FROM moderation_cases WHERE action = 'WARN' AND status = 'undone'`).get().count).toBe(2);
        expect(database.sqlite.prepare(`SELECT status FROM moderation_cases WHERE action = 'WARN_CLEAR'`).get().status).toBe('completed');
    });

    test('setup creates Greed-compatible resources and reset deletes only those owned IDs', async () => {
        const existing = {
            id: 'existing',
            permissionOverwrites: { edit: jest.fn().mockResolvedValue({}) },
            delete: jest.fn()
        };
        const channels = new Map([[existing.id, existing]]);
        const roles = new Map();
        let nextId = 1;
        guild.members.me.permissions = { has: jest.fn().mockReturnValue(true) };
        actor.permissions.has = jest.fn().mockReturnValue(true);
        guild.roles = {
            everyone: { id: 'everyone' },
            cache: roles,
            create: jest.fn(async options => {
                const role = {
                    id: `role-${nextId++}`,
                    name: options.name,
                    position: 2,
                    permissions: { has: jest.fn().mockReturnValue(false) },
                    delete: jest.fn(async () => roles.delete(role.id))
                };
                roles.set(role.id, role);
                return role;
            })
        };
        guild.channels = {
            cache: channels,
            create: jest.fn(async options => {
                const channel = {
                    id: `channel-${nextId++}`,
                    name: options.name,
                    permissionOverwrites: { edit: jest.fn().mockResolvedValue({}) },
                    delete: jest.fn(async () => channels.delete(channel.id))
                };
                channels.set(channel.id, channel);
                return channel;
            })
        };

        await mod.execute(interaction({ guild, member: actor, group: 'config', subcommand: 'setup' }), {});
        expect(guild.roles.create).toHaveBeenCalledTimes(3);
        expect(guild.channels.create).toHaveBeenCalledTimes(3);
        const config = database.sqlite.prepare('SELECT * FROM moderation_config WHERE guild_id = ?').get(guild.id);
        expect(config.setup_status).toBe('ready');
        const owned = JSON.parse(config.managed_resources);
        expect(owned.channels).toHaveLength(3);
        expect(owned.roles).toHaveLength(3);
        expect(guild.channels.create).toHaveBeenCalledWith(expect.objectContaining({ reason: 'ByteBot moderation setup' }));

        const failedResource = roles.get(owned.roles[0]);
        failedResource.delete.mockRejectedValueOnce(new Error('Discord unavailable'));
        const partialReset = interaction({ guild, member: actor, group: 'config', subcommand: 'reset', values: { confirm: true } });
        await mod.execute(partialReset, {});
        const partial = database.sqlite.prepare('SELECT setup_status, managed_resources FROM moderation_config WHERE guild_id = ?').get(guild.id);
        expect(partial.setup_status).toBe('cleanup_required');
        expect(JSON.parse(partial.managed_resources)).toEqual({ channels: [], roles: [failedResource.id] });

        await mod.execute(interaction({ guild, member: actor, group: 'config', subcommand: 'reset', values: { confirm: true } }), {});
        expect(existing.delete).not.toHaveBeenCalled();
        expect(database.sqlite.prepare('SELECT managed_resources FROM moderation_config WHERE guild_id = ?').get(guild.id).managed_resources).toBeNull();

        guild.roles.create.mockRejectedValueOnce(new Error('Discord rejected role creation'));
        const failedSetup = interaction({ guild, member: actor, group: 'config', subcommand: 'setup' });
        await mod.execute(failedSetup, {});
        expect(failedSetup.editReply.mock.calls[0][0].embeds[0].data.title).toContain('Setup Failed');
        expect(channels.size).toBe(1);
        expect(database.sqlite.prepare('SELECT managed_resources FROM moderation_config WHERE guild_id = ?').get(guild.id).managed_resources).toBeNull();
    });
});
