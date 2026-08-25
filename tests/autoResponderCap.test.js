const fs = require('fs');
const os = require('os');
const path = require('path');

test('the shared insert transaction cannot exceed 500 responders', async () => {
    jest.resetModules();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-autoresponder-cap-'));
    process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
    const database = require('../src/database');
    await database.runMigrations();
    const { createAutoResponder } = require('../src/services/autoResponderService');

    try {
        const insert = database.sqlite.prepare(`
            INSERT INTO auto_responses (guild_id, trigger, response, creator_id)
            VALUES ('guild1', ?, 'response', 'user1')
        `);
        database.sqlite.transaction(() => {
            for (let index = 0; index < 500; index++) insert.run(`trigger-${index}`);
        })();

        expect(() => createAutoResponder({ guildId: 'guild1', trigger: 'overflow', response: 'no', creatorId: 'user1' }))
            .toThrow(expect.objectContaining({ code: 'AUTO_RESPONDER_LIMIT' }));
        expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM auto_responses WHERE guild_id = 'guild1'").get().count).toBe(500);
    } finally {
        database.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
