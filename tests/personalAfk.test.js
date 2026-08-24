const fs = require('fs');
const os = require('os');
const path = require('path');
const { Collection } = require('discord.js');

jest.mock('../src/utils/honeypotUtil', () => ({ handleHoneypotMessage: jest.fn().mockResolvedValue(false) }));
jest.mock('../src/utils/uwuLockUtil', () => ({ handleUwuLockMessage: jest.fn().mockResolvedValue(false) }));
jest.mock('../src/services/antiraidService', () => ({ handleMassMention: jest.fn().mockResolvedValue(false) }));
jest.mock('../src/services/automodService', () => ({ handleMessage: jest.fn().mockResolvedValue(false) }));

describe('AFK message behavior', () => {
    let tempDir;
    let database;
    let service;
    let messageCreate;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-afk-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        service = require('../src/services/personalUtilityService');
        messageCreate = require('../src/events/messageCreate');
    });

    afterEach(() => {
        database.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('welcomes back the author and reports distinct mentioned AFK users safely', async () => {
        await service.setAfk('author', 'Coffee', 1000);
        await service.setAfk('target', 'Lunch', 1000);
        const target = { id: 'target', username: 'Target', displayAvatarURL: jest.fn().mockReturnValue('https://example.com/target.png') };
        const message = {
            content: 'hello <@target>',
            author: { id: 'author', bot: false, username: 'Author', displayAvatarURL: jest.fn() },
            member: { displayName: 'Author' },
            guild: { id: 'guild1' },
            channel: { id: 'channel1' },
            mentions: { users: new Collection([['target', target]]), repliedUser: target },
            reply: jest.fn().mockResolvedValue({})
        };

        await messageCreate.execute(message, {});

        expect(await service.getAfk('author')).toBeNull();
        expect(await service.getAfk('target')).toMatchObject({ status: 'Lunch' });
        expect(message.reply).toHaveBeenCalledTimes(2);
        for (const [payload] of message.reply.mock.calls) {
            expect(payload.allowedMentions).toEqual({ parse: [], repliedUser: false });
        }
    });
});
