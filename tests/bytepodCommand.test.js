const fs = require('fs');
const path = require('path');
const os = require('os');

function readFile(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

describe('BytePod command data access', () => {
    const bytepodContent = readFile('src/commands/utility/bytepod.js');

    test('/bytepod panel scopes owner lookup to the current guild', () => {
        const panelSection = bytepodContent.match(
            /if \(subdomain === 'panel'\) \{([\s\S]*?)if \(group === 'preset'\)/
        );

        expect(panelSection).toBeTruthy();
        expect(panelSection[1]).toContain('eq(bytepods.ownerId, interaction.user.id)');
        expect(panelSection[1]).toContain('eq(bytepods.guildId, interaction.guild.id)');
    });

    test('/bytepod panel sends the control panel into the BytePod channel', () => {
        const panelSection = bytepodContent.match(
            /if \(subdomain === 'panel'\) \{([\s\S]*?)if \(group === 'preset'\)/
        );

        expect(panelSection).toBeTruthy();
        expect(panelSection[1]).toContain('await interaction.deferReply({ flags: [MessageFlags.Ephemeral] })');
        expect(panelSection[1]).toContain('const panelMessage = await channel.send({ embeds: panelEmbeds, components: components })');
        expect(panelSection[1]).toContain('return interaction.editReply');
    });
});

describe('BytePod preset admission and browsing', () => {
    let database;
    let tempDir;
    let command;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-preset-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        command = require('../src/commands/utility/bytepod');
    });

    afterEach(() => {
        database.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function interaction(action, target = 'new-friend') {
        return {
            guild: { id: 'guild1' }, user: { id: 'owner1' },
            options: { getSubcommand: () => action, getSubcommandGroup: () => 'preset', getUser: () => ({ id: target }) },
            deferReply: jest.fn().mockResolvedValue({}),
            editReply: jest.fn().mockResolvedValue({ createMessageComponentCollector: () => ({ on: jest.fn() }) })
        };
    }

    function seed(count) {
        const insert = database.sqlite.prepare('INSERT INTO bytepod_autowhitelist (user_id, guild_id, target_user_id) VALUES (?, ?, ?)');
        database.sqlite.transaction(() => {
            for (let i = 0; i < count; i++) insert.run('owner1', 'guild1', `${100000000000000000n + BigInt(i)}`);
        })();
    }

    test('rejects additions above the channel overwrite capacity and allows removal', async () => {
        seed(998);
        const addition = interaction('add');
        await command.execute(addition);
        expect(addition.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/998.*remove/i) }));
        expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM bytepod_autowhitelist').get().count).toBe(998);
        await command.execute(interaction('remove', '100000000000000000'));
        await command.execute(interaction('add'));
        expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM bytepod_autowhitelist').get().count).toBe(998);
    });

    test('preset browsing uses the owner index instead of scanning other members presets', () => {
        const plan = database.sqlite.prepare(`EXPLAIN QUERY PLAN SELECT target_user_id FROM bytepod_autowhitelist
            WHERE user_id = ? AND guild_id = ? ORDER BY id LIMIT ? OFFSET ?`).all('owner1', 'guild1', 50, 0);
        expect(plan.map(row => row.detail).join('\n')).toContain('USING INDEX bytepod_autowhitelist_owner_idx');
    });

    test('concurrent additions cannot exceed capacity and do not consume another guild quota', async () => {
        seed(997);
        await Promise.all([command.execute(interaction('add', 'friend1')), command.execute(interaction('add', 'friend2'))]);
        expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM bytepod_autowhitelist').get().count).toBe(998);
        const otherGuild = interaction('add', 'friend3');
        otherGuild.guild.id = 'guild2';
        await command.execute(otherGuild);
        expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM bytepod_autowhitelist WHERE guild_id = 'guild2'").get().count).toBe(1);
    });

    test('browses oversized historical presets in bounded pages without deleting them', async () => {
        seed(1100);
        const request = interaction('list');
        await command.execute(request);
        const payload = request.editReply.mock.calls[0][0];
        expect(payload.embeds[0].data.description.length).toBeLessThanOrEqual(4096);
        expect(payload.components).toHaveLength(1);
        expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM bytepod_autowhitelist').get().count).toBe(1100);
    });
});
