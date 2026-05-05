const { createCommandAliasInteraction, executeAliasCommand } = require('../src/utils/commandAlias');

function createInteraction() {
    const options = {
        getSubcommand: jest.fn(() => 'remove'),
        getSubcommandGroup: jest.fn(() => 'bookmark'),
        getInteger: jest.fn(name => name === 'id' ? 42 : null),
        getString: jest.fn(name => name === 'delivery' ? 'dm' : null),
        data: []
    };

    return {
        commandName: 'me',
        options
    };
}

describe('command alias interaction proxy', () => {
    test('overrides command path while preserving option readers', () => {
        const interaction = createInteraction();
        const alias = createCommandAliasInteraction(interaction, {
            commandName: 'bookmark',
            subcommand: 'delete',
            subcommandGroup: null
        });

        expect(alias.commandName).toBe('bookmark');
        expect(alias.options.getSubcommand()).toBe('delete');
        expect(alias.options.getSubcommandGroup(false)).toBeNull();
        expect(alias.options.getInteger('id')).toBe(42);
    });

    test('can provide synthetic option values for legacy command shapes', () => {
        const interaction = createInteraction();
        const alias = createCommandAliasInteraction(interaction, {
            commandName: 'reminder',
            subcommand: 'me',
            optionValues: {
                time: '10m',
                message: 'stretch'
            }
        });

        expect(alias.options.getSubcommand()).toBe('me');
        expect(alias.options.getString('time')).toBe('10m');
        expect(alias.options.getString('message')).toBe('stretch');
        expect(alias.options.getString('delivery')).toBe('dm');
    });

    test('can rename user options for delegated commands', () => {
        const target = { id: '123' };
        const interaction = createInteraction();
        const alias = createCommandAliasInteraction(interaction, {
            commandName: 'userinfo',
            optionValues: {
                target
            }
        });

        expect(alias.options.getUser('target')).toBe(target);
    });

    test('enforces delegated command cooldowns', async () => {
        const command = {
            data: { name: 'warthunder' },
            cooldown: 10,
            execute: jest.fn()
        };
        const client = {
            commands: new Map([['warthunder', command]]),
            cooldowns: new Map()
        };
        const interaction = {
            ...createInteraction(),
            user: { id: 'user-1' },
            guild: null,
            reply: jest.fn()
        };

        await executeAliasCommand(interaction, client, {
            commandName: 'warthunder',
            subcommand: 'stats'
        });
        await executeAliasCommand(interaction, client, {
            commandName: 'warthunder',
            subcommand: 'stats'
        });

        expect(command.execute).toHaveBeenCalledTimes(1);
        expect(interaction.reply).toHaveBeenCalledTimes(1);
        expect(interaction.reply.mock.calls[0][0].embeds[0].data.title).toContain('Cooldown Active');
    });
});
