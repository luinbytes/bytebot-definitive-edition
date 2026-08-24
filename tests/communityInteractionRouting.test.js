jest.mock('../src/database', () => ({
    db: {
        select: jest.fn(() => ({ from: () => ({ where: jest.fn().mockResolvedValue([]) }) })),
        insert: jest.fn(() => ({
            values: jest.fn(() => ({ onConflictDoUpdate: jest.fn().mockResolvedValue(undefined) }))
        }))
    }
}));
jest.mock('../src/utils/dbLogger', () => ({
    dbLog: {
        select: jest.fn().mockResolvedValue([]),
        insert: jest.fn(async (_table, operation) => operation?.())
    }
}));
jest.mock('../src/commands/administration/starboard', () => {
    const actual = jest.requireActual('../src/commands/administration/starboard');
    return {
        ...actual,
        getTopStarboardEmbed: jest.fn()
    };
});

const { PermissionFlagsBits, ChannelType } = require('discord.js');
const { guilds, birthdayConfig, starboardConfig, suggestionConfig, achievementRoleConfig } = require('../src/database/schema');
const interactionCreate = require('../src/events/interactionCreate');
const community = require('../src/commands/utility/community');
const starboard = require('../src/commands/administration/starboard');
const server = require('../src/commands/administration/server');
const communityStatus = require('../src/commands/administration/community-status');

function createClient() {
    return {
        commands: new Map([
            ['community', community],
            ['server', server],
            ['community-status', communityStatus]
        ]),
        cooldowns: new Map()
    };
}

function createInteraction({ id, type, customId, commandName, group, subcommand }) {
    const reply = jest.fn();
    const editReply = jest.fn();
    const followUp = jest.fn();
    let interaction;
    const deferUpdate = jest.fn(async () => { interaction.deferred = true; });
    const deferReply = jest.fn();
    const channel = {};
    const guild = {
        id: 'guild-1',
        name: 'Community Guild',
        members: {
            me: {
                permissionsIn: jest.fn(() => ({ has: jest.fn(() => true) })),
                permissions: { has: jest.fn(() => true) }
            }
        },
        channels: { fetch: jest.fn().mockResolvedValue(null) }
    };

    interaction = {
        id,
        customId,
        commandName,
        guild,
        guildId: guild.id,
        channel,
        user: { id: 'member-1' },
        member: {
            permissions: { has: jest.fn(() => true) },
            roles: { cache: new Map() }
        },
        options: {
            data: [],
            getSubcommandGroup: jest.fn(() => group || null),
            getSubcommand: jest.fn(() => subcommand || null)
        },
        isAutocomplete: jest.fn(() => false),
        isButton: jest.fn(() => type === 'button'),
        isAnySelectMenu: jest.fn(() => false),
        isModalSubmit: jest.fn(() => false),
        isUserContextMenuCommand: jest.fn(() => false),
        isMessageContextMenuCommand: jest.fn(() => false),
        isChatInputCommand: jest.fn(() => type === 'command'),
        reply,
        editReply,
        deferUpdate,
        deferReply,
        followUp,
        replyPayload: () => reply.mock.calls[0]?.[0],
        editReplyPayload: () => editReply.mock.calls[0]?.[0]
    };
    return interaction;
}

describe('community public interaction routing', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
    });

    test('routes a community page button through interactionCreate', async () => {
        const interaction = createInteraction({ id: 'community-button', type: 'button', customId: 'community_page_progress' });

        await interactionCreate.execute(interaction, createClient());

        expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
        expect(interaction.editReplyPayload().embeds[0].toJSON().title).toContain('Your Progress');
    });

    test('routes the initial /community response through interactionCreate', async () => {
        const interaction = createInteraction({ id: 'community-command', type: 'command', commandName: 'community' });

        await interactionCreate.execute(interaction, createClient());

        const payload = interaction.replyPayload();
        expect(payload.flags).toBeDefined();
        expect(payload.embeds[0].toJSON().title).toContain('Community Hub');
        expect(payload.components[0].components.map(button => button.data.custom_id)).toContain('community_page_starboard');
    });

    test('routes the public Starboard page with the Discord client and a safe edited response', async () => {
        const interaction = createInteraction({ id: 'community-starboard-button', type: 'button', customId: 'community_page_starboard' });
        const client = createClient();
        const starboardEmbed = { toJSON: () => ({ title: '⭐ Top Starred Messages' }) };
        starboard.getTopStarboardEmbed.mockResolvedValue(starboardEmbed);

        await interactionCreate.execute(interaction, client);

        expect(starboard.getTopStarboardEmbed).toHaveBeenCalledWith(interaction.guild, client, 10, interaction.member);
        expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
        expect(interaction.editReplyPayload()).toEqual(expect.objectContaining({
            embeds: [starboardEmbed],
            components: expect.any(Array)
        }));
    });

    test('uses a follow-up error after a deferred community button destination fails', async () => {
        const interaction = createInteraction({ id: 'community-starboard-error', type: 'button', customId: 'community_page_starboard' });
        starboard.getTopStarboardEmbed.mockRejectedValue(new Error('starboard lookup failed'));

        await interactionCreate.execute(interaction, createClient());

        expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
        expect(interaction.followUp).toHaveBeenCalledTimes(1);
        expect(interaction.reply).not.toHaveBeenCalled();
    });

    test('acknowledges a recognized community button when its command handler is unavailable', async () => {
        const interaction = createInteraction({ id: 'community-missing-handler', type: 'button', customId: 'community_page_progress' });
        const client = createClient();
        client.commands.set('community', {});
        interaction.reply.mockRejectedValue(new Error('interaction token expired'));

        await expect(interactionCreate.execute(interaction, client)).resolves.toBeUndefined();

        expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: expect.any(Array) }));
    });

    test('uses a mention-safe embed when economy components are unavailable', async () => {
        const interaction = createInteraction({ id: 'economy-unavailable', type: 'button', customId: 'economy:game:cashout:id:nonce' });
        interaction.reply.mockResolvedValue(undefined);

        await interactionCreate.execute(interaction, createClient());

        expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
            embeds: expect.any(Array), allowedMentions: { parse: [] }, flags: expect.any(Array)
        }));
    });

    test('replays duplicate economy lab commands through the full command pipeline', async () => {
        const execute = jest.fn();
        const client = createClient();
        client.commands.set('economy', {
            data: { name: 'economy', dm_permission: false }, permissions: [], cooldown: 2, execute
        });
        const first = createInteraction({ id: 'economy-lab-replay', type: 'command', commandName: 'economy', group: 'lab', subcommand: 'buy' });
        const replay = createInteraction({ id: 'economy-lab-replay', type: 'command', commandName: 'economy', group: 'lab', subcommand: 'buy' });

        await interactionCreate.execute(first, client);
        await interactionCreate.execute(replay, client);

        expect(execute).toHaveBeenCalledTimes(2);
    });

    test('routes /server community view through the server alias', async () => {
        const interaction = createInteraction({
            id: 'community-view', type: 'command', commandName: 'server', group: 'community', subcommand: 'view'
        });

        await interactionCreate.execute(interaction, createClient());

        expect(interaction.deferReply).toHaveBeenCalledWith({ flags: expect.any(Array) });
        expect(interaction.editReplyPayload().embeds[0].toJSON().title).toContain('Community Status');
        expect(interaction.member.permissions.has).toHaveBeenCalledWith([PermissionFlagsBits.Administrator]);
    });

    test('routes a fully configured /server community view through the admin boundary', async () => {
        const { db } = require('../src/database');
        const rowsByTable = new Map([
            [guilds, [{ id: 'guild-1', achievementsEnabled: true, voiceHubChannelId: 'hub', voiceHubCategoryId: 'category', welcomeEnabled: false }]],
            [birthdayConfig, [{ enabled: false }]],
            [starboardConfig, [{ enabled: false }]],
            [suggestionConfig, [{ enabled: false }]],
            [achievementRoleConfig, [{ enabled: false }]]
        ]);
        db.select.mockImplementation(() => ({
            from: table => ({ where: jest.fn().mockResolvedValue(rowsByTable.get(table) || []) })
        }));
        const interaction = createInteraction({
            id: 'community-view-configured', type: 'command', commandName: 'server', group: 'community', subcommand: 'view'
        });
        const bytePodPermissions = [
            PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.Connect,
            PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks
        ];
        interaction.guild.channels.fetch.mockImplementation(id => Promise.resolve({
            type: id === 'hub' ? ChannelType.GuildVoice : ChannelType.GuildCategory,
            permissionsFor: jest.fn(() => ({ has: jest.fn(permission => bytePodPermissions.includes(permission)) }))
        }));

        await interactionCreate.execute(interaction, createClient());

        const embed = interaction.editReplyPayload().embeds[0].toJSON();
        expect(embed.fields.find(field => field.name === 'Missing Configuration').value).toBe('None');
        expect(embed.fields.find(field => field.name === 'BytePods').value).toContain('Enabled');
        expect(interaction.member.permissions.has).toHaveBeenCalledWith([PermissionFlagsBits.Administrator]);
    });
});
