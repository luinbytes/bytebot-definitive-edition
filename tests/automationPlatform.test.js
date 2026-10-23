const fs = require('fs');
const os = require('os');
const path = require('path');
const { Collection, PermissionFlagsBits, PermissionsBitField } = require('discord.js');

describe('message and member automation platform', () => {
    let tempDir;
    let database;
    let service;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-automation-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
    });

    afterEach(async () => {
        await service?.cleanup();
        database.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function responderFixture(mode = 'add') {
        const AutoResponderService = require('../src/services/autoResponderService');
        const RoleAutomationService = require('../src/services/roleAutomationService');
        const role = { id: 'role1', name: 'Reward', position: 5, editable: true, managed: false, permissions: new PermissionsBitField() };
        const guild = {
            id: 'guild1', name: 'Guild', ownerId: 'owner1', roles: { cache: new Map([[role.id, role]]) },
            members: { me: { roles: { highest: { position: 100 } } } }
        };
        const actor = { id: 'admin1', permissions: new PermissionsBitField([PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles]), roles: { highest: { position: 10 } } };
        const client = { roleAutomationService: new RoleAutomationService({}) };
        service = new AutoResponderService(client);
        client.autoResponderService = service;
        const responder = AutoResponderService.createAutoResponder({ guildId: guild.id, trigger: 'hello', response: 'Hi {user}', creatorId: actor.id });
        const interaction = action => ({
            guild, user: { id: actor.id }, member: actor,
            options: {
                getSubcommand: () => action,
                getString: name => ({ trigger: 'hello', mode })[name] || null,
                getRole: () => role
            },
            editReply: jest.fn().mockResolvedValue({})
        });
        const command = require('../src/commands/administration/autoresponder');
        return { role, guild, actor, client, responder, interaction, command };
    }

    function responderMessage({ guild }) {
        const member = {
            id: 'user1', guild, user: { id: 'user1', tag: 'User#0001' },
            roles: { cache: new Map() }
        };
        member.roles.add = jest.fn(async role => member.roles.cache.set(role.id, role));
        member.roles.remove = jest.fn(async role => member.roles.cache.delete(role.id));
        const sent = { id: 'reply1', delete: jest.fn().mockResolvedValue({}) };
        return {
            id: 'message1', guild, member, author: { id: 'user1', username: 'User' }, content: 'hello',
            channel: { id: 'channel1', send: jest.fn().mockResolvedValue(sent) },
            reply: jest.fn().mockResolvedValue(sent), delete: jest.fn().mockResolvedValue({})
        };
    }

    test('responder role actions require Manage Roles in addition to Manage Server', async () => {
        const { actor, client, interaction, command } = responderFixture();
        actor.permissions.remove(PermissionFlagsBits.ManageRoles);
        const add = interaction('role-add');
        await command.execute(add, client);
        expect(add.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Manage Roles') }));
        const list = interaction('role-list');
        await command.execute(list, client);
        expect(list.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: 'None configured.' }));
    });

    test.each(['add', 'toggle'])('responder %s configuration rejects roles at the actor hierarchy', async mode => {
        const { actor, role, client, interaction, command } = responderFixture(mode);
        role.position = actor.roles.highest.position;
        const add = interaction('role-add');
        await command.execute(add, client);
        expect(add.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('highest role') }));
        const list = interaction('role-list');
        await command.execute(list, client);
        expect(list.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: 'None configured.' }));
    });

    test.each(['add', 'toggle'])('responder %s configuration respects denied permissions', async mode => {
        const { role, client, interaction, command } = responderFixture(mode);
        role.permissions.add(PermissionFlagsBits.Administrator);
        const { deniedRolePermissions } = require('../src/database/schema');
        database.db.insert(deniedRolePermissions).values({ guildId: 'guild1', permission: 'Administrator' }).run();
        const add = interaction('role-add');
        await command.execute(add, client);
        expect(add.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('blocked permission Administrator') }));
        const list = interaction('role-list');
        await command.execute(list, client);
        expect(list.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: 'None configured.' }));
    });

    test.each([
        ['legacy', 'add'], ['legacy', 'toggle'], ['actions', 'add'], ['actions', 'toggle']
    ])('%s responder %s refuses a role after denied-permission policy changes', async (storage, mode) => {
        const fixture = responderFixture(mode);
        const { role, client, interaction, command, responder } = fixture;
        const { autoResponses, deniedRolePermissions } = require('../src/database/schema');
        const { eq } = require('drizzle-orm');
        if (storage === 'legacy') {
            database.db.update(autoResponses).set({ actionRoleId: role.id, actionRoleMode: mode }).where(eq(autoResponses.id, responder.id)).run();
        } else await command.execute(interaction('role-add'), client);
        role.permissions.add(PermissionFlagsBits.ManageRoles);
        database.db.insert(deniedRolePermissions).values({ guildId: 'guild1', permission: 'ManageRoles' }).run();
        const message = responderMessage(fixture);
        await service.checkMessage(message);
        expect(message.channel.send).toHaveBeenCalledTimes(1);
        expect(message.member.roles.add).not.toHaveBeenCalled();
    });

    test.each([
        ['legacy', 'add', false, true], ['legacy', 'remove', true, false],
        ['legacy', 'toggle', false, true], ['legacy', 'toggle', true, false],
        ['actions', 'add', false, true], ['actions', 'remove', true, false],
        ['actions', 'toggle', false, true], ['actions', 'toggle', true, false]
    ])('%s responder %s preserves role actions and cooldowns with prior membership %s', async (storage, mode, hadRole, expected) => {
        const fixture = responderFixture(mode);
        const { role, client, interaction, command, responder } = fixture;
        const { autoResponses, deniedRolePermissions } = require('../src/database/schema');
        const { eq } = require('drizzle-orm');
        if (storage === 'legacy') {
            database.db.update(autoResponses).set({ actionRoleId: role.id, actionRoleMode: mode }).where(eq(autoResponses.id, responder.id)).run();
        } else await command.execute(interaction('role-add'), client);
        const message = responderMessage(fixture);
        if (hadRole) {
            message.member.roles.cache.set(role.id, role);
            role.permissions.add(PermissionFlagsBits.ManageRoles);
            database.db.insert(deniedRolePermissions).values({ guildId: 'guild1', permission: 'ManageRoles' }).run();
        }
        await service.checkMessage(message);
        await service.checkMessage(message);
        expect(message.member.roles.cache.has(role.id)).toBe(expected);
        expect(message.channel.send).toHaveBeenCalledTimes(1);
        expect(message.channel.send).toHaveBeenCalledWith({ content: 'Hi <@user1>', allowedMentions: { parse: [], repliedUser: false } });
        if (hadRole) expect(message.member.roles.remove).toHaveBeenCalledWith(role, 'Auto-responder role action');
        else expect(message.member.roles.add).toHaveBeenCalledWith(role, 'Auto-responder role action');
    });

    test('a responder role action can be removed after the role becomes unmanageable', async () => {
        const { role, actor, client, interaction, command } = responderFixture();
        await command.execute(interaction('role-add'), client);
        role.editable = false;
        role.managed = true;
        actor.permissions.remove(PermissionFlagsBits.ManageRoles);
        await command.execute(interaction('role-remove'), client);
        const list = interaction('role-list');
        await command.execute(list, client);
        expect(list.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: 'None configured.' }));
    });

    test.each(['roles-remove', 'channels-remove', 'enable'])('changing role responder access through %s requires authority over existing actions', async action => {
        const { actor, role, guild, client, interaction, command, responder } = responderFixture();
        await command.execute(interaction('role-add'), client);
        const restriction = { id: 'restricted', editable: true, position: 1 };
        guild.roles.cache.set(restriction.id, restriction);
        database.sqlite.prepare('UPDATE auto_responses SET role_ids = ?, channel_ids = ?, enabled = 0 WHERE id = ?')
            .run(JSON.stringify([restriction.id]), JSON.stringify(['channel1']), responder.id);
        const before = database.sqlite.prepare('SELECT * FROM auto_responses WHERE id = ?').get(responder.id);
        const request = interaction(action);
        request.options.getRole = () => restriction;
        request.options.getChannel = () => ({ id: 'channel1' });
        actor.permissions.remove(PermissionFlagsBits.ManageRoles);
        await command.execute(request, client);
        expect(database.sqlite.prepare('SELECT * FROM auto_responses WHERE id = ?').get(responder.id)).toEqual(before);
        actor.permissions.add(PermissionFlagsBits.ManageRoles);
        actor.roles.highest.position = role.position;
        await command.execute(request, client);
        expect(database.sqlite.prepare('SELECT * FROM auto_responses WHERE id = ?').get(responder.id)).toEqual(before);
        actor.roles.highest.position = role.position + 1;
        await command.execute(request, client);
        expect(database.sqlite.prepare('SELECT * FROM auto_responses WHERE id = ?').get(responder.id)).not.toEqual(before);
    });

    test.each(['legacy', 'actions'])('legacy toggle allows disabling but authorizes re-enabling %s role actions', async storage => {
        const { actor, role, client, interaction, command, responder } = responderFixture();
        if (storage === 'legacy') database.sqlite.prepare('UPDATE auto_responses SET action_role_id = ? WHERE id = ?').run(role.id, responder.id);
        else await command.execute(interaction('role-add'), client);
        const legacy = require('../src/commands/administration/autorespond');
        const request = interaction('toggle');
        request.options.getInteger = () => responder.id;
        actor.permissions.remove(PermissionFlagsBits.ManageRoles);
        await legacy.execute(request, client);
        expect(database.sqlite.prepare('SELECT enabled FROM auto_responses WHERE id = ?').get(responder.id).enabled).toBe(0);
        await legacy.execute(request, client);
        expect(database.sqlite.prepare('SELECT enabled FROM auto_responses WHERE id = ?').get(responder.id).enabled).toBe(0);
        actor.permissions.add(PermissionFlagsBits.ManageRoles);
        await legacy.execute(request, client);
        expect(database.sqlite.prepare('SELECT enabled FROM auto_responses WHERE id = ?').get(responder.id).enabled).toBe(1);
    });

    test('runtime role actions recheck the bot hierarchy', async () => {
        const fixture = responderFixture();
        await fixture.command.execute(fixture.interaction('role-add'), fixture.client);
        fixture.role.position = fixture.guild.members.me.roles.highest.position;
        const message = responderMessage(fixture);
        await service.checkMessage(message);
        expect(message.member.roles.add).not.toHaveBeenCalled();
        expect(message.channel.send).toHaveBeenCalledTimes(1);
    });

    test('overlapping asynchronous matches send once and preserve the cooldown', async () => {
        const fixture = responderFixture();
        const { autoResponses } = require('../src/database/schema');
        const { eq } = require('drizzle-orm');
        database.db.update(autoResponses).set({ matchType: 'regex', trigger: '^hello$' }).where(eq(autoResponses.id, fixture.responder.id)).run();
        const message = responderMessage(fixture);
        let release;
        message.channel.send.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const checks = [service.checkMessage(message), service.checkMessage(message)];
        try {
            await Promise.race(checks);
            expect(message.channel.send).toHaveBeenCalledTimes(1);
        } finally {
            release?.({ id: 'reply1' });
            await Promise.all(checks);
        }
        await service.checkMessage(message);
        expect(message.channel.send).toHaveBeenCalledTimes(1);
    });

    test('responder replies preserve deletion, channel and role scopes, and durable self destruction', async () => {
        const fixture = responderFixture();
        const AutomationService = require('../src/services/automationService');
        fixture.client.automationService = new AutomationService({ guilds: { cache: new Map() } });
        const { autoResponses } = require('../src/database/schema');
        const { eq } = require('drizzle-orm');
        database.db.update(autoResponses).set({
            reply: true, deleteTrigger: true, selfDestructSeconds: 6, mentionPolicy: 'users',
            channelIds: JSON.stringify(['channel1']), roleIds: JSON.stringify(['role1'])
        }).where(eq(autoResponses.id, fixture.responder.id)).run();
        const message = responderMessage(fixture);
        await service.checkMessage(message);
        expect(message.reply).not.toHaveBeenCalled();
        message.member.roles.cache.set(fixture.role.id, fixture.role);
        message.channel.id = 'elsewhere';
        await service.checkMessage(message);
        expect(message.reply).not.toHaveBeenCalled();
        message.channel.id = 'channel1';
        await service.checkMessage(message);
        expect(message.reply).toHaveBeenCalledWith({ content: 'Hi <@user1>', allowedMentions: { parse: ['users'], repliedUser: false } });
        expect(message.channel.send).not.toHaveBeenCalled();
        expect(message.delete).toHaveBeenCalledTimes(1);
        const deletion = await fixture.client.automationService.get('guild1', 'delete-message', 'reply1');
        expect(JSON.parse(deletion.config)).toEqual({ channelId: 'channel1', messageId: 'reply1' });
        expect(deletion.nextRunAt).toBeGreaterThan(Date.now());
    });

    test('published command families and aliases render as Manage Server slash commands', () => {
        const expected = {
            autoresponder: ['add', 'update', 'enable', 'disable', 'remove', 'list', 'clear', 'reset', 'channels-add', 'channels-remove', 'channels-list', 'roles-add', 'roles-remove', 'roles-list', 'role-add', 'role-remove', 'role-list'],
            autoreact: ['add', 'remove', 'list', 'clear', 'channels-add', 'channels-remove', 'channels-list', 'roles-add', 'roles-remove', 'roles-list'],
            autorole: ['add', 'remove', 'list', 'clear', 'bots-add', 'bots-remove', 'bots-list'],
            vanity: ['set', 'setup', 'message', 'channel', 'strict', 'view', 'role-add', 'role-remove', 'role-list', 'role', 'removerole', 'rewards', 'settings', 'remove'],
            pingonjoin: ['enable', 'disable', 'info', 'message', 'remove']
        };
        for (const [name, actions] of Object.entries(expected)) {
            const json = require(`../src/commands/administration/${name}`).data.toJSON();
            expect(json.options.map(option => option.name)).toEqual(expect.arrayContaining(actions));
            expect(json.default_member_permissions).toBe(PermissionFlagsBits.ManageGuild.toString());
        }
        expect(require('../src/commands/administration/poj').data.toJSON().default_member_permissions)
            .toBe(PermissionFlagsBits.ManageGuild.toString());
        for (const name of ['timer', 'bumpreminder', 'stickymessage', 'revive', 'tracking', 'counter']) {
            const json = require(`../src/commands/utility/${name}`).data.toJSON();
            expect(json.options.length).toBeGreaterThan(1);
            if (name === 'tracking') expect(json.default_member_permissions).toBeUndefined();
            else expect(json.default_member_permissions).toBe(PermissionFlagsBits.ManageGuild.toString());
        }
    });

    test('autorole and vanity configuration require role authority before saving or enabling grants', async () => {
        const AutomationService = require('../src/services/automationService');
        service = new AutomationService({ guilds: { cache: new Map() } });
        const role = { id: 'reward', position: 10, editable: true, managed: false, permissions: { has: () => false } };
        const actor = { id: 'admin1', roles: { highest: { position: 10 } }, permissions: { has: () => true } };
        const guild = { id: 'guild1', ownerId: 'owner1', roles: { cache: new Map([[role.id, role]]) } };
        const interaction = (action, member = actor) => ({
            guild, member, user: { id: 'admin1' }, editReply: jest.fn(),
            options: { getSubcommand: () => action, getSubcommandGroup: () => null,
                getRole: () => role, getString: () => null, getBoolean: () => null, getInteger: () => null }
        });
        const command = require('../src/commands/administration/autorole');
        const denied = interaction('add');
        await command.execute(denied, { automationService: service });
        expect(await service.list(guild.id, 'autorole')).toHaveLength(0);
        expect(denied.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('highest role') }));

        actor.roles.highest = {};
        await command.execute(interaction('add'), { automationService: service });
        expect(await service.list(guild.id, 'autorole')).toHaveLength(0);
        actor.roles.highest.position = 11;
        role.managed = true;
        await command.execute(interaction('add'), { automationService: service });
        expect(await service.list(guild.id, 'autorole')).toHaveLength(0);
        role.managed = false;
        role.permissions.has = permission => permission === PermissionFlagsBits.Administrator;
        database.sqlite.prepare("INSERT INTO denied_role_permissions (guild_id, permission) VALUES ('guild1', 'Administrator')").run();
        await command.execute(interaction('add'), { automationService: service });
        expect(await service.list(guild.id, 'autorole')).toHaveLength(0);
        database.sqlite.prepare("DELETE FROM denied_role_permissions WHERE guild_id = 'guild1'").run();
        await command.execute(interaction('add'), { automationService: service });
        expect(await service.list(guild.id, 'autorole')).toHaveLength(1);
        await service.setEnabled(guild.id, 'autorole', 'member:reward', false);
        actor.permissions.has = permission => permission === PermissionFlagsBits.ManageGuild;
        await command.execute(interaction('enable'), { automationService: service });
        expect((await service.get(guild.id, 'autorole', 'member:reward')).enabled).toBe(false);
        await command.execute(interaction('enable', null), { automationService: service });
        expect((await service.get(guild.id, 'autorole', 'member:reward')).enabled).toBe(false);

        await service.upsert({ guildId: guild.id, kind: 'vanity', key: 'main', config: { vanity: 'byte' }, createdBy: actor.id });
        const vanity = require('../src/commands/administration/vanity');
        await vanity.execute(interaction('role-add'), { automationService: service });
        expect(JSON.parse((await service.get(guild.id, 'vanity', 'main')).config).roleIds).toBeUndefined();
        guild.ownerId = actor.id;
        role.position = 15;
        await vanity.execute(interaction('role-add'), { automationService: service });
        expect(JSON.parse((await service.get(guild.id, 'vanity', 'main')).config).roleIds).toEqual(['reward']);
    });

    test('interval parsing is bounded and unambiguous', () => {
        const { parseInterval } = require('../src/services/automationService');
        expect(parseInterval('30m')).toBe(1800000);
        expect(parseInterval('2h')).toBe(7200000);
        expect(parseInterval('1d')).toBe(86400000);
        expect(parseInterval('5s')).toBeNull();
        expect(parseInterval('29d')).toBeNull();
        expect(parseInterval('tomorrow')).toBeNull();
    });

    test.each([true, false])('vanity rewards remain removable after policy changes while enabled is %s', async enabled => {
        const AutomationService = require('../src/services/automationService');
        service = new AutomationService({ guilds: { cache: new Map() } });
        const roles = ['one', 'two'].map(id => ({ id, editable: true, position: 1,
            permissions: new PermissionsBitField(PermissionFlagsBits.Administrator) }));
        const guild = { id: 'guild1', ownerId: 'owner', roles: { cache: new Map(roles.map(role => [role.id, role])) } };
        await service.upsert({ guildId: guild.id, kind: 'vanity', key: 'main', enabled,
            config: { vanity: 'byte', roleIds: roles.map(role => role.id) }, createdBy: 'admin' });
        database.sqlite.prepare("INSERT INTO denied_role_permissions (guild_id, permission) VALUES ('guild1', 'Administrator')").run();
        const command = require('../src/commands/administration/vanity');
        for (const [index, action] of ['role-remove', 'removerole'].entries()) {
            await command.execute({ guild, user: { id: 'admin' },
                member: { id: 'admin', permissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild) },
                editReply: jest.fn(), options: { getSubcommand: () => action, getSubcommandGroup: () => null,
                    getRole: () => roles[index], getString: () => null, getBoolean: () => null, getInteger: () => null }
            }, { automationService: service });
            const saved = await service.get(guild.id, 'vanity', 'main');
            expect(saved.enabled).toBe(enabled);
            expect(JSON.parse(saved.config).roleIds).toEqual(roles.slice(index + 1).map(role => role.id));
        }
    });

    test('configuration is guild scoped and upserts instead of duplicating', async () => {
        const AutomationService = require('../src/services/automationService');
        service = new AutomationService({ guilds: { cache: new Map() } });
        await service.upsert({ guildId: 'guild1', kind: 'timer', key: 'channel1', config: { message: 'one' }, createdBy: 'admin1' });
        await service.upsert({ guildId: 'guild1', kind: 'timer', key: 'channel1', config: { message: 'two' }, createdBy: 'admin1' });
        await service.upsert({ guildId: 'guild2', kind: 'timer', key: 'channel1', config: { message: 'other' }, createdBy: 'admin2' });
        expect(await service.list('guild1', 'timer')).toHaveLength(1);
        expect(JSON.parse((await service.get('guild1', 'timer', 'channel1')).config).message).toBe('two');
        expect(await service.list('guild2', 'timer')).toHaveLength(1);
    });

    test('autoroles use the highest public 50-role cap transactionally', async () => {
        const AutomationService = require('../src/services/automationService');
        service = new AutomationService({ guilds: { cache: new Map() } });
        for (let index = 0; index < 50; index += 1) {
            await service.upsert({
                guildId: 'guild1', kind: 'autorole', key: `member:role-${index}`,
                config: { roleId: `role-${index}` }, createdBy: 'admin1'
            });
        }
        expect(() => service.upsert({
            guildId: 'guild1', kind: 'autorole', key: 'bot:overflow',
            config: { roleId: 'overflow' }, createdBy: 'admin1'
        })).toThrow('50 autorole');
        expect(service.upsert({
            guildId: 'guild1', kind: 'autorole', key: 'member:role-0',
            config: { roleId: 'updated' }, createdBy: 'admin1'
        })).toEqual(expect.objectContaining({ key: 'member:role-0' }));
        expect(await service.list('guild1', 'autorole')).toHaveLength(50);
    });

    test('autoreact honors channel and role scopes and caps configured reactions', async () => {
        const AutomationService = require('../src/services/automationService');
        service = new AutomationService({ guilds: { cache: new Map() } });
        await service.upsert({ guildId: 'guild1', kind: 'autoreact', key: 'hello', config: {
            trigger: 'hello', reactions: ['👍', '❤️'], channelIds: ['channel1'], roleIds: ['role1']
        }, createdBy: 'admin1' });
        const message = {
            guild: { id: 'guild1' }, channel: { id: 'channel1' }, author: { id: 'user1', bot: false }, content: 'well hello',
            member: { roles: { cache: new Map([['role1', { id: 'role1' }]]) } }, react: jest.fn().mockResolvedValue({})
        };
        await service.handleMessage(message);
        expect(message.react.mock.calls.map(call => call[0])).toEqual(['👍', '❤️']);
        message.channel.id = 'elsewhere';
        await service.handleMessage(message);
        expect(message.react).toHaveBeenCalledTimes(2);
    });

    test('due delivery is bounded and claimed once across overlapping polls', async () => {
        const send = jest.fn().mockResolvedValue({ id: 'message1' });
        const channel = { id: 'channel1', send };
        const guild = { id: 'guild1', name: 'Guild', channels: { cache: new Map([['channel1', channel]]) } };
        const AutomationService = require('../src/services/automationService');
        service = new AutomationService({ guilds: { cache: new Map([['guild1', guild]]) } }, { batchSize: 1 });
        await service.upsert({ guildId: 'guild1', kind: 'timer', key: 'channel1', config: {
            channelId: 'channel1', message: 'tick', intervalMs: 6000
        }, nextRunAt: Date.now() - 1, createdBy: 'admin1' });
        await Promise.all([service.runDue(), service.runDue()]);
        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ nonce: expect.any(String), enforceNonce: true }));
        const rule = await service.get('guild1', 'timer', 'channel1');
        expect(rule.nextRunAt).toBeGreaterThan(Date.now());
        expect(rule.runCount).toBe(1);
    });

    test('persisted one-shot deletions resume after service restart and remove their claim', async () => {
        const remove = jest.fn().mockResolvedValue({});
        const channel = { id: 'channel1', messages: { delete: remove } };
        const guild = { id: 'guild1', channels: { cache: new Map([['channel1', channel]]) } };
        const AutomationService = require('../src/services/automationService');
        service = new AutomationService({ guilds: { cache: new Map() } });
        await service.upsert({ guildId: 'guild1', kind: 'delete-message', key: 'message1', config: {
            channelId: 'channel1', messageId: 'message1'
        }, nextRunAt: Date.now() - 1, createdBy: 'admin1' });
        service.cleanup();
        service = new AutomationService({ guilds: { cache: new Map([['guild1', guild]]) } });
        await service.runDue();
        expect(remove).toHaveBeenCalledWith('message1');
        expect(await service.get('guild1', 'delete-message', 'message1')).toBeUndefined();
    });

    test('an unexpired lease blocks a second worker and an expired lease is reclaimed', async () => {
        const send = jest.fn().mockResolvedValue({ id: 'message1' });
        const channel = { id: 'channel1', send };
        const guild = { id: 'guild1', name: 'Guild', channels: { cache: new Map([['channel1', channel]]) } };
        const AutomationService = require('../src/services/automationService');
        service = new AutomationService({ guilds: { cache: new Map([['guild1', guild]]) } });
        const rule = await service.upsert({ guildId: 'guild1', kind: 'timer', key: 'channel1', config: {
            channelId: 'channel1', message: 'tick', intervalMs: 6000
        }, nextRunAt: Date.now() - 1, createdBy: 'admin1' });
        database.sqlite.prepare('UPDATE automation_rules SET lease_token = ?, lease_expires_at = ? WHERE id = ?')
            .run('other-worker', Date.now() + 60000, rule.id);
        await service.runDue();
        expect(send).not.toHaveBeenCalled();
        database.sqlite.prepare('UPDATE automation_rules SET lease_expires_at = ? WHERE id = ?').run(Date.now() - 1, rule.id);
        await service.runDue();
        expect(send).toHaveBeenCalledTimes(1);
    });

    test('leased rows do not starve later due work from a bounded batch', async () => {
        const send = jest.fn().mockResolvedValue({ id: 'message2' });
        const guild = { id: 'guild1', channels: { cache: new Map([
            ['channel1', { id: 'channel1', send }], ['channel2', { id: 'channel2', send }]
        ]) } };
        const AutomationService = require('../src/services/automationService');
        service = new AutomationService({ guilds: { cache: new Map([['guild1', guild]]) } }, { batchSize: 1 });
        const first = await service.upsert({ guildId: 'guild1', kind: 'timer', key: 'channel1', config: {
            channelId: 'channel1', message: 'first', intervalMs: 6000
        }, nextRunAt: Date.now() - 2, createdBy: 'admin1' });
        await service.upsert({ guildId: 'guild1', kind: 'timer', key: 'channel2', config: {
            channelId: 'channel2', message: 'second', intervalMs: 6000
        }, nextRunAt: Date.now() - 1, createdBy: 'admin1' });
        database.sqlite.prepare('UPDATE automation_rules SET lease_token = ?, lease_expires_at = ? WHERE id = ?')
            .run('other-worker', Date.now() + 60000, first.id);
        await service.runDue();
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: 'second' }));
    });

    test('a rule disabled after polling cannot be claimed from a stale due row', async () => {
        const send = jest.fn().mockResolvedValue({ id: 'message1' });
        const guild = { id: 'guild1', channels: { cache: new Map([['channel1', { id: 'channel1', send }]]) } };
        const AutomationService = require('../src/services/automationService');
        service = new AutomationService({ guilds: { cache: new Map([['guild1', guild]]) } });
        const rule = await service.upsert({ guildId: 'guild1', kind: 'timer', key: 'channel1', config: {
            channelId: 'channel1', message: 'tick', intervalMs: 6000
        }, nextRunAt: Date.now() - 1, createdBy: 'admin1' });
        await service.setEnabled('guild1', 'timer', 'channel1', false);
        await service.deliver(rule, Date.now());
        expect(send).not.toHaveBeenCalled();
    });

    test('an already deleted message completes its durable deletion', async () => {
        const remove = jest.fn().mockRejectedValue(Object.assign(new Error('Unknown Message'), { code: 10008 }));
        const guild = { id: 'guild1', channels: { cache: new Map([['channel1', { messages: { delete: remove } }]]) } };
        const AutomationService = require('../src/services/automationService');
        service = new AutomationService({ guilds: { cache: new Map([['guild1', guild]]) } });
        await service.upsert({ guildId: 'guild1', kind: 'delete-message', key: 'message1', config: {
            channelId: 'channel1', messageId: 'message1'
        }, nextRunAt: Date.now() - 1, createdBy: 'admin1' });
        await service.runDue();
        expect(await service.get('guild1', 'delete-message', 'message1')).toBeUndefined();
    });

    test('an uncertain delivery retry keeps the original nonce', async () => {
        const send = jest.fn().mockResolvedValue({ id: 'message1' });
        const guild = { id: 'guild1', channels: { cache: new Map([['channel1', { id: 'channel1', send }]]) } };
        const AutomationService = require('../src/services/automationService');
        service = new AutomationService({ guilds: { cache: new Map([['guild1', guild]]) } });
        const rule = await service.upsert({ guildId: 'guild1', kind: 'timer', key: 'channel1', config: {
            channelId: 'channel1', message: 'tick', intervalMs: 6000
        }, nextRunAt: Date.now() - 1, createdBy: 'admin1' });
        database.sqlite.exec(`CREATE TRIGGER reject_automation_completion BEFORE UPDATE ON automation_rules
            WHEN NEW.last_run_at IS NOT NULL BEGIN SELECT RAISE(FAIL, 'completion failed'); END`);
        await service.runDue();
        database.sqlite.prepare('UPDATE automation_rules SET lease_expires_at = ? WHERE id = ?').run(Date.now() - 1, rule.id);
        await service.runDue();
        expect(send).toHaveBeenCalledTimes(2);
        expect(send.mock.calls[1][0].nonce).toBe(send.mock.calls[0][0].nonce);
    });

    test('invalid counting messages cannot grow the durable deletion queue without bound', async () => {
        const AutomationService = require('../src/services/automationService');
        const { MAX_PENDING_DELETES } = require('../src/services/automationService');
        service = new AutomationService({ guilds: { cache: new Map() } });
        await service.upsert({ guildId: 'guild1', kind: 'counter', key: 'channel1', config: {
            mode: 'counting', channelId: 'channel1', current: 0, lastUserId: null
        }, createdBy: 'admin1' });
        const insert = database.sqlite.prepare(`INSERT INTO automation_rules
            (guild_id, kind, key, config, enabled, next_run_at, run_count, created_by, created_at, updated_at)
            VALUES ('guild1', 'delete-message', ?, '{}', 1, 1, 0, 'admin1', 1, 1)`);
        database.sqlite.transaction(() => {
            for (let index = 0; index < MAX_PENDING_DELETES; index += 1) insert.run(`pending-${index}`);
        })();
        const message = {
            id: 'overflow', guild: { id: 'guild1' }, channel: { id: 'channel1' },
            author: { id: 'user1', bot: false }, content: 'wrong', react: jest.fn().mockResolvedValue({})
        };
        await service.handleMessage(message);
        expect(await service.get('guild1', 'delete-message', 'overflow')).toBeUndefined();
    });

    test('bounded automation summaries report omitted configurations', () => {
        const { formatRules } = require('../src/utils/automationCommand');
        const rules = Array.from({ length: 30 }, (_, index) => ({
            id: index + 1, key: `rule-${index}`, enabled: true, config: JSON.stringify({ message: 'x'.repeat(100) })
        }));
        const content = formatRules('timer', rules);
        expect(content.length).toBeLessThanOrEqual(2000);
        expect(content).toMatch(/… \d+ more configured\.$/);
    });

    test('new member workflows separate bot and member roles', async () => {
        const AutomationService = require('../src/services/automationService');
        const send = jest.fn().mockResolvedValue({});
        service = new AutomationService({ guilds: { cache: new Map() } });
        await service.upsert({ guildId: 'guild1', kind: 'autorole', key: 'member:role1', config: { roleId: 'role1' }, createdBy: 'admin1' });
        await service.upsert({ guildId: 'guild1', kind: 'autorole', key: 'bot:role2', config: { roleId: 'role2' }, createdBy: 'admin1' });
        await service.upsert({ guildId: 'guild1', kind: 'pingonjoin', key: 'main', config: { channelId: 'channel1', message: 'Hi {member.mention}' }, createdBy: 'admin1' });
        const add = jest.fn().mockResolvedValue({});
        const member = { id: 'user1', user: { bot: false, username: 'User' }, roles: { add, cache: new Map() }, guild: {
            id: 'guild1', name: 'Guild', members: { me: { roles: { highest: { position: 10 } } } }, roles: { cache: new Map([['role1', { id: 'role1', editable: true, managed: false, position: 1 }]]) },
            channels: { cache: new Map([['channel1', { id: 'channel1', isTextBased: () => true, send }]]) }
        } };
        await service.handleMemberAdd(member);
        expect(add).toHaveBeenCalledWith(expect.objectContaining({ id: 'role1' }), 'Configured autorole');
        expect(add).not.toHaveBeenCalledWith('role2', expect.anything());
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: 'Hi <@user1>', allowedMentions: { users: ['user1'], parse: [] } }));
    });

    test('autorole and vanity grants apply current denied-role policy at execution', async () => {
        const AutomationService = require('../src/services/automationService');
        service = new AutomationService({ guilds: { cache: new Map() } });
        const role = { id: 'reward', name: 'Reward', position: 1, editable: true, managed: false,
            permissions: { has: permission => permission === PermissionFlagsBits.Administrator } };
        const member = { id: 'user1', user: { bot: false, tag: 'User' }, roles: { cache: new Map(),
            add: jest.fn().mockResolvedValue({}), remove: jest.fn().mockResolvedValue({}) }, guild: {
            id: 'guild1', roles: { cache: new Map([[role.id, role]]) },
            members: { me: { roles: { highest: { position: 10 } } } }, channels: { cache: new Map() }
        } };
        await service.upsert({ guildId: 'guild1', kind: 'autorole', key: 'member:reward', config: { roleId: role.id }, createdBy: 'admin1' });
        await service.upsert({ guildId: 'guild1', kind: 'vanity', key: 'main', config: { vanity: 'byte', roleIds: [role.id] }, createdBy: 'admin1' });
        database.sqlite.prepare("INSERT INTO denied_role_permissions (guild_id, permission) VALUES ('guild1', 'Administrator')").run();
        await service.handleMemberAdd(member);
        await service.handlePresence({ activities: [] }, { member, activities: [{ state: 'byte' }] });
        expect(member.roles.add).not.toHaveBeenCalled();
        await service.handlePresence({ activities: [{ state: 'byte' }] }, { member, activities: [] });
        expect(member.roles.remove).toHaveBeenCalledWith('reward', 'Vanity removed');

        database.sqlite.prepare("DELETE FROM denied_role_permissions WHERE guild_id = 'guild1'").run();
        await service.handleMemberAdd(member);
        await service.handlePresence({ activities: [] }, { member, activities: [{ state: 'byte' }] });
        expect(member.roles.add).toHaveBeenCalledWith(role, 'Configured autorole');
        expect(member.roles.add).toHaveBeenCalledWith(role, 'Vanity reward');
    });

    test('counting channels atomically accept the next number and queue invalid-message cleanup', async () => {
        const AutomationService = require('../src/services/automationService');
        service = new AutomationService({ guilds: { cache: new Map() } });
        await service.upsert({ guildId: 'guild1', kind: 'counter', key: 'channel1', config: {
            mode: 'counting', channelId: 'channel1', current: 0, lastUserId: null
        }, createdBy: 'admin1' });
        const message = value => ({
            id: `message${value}`, guild: { id: 'guild1' }, channel: { id: 'channel1' },
            author: { id: `user${value}`, bot: false }, content: String(value), react: jest.fn().mockResolvedValue({})
        });
        const first = message(1);
        await service.handleMessage(first);
        expect(first.react).toHaveBeenCalledWith('✅');
        expect(JSON.parse((await service.get('guild1', 'counter', 'channel1')).config).current).toBe(1);
        const wrong = message(3);
        await service.handleMessage(wrong);
        expect(wrong.react).toHaveBeenCalledWith('❌');
        expect(await service.get('guild1', 'delete-message', 'message3')).toEqual(expect.objectContaining({ nextRunAt: expect.any(Number) }));
    });

    test('metric counters expose and idempotently update every evidenced metric', async () => {
        const command = require('../src/commands/utility/counter').data.toJSON();
        const add = command.options.find(option => option.name === 'add');
        expect(add.options.find(option => option.name === 'metric').choices.map(choice => choice.value))
            .toEqual(['members', 'bots', 'online', 'voice']);
        const channel = { id: 'channel1', name: 'bots: 1', setName: jest.fn(function setName(name) { this.name = name; }) };
        const guild = {
            id: 'guild1', memberCount: 3, channels: { cache: new Map([['channel1', channel]]) },
            members: { cache: new Collection([
                ['user1', { user: { bot: false }, presence: { status: 'online' } }],
                ['user2', { user: { bot: false }, presence: { status: 'offline' } }],
                ['bot1', { user: { bot: true }, presence: { status: 'idle' } }]
            ]) }
        };
        const AutomationService = require('../src/services/automationService');
        service = new AutomationService({ guilds: { cache: new Map([['guild1', guild]]) } });
        await service.upsert({ guildId: 'guild1', kind: 'counter', key: 'channel1', config: {
            mode: 'metric', channelId: 'channel1', metric: 'bots', intervalMs: 300000
        }, nextRunAt: Date.now() - 1, createdBy: 'admin1' });
        await service.runDue();
        expect(channel.setName).not.toHaveBeenCalled();
        await service.upsert({ guildId: 'guild1', kind: 'counter', key: 'channel1', config: {
            mode: 'metric', channelId: 'channel1', metric: 'online', intervalMs: 300000
        }, nextRunAt: Date.now() - 1, createdBy: 'admin1' });
        await service.runDue();
        expect(channel.setName).toHaveBeenCalledWith('online: 2', 'Automation counter');
    });

    test('tracking uses configured availability windows and arms matching personal notifications', async () => {
        const guild = { id: 'guild1', channels: { cache: new Map([['channel1', { send: jest.fn().mockResolvedValue({}) }]]) } };
        const AutomationService = require('../src/services/automationService');
        service = new AutomationService({ guilds: { cache: new Map([['guild1', guild]]) } });
        await service.upsert({ guildId: 'guild1', kind: 'tracking', key: 'channel1', config: {
            mode: 'channel', channelId: 'channel1', types: ['username'], usernameDays: 2
        }, createdBy: 'admin1' });
        await service.upsert({ guildId: 'guild1', kind: 'tracking', key: 'notify:user1:username:oldname', config: {
            mode: 'notify', type: 'username', desired: 'OldName', userId: 'user1'
        }, createdBy: 'user1' });
        const before = Date.now();
        await service.handleUserUpdate({ username: 'OldName' }, { username: 'NewName' });
        const dropped = JSON.parse((await service.get('guild1', 'tracking', 'channel1')).config).dropped[0];
        expect(dropped.availableAt).toBeGreaterThanOrEqual(before + 2 * 86400000);
        expect((await service.get('guild1', 'tracking', 'notify:user1:username:oldname')).nextRunAt).toBe(dropped.availableAt);
    });
});
