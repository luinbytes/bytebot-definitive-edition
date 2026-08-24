const { PermissionFlagsBits } = require('discord.js');

test('rich-content slash commands expose the frozen public lifecycle and real Discord permissions', () => {
    const commands = {
        '../src/commands/utility/embed': ['create', 'copy', 'save', 'list', 'raw', 'rename', 'remove', 'publish', 'published', 'unpublish', 'colors', 'setcolor', 'resetcolors'],
        '../src/commands/utility/tag': ['add', 'edit', 'remove', 'rename', 'reset', 'send', 'list', 'search', 'random', 'author', 'settings'],
        '../src/commands/administration/custom': ['add', 'list', 'test', 'raw', 'rename', 'remove', 'reset'],
        '../src/commands/administration/pagination': ['set', 'add', 'update', 'remove', 'delete', 'reset', 'list', 'restorereactions'],
        '../src/commands/administration/webhook': ['create', 'send', 'edit', 'delete', 'avatar', 'list']
    };
    for (const [path, actions] of Object.entries(commands)) {
        const json = require(path).data.toJSON();
        expect(json.options.map(option => option.name)).toEqual(expect.arrayContaining(actions));
    }
    expect(require('../src/commands/administration/custom').data.toJSON().default_member_permissions)
        .toBe(PermissionFlagsBits.ManageGuild.toString());
    expect(require('../src/commands/administration/pagination').data.toJSON().default_member_permissions)
        .toBe(PermissionFlagsBits.ManageMessages.toString());
    expect(require('../src/commands/administration/webhook').data.toJSON().default_member_permissions)
        .toBe(PermissionFlagsBits.ManageWebhooks.toString());
    expect(require('../src/commands/utility/variables').data.toJSON().name).toBe('variables');
    expect(require('../src/commands/utility/createembed').data.toJSON().name).toBe('createembed');
    expect(require('../src/commands/utility/copyembed').data.toJSON().name).toBe('copyembed');
});

test('rich-content component and reaction events reach the shared service', async () => {
    const handleCustomButton = jest.fn().mockResolvedValue();
    const interaction = {
        id: `rich-button-${Date.now()}`, customId: 'rich:custom:rules',
        isButton: () => true, isAutocomplete: () => false
    };
    await require('../src/events/interactionCreate').execute(interaction, {
        richContentService: { handleCustomButton }
    });
    expect(handleCustomButton).toHaveBeenCalledWith(interaction);

    const handlePaginationReaction = jest.fn().mockResolvedValue(true);
    const reaction = {
        client: { richContentService: { handlePaginationReaction } },
        message: { guild: { id: 'guild1' } }, emoji: { name: '➡️' }
    };
    const user = { id: 'user1', bot: false };
    await require('../src/events/messageReactionAdd').execute(reaction, user);
    expect(handlePaginationReaction).toHaveBeenCalledWith(reaction, user);
});
