const path = require('path');

function commandJson(commandPath) {
    return require(path.resolve(commandPath)).data.toJSON();
}

test('/lookup exposes every provider-backed public parity path with bounded options', () => {
    const command = commandJson('src/commands/utility/lookup.js');
    const options = Object.fromEntries(command.options.map(option => [option.name, option]));

    expect(command.name).toBe('lookup');
    expect(command.dm_permission).toBe(true);
    expect(Object.keys(options)).toEqual([
        'calculate', 'qr', 'screenshot', 'weather', 'definition', 'translate', 'github'
    ]);
    expect(options.calculate.options[0]).toMatchObject({ name: 'expression', required: true, max_length: 500 });
    expect(options.translate.options).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'language', required: true, max_length: 50 }),
        expect.objectContaining({ name: 'text', required: true, max_length: 2000 })
    ]));
    expect(options.github.options.map(option => option.name)).toEqual(['user', 'repository', 'email']);
});

test('/lookup github user renders validated provider data and the contributions limitation', async () => {
    const lookup = require('../src/commands/utility/lookup');
    const interaction = {
        options: {
            getSubcommandGroup: jest.fn().mockReturnValue('github'),
            getSubcommand: jest.fn().mockReturnValue('user'),
            getString: jest.fn().mockReturnValue('octocat')
        },
        editReply: jest.fn().mockResolvedValue()
    };
    const client = { informationLookupService: { githubUser: jest.fn().mockResolvedValue({
        username: 'octocat', id: 1, url: 'https://github.com/octocat', avatar: 'https://avatars.githubusercontent.com/u/1',
        name: 'The Octocat', bio: 'A profile', company: '@github', location: 'San Francisco', website: null,
        repositories: 8, gists: 8, followers: 100, following: 2, createdAt: '2011-01-25T18:44:36Z'
    }) } };

    await lookup.execute(interaction, client);

    const embed = interaction.editReply.mock.calls[0][0].embeds[0].data;
    expect(embed.url).toBe('https://github.com/octocat');
    expect(embed.fields).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'Contributions', value: expect.stringContaining('Not available') })
    ]));
});

test('/me and /server place identity lookups in the existing intent hubs', () => {
    const me = commandJson('src/commands/utility/me.js');
    const server = commandJson('src/commands/administration/server.js');
    const byName = command => Object.fromEntries(command.options.map(option => [option.name, option]));
    const meOptions = byName(me);
    const serverOptions = byName(server);

    expect(Object.keys(meOptions)).toEqual(expect.arrayContaining([
        'banner', 'server-avatar', 'server-banner', 'name'
    ]));
    expect(meOptions.name.options.map(option => option.name)).toEqual(['history']);
    expect(serverOptions.info.options).toEqual([
        expect.objectContaining({ name: 'server', max_length: 2048 })
    ]);
    expect(serverOptions.role.options.map(option => option.name)).toEqual(['info', 'members']);
    expect(serverOptions.invite.options.map(option => option.name)).toEqual(['bot', 'info']);
    expect(serverOptions.asset.options.map(option => option.name)).toEqual(['icon', 'banner']);
    expect(serverOptions.permissions.options.map(option => option.name)).toContain('view');
    expect(server.options).toHaveLength(24);
});

test('username updates record history only in shared guilds', async () => {
    const userUpdate = require('../src/events/userUpdate');
    const recordNameChange = jest.fn();
    const handleUserUpdate = jest.fn().mockResolvedValue();
    const client = {
        informationLookupService: { recordNameChange },
        automationService: { handleUserUpdate },
        guilds: { cache: new Map([
            ['123456789012345678', { id: '123456789012345678', members: { cache: new Map([['223456789012345678', {}]]) } }],
            ['323456789012345678', { id: '323456789012345678', members: { cache: new Map() } }]
        ]) }
    };

    await userUpdate.execute(
        { id: '223456789012345678', username: 'FormerName' },
        { id: '223456789012345678', username: 'CurrentName' },
        client
    );

    expect(recordNameChange).toHaveBeenCalledWith(
        ['123456789012345678'], '223456789012345678', 'FormerName'
    );
    expect(handleUserUpdate).toHaveBeenCalled();
});

test('/me banner uses fresh Discord user data and reports the real asset', async () => {
    const me = require('../src/commands/utility/me');
    const reply = jest.fn();
    const user = { id: '223456789012345678', username: 'Member' };
    const fetched = { ...user, bannerURL: jest.fn().mockReturnValue('https://cdn.discordapp.com/banner.png') };
    const interaction = {
        user,
        guild: { id: '123456789012345678' },
        options: {
            getSubcommandGroup: jest.fn().mockReturnValue(null),
            getSubcommand: jest.fn().mockReturnValue('banner'),
            getUser: jest.fn().mockReturnValue(user)
        },
        reply
    };

    await me.execute(interaction, { users: { fetch: jest.fn().mockResolvedValue(fetched) } });

    expect(reply.mock.calls[0][0].embeds[0].data.image.url).toBe('https://cdn.discordapp.com/banner.png');
});

test('/server role info reports Discord role facts without requiring admin access', async () => {
    const server = require('../src/commands/administration/server');
    const reply = jest.fn();
    const role = {
        id: '423456789012345678', name: 'Members', color: 0x123456,
        createdTimestamp: 1000, members: { size: 3 }, permissions: { toArray: () => ['ViewChannel'] },
        iconURL: jest.fn().mockReturnValue(null)
    };
    const interaction = {
        guild: { id: '123456789012345678', name: 'Guild' },
        options: {
            getSubcommandGroup: jest.fn().mockReturnValue('role'),
            getSubcommand: jest.fn().mockReturnValue('info'),
            getRole: jest.fn().mockReturnValue(role)
        },
        reply
    };

    await server.execute(interaction, {});

    expect(reply.mock.calls[0][0].embeds[0].data.fields).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'Role ID', value: role.id }),
        expect.objectContaining({ name: 'Members', value: '3' })
    ]));
});

test('/server role members paginates every resolved member in pages of 25', async () => {
    const server = require('../src/commands/administration/server');
    const members = new Map(Array.from({ length: 26 }, (_, index) => {
        const id = String(223456789012345678n + BigInt(index));
        return [id, { id }];
    }));
    const collector = { on: jest.fn() };
    const message = { createMessageComponentCollector: jest.fn().mockReturnValue(collector) };
    const interaction = {
        user: { id: '123456789012345678' },
        guild: { id: '123456789012345678' },
        options: {
            getSubcommandGroup: jest.fn().mockReturnValue('role'),
            getSubcommand: jest.fn().mockReturnValue('members'),
            getRole: jest.fn().mockReturnValue({ id: '423456789012345678', name: 'Members', members })
        },
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(message)
    };

    await server.execute(interaction, {});

    expect(interaction.deferReply).toHaveBeenCalled();
    expect(interaction.editReply.mock.calls[0][0].embeds[0].data.description).toContain('1-25 of 26');
    expect(interaction.editReply.mock.calls[0][0].components).toHaveLength(1);
    expect(message.createMessageComponentCollector).toHaveBeenCalled();
});

test('/server invite info validates through Discord and reports unavailable fields honestly', async () => {
    const server = require('../src/commands/administration/server');
    const reply = jest.fn();
    const interaction = {
        guild: { id: '123456789012345678', name: 'Guild' },
        options: {
            getSubcommandGroup: jest.fn().mockReturnValue('invite'),
            getSubcommand: jest.fn().mockReturnValue('info'),
            getString: jest.fn().mockReturnValue('https://discord.gg/example')
        },
        reply
    };
    const client = { fetchInvite: jest.fn().mockResolvedValue({
        code: 'example', expiresTimestamp: null,
        guild: { id: '123456789012345678', name: 'Guild', iconURL: jest.fn().mockReturnValue(null) },
        approximateMemberCount: 42, approximatePresenceCount: 7
    }) };

    await server.execute(interaction, client);

    expect(client.fetchInvite).toHaveBeenCalledWith('example');
    expect(reply.mock.calls[0][0].embeds[0].data.fields).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'Code', value: 'example' }),
        expect.objectContaining({ name: 'Expires', value: 'Never' }),
        expect.objectContaining({ name: 'Members', value: '42' })
    ]));
});

test('/server permissions view reports only resolved Discord permissions', async () => {
    const server = require('../src/commands/administration/server');
    const reply = jest.fn();
    const user = { id: '223456789012345678', username: 'Member' };
    const interaction = {
        user,
        guild: { id: '123456789012345678', members: { fetch: jest.fn().mockResolvedValue({
            user, permissions: { toArray: () => ['ViewChannel', 'SendMessages'] }
        }) } },
        options: {
            getSubcommandGroup: jest.fn().mockReturnValue('permissions'),
            getSubcommand: jest.fn().mockReturnValue('view'),
            getUser: jest.fn().mockReturnValue(null)
        },
        reply
    };

    await server.execute(interaction, {});

    expect(reply.mock.calls[0][0].embeds[0].data.description).toContain('ViewChannel');
    expect(reply.mock.calls[0][0].embeds[0].data.description).toContain('SendMessages');
});

test('/server asset icon uses Discord guild data and never accepts an arbitrary image URL', async () => {
    const server = require('../src/commands/administration/server');
    const reply = jest.fn();
    const guild = {
        id: '123456789012345678', name: 'Guild',
        iconURL: jest.fn().mockReturnValue('https://cdn.discordapp.com/icon.png')
    };
    const interaction = {
        guild,
        options: {
            getSubcommandGroup: jest.fn().mockReturnValue('asset'),
            getSubcommand: jest.fn().mockReturnValue('icon'),
            getString: jest.fn().mockReturnValue(null)
        },
        reply
    };

    await server.execute(interaction, {});

    expect(reply.mock.calls[0][0].embeds[0].data.image.url).toBe('https://cdn.discordapp.com/icon.png');
});

test('/server info resolves a public invite instead of fabricating remote guild fields', async () => {
    const serverInfo = require('../src/commands/utility/serverinfo');
    const reply = jest.fn();
    const remote = {
        id: '323456789012345678', name: 'Remote Guild', memberCount: 42,
        createdTimestamp: 1000, iconURL: jest.fn().mockReturnValue(null)
    };
    const interaction = {
        guild: { id: '123456789012345678', name: 'Current Guild' },
        user: { id: '223456789012345678' },
        options: {
            getSubcommandGroup: jest.fn().mockReturnValue(null),
            getSubcommand: jest.fn().mockReturnValue('info'),
            getString: jest.fn().mockReturnValue('https://discord.gg/remote'),
            getBoolean: jest.fn().mockReturnValue(false)
        },
        reply
    };
    const client = { fetchInvite: jest.fn().mockResolvedValue({ guild: remote }) };

    await serverInfo.execute(interaction, client);

    expect(reply.mock.calls[0][0].embeds[0].data.title).toBe('Remote Guild Info');
    expect(reply.mock.calls[0][0].embeds[0].data.fields).toContainEqual(
        expect.objectContaining({ name: 'Members', value: '42' })
    );
    expect(reply.mock.calls[0][0].embeds[0].data.fields).not.toContainEqual(
        expect.objectContaining({ name: 'Owner', value: expect.stringContaining('undefined') })
    );
});
