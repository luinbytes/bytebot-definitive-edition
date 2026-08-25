const fs = require('fs');
const os = require('os');
const path = require('path');

describe('personal utilities', () => {
    let tempDir;
    let database;
    let service;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-personal-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        service = require('../src/services/personalUtilityService');
    });

    afterEach(() => {
        database.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('persists voluntary global settings and deletes empty settings rows', async () => {
        await service.setTimezone('user1', 'Europe/London');
        await service.setAfkTemplate('user1', '{content: {user.name} is away}');

        expect(await service.getSettings('user1')).toMatchObject({
            timezone: 'Europe/London',
            afkTemplate: '{content: {user.name} is away}'
        });

        await service.removeTimezone('user1');
        await service.setAfkTemplate('user1', null);
        expect(await service.getSettings('user1')).toBeNull();
    });

    test('clears an AFK status atomically and keeps the custom template', async () => {
        await service.setAfkTemplate('user1', 'custom');
        await service.setAfk('user1', 'Lunch', 1000);

        expect(await service.getAfk('user1')).toMatchObject({ status: 'Lunch', setAt: 1000 });
        expect(await service.clearAfk('user1')).toMatchObject({ status: 'Lunch' });
        expect(await service.getAfk('user1')).toBeNull();
        expect((await service.getSettings('user1')).afkTemplate).toBe('custom');
    });

    test('enforces one UTC diary entry per day and owner-only deletion', async () => {
        const entry = await service.createDiaryEntry('user1', '2026-08-24', 'private note', 1000);

        await expect(service.createDiaryEntry('user1', '2026-08-24', 'duplicate', 1001))
            .rejects.toThrow('already have a diary entry');
        expect(await service.listDiaryEntries('user1')).toEqual([expect.objectContaining({ id: entry.id, content: 'private note' })]);
        expect(await service.deleteDiaryEntry('user2', entry.id)).toBe(false);
        expect(await service.deleteDiaryEntry('user1', entry.id)).toBe(true);
    });

    test('normalizes evidenced time-zone forms without guessing unknown locations', () => {
        expect(service.normalizeTimezone('UTC')).toBe('UTC');
        expect(service.normalizeTimezone('London')).toBe('Europe/London');
        expect(service.normalizeTimezone('EST')).toBe('America/New_York');
        expect(() => service.normalizeTimezone('Definitely Not A Place')).toThrow('valid time zone');
    });

    test('executes private diary commands through the public handler', async () => {
        const { executePersonalUtility } = require('../src/utils/personalUtilityCommand');
        const interaction = {
            user: { id: 'user1', username: 'Member' },
            options: {
                getSubcommandGroup: () => 'diary',
                getSubcommand: () => 'create',
                getString: name => name === 'content' ? 'from slash' : null
            },
            reply: jest.fn().mockResolvedValue({})
        };

        await executePersonalUtility(interaction);

        expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('Diary entry #'),
            allowedMentions: { parse: [], repliedUser: false },
            flags: expect.any(Array)
        }));
        expect(await service.listDiaryEntries('user1')).toEqual([
            expect.objectContaining({ content: 'from slash' })
        ]);
    });

    test('snoozes only an owned active reminder and reschedules it', async () => {
        database.sqlite.prepare(`INSERT INTO reminders
            (user_id, message, trigger_at, created_at, active)
            VALUES ('user1', 'test', 1000, 1, 1)`).run();
        const ReminderService = require('../src/services/reminderService');
        const reminderService = new ReminderService({});
        reminderService.scheduleReminder = jest.fn();

        const result = await reminderService.snoozeReminder(1, 'user1', new Date(5000));

        expect(result.triggerAt.getTime()).toBe(5000);
        expect(reminderService.scheduleReminder).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
        await expect(reminderService.snoozeReminder(1, 'user2', new Date(6000)))
            .rejects.toThrow('not found');
        reminderService.cleanup();
    });

    test('does not fire a reminder before a snoozed deadline', async () => {
        database.sqlite.prepare(`INSERT INTO reminders
            (user_id, message, trigger_at, created_at, active)
            VALUES ('user1', 'test', ?, 1, 1)`).run(Date.now() + 60_000);
        const ReminderService = require('../src/services/reminderService');
        const reminderService = new ReminderService({});

        await reminderService.fireReminder(1);

        expect(database.sqlite.prepare('SELECT active FROM reminders WHERE id = 1').get().active).toBe(1);
        reminderService.cleanup();
    });

    test('accepts documented birthday input forms and rejects ambiguous names', () => {
        const birthday = require('../src/commands/utility/birthday');

        expect(birthday.parseBirthday('3/15')).toMatchObject({ valid: true, month: 3, day: 15 });
        expect(birthday.parseBirthday('March 15th')).toMatchObject({ valid: true, month: 3, day: 15 });
        expect(birthday.parseBirthday('Mar 15')).toMatchObject({ valid: true, month: 3, day: 15 });
        expect(birthday.parseBirthday('M 15')).toMatchObject({ valid: false });
        expect(birthday.parseBirthday('February 30')).toMatchObject({ valid: false });
    });
});
