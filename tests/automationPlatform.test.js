const fs = require('fs');
const os = require('os');
const path = require('path');
const { Collection, PermissionFlagsBits } = require('discord.js');

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

    afterEach(() => {
        service?.cleanup();
        database.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
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

    test('interval parsing is bounded and unambiguous', () => {
        const { parseInterval } = require('../src/services/automationService');
        expect(parseInterval('30m')).toBe(1800000);
        expect(parseInterval('2h')).toBe(7200000);
        expect(parseInterval('1d')).toBe(86400000);
        expect(parseInterval('5s')).toBeNull();
        expect(parseInterval('29d')).toBeNull();
        expect(parseInterval('tomorrow')).toBeNull();
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
        const member = { id: 'user1', user: { bot: false, username: 'User' }, roles: { add }, guild: {
            id: 'guild1', name: 'Guild', roles: { cache: new Map([['role1', { id: 'role1', editable: true, managed: false }]]) },
            channels: { cache: new Map([['channel1', { id: 'channel1', isTextBased: () => true, send }]]) }
        } };
        await service.handleMemberAdd(member);
        expect(add).toHaveBeenCalledWith('role1', 'Configured autorole');
        expect(add).not.toHaveBeenCalledWith('role2', expect.anything());
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: 'Hi <@user1>', allowedMentions: { users: ['user1'], parse: [] } }));
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
