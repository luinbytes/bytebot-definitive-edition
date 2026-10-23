const mockDbLog = {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
};

jest.mock('../src/database', () => ({ db: {} }));
jest.mock('../src/utils/dbLogger', () => ({ dbLog: mockDbLog }));
jest.mock('../src/utils/permissionCheck', () => ({
    checkBotPermissions: jest.fn().mockResolvedValue(true)
}));
jest.mock('../src/utils/logger', () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), errorContext: jest.fn()
}));
jest.mock('../src/utils/embeds', () => ({ brand: jest.fn(() => ({})) }));
jest.mock('../src/components/bytepodControls', () => ({ getControlPanel: jest.fn() }));

const voiceStateUpdate = require('../src/events/voiceStateUpdate');

async function waitForCall(mock) {
    for (let attempt = 0; attempt < 10 && mock.mock.calls.length === 0; attempt++) {
        await new Promise(setImmediate);
    }
    expect(mock).toHaveBeenCalled();
}

test.each([1, 1200])('moves the creator promptly and bounds %i saved preset entries', async presetCount => {
    jest.clearAllMocks();
    let resolveMemberFetch;
    const memberFetch = new Promise(resolve => { resolveMemberFetch = resolve; });
    const setChannel = jest.fn().mockResolvedValue(undefined);
    const createdChannel = {
        id: 'pod-1',
        send: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
        permissionOverwrites: { edit: jest.fn().mockResolvedValue(undefined) }
    };
    const create = jest.fn().mockResolvedValue(createdChannel);
    const member = {
        id: 'owner-1',
        user: { id: 'owner-1', bot: false, username: 'Owner', tag: 'Owner#0001' },
        voice: { channelId: 'hub-1', setChannel },
        send: jest.fn()
    };
    const guild = {
        id: 'guild-1',
        channels: {
            cache: new Map([['hub-1', { id: 'hub-1' }]]),
            fetch: jest.fn(),
            create
        },
        members: {
            cache: new Map(),
            fetch: jest.fn(() => memberFetch)
        },
        voiceStates: { cache: new Map([[member.id, { channelId: 'hub-1' }]]) },
        client: { user: { id: 'bot-1' }, users: { fetch: jest.fn() } }
    };

    mockDbLog.select.mockImplementation(async table => ({
        guilds: { voiceHubChannelId: 'hub-1', voiceHubCategoryId: 'category-1' },
        bytepodUserSettings: null,
        bytepods: null,
        bytepodAutoWhitelist: Array.from({ length: presetCount }, (_, index) => ({ targetUserId: `friend-${index + 1}` }))
    })[table]);
    mockDbLog.insert.mockResolvedValue(undefined);

    const execution = voiceStateUpdate.execute(
        { channelId: null },
        { member, guild, channelId: 'hub-1', channel: { parentId: 'category-1' }, client: {} }
    );

    await waitForCall(create);
    await new Promise(setImmediate);

    expect(setChannel).toHaveBeenCalledWith(createdChannel);

    resolveMemberFetch({ user: { id: 'friend-1' } });
    await execution;
    expect(createdChannel.permissionOverwrites.edit).toHaveBeenCalledTimes(Math.min(presetCount, 998));
    expect(guild.members.fetch).toHaveBeenCalledTimes(Math.min(presetCount, 998));
    expect(createdChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
        { id: 'friend-1' },
        { Connect: true }
    );
});
