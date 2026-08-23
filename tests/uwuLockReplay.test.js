const fs = require('fs');
const os = require('os');
const path = require('path');
const { Collection, MessageType } = require('discord.js');

function createMessage(overrides = {}) {
    const replay = { delete: jest.fn() };
    const webhook = {
        name: 'ByteBot UwU Lock',
        owner: { id: 'bot1' },
        send: jest.fn().mockResolvedValue(replay)
    };
    const channel = {
        id: 'channel1',
        isThread: jest.fn().mockReturnValue(false),
        permissionsFor: jest.fn().mockReturnValue({ has: jest.fn().mockReturnValue(true) }),
        fetchWebhooks: jest.fn().mockResolvedValue(new Collection([['webhook1', webhook]])),
        createWebhook: jest.fn()
    };
    const message = {
        id: 'message1',
        type: MessageType.Default,
        content: 'Really <@999>',
        system: false,
        webhookId: null,
        deletable: true,
        reference: null,
        poll: null,
        components: [],
        stickers: new Collection(),
        attachments: new Collection(),
        author: {
            id: 'user1',
            bot: false,
            username: 'Member',
            displayAvatarURL: jest.fn().mockReturnValue('https://example.com/avatar.png')
        },
        member: { displayName: 'Visible Member' },
        guild: { id: 'guild1', members: { me: { id: 'bot1' } } },
        channel,
        channelId: channel.id,
        client: { user: { id: 'bot1' } },
        delete: jest.fn(),
        ...overrides
    };

    return { message, webhook, replay };
}

describe('UwU Lock message replay', () => {
    let tempDir;
    let database;
    let messageCreate;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-uwu-replay-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        database.sqlite.prepare(`
            INSERT INTO uwu_lock_members (guild_id, user_id, state)
            VALUES ('guild1', 'user1', 'target')
        `).run();
        messageCreate = require('../src/events/messageCreate');
    });

    afterEach(() => {
        database.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('sends a mention-safe replay before deleting the original', async () => {
        const { message, webhook } = createMessage();

        await messageCreate.execute(message, {});

        expect(webhook.send).toHaveBeenCalledWith({
            content: 'Weawwy <@999>',
            username: 'Visible Member',
            avatarURL: 'https://example.com/avatar.png',
            allowedMentions: { parse: [], repliedUser: false }
        });
        expect(message.delete).toHaveBeenCalledTimes(1);
        expect(webhook.send.mock.invocationCallOrder[0]).toBeLessThan(
            message.delete.mock.invocationCallOrder[0]
        );
    });

    test('never replays webhook messages or members from another guild', async () => {
        const webhookMessage = createMessage();
        webhookMessage.message.webhookId = 'existing-webhook';
        await messageCreate.execute(webhookMessage.message, {});
        expect(webhookMessage.webhook.send).not.toHaveBeenCalled();

        const otherGuild = createMessage();
        otherGuild.message.guild.id = 'guild2';
        await messageCreate.execute(otherGuild.message, {});
        expect(otherGuild.webhook.send).not.toHaveBeenCalled();

        const owner = createMessage();
        owner.message.guild.ownerId = 'user1';
        await messageCreate.execute(owner.message, {});
        expect(owner.webhook.send).not.toHaveBeenCalled();

        database.sqlite.prepare("UPDATE uwu_lock_members SET state = 'protected' WHERE user_id = 'user1'").run();
        const protectedMember = createMessage();
        await messageCreate.execute(protectedMember.message, {});
        expect(protectedMember.webhook.send).not.toHaveBeenCalled();
    });

    test('keeps the original when replay delivery fails', async () => {
        const { message, webhook } = createMessage();
        webhook.send.mockRejectedValue(new Error('send failed'));

        await messageCreate.execute(message, {});

        expect(webhook.send).toHaveBeenCalledTimes(1);
        expect(message.delete).not.toHaveBeenCalled();
    });

    test('deletes the replay when deleting the original fails', async () => {
        const { message, replay } = createMessage();
        message.delete.mockRejectedValue(new Error('delete failed'));
        message.channel.messages = { fetch: jest.fn().mockResolvedValue(message) };

        await messageCreate.execute(message, {});

        expect(replay.delete).toHaveBeenCalledTimes(1);
    });

    test('keeps the replay when a failed delete leaves the original state unknown', async () => {
        const { message, replay } = createMessage();
        message.delete.mockRejectedValue(new Error('connection lost'));
        message.channel.messages = { fetch: jest.fn().mockRejectedValue(new Error('connection lost')) };

        await messageCreate.execute(message, {});

        expect(replay.delete).not.toHaveBeenCalled();
    });

    test('replays bounded attachments and leaves unsupported payloads untouched', async () => {
        const supported = createMessage();
        supported.message.attachments.set('file1', {
            url: 'https://cdn.example.com/file.png',
            name: 'file.png',
            size: 1024
        });
        await messageCreate.execute(supported.message, {});
        expect(supported.webhook.send.mock.calls[0][0].files).toEqual([{
            attachment: 'https://cdn.example.com/file.png',
            name: 'file.png'
        }]);

        const oversized = createMessage();
        oversized.message.attachments.set('file1', {
            url: 'https://cdn.example.com/large.bin',
            name: 'large.bin',
            size: 8 * 1024 * 1024 + 1
        });
        await messageCreate.execute(oversized.message, {});
        expect(oversized.webhook.send).not.toHaveBeenCalled();
        expect(oversized.message.delete).not.toHaveBeenCalled();

        const reply = createMessage();
        reply.message.reference = { messageId: 'original' };
        await messageCreate.execute(reply.message, {});
        expect(reply.webhook.send).not.toHaveBeenCalled();
        expect(reply.message.delete).not.toHaveBeenCalled();
    });

    test('leaves the original untouched when required bot permissions are missing', async () => {
        const { message, webhook } = createMessage();
        message.channel.permissionsFor.mockReturnValue({ has: jest.fn().mockReturnValue(false) });

        await messageCreate.execute(message, {});

        expect(webhook.send).not.toHaveBeenCalled();
        expect(message.delete).not.toHaveBeenCalled();
    });

    test('creates the channel webhook lazily when ByteBot does not have one', async () => {
        const { message, webhook } = createMessage();
        message.channel.fetchWebhooks.mockResolvedValue(new Collection());
        message.channel.createWebhook.mockResolvedValue(webhook);

        await messageCreate.execute(message, {});

        expect(message.channel.createWebhook).toHaveBeenCalledWith({
            name: 'ByteBot UwU Lock',
            reason: 'UwU Lock message replay'
        });
        expect(webhook.send).toHaveBeenCalledTimes(1);
    });

    test('routes thread replays through the parent channel webhook', async () => {
        const { message, webhook } = createMessage();
        const parent = message.channel;
        const thread = {
            id: 'thread1',
            parent,
            isThread: jest.fn().mockReturnValue(true),
            permissionsFor: jest.fn().mockReturnValue({ has: jest.fn().mockReturnValue(true) })
        };
        message.channel = thread;
        message.channelId = thread.id;

        await messageCreate.execute(message, {});

        expect(parent.fetchWebhooks).toHaveBeenCalledTimes(1);
        expect(webhook.send.mock.calls[0][0].threadId).toBe('thread1');
        expect(message.delete).toHaveBeenCalledTimes(1);
    });
});
