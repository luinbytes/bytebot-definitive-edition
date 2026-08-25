const { PermissionFlagsBits } = require('discord.js');
const autopfp = require('../src/commands/administration/autopfp');

describe('AutoPFP terminal provider contract', () => {
    test('registers the documented Administrator-only slash surface', () => {
        const json = autopfp.data.toJSON();
        expect(json.name).toBe('autopfp');
        expect(json.default_member_permissions).toBe(PermissionFlagsBits.Administrator.toString());
        expect(json.options.map(option => option.name)).toEqual(['add', 'interval', 'test', 'list', 'remove']);
    });

    test('fails closed without creating configuration or a webhook', async () => {
        const reply = jest.fn();
        await autopfp.execute({
            member: { permissions: { has: jest.fn().mockReturnValue(true) } },
            options: { getSubcommand: jest.fn().mockReturnValue('add') },
            reply
        });

        expect(reply).toHaveBeenCalledTimes(1);
        expect(reply.mock.calls[0][0].embeds[0].data.description).toContain('No configuration or webhook was created');
    });

    test('rechecks real Administrator authority at execution', async () => {
        const reply = jest.fn();
        await autopfp.execute({
            member: { permissions: { has: jest.fn().mockReturnValue(false) } },
            options: { getSubcommand: jest.fn().mockReturnValue('list') },
            reply
        });
        expect(reply.mock.calls[0][0].embeds[0].data.title).toContain('Access Denied');
    });
});
