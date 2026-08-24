const fs = require('fs');
const os = require('os');
const path = require('path');

describe('ticket platform', () => {
    let tempDir;
    let database;
    let service;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-tickets-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        const { TicketService } = require('../src/services/ticketService');
        service = new TicketService(null, { sqlite: database.sqlite, now: () => 1000 });
    });

    afterEach(() => {
        service?.cleanup();
        database.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('registers the public ticket tree in Administration without hiding member actions', () => {
        const command = require('../src/commands/administration/ticket');
        const json = command.data.toJSON();
        const groups = Object.fromEntries(json.options.filter(option => option.type === 2)
            .map(group => [group.name, group.options.map(option => option.name)]));
        const direct = json.options.filter(option => option.type === 1).map(option => option.name);

        expect(json.name).toBe('ticket');
        expect(json.default_member_permissions).toBeUndefined();
        expect(json.options.length).toBeLessThanOrEqual(25);
        expect(groups).toEqual({
            panel: ['create', 'send', 'manage', 'remove', 'list'],
            topics: ['add', 'remove', 'category', 'role', 'embed', 'list'],
            settings: ['view', 'dms', 'inactivity', 'limit', 'logs', 'rating', 'vouch'],
            access: ['blacklist', 'unblacklist', 'list'],
            profile: ['set', 'view', 'clear']
        });
        expect(direct).toEqual([
            'setup', 'support', 'category', 'message', 'button', 'reset',
            'add', 'remove', 'rename', 'claim', 'unclaim', 'close', 'reopen',
            'delete', 'transcript', 'move', 'reason', 'list', 'stats'
        ]);
        expect(command.category).toBeUndefined();
    });

    test('migrations enforce guild-scoped panel names and opening blacklists', () => {
        const insertPanel = database.sqlite.prepare(`
            INSERT INTO ticket_panels (guild_id, name, mode, created_by, created_at, updated_at)
            VALUES (?, 'support', 'dropdown', 'admin', 1, 1)
        `);
        insertPanel.run('guild1');
        expect(() => insertPanel.run('guild1')).toThrow();
        expect(() => insertPanel.run('guild2')).not.toThrow();

        const insertBlacklist = database.sqlite.prepare(`
            INSERT INTO ticket_blacklist (guild_id, target_type, target_id, created_by, created_at)
            VALUES ('guild1', 'member', 'user1', 'admin', 1)
        `);
        insertBlacklist.run();
        expect(() => insertBlacklist.run()).toThrow();
    });

    test('reserves ticket numbers atomically and enforces one total or one per topic', () => {
        service.updateConfig('guild1', { limitMode: 'one_total' });
        const first = service.reserveTicket({ guildId: 'guild1', openerId: 'user1', topicId: 'billing' });
        expect(first.number).toBe(1);
        expect(() => service.reserveTicket({ guildId: 'guild1', openerId: 'user1', topicId: 'technical' }))
            .toThrow('already have an open ticket');

        service.markDeleted(first.id, 'admin');
        service.updateConfig('guild1', { limitMode: 'one_per_topic' });
        const second = service.reserveTicket({ guildId: 'guild1', openerId: 'user1', topicId: 'billing' });
        const third = service.reserveTicket({ guildId: 'guild1', openerId: 'user1', topicId: 'technical' });
        expect([second.number, third.number]).toEqual([2, 3]);
        expect(() => service.reserveTicket({ guildId: 'guild1', openerId: 'user1', topicId: 'billing' }))
            .toThrow('already have an open ticket for that topic');
    });

    test('lifecycle transitions are compare-and-swap and leave terminal tickets immutable', () => {
        const ticket = service.reserveTicket({ guildId: 'guild1', openerId: 'user1' });
        service.attachChannel(ticket.id, 'channel1');
        expect(service.claim(ticket.id, 'staff1').status).toBe('claimed');
        expect(() => service.claim(ticket.id, 'staff2')).toThrow('not available to claim');
        expect(service.close(ticket.id, 'staff1', 'resolved').status).toBe('closed');
        expect(service.reopen(ticket.id, 'staff1').status).toBe('open');
        expect(service.beginDelete(ticket.id, 'staff1').status).toBe('deleting');
        expect(() => service.reopen(ticket.id, 'staff1')).toThrow('cannot be reopened');
        expect(service.markDeleted(ticket.id, 'staff1').status).toBe('deleted');
        expect(service.markDeleted(ticket.id, 'staff1').status).toBe('deleted');
    });

    test('transcripts escape user content and preserve ticket metadata', () => {
        const html = service.renderTranscript({
            ticket: { number: 7, openerId: 'user1', topicName: 'Billing & refunds' },
            messages: [{
                id: 'm1',
                createdTimestamp: 500,
                author: { id: 'user1', username: '<Admin>' },
                member: { displayName: 'A & B', roles: { cache: new Map([['r1', { name: '<Staff>' }]]) } },
                content: '<script>alert(1)</script>',
                attachments: new Map([['a1', { name: 'proof.png', url: 'https://cdn.example/proof.png' }]])
            }]
        });

        expect(html).toContain('Ticket #7');
        expect(html).toContain('Billing &amp; refunds');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).toContain('A &amp; B');
        expect(html).not.toContain('<script>');
    });

    test('enforces only the publicly evidenced and Discord-native configuration limits', () => {
        for (let index = 1; index <= 15; index++) service.createPanel('guild1', `panel-${index}`, 'dropdown', 'admin');
        expect(() => service.createPanel('guild1', 'panel-16', 'button', 'admin')).toThrow('maximum of 15 panels');

        for (let index = 1; index <= 25; index++) service.createTopic('guild1', `topic-${index}`);
        expect(() => service.createTopic('guild1', 'topic-26')).toThrow('maximum of 25 topics');

        const panel = service.getPanel('guild1', 'panel-1');
        const form = service.createForm(panel.id, 'intake');
        for (let index = 1; index <= 5; index++) service.addFormField(form.id, { label: `Question ${index}` });
        expect(() => service.addFormField(form.id, { label: 'Question 6' })).toThrow('at most five fields');
    });

    test('snapshots support authorization so configuration cleanup cannot orphan a live ticket', () => {
        const ticket = service.reserveTicket({
            guildId: 'guild1', openerId: 'user1',
            accessSnapshot: { supportRoleIds: ['support'], traineeRoleIds: ['trainee'], traineeClaim: false }
        });
        const member = {
            id: 'staff1', guild: { id: 'guild1', ownerId: 'owner' },
            permissions: { has: () => false }, roles: { cache: new Map([['support', {}]]) }
        };
        const trainee = { ...member, id: 'trainee1', roles: { cache: new Map([['trainee', {}]]) } };

        expect(service.authorize(ticket, member, 'manage')).toBe(true);
        expect(service.authorize(ticket, trainee, 'view')).toBe(true);
        expect(service.authorize(ticket, trainee, 'claim')).toBe(false);
    });

    test('opens a marked private channel and persists the option access snapshot', async () => {
        const panel = service.createPanel('guild1', 'support', 'button', 'admin');
        const option = service.addOption(panel.id, { label: 'Billing' });
        service.setOptionRole(option.id, 'support-role', 'support');
        const channel = { id: 'channel1', send: jest.fn(async () => ({})), delete: jest.fn() };
        const guild = {
            id: 'guild1', roles: { everyone: { id: 'guild1' } },
            members: { me: { id: 'bot', permissions: { has: () => true } } },
            channels: { cache: new Map(), create: jest.fn(async () => channel) }
        };
        const interaction = {
            guild, user: { id: 'user1' },
            member: { id: 'user1', guild, roles: { cache: new Map() } }
        };

        const ticket = await service.openTicket(interaction, option.id);

        expect(guild.channels.create).toHaveBeenCalledWith(expect.objectContaining({
            name: 'ticket-1', topic: expect.stringContaining('ByteBot ticket:1'),
            permissionOverwrites: expect.arrayContaining([expect.objectContaining({ id: 'support-role' })])
        }));
        expect(ticket.channelId).toBe('channel1');
        expect(service.getTicket(ticket.id).accessSnapshot.supportRoleIds).toEqual(['support-role']);
    });

    test('saves and logs the transcript before deleting the exact tracked channel', async () => {
        const ticket = service.reserveTicket({ guildId: 'guild1', openerId: 'user1' });
        service.attachChannel(ticket.id, 'channel1');
        service.updateConfig('guild1', { logChannelId: 'logs' });
        service.createTranscript = jest.fn(async () => ({ html: '<html></html>', attachment: {} }));
        service.log = jest.fn(async () => ({}));
        service.notifyOpener = jest.fn(async () => true);
        const channel = { delete: jest.fn(async () => {}) };

        await service.deleteDiscordTicket(service.getTicket(ticket.id), channel, 'staff1');

        expect(service.createTranscript.mock.invocationCallOrder[0]).toBeLessThan(channel.delete.mock.invocationCallOrder[0]);
        expect(service.log.mock.invocationCallOrder[0]).toBeLessThan(channel.delete.mock.invocationCallOrder[0]);
        expect(service.getTicket(ticket.id).status).toBe('deleted');
    });

    test('never deletes a channel when transcript persistence fails', async () => {
        const ticket = service.reserveTicket({ guildId: 'guild1', openerId: 'user1' });
        service.attachChannel(ticket.id, 'channel1');
        service.updateConfig('guild1', { logChannelId: 'logs' });
        service.createTranscript = jest.fn(async () => { throw new Error('disk full'); });
        const channel = { delete: jest.fn() };

        await expect(service.deleteDiscordTicket(service.getTicket(ticket.id), channel, 'staff1')).rejects.toThrow('disk full');

        expect(channel.delete).not.toHaveBeenCalled();
        expect(service.getTicket(ticket.id).status).toBe('open');
    });

    test('stores only the first rating for a deleted ticket', async () => {
        const ticket = service.reserveTicket({ guildId: 'guild1', openerId: 'user1' });
        service.markDeleted(ticket.id, 'staff1');
        const interaction = { user: { id: 'user1' }, update: jest.fn(async payload => payload) };

        await service.handleRating(interaction, ticket.id, 5);
        await service.handleRating(interaction, ticket.id, 1);

        expect(database.sqlite.prepare('SELECT stars FROM ticket_ratings WHERE ticket_id = ?').get(ticket.id).stars).toBe(5);
        expect(interaction.update).toHaveBeenLastCalledWith({ content: 'Your rating was already saved.', components: [] });
    });
});
