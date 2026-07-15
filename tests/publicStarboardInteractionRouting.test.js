const { PermissionFlagsBits } = require('discord.js');
const { starboardConfig, starboardMessages } = require('../src/database/schema');

let mockRowsByTable = new Map();
const mockDb = {
    select: jest.fn(() => ({
        from: table => {
            const rows = mockRowsByTable.get(table) || [];
            if (table === starboardConfig) {
                return {
                    where: jest.fn(() => ({ limit: jest.fn().mockResolvedValue(rows) }))
                };
            }
            const query = {
                where: jest.fn(() => query),
                orderBy: jest.fn(() => query),
                all: jest.fn().mockResolvedValue(rows),
                limit: jest.fn(limit => ({ all: jest.fn().mockResolvedValue(rows.slice(0, limit)) }))
            };
            return query;
        }
    }))
};

jest.mock('../src/database', () => ({ db: mockDb }));
jest.mock('../src/utils/dbLogger', () => ({
    dbLog: { select: jest.fn(async (_table, operation) => operation()) }
}));

const interactionCreate = require('../src/events/interactionCreate');
const community = require('../src/commands/utility/community');
const starboard = require('../src/commands/administration/starboard');

function sourceChannel(id, name, canView, canReadHistory = canView) {
    return {
        id,
        name,
        permissionsFor: jest.fn(() => ({ has: jest.fn(permission => (
            (permission === PermissionFlagsBits.ViewChannel && canView)
            || (permission === PermissionFlagsBits.ReadMessageHistory && canReadHistory)
        )) }))
    };
}

let interactionCounter = 0;

function createInteraction() {
    const editReply = jest.fn();
    const member = { id: 'member-1', roles: { cache: new Map() }, permissions: { has: jest.fn(() => false) } };
    const visible = sourceChannel('visible-channel', 'visible-chat', true);
    const privateChannel = sourceChannel('private-channel', 'private-staff-chat', false);
    const channels = new Map([[visible.id, visible], [privateChannel.id, privateChannel]]);

    return {
        id: `public-starboard-routing-${++interactionCounter}`, 
        customId: 'community_page_starboard',
        guildId: 'guild-1',
        user: { id: member.id },
        member,
        guild: {
            id: 'guild-1',
            channels: { fetch: jest.fn(id => Promise.resolve(channels.get(id) || null)) }
        },
        isAutocomplete: jest.fn(() => false),
        isButton: jest.fn(() => true),
        isAnySelectMenu: jest.fn(() => false),
        isModalSubmit: jest.fn(() => false),
        deferUpdate: jest.fn(),
        editReply,
        editReplyPayload: () => editReply.mock.calls[0]?.[0]
    };
}

describe('public Starboard interaction routing', () => {
    beforeEach(() => {
        mockRowsByTable = new Map([
            [starboardConfig, [{ guildId: 'guild-1', emoji: '⭐', enabled: true }]],
            [starboardMessages, [
                { originalChannelId: 'visible-channel', originalMessageId: 'visible-message', authorId: 'visible-author', starCount: 8 },
                { originalChannelId: 'private-channel', originalMessageId: 'private-message', authorId: 'private-author', starCount: 10 }
            ]]
        ]);
    });

    test('omits private source entries and their metadata when routed through interactionCreate', async () => {
        const interaction = createInteraction();
        const client = {
            commands: new Map([['community', community]]),
            cooldowns: new Map(),
            users: {
                fetch: jest.fn(id => Promise.resolve({ tag: id === 'visible-author' ? 'Visible Author#0001' : 'Private Author#0001' }))
            }
        };

        await interactionCreate.execute(interaction, client);

        const embed = interaction.editReplyPayload().embeds[0].toJSON();
        const rendered = `${embed.description}\n${embed.footer.text}`;
        expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
        expect(rendered).toContain('visible-chat');
        expect(rendered).toContain('Visible Author#0001');
        expect(rendered).toContain('/visible-channel/visible-message');
        expect(rendered).not.toContain('private-staff-chat');
        expect(rendered).not.toContain('Private Author#0001');
        expect(rendered).not.toContain('private-channel');
        expect(rendered).not.toContain('private-message');
        expect(client.users.fetch).not.toHaveBeenCalledWith('private-author');
    });

    test('fills the public leaderboard from lower-ranked channels the requester can view', async () => {
        mockRowsByTable.set(starboardMessages, [
            ...Array.from({ length: 10 }, (_, index) => ({
                originalChannelId: 'private-channel', originalMessageId: `private-${index}`, authorId: `private-${index}`, starCount: 100 - index
            })),
            { originalChannelId: 'visible-channel', originalMessageId: 'visible-message', authorId: 'visible-author', starCount: 1 }
        ]);
        const interaction = createInteraction();
        const client = {
            commands: new Map([['community', community]]), cooldowns: new Map(),
            users: { fetch: jest.fn(id => Promise.resolve({ tag: id === 'visible-author' ? 'Visible Author#0001' : 'Private Author#0001' })) }
        };

        await interactionCreate.execute(interaction, client);

        const embed = interaction.editReplyPayload().embeds[0].toJSON();
        expect(embed.description).toContain('visible-chat');
        expect(embed.footer.text).toBe('Showing top 1 starred messages');
        expect(client.users.fetch).toHaveBeenCalledTimes(1);
    });

    test('uses cached source channels and fetches each uncached source once while filling visible entries in rank order', async () => {
        mockRowsByTable.set(starboardMessages, [
            ...Array.from({ length: 5 }, (_, index) => ({
                originalChannelId: 'private-channel', originalMessageId: `private-${index}`, authorId: `private-${index}`, starCount: 20 - index
            })),
            { originalChannelId: 'visible-channel', originalMessageId: 'visible-one', authorId: 'visible-one', starCount: 10 },
            { originalChannelId: 'visible-channel', originalMessageId: 'visible-two', authorId: 'visible-two', starCount: 9 }
        ]);
        const interaction = createInteraction();
        const cachedVisible = sourceChannel('visible-channel', 'cached-visible-chat', true);
        interaction.guild.channels.cache = new Map([[cachedVisible.id, cachedVisible]]);
        const client = {
            users: { fetch: jest.fn(id => Promise.resolve({ tag: `${id}#0001` })) }
        };

        const embed = await starboard.getTopStarboardEmbed(interaction.guild, client, 2, interaction.member);

        expect(embed.toJSON().description).toContain('cached-visible-chat');
        expect(interaction.guild.channels.fetch).toHaveBeenCalledTimes(1);
        expect(interaction.guild.channels.fetch).toHaveBeenCalledWith('private-channel');
        expect(client.users.fetch).toHaveBeenCalledTimes(2);
    });

    test('bounds public candidate inspection even when many higher-ranked rows are hidden', async () => {
        mockRowsByTable.set(starboardMessages, [
            ...Array.from({ length: 100 }, (_, index) => ({
                originalChannelId: 'private-channel', originalMessageId: `private-${index}`, authorId: `private-${index}`, starCount: 200 - index
            })),
            { originalChannelId: 'visible-channel', originalMessageId: 'outside-bound', authorId: 'visible-author', starCount: 1 }
        ]);
        const interaction = createInteraction();
        const client = { users: { fetch: jest.fn() } };

        const embed = await starboard.getTopStarboardEmbed(interaction.guild, client, 10, interaction.member);

        expect(embed.toJSON().title).toContain('No Visible Starred Messages');
        expect(interaction.guild.channels.fetch).toHaveBeenCalledTimes(1);
        expect(interaction.guild.channels.fetch).toHaveBeenCalledWith('private-channel');
        expect(client.users.fetch).not.toHaveBeenCalled();
    });

    test('omits a source channel when the requester can view it but cannot read its history', async () => {
        const interaction = createInteraction();
        interaction.guild.channels.fetch.mockImplementation(id => Promise.resolve(
            id === 'visible-channel'
                ? sourceChannel('visible-channel', 'history-denied-chat', true, false)
                : sourceChannel('private-channel', 'private-staff-chat', false)
        ));
        const client = {
            commands: new Map([['community', community]]),
            cooldowns: new Map(),
            users: { fetch: jest.fn() }
        };

        await interactionCreate.execute(interaction, client);

        const embed = interaction.editReplyPayload().embeds[0].toJSON();
        expect(embed.title).toContain('No Visible Starred Messages');
        expect(client.users.fetch).not.toHaveBeenCalled();
    });

    test('preserves the disabled administrator command leaderboard without requester filtering', async () => {
        mockRowsByTable.set(starboardConfig, [{ guildId: 'guild-1', emoji: '⭐', enabled: false }]);
        const interaction = createInteraction();
        interaction.options = { getSubcommand: jest.fn(() => 'top'), getInteger: jest.fn(() => 10) };
        const client = { users: { fetch: jest.fn(id => Promise.resolve({ tag: id === 'private-author' ? 'Private Author#0001' : 'Visible Author#0001' })) } };

        await starboard.execute(interaction, client);

        const embed = interaction.editReplyPayload().embeds[0].toJSON();
        expect(embed.description).toContain('private-staff-chat');
        expect(embed.description).toContain('Private Author#0001');
    });

    test('shows Starboard as unavailable through the public interaction when it is disabled', async () => {
        mockRowsByTable.set(starboardConfig, [{ guildId: 'guild-1', emoji: '⭐', enabled: false }]);
        const interaction = createInteraction();
        const client = { commands: new Map([['community', community]]), cooldowns: new Map(), users: { fetch: jest.fn() } };

        await interactionCreate.execute(interaction, client);

        const embed = interaction.editReplyPayload().embeds[0].toJSON();
        expect(embed.title).toContain('Starboard Unavailable');
        expect(client.users.fetch).not.toHaveBeenCalled();
    });
});
