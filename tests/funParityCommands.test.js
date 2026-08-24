const fs = require('fs');
const os = require('os');
const path = require('path');
const { PermissionFlagsBits } = require('discord.js');

function makeInteraction({ group, subcommand, strings = {}, integers = {}, users = {}, manage = true, service }) {
    return {
        commandName: 'fun',
        guild: { id: 'guild1' },
        guildId: 'guild1',
        channelId: 'channel1',
        user: { id: 'actor1', username: 'Actor' },
        member: {
            roles: { cache: new Map() },
            permissions: { has: jest.fn(() => manage) }
        },
        client: { funService: service, user: { id: 'bot1' } },
        options: {
            getSubcommandGroup: jest.fn().mockReturnValue(group),
            getSubcommand: jest.fn().mockReturnValue(subcommand),
            getString: jest.fn(name => strings[name] ?? null),
            getInteger: jest.fn(name => integers[name] ?? null),
            getUser: jest.fn(name => users[name] ?? null)
        },
        reply: jest.fn(async payload => payload),
        deferReply: jest.fn(async () => null),
        editReply: jest.fn(async payload => payload),
        replied: false,
        deferred: false
    };
}

describe('/fun public parity surface', () => {
    let tempDir;
    let database;
    let service;
    let fun;

    beforeEach(async () => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-fun-command-'));
        process.env.DATABASE_URL = path.join(tempDir, 'sqlite.db');
        database = require('../src/database');
        await database.runMigrations();
        const { FunService } = require('../src/services/funService');
        service = new FunService({ sqlite: database.sqlite, http: { get: jest.fn() } });
        fun = require('../src/commands/fun/fun');
    });

    afterEach(() => {
        service?.cleanup();
        database?.sqlite.close();
        delete process.env.DATABASE_URL;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('registers grouped snipe, roleplay, game, meter, blunt, and vape paths', () => {
        const json = fun.data.toJSON();
        expect(json.options).toHaveLength(14);
        for (const group of ['snipe', 'roleplay', 'game', 'meter', 'blunt', 'vape']) {
            expect(json.options.find(option => option.name === group)?.options?.length).toBeGreaterThan(0);
        }
        expect(json.options.find(option => option.name === 'roleplay').options
            .find(option => option.name === 'action').options.find(option => option.name === 'action').autocomplete).toBe(true);
    });

    test('shows and protects snipe entries without leaking mentions', async () => {
        service.captureDeleted({
            id: 'message1', guild: { id: 'guild1' }, channelId: 'channel1', content: '@everyone secret',
            author: { id: 'actor1', bot: false, username: 'Actor', displayAvatarURL: () => null },
            partial: false, webhookId: null, system: false
        });
        const show = makeInteraction({ group: 'snipe', subcommand: 'deleted', integers: { index: 1 }, service });
        await fun.execute(show);
        expect(show.reply.mock.calls[0][0].embeds[0].data.description).toContain('@everyone secret');
        expect(show.reply.mock.calls[0][0].allowedMentions).toEqual({ parse: [], repliedUser: false });

        const protect = makeInteraction({ group: 'snipe', subcommand: 'protect', strings: { mode: 'on' }, service });
        await fun.execute(protect);
        expect(service.getSnipeProtection('actor1')).toBe(true);
        expect(protect.reply.mock.calls[0][0].flags).toBeDefined();
    });

    test('requires real Manage Messages permission for clear', async () => {
        const denied = makeInteraction({ group: 'snipe', subcommand: 'clear', manage: false, service });
        await fun.execute(denied);
        expect(denied.member.permissions.has).toHaveBeenCalledWith([PermissionFlagsBits.ManageMessages]);
        expect(denied.reply.mock.calls[0][0].embeds[0].data.title).toContain('Insufficient Permissions');
    });

    test('returns all roleplay terminal mappings and only valid autocomplete choices', async () => {
        const list = makeInteraction({ group: 'roleplay', subcommand: 'list', service });
        await fun.execute(list);
        const description = list.reply.mock.calls[0][0].embeds[0].data.description;
        expect(description).toContain('✅ hug');
        expect(description).toContain('🚫 fuck — policy excluded');

        const respond = jest.fn();
        await fun.autocomplete({
            guildId: 'guild1',
            client: { funService: service },
            options: {
                getSubcommandGroup: () => 'roleplay',
                getFocused: () => ({ name: 'action', value: 'hu' })
            },
            respond
        });
        expect(respond.mock.calls[0][0]).toContainEqual({ name: 'hug', value: 'hug' });
        expect(respond.mock.calls[0][0].every(choice => choice.value.includes('hu'))).toBe(true);
    });

    test('reuses persistent blunt and vape state through slash handlers', async () => {
        const spark = makeInteraction({ group: 'blunt', subcommand: 'spark', service });
        await fun.execute(spark);
        expect(spark.reply.mock.calls[0][0].embeds[0].data.description).toContain('sparked');

        const steal = makeInteraction({ group: 'vape', subcommand: 'steal', service });
        await fun.execute(steal);
        const hit = makeInteraction({ group: 'vape', subcommand: 'hit', service });
        await fun.execute(hit);
        expect(hit.reply.mock.calls[0][0].embeds[0].data.description).toContain('1');
    });
});
