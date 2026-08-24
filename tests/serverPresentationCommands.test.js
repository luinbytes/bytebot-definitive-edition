const fs = require('fs');
const os = require('os');
const path = require('path');

describe('server presentation commands', () => {
    let tempDir;
    let database;
    let executeBackup;
    let executeCustomize;
    let executeDiscovery;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-presentation-commands-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        ({ executeBackup } = require('../src/utils/serverBackupCommand'));
        ({ executeCustomize, executeDiscovery } = require('../src/utils/serverPresentationCommand'));
    });

    afterEach(() => {
        database?.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('enforces real management and owner boundaries while leaving discovery browsing public', async () => {
        const deniedReply = jest.fn();
        await executeBackup({
            member: { permissions: { has: () => false } },
            reply: deniedReply,
            deferred: false
        });
        expect(deniedReply.mock.calls[0][0].content).toContain('Manage Server');

        const ownerReply = jest.fn();
        await executeCustomize({
            guild: { ownerId: 'owner' }, user: { id: 'member' }, reply: ownerReply, deferred: false
        });
        expect(ownerReply.mock.calls[0][0].content).toContain('server owner');

        const publicReply = jest.fn();
        await executeDiscovery({
            guild: { id: 'guild1' }, user: { id: 'member' }, member: { permissions: { has: () => false } },
            options: { getSubcommand: () => 'list', getString: () => null },
            reply: publicReply, deferred: false
        });
        expect(publicReply.mock.calls[0][0].content).toContain('No public ByteBot server listings');
        expect(publicReply.mock.calls[0][0].flags).toBeUndefined();
    });

    test('owner customization edits the current guild member rather than the global bot user', async () => {
        const editMe = jest.fn(async () => ({}));
        const reply = jest.fn();
        const interaction = {
            guild: {
                id: 'guild1', ownerId: 'owner',
                members: { me: { permissions: { has: () => true } }, editMe }
            },
            user: { id: 'owner' },
            options: {
                getSubcommand: () => 'name',
                getString: name => name === 'nickname' ? 'Bytey' : null
            },
            reply,
            deferred: false
        };

        await executeCustomize(interaction);

        expect(editMe).toHaveBeenCalledWith(expect.objectContaining({ nick: 'Bytey' }));
        expect(reply.mock.calls[0][0].content).toContain('nickname');
    });
});
