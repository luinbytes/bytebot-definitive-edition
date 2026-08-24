const fs = require('fs');
const os = require('os');
const path = require('path');
const { Collection, PermissionFlagsBits } = require('discord.js');

describe('self-service and booster role automation', () => {
    let tempDir;
    let database;
    let automation;
    let service;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-roles-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        const AutomationService = require('../src/services/automationService');
        automation = new AutomationService({ guilds: { cache: new Map() } });
    });

    afterEach(() => {
        automation?.cleanup();
        database.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('published role command families serialize with their full lifecycle', () => {
        const expected = {
            reactionrole: ['add', 'remove', 'list', 'clear'],
            buttonrole: ['add', 'remove', 'removeall', 'reset', 'list'],
            temprole: ['add', 'remove', 'list']
        };
        for (const [name, actions] of Object.entries(expected)) {
            const json = require(`../src/commands/utility/${name}`).data.toJSON();
            expect(json.options.map(option => option.name)).toEqual(expect.arrayContaining(actions));
            expect(json.default_member_permissions).toBe(PermissionFlagsBits.ManageRoles.toString());
        }
        const booster = require('../src/commands/administration/boosterrole').data.toJSON();
        expect(booster.options.map(option => option.name)).toEqual(expect.arrayContaining([
            'setup', 'disable', 'base', 'create', 'delete', 'rename', 'color', 'icon', 'share', 'list', 'include', 'sync', 'hoist', 'limit', 'filter', 'shares'
        ]));
        expect(require('../src/commands/utility/boosters').data.toJSON().options.map(option => option.name))
            .toEqual(expect.arrayContaining(['list', 'lost']));
    });

    test('reaction mappings grant and revoke through the blocked-permission role manager', async () => {
        const role = { id: '200', name: 'Role', position: 1, managed: false, editable: true, permissions: { has: () => false } };
        const add = jest.fn().mockResolvedValue({});
        const remove = jest.fn().mockResolvedValue({});
        const guild = {
            id: 'guild1', roles: { cache: new Map([['200', role]]) },
            members: { me: { roles: { highest: { position: 10 } } }, fetch: jest.fn().mockResolvedValue({
                user: { id: 'user1', tag: 'User' }, guild: null, roles: { cache: new Map(), add, remove }
            }) }
        };
        const member = await guild.members.fetch('user1');
        member.guild = guild;
        guild.members.fetch.mockResolvedValue(member);
        const RoleAutomationService = require('../src/services/roleAutomationService');
        service = new RoleAutomationService({ user: { id: 'bot1' } }, automation);
        await automation.upsert({ guildId: 'guild1', kind: 'reaction-role', key: '100:🎉', config: {
            messageId: '100', channelId: 'channel1', emoji: '🎉', roleId: '200'
        }, createdBy: 'admin1' });
        const reaction = { message: { id: '100', guild }, emoji: { id: null, name: '🎉' } };
        await service.handleReaction(reaction, { id: 'user1' }, true);
        member.roles.cache.set(role.id, role);
        await service.handleReaction(reaction, { id: 'user1' }, false);
        expect(add).toHaveBeenCalledWith(role, 'Reaction role');
        expect(remove).toHaveBeenCalledWith(role, 'Reaction role removed');
    });

    test('the atomic reaction cap removes the unmapped bot reaction', async () => {
        const role = { id: '200', name: 'Role', managed: false, editable: true, permissions: { has: () => false } };
        const remove = jest.fn().mockResolvedValue();
        const message = { id: '100', channel: { id: '300' }, react: jest.fn().mockResolvedValue({ users: { remove } }) };
        const guild = { id: '400', channels: { cache: new Map([['300', { messages: { fetch: jest.fn().mockResolvedValue(message) } }]]) } };
        const RoleAutomationService = require('../src/services/roleAutomationService');
        const { automationRules } = require('../src/database/schema');
        service = new RoleAutomationService({ user: { id: 'bot1' } }, automation);
        const now = Date.now();
        await database.db.insert(automationRules).values(Array.from({ length: 500 }, (_, index) => ({
            guildId: '400', kind: 'reaction-role', key: `existing-${index}`, config: '{}', enabled: true,
            createdBy: 'admin1', createdAt: now, updatedAt: now
        })));
        await expect(service.addReactionRole({ guild, messageLink: 'https://discord.com/channels/400/300/100',
            emoji: '🎉', role, createdBy: 'admin1' })).rejects.toThrow(/500 reaction-role limit/);
        expect(remove).toHaveBeenCalledWith('bot1');
    });

    test('button custom IDs are durable and stale message copies fail closed', async () => {
        const role = { id: '200', name: 'Role', position: 1, managed: false, editable: true, permissions: { has: () => false } };
        const add = jest.fn().mockResolvedValue({});
        const guild = { id: 'guild1', roles: { cache: new Map([['200', role]]) }, members: { me: { roles: { highest: { position: 10 } } } } };
        const member = { user: { id: 'user1', tag: 'User' }, guild, roles: { cache: new Map(), add, remove: jest.fn() } };
        const RoleAutomationService = require('../src/services/roleAutomationService');
        service = new RoleAutomationService({ user: { id: 'bot1' } }, automation);
        await automation.upsert({ guildId: 'guild1', kind: 'button-role', key: '100:200', config: {
            messageId: '100', channelId: 'channel1', roleId: '200', label: 'Role'
        }, createdBy: 'admin1' });
        const reply = jest.fn().mockResolvedValue({});
        await service.handleButton({ customId: 'rolebtn:100:200', guild, guildId: 'guild1', message: { id: '999' }, member, reply });
        expect(add).not.toHaveBeenCalled();
        expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/expired|stale/i) }));
        reply.mockClear();
        await service.handleButton({ customId: 'rolebtn:100:200', guild, guildId: 'guild1', message: { id: '100' }, member, reply });
        expect(add).toHaveBeenCalledWith(role, 'Button role');
    });

    test('failed button edits do not leave an active database rule', async () => {
        const role = { id: '200', name: 'Role', managed: false, editable: true, permissions: { has: () => false } };
        const message = { id: '100', author: { id: 'bot1' }, channel: { id: 'channel1' }, components: [],
            edit: jest.fn().mockRejectedValue(new Error('Missing permissions')) };
        const channel = { messages: { fetch: jest.fn().mockResolvedValue(message) } };
        const guild = { id: '400', channels: { cache: new Map([['300', channel]]) } };
        const RoleAutomationService = require('../src/services/roleAutomationService');
        service = new RoleAutomationService({ user: { id: 'bot1' } }, automation);
        await expect(service.addButtonRole({ guild, messageLink: 'https://discord.com/channels/400/300/100', role,
            createdBy: 'admin1' })).rejects.toThrow('Missing permissions');
        expect(await automation.get('400', 'button-role', '100:200')).toBeUndefined();
    });

    test('button removal refuses messages ByteBot does not own', async () => {
        const message = { id: '100', author: { id: 'other-bot' }, channel: { id: '300' }, edit: jest.fn() };
        const guild = { id: '400', channels: { cache: new Map([['300', { messages: { fetch: jest.fn().mockResolvedValue(message) } }]]) } };
        const RoleAutomationService = require('../src/services/roleAutomationService');
        service = new RoleAutomationService({ user: { id: 'bot1' } }, automation);
        await automation.upsert({ guildId: '400', kind: 'button-role', key: '100:200', config: {
            messageId: '100', channelId: '300', roleId: '200', label: 'Role'
        }, createdBy: 'admin1' });
        const editReply = jest.fn().mockResolvedValue();
        await require('../src/commands/utility/buttonrole').execute({ guild, user: { id: 'admin1' }, editReply, options: {
            getSubcommand: () => 'removeall', getString: () => 'https://discord.com/channels/400/300/100'
        } }, { user: { id: 'bot1' }, automationService: automation, roleAutomationService: service });
        expect(editReply).toHaveBeenCalledWith(expect.stringMatching(/ByteBot-authored/));
        expect(message.edit).not.toHaveBeenCalled();
        expect(await automation.get('400', 'button-role', '100:200')).toBeDefined();
    });

    test('Discord events route role reactions and buttons to the durable service', async () => {
        const handleReaction = jest.fn().mockResolvedValue();
        const reaction = { client: { roleAutomationService: { handleReaction } }, message: { guild: { id: 'guild1' } }, emoji: { name: '🎉' } };
        await require('../src/events/messageReactionAdd').execute(reaction, { id: 'user1', bot: false });
        expect(handleReaction).toHaveBeenCalledWith(reaction, expect.objectContaining({ id: 'user1' }), true);

        const handleButton = jest.fn().mockResolvedValue();
        const interaction = { id: `role-button-${Date.now()}`, customId: 'rolebtn:100:200', isButton: () => true };
        await require('../src/events/interactionCreate').execute(interaction, { roleAutomationService: { handleButton } });
        expect(handleButton).toHaveBeenCalledWith(interaction);
    });

    test('configuration rejects roles carrying a server-blocked permission', async () => {
        const { deniedRolePermissions } = require('../src/database/schema');
        await database.db.insert(deniedRolePermissions).values({ guildId: 'guild1', permission: 'Administrator' });
        const role = { id: '200', editable: true, managed: false, permissions: { has: permission => permission === PermissionFlagsBits.Administrator } };
        const RoleAutomationService = require('../src/services/roleAutomationService');
        service = new RoleAutomationService({ user: { id: 'bot1' } }, automation);
        await expect(service.validateRole({ id: 'guild1' }, role)).resolves.toMatch(/blocked permission Administrator/);
        const ordinaryRole = { ...role, position: 5, permissions: { has: () => false } };
        await expect(service.validateRole({ id: 'guild1', ownerId: 'owner1' }, ordinaryRole,
            { id: 'admin1', roles: { highest: { position: 5 } } })).resolves.toMatch(/highest role/);
        const { RoleManager } = require('../src/utils/discordApiUtil');
        await expect(RoleManager.addRole({ guild: { id: 'guild1' }, roles: { cache: new Map() } },
            { id: 'managed1', name: 'Integration', managed: true })).resolves.toEqual(expect.objectContaining({ success: false }));
    });

    test('temporary roles are removed by the existing restart-safe scheduler', async () => {
        const role = { id: 'role1', name: 'Role', position: 1, managed: false, permissions: { has: () => false } };
        const remove = jest.fn().mockResolvedValue({});
        const member = { user: { id: 'user1', tag: 'User' }, roles: { cache: new Map([['role1', role]]), remove }, guild: null };
        const guild = { id: 'guild1', roles: { cache: new Map([['role1', role]]) }, members: {
            me: { roles: { highest: { position: 10 } } }, fetch: jest.fn().mockResolvedValue(member)
        }, channels: { cache: new Map() } };
        member.guild = guild;
        const AutomationService = require('../src/services/automationService');
        automation = new AutomationService({ guilds: { cache: new Map([['guild1', guild]]) } });
        await automation.upsert({ guildId: 'guild1', kind: 'temp-role', key: 'user1:role1', config: {
            userId: 'user1', roleId: 'role1'
        }, nextRunAt: Date.now() - 1, createdBy: 'admin1' });
        await automation.runDue();
        expect(remove).toHaveBeenCalledWith(role, 'Temporary role expired');
        expect(await automation.get('guild1', 'temp-role', 'user1:role1')).toBeUndefined();
    });

    test('temporary-role expiry retries a transient member fetch failure', async () => {
        const fetchError = new Error('Discord unavailable');
        const guild = { id: 'guild1', roles: { cache: new Map([['role1', { id: 'role1' }]]) },
            members: { fetch: jest.fn().mockRejectedValue(fetchError) }, channels: { cache: new Map() } };
        const AutomationService = require('../src/services/automationService');
        automation = new AutomationService({ guilds: { cache: new Map([['guild1', guild]]) } }, { retryBaseMs: 1000 });
        await automation.upsert({ guildId: 'guild1', kind: 'temp-role', key: 'user1:role1', config: {
            userId: 'user1', roleId: 'role1'
        }, nextRunAt: Date.now() - 1, createdBy: 'admin1' });
        await automation.runDue();
        expect(await automation.get('guild1', 'temp-role', 'user1:role1')).toEqual(expect.objectContaining({ enabled: true }));
    });

    test('booster ownership claims are atomic for owners and existing roles', () => {
        const RoleAutomationService = require('../src/services/roleAutomationService');
        service = new RoleAutomationService({ user: { id: 'bot1' } }, automation);
        expect(service.claimBoosterRole({ guildId: 'guild1', ownerId: 'user1', roleId: 'role1', maxRoles: 249,
            createdBy: 'admin1' })).toEqual(expect.objectContaining({ status: 'claimed' }));
        expect(service.claimBoosterRole({ guildId: 'guild1', ownerId: 'user1', roleId: 'role2', maxRoles: 249,
            createdBy: 'admin1' })).toEqual({ status: 'owner' });
        expect(service.claimBoosterRole({ guildId: 'guild1', ownerId: 'user2', roleId: 'role1', maxRoles: 249,
            createdBy: 'admin1' })).toEqual({ status: 'role' });
    });

    test('the scheduler removes a Discord role created before its ID could be persisted', async () => {
        const pendingRole = { id: 'role1', name: null, delete: jest.fn().mockResolvedValue() };
        const roles = new Collection([['role1', pendingRole]]);
        const guild = { id: 'guild1', roles: { cache: roles, fetch: jest.fn().mockResolvedValue(roles) },
            members: { fetch: jest.fn() }, channels: { cache: new Map() } };
        const client = { user: { id: 'bot1' }, guilds: { cache: new Map([['guild1', guild]]) } };
        const AutomationService = require('../src/services/automationService');
        const RoleAutomationService = require('../src/services/roleAutomationService');
        automation = new AutomationService(client);
        service = new RoleAutomationService(client, automation);
        client.roleAutomationService = service;
        const claim = service.claimBoosterRole({ guildId: 'guild1', ownerId: 'user1', maxRoles: 249, createdBy: 'user1' });
        pendingRole.name = claim.pendingName;
        await automation.upsert({ guildId: 'guild1', kind: 'booster-role', key: 'user1', config: {
            roleId: null, shares: [], pendingName: claim.pendingName
        }, nextRunAt: Date.now() - 1, createdBy: 'user1' });
        await automation.runDue();
        expect(pendingRole.delete).toHaveBeenCalledWith('Interrupted booster role setup');
        expect(await automation.get('guild1', 'booster-role', 'user1')).toBeUndefined();
    });

    test('the scheduler drops an interrupted include claim when no role was granted', async () => {
        const role = { id: 'role1', name: 'Existing role' };
        const member = { id: 'user1', premiumSince: new Date(), roles: { cache: new Map() } };
        const guild = { id: 'guild1', roles: { cache: new Map([['role1', role]]), fetch: jest.fn() },
            members: { fetch: jest.fn().mockResolvedValue(member) }, channels: { cache: new Map() } };
        member.guild = guild;
        const client = { user: { id: 'bot1' }, guilds: { cache: new Map([['guild1', guild]]) } };
        const AutomationService = require('../src/services/automationService');
        const RoleAutomationService = require('../src/services/roleAutomationService');
        automation = new AutomationService(client);
        service = new RoleAutomationService(client, automation);
        client.roleAutomationService = service;
        service.claimBoosterRole({ guildId: 'guild1', ownerId: 'user1', roleId: 'role1', maxRoles: 249, createdBy: 'admin1' });
        await automation.upsert({ guildId: 'guild1', kind: 'booster-role', key: 'user1', config: {
            roleId: 'role1', shares: [], pendingGrant: true, included: true
        }, nextRunAt: Date.now() - 1, createdBy: 'admin1' });
        await automation.runDue();
        expect(await automation.get('guild1', 'booster-role', 'user1')).toBeUndefined();
    });

    test('a manually deleted booster role clears its owner record', async () => {
        const unknownRole = Object.assign(new Error('Unknown Role'), { code: 10011 });
        const guild = { id: 'guild1', roles: { cache: new Map(), fetch: jest.fn().mockRejectedValue(unknownRole) },
            members: { fetch: jest.fn() }, channels: { cache: new Map() } };
        const client = { user: { id: 'bot1' }, guilds: { cache: new Map([['guild1', guild]]) } };
        const AutomationService = require('../src/services/automationService');
        const RoleAutomationService = require('../src/services/roleAutomationService');
        automation = new AutomationService(client);
        service = new RoleAutomationService(client, automation);
        client.roleAutomationService = service;
        await automation.upsert({ guildId: 'guild1', kind: 'booster-role', key: 'user1', config: {
            roleId: 'role1', shares: [], cleanup: false
        }, nextRunAt: Date.now() - 1, createdBy: 'user1' });
        await automation.runDue();
        expect(await automation.get('guild1', 'booster-role', 'user1')).toBeUndefined();
    });

    test('booster share updates serialize per owner', async () => {
        const RoleAutomationService = require('../src/services/roleAutomationService');
        service = new RoleAutomationService({ user: { id: 'bot1' } }, automation);
        const order = [];
        let finish;
        const first = service.withBoosterLock('guild1:user1', () => new Promise(resolve => { finish = () => { order.push('first'); resolve(); }; }));
        const second = service.withBoosterLock('guild1:user1', async () => { order.push('second'); });
        await Promise.resolve();
        expect(order).toEqual([]);
        finish();
        await Promise.all([first, second]);
        expect(order).toEqual(['first', 'second']);
    });

    test('the leased scheduler cleans booster roles lost while ByteBot was offline', async () => {
        const removeRole = jest.fn().mockResolvedValue();
        const member = { id: 'user1', premiumSince: null, guild: null };
        const guild = { id: 'guild1', roles: { cache: new Map([['role1', { id: 'role1', delete: removeRole }]]), fetch: jest.fn() },
            members: { fetch: jest.fn().mockResolvedValue(member) }, channels: { cache: new Map() } };
        member.guild = guild;
        const client = { user: { id: 'bot1' }, guilds: { cache: new Map([['guild1', guild]]) } };
        const AutomationService = require('../src/services/automationService');
        const RoleAutomationService = require('../src/services/roleAutomationService');
        automation = new AutomationService(client);
        service = new RoleAutomationService(client, automation);
        client.roleAutomationService = service;
        await automation.upsert({ guildId: 'guild1', kind: 'booster-role', key: 'user1', config: {
            roleId: 'role1', shares: [], cleanup: false
        }, nextRunAt: Date.now() - 1, createdBy: 'user1' });
        await automation.runDue();
        expect(removeRole).toHaveBeenCalled();
        expect(await automation.get('guild1', 'booster-role', 'user1')).toBeUndefined();
        expect(await automation.get('guild1', 'booster-lost', 'user1')).toBeDefined();
    });

    test('stopping a boost deletes the owned role and records the loss', async () => {
        const removeRole = jest.fn().mockResolvedValue({});
        const guild = { id: 'guild1', roles: { cache: new Map([['role1', { id: 'role1', delete: removeRole }]]) } };
        const member = { id: 'user1', guild, premiumSince: null };
        const RoleAutomationService = require('../src/services/roleAutomationService');
        service = new RoleAutomationService({ user: { id: 'bot1' } }, automation);
        await automation.upsert({ guildId: 'guild1', kind: 'booster-role', key: 'user1', config: { roleId: 'role1', shares: [] }, createdBy: 'user1' });
        await service.handleMemberUpdate({ premiumSince: new Date() }, member);
        expect(removeRole).toHaveBeenCalledWith('Booster stopped boosting or left');
        expect(await automation.get('guild1', 'booster-role', 'user1')).toBeUndefined();
        expect(await automation.get('guild1', 'booster-lost', 'user1')).toBeDefined();
        const editReply = jest.fn().mockResolvedValue();
        await require('../src/commands/utility/boosters').execute({ guild, editReply,
            options: { getSubcommand: () => 'lost' } }, { automationService: automation });
        expect(editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('<@user1>') }));
    });

    test('role lists stay within Discord message limits and report omissions', () => {
        const { boundedList } = require('../src/services/roleAutomationService');
        const content = boundedList(Array.from({ length: 100 }, (_, index) => `${index}. ${'x'.repeat(80)}`), 'empty');
        expect(content.length).toBeLessThan(2000);
        expect(content).toMatch(/more configured/);
    });
});
