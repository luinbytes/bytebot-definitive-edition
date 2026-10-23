const { ChannelType, PermissionFlagsBits, PermissionsBitField } = require('discord.js');

test.each([
    ['../src/commands/utility/copyembed', null],
    ['../src/commands/utility/embed', 'copy'],
    ['../src/commands/administration/pagination', 'set']
])('%s refuses to fetch messages from channels the caller cannot read', async (commandPath, action) => {
    const fetch = jest.fn().mockResolvedValue({ content: 'private content', embeds: [], components: [] });
    const channel = {
        id: '222222222222222222', guildId: '111111111111111111',
        permissionsFor: () => ({ has: () => false }), messages: { fetch }
    };
    const interaction = {
        user: { id: '444444444444444444' }, member: { id: '444444444444444444' },
        guildId: channel.guildId,
        guild: { id: channel.guildId, channels: { fetch: jest.fn().mockResolvedValue(channel) } },
        options: {
            getSubcommand: () => action,
            getString: name => name === 'message'
                ? `https://discord.com/channels/${channel.guildId}/${channel.id}/333333333333333333` : null
        },
        editReply: jest.fn()
    };
    await require(commandPath).execute(interaction, { richContentService: { setupPagination: jest.fn() } });
    expect(fetch).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith('That message was not found or is not accessible.');
});

test.each([
    ['readable channel', [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], false, true, true],
    ['no history access', [PermissionFlagsBits.ViewChannel], false, true, false],
    ['no channel access', [PermissionFlagsBits.ReadMessageHistory], false, true, false],
    ['private thread nonmember', [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], true, false, false],
    ['private thread member', [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], true, true, true],
    ['private thread moderator', [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageThreads], true, false, true]
])('copyembed respects %s', async (_label, flags, privateThread, joined, allowed) => {
    const source = { content: 'readable content', embeds: [], components: [] };
    const fetch = jest.fn().mockResolvedValue(source);
    const channel = {
        id: '222222222222222222', guildId: '111111111111111111',
        type: privateThread ? ChannelType.PrivateThread : ChannelType.GuildText,
        permissionsFor: () => new PermissionsBitField(flags), messages: { fetch },
        members: { fetch: jest.fn().mockResolvedValue(joined ? { id: '444444444444444444' } : null) }
    };
    const interaction = {
        guildId: channel.guildId, guild: { id: channel.guildId }, channel,
        member: { id: '444444444444444444' }, user: { id: '444444444444444444' },
        options: { getString: () => '333333333333333333' }, editReply: jest.fn()
    };
    await require('../src/commands/utility/copyembed').execute(interaction);
    expect(fetch).toHaveBeenCalledTimes(allowed ? 1 : 0);
    if (allowed) expect(JSON.stringify(interaction.editReply.mock.calls[0][0])).toContain('readable content');
    else expect(interaction.editReply).toHaveBeenCalledWith('That message was not found or is not accessible.');
});

test.each([
    'https://discord.com/channels/999999999999999999/222222222222222222/333333333333333333',
    'https://example.com/333333333333333333',
    'not a message 333333333333333333'
])('copyembed rejects foreign or malformed message references before fetching %s', async input => {
    const fetch = jest.fn();
    const editReply = jest.fn();
    await require('../src/commands/utility/copyembed').execute({
        guildId: '111111111111111111', guild: { channels: { fetch } },
        options: { getString: () => input }, editReply
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledWith('That message was not found or is not accessible.');
});

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

test('/tag reset does not require a tag name lookup', async () => {
    const resetTags = jest.fn().mockReturnValue(3);
    const editReply = jest.fn();
    await require('../src/commands/utility/tag').execute({
        options: {
            getSubcommand: () => 'reset', getString: () => null,
            getBoolean: () => true
        },
        member: { permissions: { has: () => false } }, user: { id: 'user1' }, editReply
    }, { richContentService: { resetTags } });

    expect(resetTags).toHaveBeenCalledWith('user1');
    expect(editReply).toHaveBeenCalledWith('Removed 3 tag(s).');
});

test('/custom list shows source previews and use counts', async () => {
    const editReply = jest.fn().mockResolvedValue({});
    await require('../src/commands/administration/custom').execute({
        guildId: 'guild1', user: { id: 'admin1' },
        options: { getSubcommand: () => 'list', getString: () => null }, editReply
    }, { richContentService: { listCustom: () => [
        { key: 'rules', config: JSON.stringify({ script: '{content: Be kind}', useCount: 12 }) },
        { key: 'faq', config: JSON.stringify({ script: '{embed}$v{title: Answers}', useCount: 3 }) }
    ] } });

    const description = editReply.mock.calls[0][0].embeds[0].data.description;
    expect(description).toContain('`rules`** — 12 uses\n{content: Be kind}');
    expect(description).toContain('`faq`** — 3 uses\n{embed}$v{title: Answers}');
});
