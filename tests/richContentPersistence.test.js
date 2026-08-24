const fs = require('fs');
const os = require('os');
const path = require('path');
const { Collection, EmbedBuilder } = require('discord.js');

describe('rich-content persistence', () => {
    let tempDir;
    let database;
    let automation;
    let service;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-rich-content-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        const AutomationService = require('../src/services/automationService');
        automation = new AutomationService({ guilds: { cache: new Map() } });
        const RichContentService = require('../src/services/richContentService');
        service = new RichContentService({}, automation);
    });

    afterEach(() => {
        automation.cleanup();
        database.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('tags are globally discoverable but only their author or server staff may mutate them', async () => {
        await service.saveTag('user1', 'Rules', '{content: Be kind}');
        expect(await service.getTag('rules')).toEqual(expect.objectContaining({ createdBy: 'user1' }));
        await expect(service.saveTag('user2', 'rules', '{content: Be loud}')).rejects.toThrow(/permission/i);
        await service.saveTag('admin', 'rules', '{content: Be excellent}', { canManage: true });
        expect(JSON.parse((await service.getTag('RULES')).config).script).toBe('{content: Be excellent}');
    });

    test('tag rename, search, removal, and reset preserve other authors', async () => {
        await service.saveTag('user1', 'rules', 'one');
        await service.saveTag('user1', 'roles', 'two');
        await service.saveTag('user2', 'faq', 'three');
        await service.renameTag('user1', 'rules', 'guidelines');

        expect((await service.listTags('guide')).map(rule => rule.key)).toEqual(['guidelines']);
        await expect(service.removeTag('user2', 'guidelines')).rejects.toThrow(/permission/i);
        expect(await service.resetTags('user1')).toBe(2);
        expect((await service.listTags()).map(rule => rule.key)).toEqual(['faq']);
    });

    test('custom scripts normalize names, overwrite in place, and enforce the public 100-script cap', async () => {
        await service.saveCustom('guild1', 'admin1', 'Rules', '{content: one}');
        await service.saveCustom('guild1', 'admin2', 'RULES', '{content: two}');
        expect(service.listCustom('guild1')).toHaveLength(1);
        expect(JSON.parse(service.getCustom('guild1', 'rules').config).script).toBe('{content: two}');

        for (let index = 1; index < 100; index += 1) {
            await service.saveCustom('guild1', 'admin1', `script-${index}`, `{content: ${index}}`);
        }
        await expect(service.saveCustom('guild1', 'admin1', 'overflow', '{content: no}')).rejects.toThrow(/100-script limit/i);
        await service.useCustom('guild1', 'rules');
        expect(JSON.parse(service.getCustom('guild1', 'rules').config).useCount).toBe(1);
    });

    test('custom buttons render an ephemeral script and count only successful uses', async () => {
        await service.saveCustom('guild1', 'admin1', 'rules', '{content: Hello {user.mention}}');
        const interaction = {
            customId: 'rich:custom:rules', guildId: 'guild1',
            guild: { id: 'guild1', name: 'Guild' }, channel: { id: 'channel1', name: 'general' },
            user: { id: 'user1', username: 'Ada' }, reply: jest.fn().mockResolvedValue({})
        };

        await service.handleCustomButton(interaction);

        expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
            content: 'Hello <@user1>', allowedMentions: { parse: [], repliedUser: false }
        }));
        expect(JSON.parse(service.getCustom('guild1', 'rules').config).useCount).toBe(1);
    });

    test('saved embeds follow their owner and publishing enforces the highest public cap', async () => {
        await service.saveEmbed('user1', 'Welcome', '{embed}$v{title: Hello}');
        expect(JSON.parse(service.getEmbed('user1', 'welcome').config).script).toContain('Hello');
        for (let index = 0; index < 10; index += 1) {
            const name = `card-${index}`;
            await service.saveEmbed('user1', name, `{embed}$v{title: ${index}}`);
            await service.publishEmbed('user1', name, 'Other', `Card ${index}`);
        }
        await service.publishEmbed('user1', 'card-0', 'Staff', 'Updated');
        await expect(service.publishEmbed('user1', 'welcome', 'Other')).rejects.toThrow(/10-published limit/i);
        expect(service.listPublished('Staff')).toEqual([
            expect.objectContaining({ key: 'user1:card-0' })
        ]);
        expect(service.copyPublishedEmbed('user2', 'user1:card-0', 'borrowed')).toBe('borrowed');
        expect(JSON.parse(service.getEmbed('user2', 'borrowed').config).script).toContain('title: 0');
        service.copyPublishedEmbed('user2', 'user1:card-0', 'borrowed-again');
        expect(JSON.parse(service.listPublished('Staff')[0].config).copies).toBe(1);
    });

    test('server information color applies only when a rich embed has no explicit color', () => {
        service.setEmbedColor('guild1', 'information', '#123456', 'admin1');
        service.setEmbedColor('guild1', 'success', '#654321', 'admin1');
        const guild = { id: 'guild1' };

        expect(service.render('{embed}$v{title: Default}', { guild }).embeds[0].toJSON().color).toBe(0x123456);
        expect(service.render('{embed}$v{title: Explicit}$v{color: #abcdef}', { guild }).embeds[0].toJSON().color).toBe(0xabcdef);

        const embeds = require('../src/utils/embeds');
        embeds.withGuild({ richContentService: service }, 'guild1', () => {
            expect(embeds.info('Info').toJSON().color).toBe(0x123456);
            expect(embeds.success('Done').toJSON().color).toBe(0x654321);
        });
    });

    test('pagination persists bot-owned pages and reaction navigation survives restart', async () => {
        service.client = { user: { id: 'bot1' } };
        const message = {
            id: 'message1', url: 'https://discord.com/channels/guild1/channel1/message1',
            guild: { id: 'guild1' }, channel: { id: 'channel1' }, author: { id: 'bot1' },
            embeds: [new EmbedBuilder().setTitle('Page one')], react: jest.fn().mockResolvedValue({}),
            edit: jest.fn().mockResolvedValue({})
        };
        await service.setupPagination(message, 'admin1');
        await service.addPaginationPage(message, '{embed}$v{title: Page two}', 'admin1');

        const remove = jest.fn().mockResolvedValue({});
        await service.handlePaginationReaction({ message, emoji: { name: '➡️' }, users: { remove } }, { id: 'user1', bot: false });
        expect(message.edit.mock.calls[0][0].embeds[0].toJSON().title).toBe('Page two');
        expect(remove).toHaveBeenCalledWith('user1');
        expect(JSON.parse(service.getPagination('guild1', 'message1').config).page).toBe(1);
    });

    test('managed webhooks persist identifiers without credentials and track editable messages', async () => {
        const webhook = {
            id: 'webhook1', name: 'News', token: 'never-store-this',
            send: jest.fn().mockResolvedValue({ id: 'message1' }),
            editMessage: jest.fn().mockResolvedValue({ id: 'message1' }),
            deleteMessage: jest.fn().mockResolvedValue({}),
            delete: jest.fn().mockResolvedValue({})
        };
        const channel = {
            id: 'channel1', name: 'general',
            createWebhook: jest.fn().mockResolvedValue(webhook),
            fetchWebhooks: jest.fn().mockResolvedValue(new Collection([['webhook1', webhook]]))
        };
        const guild = { id: 'guild1', channels: { cache: new Map([['channel1', channel]]), fetch: jest.fn().mockResolvedValue(channel) } };

        const rule = await service.createWebhook(guild, channel, 'News', 'admin1');
        expect(rule.config).not.toMatch(/never-store-this|https?:\/\//);
        await service.sendWebhook(guild, rule.key, '{content: Hello}');
        await service.editWebhookMessage(guild, channel, 'message1', '{content: Updated}');
        expect(webhook.send).toHaveBeenCalledWith(expect.objectContaining({ content: 'Hello', allowedMentions: { parse: [], repliedUser: false } }));
        expect(webhook.editMessage).toHaveBeenCalledWith('message1', expect.objectContaining({ content: 'Updated' }));

        webhook.send.mockResolvedValueOnce({ id: 'message2' });
        jest.spyOn(automation, 'upsert').mockImplementationOnce(() => { throw new Error('disk full'); });
        await expect(service.sendWebhook(guild, rule.key, '{content: Orphan}')).rejects.toThrow(/track/i);
        expect(webhook.deleteMessage).toHaveBeenCalledWith('message2');
    });
});
