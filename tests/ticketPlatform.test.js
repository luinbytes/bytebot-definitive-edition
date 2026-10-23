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

    function deletionFixture() {
        const { Collection } = require('discord.js');
        const reserved = service.reserveTicket({ guildId: 'guild1', openerId: 'user1',
            accessSnapshot: { supportRoleIds: ['support'] } });
        const ticket = service.attachChannel(reserved.id, 'channel1');
        service.updateConfig('guild1', { logChannelId: 'logs', dmsEnabled: true });
        const channel = {
            id: 'channel1', messages: { fetch: jest.fn(async () => new Collection()) },
            permissionOverwrites: { edit: jest.fn(async () => {}) },
            delete: jest.fn(async () => {})
        };
        const log = { send: jest.fn(async () => ({ id: 'log-message' })) };
        const opener = { send: jest.fn(async () => ({})) };
        const guild = {
            channels: { cache: new Map([['channel1', channel], ['logs', log]]), fetch: jest.fn(async () => null) }
        };
        service.client = {
            user: { id: 'bot' }, guilds: { cache: new Map([['guild1', guild]]) },
            users: { fetch: jest.fn(async () => opener) }
        };
        return { ticket, channel, log, opener, guild };
    }

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
        expect(() => service.beginDelete(ticket.id, 'staff2')).toThrow('cannot be deleted');
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

    test('stops fetching oversized escaped transcripts without replacing the archive or deleting the channel', async () => {
        const { Collection } = require('discord.js');
        const ticket = service.reserveTicket({ guildId: 'guild1', openerId: 'user1' });
        service.attachChannel(ticket.id, 'channel1');
        service.updateConfig('guild1', { logChannelId: 'logs' });
        database.sqlite.prepare('INSERT INTO ticket_transcripts (ticket_id, html, created_at, updated_at) VALUES (?, ?, 1, 1)')
            .run(ticket.id, 'previous complete archive');
        const fetch = jest.fn(async () => {
            const page = fetch.mock.calls.length;
            return new Collection(page <= 8 ? Array.from({ length: 100 }, (_, index) => {
                const id = String(1000 - (page - 1) * 100 - index);
                return [id, { id, createdTimestamp: Number(id), content: '&'.repeat(4000) }];
            }) : []);
        });
        const channel = { messages: { fetch }, delete: jest.fn() };
        service.log = jest.fn();
        service.notifyOpener = jest.fn();

        await expect(service.deleteDiscordTicket(service.getTicket(ticket.id), channel, 'staff1'))
            .rejects.toThrow('complete transcript exceeds');

        expect(fetch).toHaveBeenCalledTimes(5);
        expect(service.getTicket(ticket.id).status).toBe('open');
        expect(database.sqlite.prepare('SELECT html FROM ticket_transcripts WHERE ticket_id = ?').get(ticket.id).html)
            .toBe('previous complete archive');
        expect(service.log).not.toHaveBeenCalled();
        expect(service.notifyOpener).not.toHaveBeenCalled();
        expect(channel.delete).not.toHaveBeenCalled();
    });

    test('archives every page in chronological order with escaped roles, content and attachments', async () => {
        const { Collection } = require('discord.js');
        const ticket = service.reserveTicket({ guildId: 'guild1', openerId: 'user1' });
        const message = id => ({ id: String(id), createdTimestamp: id, content: `message-${id}` });
        const first = {
            ...message(1), content: `message-1 <>&"' 💬`,
            member: { displayName: 'A & B', roles: { cache: new Map([['r1', { name: '<Staff>' }]]) } },
            attachments: new Map([
                ['safe', { name: 'proof"&.png', url: 'https://cdn.example/proof?q="&b=1' }],
                ['unsafe', { name: 'unsafe', url: 'javascript:alert(1)' }]
            ])
        };
        const newest = Array.from({ length: 100 }, (_, index) => message(103 - index));
        const fetch = jest.fn()
            .mockResolvedValueOnce(new Collection(newest.map(value => [value.id, value])))
            .mockResolvedValueOnce(new Collection([message(3), first, message(2)].map(value => [value.id, value])));

        const transcript = await service.createTranscript(ticket, { messages: { fetch } });

        expect(fetch).toHaveBeenNthCalledWith(2, { limit: 100, before: '4' });
        expect(transcript.html.match(/<article>/g)).toHaveLength(103);
        expect([...transcript.html.matchAll(/<p>message-(\d+)/g)].map(match => Number(match[1])))
            .toEqual(Array.from({ length: 103 }, (_, index) => index + 1));
        expect(transcript.html).toContain('A &amp; B');
        expect(transcript.html).toContain('<small>&lt;Staff&gt;</small>');
        expect(transcript.html).toContain('message-1 &lt;&gt;&amp;&quot;&#39; 💬');
        expect(transcript.html).toContain('<a href="https://cdn.example/proof?q=&quot;&amp;b=1">proof&quot;&amp;.png</a>');
        expect(transcript.html).not.toContain('javascript:');
        expect(transcript.attachment.attachment.toString()).toBe(transcript.html);
        expect(database.sqlite.prepare('SELECT html FROM ticket_transcripts WHERE ticket_id = ?').get(ticket.id).html)
            .toBe(transcript.html);
    });

    test.each([0, 1])('accounts for the complete UTF-8 document at the 8 MiB boundary with %s excess bytes', async excess => {
        const { Collection } = require('discord.js');
        const ticket = service.reserveTicket({ guildId: 'guild1', openerId: 'user1' });
        const envelope = '<!doctype html><html><head><meta charset="utf-8"><title>Ticket #1</title></head><body><h1>Ticket #1</h1>'
            + '<dl><dt>Opener</dt><dd>user1</dd><dt>Topic</dt><dd>General</dd></dl></body></html>';
        const row = '<article><header>Unknown () · 1970-01-01T00:00:00.000Z</header><p></p></article>';
        const contentBytes = 8 * 1024 * 1024 - Buffer.byteLength(envelope + row + '\n' + row) + excess;
        const content = 'é'.repeat(Math.floor(contentBytes / 2)) + 'x'.repeat(contentBytes % 2);
        const fetch = jest.fn(async () => new Collection([
            ['2', { id: '2', createdTimestamp: 0, content }], ['1', { id: '1', createdTimestamp: 0, content: '' }]
        ]));

        const transcript = service.createTranscript(ticket, { messages: { fetch } });
        if (excess) {
            await expect(transcript).rejects.toThrow('complete transcript exceeds');
            expect(database.sqlite.prepare('SELECT 1 FROM ticket_transcripts WHERE ticket_id = ?').get(ticket.id)).toBeUndefined();
        } else {
            const { html } = await transcript;
            expect(Buffer.byteLength(html)).toBe(8 * 1024 * 1024);
            expect(html).toContain(content);
            expect(html.match(/<article>/g)).toHaveLength(2);
        }
        expect(fetch).toHaveBeenCalledTimes(1);
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

    test('coalesces overlapping deletes while Discord log delivery is pending', async () => {
        const { ticket, channel, log, opener } = deletionFixture();
        let deliver;
        let logStarted;
        const started = new Promise(resolve => { logStarted = resolve; });
        const delivery = new Promise(resolve => { deliver = resolve; });
        log.send.mockImplementation(() => {
            logStarted();
            return delivery;
        });

        const first = service.deleteDiscordTicket(ticket, channel, 'staff1');
        await started;
        await service.reconcile();
        expect(service.getTicket(ticket.id).status).toBe('deleting');
        const second = service.deleteDiscordTicket(ticket, channel, 'staff2');
        deliver({ id: 'log-message' });
        const results = await Promise.all([first, second]);

        expect(results.map(result => result.status)).toEqual(['deleted', 'deleted']);
        expect(channel.messages.fetch).toHaveBeenCalledTimes(1);
        expect(log.send).toHaveBeenCalledTimes(1);
        expect(channel.delete).toHaveBeenCalledTimes(1);
        expect(opener.send).toHaveBeenCalledTimes(1);
    });

    test('retries channel deletion after an acknowledged log without sending another transcript or DM', async () => {
        const { ticket, channel, log, opener } = deletionFixture();
        channel.delete.mockRejectedValueOnce(new Error('Discord unavailable'));

        await expect(service.deleteDiscordTicket(ticket, channel, 'staff1')).rejects.toThrow('Discord unavailable');
        expect(service.getTicket(ticket.id).status).toBe('deleting');
        expect(opener.send).not.toHaveBeenCalled();

        await expect(service.deleteDiscordTicket(ticket, channel, 'staff2')).resolves.toMatchObject({ status: 'deleted' });

        expect(channel.messages.fetch).toHaveBeenCalledTimes(2);
        expect(log.send).toHaveBeenCalledTimes(1);
        expect(channel.delete).toHaveBeenCalledTimes(2);
        expect(opener.send).toHaveBeenCalledTimes(1);
    });

    test.each([false, true])('preserves messages added after log delivery even when the archive was replaced %s', async replaceArchive => {
        const { Collection } = require('discord.js');
        const { ticket, channel, log, opener } = deletionFixture();
        channel.delete.mockRejectedValueOnce(new Error('Discord unavailable'));
        await expect(service.deleteDiscordTicket(ticket, channel, 'staff1')).rejects.toThrow('Discord unavailable');
        channel.messages.fetch.mockResolvedValue(new Collection([
            ['new', { id: 'new', createdTimestamp: 3000, content: 'later message' }]
        ]));
        if (replaceArchive) await service.createTranscript(ticket, channel);

        await expect(service.deleteDiscordTicket(ticket, channel, 'staff2')).rejects.toThrow('transcript');

        expect(service.getTicket(ticket.id).status).toBe('closed');
        expect(channel.permissionOverwrites.edit).toHaveBeenCalledWith('user1',
            { ViewChannel: false, SendMessages: false, ReadMessageHistory: false }, expect.any(Object));
        expect(log.send).toHaveBeenCalledTimes(1);
        expect(channel.delete).toHaveBeenCalledTimes(1);
        expect(opener.send).not.toHaveBeenCalled();
    });

    test('closes a resumed deletion if its current complete transcript has grown oversized', async () => {
        const { Collection } = require('discord.js');
        const { ticket, channel, log, opener } = deletionFixture();
        channel.delete.mockRejectedValueOnce(new Error('Discord unavailable'));
        await expect(service.deleteDiscordTicket(ticket, channel, 'staff1')).rejects.toThrow('Discord unavailable');
        const archived = database.sqlite.prepare('SELECT html FROM ticket_transcripts WHERE ticket_id = ?').get(ticket.id).html;
        const fetch = jest.fn(async () => {
            const page = fetch.mock.calls.length;
            return new Collection(Array.from({ length: 100 }, (_, index) => {
                const id = String(1000 - (page - 1) * 100 - index);
                return [id, { id, createdTimestamp: Number(id), content: '&'.repeat(4000) }];
            }));
        });
        channel.messages.fetch = fetch;

        await expect(service.deleteDiscordTicket(ticket, channel, 'staff2')).rejects.toThrow('complete transcript exceeds');

        expect(fetch).toHaveBeenCalledTimes(5);
        expect(service.getTicket(ticket.id).status).toBe('closed');
        expect(database.sqlite.prepare('SELECT html FROM ticket_transcripts WHERE ticket_id = ?').get(ticket.id).html).toBe(archived);
        expect(log.send).toHaveBeenCalledTimes(1);
        expect(channel.delete).toHaveBeenCalledTimes(1);
        expect(opener.send).not.toHaveBeenCalled();
    });

    test('does not replay a transcript whose Discord delivery outcome is uncertain', async () => {
        const { ticket, channel, log, opener } = deletionFixture();
        log.send.mockRejectedValueOnce(new Error('response lost after send'));

        await expect(service.deleteDiscordTicket(ticket, channel, 'staff1')).rejects.toThrow();
        await expect(service.deleteDiscordTicket(ticket, channel, 'staff2')).rejects.toThrow('uncertain');

        expect(log.send).toHaveBeenCalledTimes(1);
        expect(channel.messages.fetch).toHaveBeenCalledTimes(1);
        expect(channel.delete).not.toHaveBeenCalled();
        expect(opener.send).not.toHaveBeenCalled();
        expect(service.getTicket(ticket.id).status).toBe('open');
    });

    test.each([false, true])('recovery closes a surviving interrupted deletion and syncs access with uncertain delivery %s', async uncertain => {
        const { ticket, channel, log, opener } = deletionFixture();
        service.beginDelete(ticket.id, 'staff1');
        if (uncertain) service.recordAction(ticket.id, 'staff1', 'delete_log_pending');
        const { TicketService } = require('../src/services/ticketService');
        service = new TicketService(service.client, { sqlite: database.sqlite, now: () => 2000 });

        await service.reconcile();

        expect(service.getTicket(ticket.id)).toMatchObject({ status: 'closed', closedAt: 2000 });
        expect(channel.permissionOverwrites.edit).toHaveBeenCalledWith('user1',
            { ViewChannel: false, SendMessages: false, ReadMessageHistory: false }, expect.any(Object));
        expect(channel.permissionOverwrites.edit).toHaveBeenCalledWith('support',
            { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }, expect.any(Object));
        expect(log.send).not.toHaveBeenCalled();
        expect(channel.delete).not.toHaveBeenCalled();
        expect(opener.send).not.toHaveBeenCalled();
        expect(channel.messages.fetch).not.toHaveBeenCalled();
        if (uncertain) {
            await expect(service.deleteDiscordTicket(ticket, channel, 'staff2')).rejects.toThrow('uncertain');
            expect(log.send).not.toHaveBeenCalled();
        }
    });

    test('recovery resumes only the channel deletion when the transcript delivery was acknowledged', async () => {
        const { ticket, channel, log, opener } = deletionFixture();
        channel.delete.mockRejectedValueOnce(new Error('Discord unavailable'));
        await expect(service.deleteDiscordTicket(ticket, channel, 'staff1')).rejects.toThrow('Discord unavailable');
        service.updateConfig('guild1', { logChannelId: null });
        const { TicketService } = require('../src/services/ticketService');
        service = new TicketService(service.client, { sqlite: database.sqlite, now: () => 2000 });

        await service.reconcile();

        expect(service.getTicket(ticket.id).status).toBe('deleted');
        expect(log.send).toHaveBeenCalledTimes(1);
        expect(channel.messages.fetch).toHaveBeenCalledTimes(2);
        expect(channel.delete).toHaveBeenCalledTimes(2);
        expect(opener.send).toHaveBeenCalledTimes(1);
    });

    test.each(['none', 'pending', 'delivered'])('recovery records a missing channel without replaying %s delivery', async delivery => {
        const { ticket, channel, log, opener, guild } = deletionFixture();
        if (delivery === 'delivered') {
            channel.delete.mockRejectedValueOnce(new Error('response lost after delete'));
            await expect(service.deleteDiscordTicket(ticket, channel, 'staff1')).rejects.toThrow('response lost after delete');
        } else {
            service.beginDelete(ticket.id, 'staff1');
            if (delivery === 'pending') service.recordAction(ticket.id, 'staff1', 'delete_log_pending');
        }
        guild.channels.cache.delete('channel1');
        guild.channels.fetch.mockRejectedValueOnce(Object.assign(new Error('Unknown Channel'), { code: 10003 }));
        const { TicketService } = require('../src/services/ticketService');
        service = new TicketService(service.client, { sqlite: database.sqlite, now: () => 2000 });

        await service.reconcile();
        await service.reconcile();

        expect(service.getTicket(ticket.id).status).toBe(delivery === 'delivered' ? 'deleted' : 'lost');
        expect(log.send).toHaveBeenCalledTimes(delivery === 'delivered' ? 1 : 0);
        expect(channel.delete).toHaveBeenCalledTimes(delivery === 'delivered' ? 1 : 0);
        expect(opener.send).not.toHaveBeenCalled();
    });

    test('a stale caller returns the persisted deleted ticket without requiring configuration or sending again', async () => {
        const { ticket, channel, log, opener } = deletionFixture();
        await service.deleteDiscordTicket(ticket, channel, 'staff1');
        service.updateConfig('guild1', { logChannelId: null });

        await expect(service.deleteDiscordTicket(ticket, channel, 'staff2')).resolves.toMatchObject({ status: 'deleted' });

        expect(log.send).toHaveBeenCalledTimes(1);
        expect(channel.messages.fetch).toHaveBeenCalledTimes(1);
        expect(channel.delete).toHaveBeenCalledTimes(1);
        expect(opener.send).toHaveBeenCalledTimes(1);
    });

    test('coalesced transcript failures restore the persisted state and allow a later retry', async () => {
        const { ticket, channel, log, opener } = deletionFixture();
        service.close(ticket.id, 'staff1');
        const error = new Error('history unavailable');
        channel.messages.fetch.mockRejectedValueOnce(error);

        const results = await Promise.allSettled([
            service.deleteDiscordTicket(ticket, channel, 'staff1'),
            service.deleteDiscordTicket(ticket, channel, 'staff2')
        ]);

        expect(results).toEqual([{ status: 'rejected', reason: error }, { status: 'rejected', reason: error }]);
        expect(service.getTicket(ticket.id).status).toBe('closed');
        expect(log.send).not.toHaveBeenCalled();
        expect(channel.delete).not.toHaveBeenCalled();
        await expect(service.deleteDiscordTicket(ticket, channel, 'staff2')).resolves.toMatchObject({ status: 'deleted' });
        expect(channel.messages.fetch).toHaveBeenCalledTimes(2);
        expect(log.send).toHaveBeenCalledTimes(1);
        expect(channel.delete).toHaveBeenCalledTimes(1);
        expect(opener.send).toHaveBeenCalledTimes(1);
    });

    test('a missing log destination can be repaired and retried without an uncertain send', async () => {
        const { ticket, channel, log, guild } = deletionFixture();
        guild.channels.cache.delete('logs');

        await expect(service.deleteDiscordTicket(ticket, channel, 'staff1')).rejects.toThrow('could not be delivered');
        expect(service.getTicket(ticket.id).status).toBe('open');
        expect(log.send).not.toHaveBeenCalled();
        expect(channel.delete).not.toHaveBeenCalled();
        guild.channels.cache.set('logs', log);

        await expect(service.deleteDiscordTicket(ticket, channel, 'staff2')).resolves.toMatchObject({ status: 'deleted' });
        expect(log.send).toHaveBeenCalledTimes(1);
        expect(channel.delete).toHaveBeenCalledTimes(1);
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
