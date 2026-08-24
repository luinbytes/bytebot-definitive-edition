const fs = require('fs');
const os = require('os');
const path = require('path');
const { ChannelType, PermissionFlagsBits } = require('discord.js');

function interaction(guild, subcommand) {
    return {
        guild,
        guildId: guild.id,
        user: { id: 'admin-1' },
        member: { permissions: { has: permission => permission === PermissionFlagsBits.Administrator } },
        options: {
            getSubcommandGroup: () => null,
            getSubcommand: () => subcommand
        },
        editReply: jest.fn(async payload => payload)
    };
}

describe('VoiceMaster lifecycle', () => {
    let tempDir;
    let database;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-voicemaster-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
    });

    afterEach(() => {
        database.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('setup is durable and a repeated setup cannot create duplicate resources', async () => {
        const channels = new Map();
        const join = {
            id: 'join-1', type: ChannelType.GuildVoice,
            send: jest.fn(async () => ({ id: `interface-${join.send.mock.calls.length}` }))
        };
        const category = { id: 'category-1', type: ChannelType.GuildCategory };
        const create = jest.fn(async values => {
            const channel = values.type === ChannelType.GuildCategory ? category : join;
            channels.set(channel.id, channel);
            return channel;
        });
        const guild = {
            id: 'guild-1', name: 'Guild',
            members: { me: { id: 'bot-1', permissions: { has: () => true } } },
            roles: { everyone: { id: 'guild-1' } },
            channels: { cache: channels, create, fetch: jest.fn(async id => channels.get(id) || null) }
        };
        const { VoiceMasterService } = require('../src/services/voiceMasterService');
        const service = new VoiceMasterService({ sqlite: database.sqlite });

        await service.execute(interaction(guild, 'setup'));
        const restarted = new VoiceMasterService({ sqlite: database.sqlite });
        await restarted.execute(interaction(guild, 'sendinterface'));
        await restarted.execute(interaction(guild, 'setup'));

        expect(create.mock.calls.map(([values]) => [values.name, values.type])).toEqual([
            ['VoiceMaster', ChannelType.GuildCategory],
            ['Join to Create', ChannelType.GuildVoice]
        ]);
        expect(join.send).toHaveBeenCalledTimes(2);
    });
});
