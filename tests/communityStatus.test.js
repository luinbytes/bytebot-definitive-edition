const { PermissionFlagsBits, ChannelType } = require('discord.js');
const { db } = require('../src/database');
const { guilds, birthdayConfig, starboardConfig, suggestionConfig, achievementRoleConfig, achievementRoles } = require('../src/database/schema');

jest.mock('../src/database', () => ({
    db: { select: jest.fn() }
}));

const communityStatus = require('../src/commands/administration/community-status');

function mockSelectRows(rowsByTable) {
    db.select.mockImplementation(() => ({
        from: table => ({
            where: jest.fn().mockResolvedValue(rowsByTable.get(table) || [])
        })
    }));
}

function createInteraction({ guildRecord, birthday, starboard, suggestions, achievementRoles: achievementRoleSettings, achievementRoleRecords, channelPermissions = {}, channelTypes = {}, roles = {}, botPermissions, botHighestRolePosition = 10 } = {}) {
    const channels = new Map(Object.entries(channelPermissions).map(([id, permissions]) => [id, {
        id,
        type: channelTypes[id],
        permissionsFor: jest.fn(() => ({ has: jest.fn(required => (Array.isArray(required) ? required : [required]).every(permission => permissions.includes(permission))) }))
    }]));
    const resolvedBotPermissions = new Set(botPermissions || [
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageRoles,
        PermissionFlagsBits.MoveMembers,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks
    ]);
    const editReply = jest.fn();

    mockSelectRows(new Map([
        [guilds, guildRecord ? [guildRecord] : []],
        [birthdayConfig, birthday ? [birthday] : []],
        [starboardConfig, starboard ? [starboard] : []],
        [suggestionConfig, suggestions ? [suggestions] : []],
        [achievementRoleConfig, achievementRoleSettings ? [achievementRoleSettings] : []],
        [achievementRoles, achievementRoleRecords || []]
    ]));

    return {
        guild: {
            id: 'guild-1',
            name: 'Community Guild',
            channels: { fetch: jest.fn(id => Promise.resolve(channels.get(id) || null)) },
            members: { me: { permissions: { has: jest.fn(permission => resolvedBotPermissions.has(permission)) }, roles: { highest: { position: botHighestRolePosition } } } },
            roles: { fetch: jest.fn(id => Promise.resolve(roles[id] || null)) }
        },
        deferReply: jest.fn(),
        editReply,
        editReplyPayload: () => editReply.mock.calls[0]?.[0]
    };
}

describe('community status interaction', () => {
    beforeEach(() => jest.clearAllMocks());

    test('renders configured community features without mutating Discord resources', async () => {
        const interaction = createInteraction({
            guildRecord: {
                achievementsEnabled: true,
                voiceHubChannelId: 'voice-hub',
                voiceHubCategoryId: 'voice-category',
                welcomeEnabled: true,
                welcomeChannel: 'welcome-channel'
            },
            birthday: { enabled: true, channelId: 'birthday-channel', roleId: 'birthday-role' },
            starboard: { enabled: true, channelId: 'starboard-channel' },
            suggestions: { enabled: true, channelId: 'suggestion-channel', reviewRoleId: 'review-role' },
            achievementRoles: { enabled: true },
            roles: {
                'birthday-role': { id: 'birthday-role', managed: false, position: 2 },
                'review-role': { id: 'review-role', managed: false, position: 2 }
            },
            channelPermissions: {
                'welcome-channel': [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
                'birthday-channel': [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
                'starboard-channel': [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
                'suggestion-channel': [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AddReactions],
                'voice-hub': [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
                'voice-category': [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]
            },
            channelTypes: {
                'welcome-channel': ChannelType.GuildText,
                'birthday-channel': ChannelType.GuildText,
                'starboard-channel': ChannelType.GuildText,
                'suggestion-channel': ChannelType.GuildText,
                'voice-hub': ChannelType.GuildVoice,
                'voice-category': ChannelType.GuildCategory
            }
        });

        await communityStatus.execute(interaction);

        const embed = interaction.editReplyPayload().embeds[0].toJSON();
        expect(interaction.deferReply).toHaveBeenCalled();
        expect(embed.title).toContain('Community Status');
        expect(embed.fields.find(field => field.name === 'Achievements').value).toContain('Enabled');
        expect(embed.fields.find(field => field.name === 'Missing Configuration').value).toBe('None');
        expect(embed.fields.find(field => field.name === 'Permission Gaps').value).toBe('None detected');
        expect(interaction.guild.channels.fetch).toHaveBeenCalled();
        expect(interaction.guild.channels.create).toBeUndefined();
        expect(interaction.guild.roles.create).toBeUndefined();
    });

    test('reports missing configuration and detectable channel permission gaps without creating resources', async () => {
        const interaction = createInteraction({
            guildRecord: {
                achievementsEnabled: false,
                voiceHubChannelId: 'voice-hub',
                voiceHubCategoryId: null,
                welcomeEnabled: true,
                welcomeChannel: null
            },
            birthday: { enabled: true, channelId: 'missing-birthday-channel' },
            starboard: { enabled: true, channelId: 'starboard-channel' },
            suggestions: { enabled: true, channelId: 'suggestion-channel' },
            channelPermissions: {
                'starboard-channel': [PermissionFlagsBits.SendMessages],
                'suggestion-channel': [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]
            },
            channelTypes: {
                'starboard-channel': ChannelType.GuildText,
                'suggestion-channel': ChannelType.GuildText
            }
        });

        await communityStatus.execute(interaction);

        const embed = interaction.editReplyPayload().embeds[0].toJSON();
        const missing = embed.fields.find(field => field.name === 'Missing Configuration').value;
        const permissionGaps = embed.fields.find(field => field.name === 'Permission Gaps').value;
        expect(embed.fields.find(field => field.name === 'Achievements').value).toContain('Disabled');
        expect(missing).not.toContain('BytePods category');
        expect(missing).toContain('Welcome channel');
        expect(missing).not.toContain('Achievement role reward settings');
        expect(missing).toContain('Birthdays channel is unavailable');
        expect(permissionGaps).toContain('Starboard: Embed Links');
        expect(permissionGaps).toContain('Suggestions: Add Reactions');
        expect(interaction.guild.channels.create).toBeUndefined();
        expect(interaction.guild.roles.create).toBeUndefined();
    });

    test('reports Manage Roles when enabled birthday or achievement role assignments need it', async () => {
        const interaction = createInteraction({
            guildRecord: { achievementsEnabled: true },
            birthday: { enabled: true, channelId: 'birthday-channel', roleId: 'birthday-role' },
            achievementRoles: { enabled: true },
            channelPermissions: {
                'birthday-channel': [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]
            },
            botPermissions: [
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.MoveMembers,
                PermissionFlagsBits.Connect,
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.EmbedLinks
            ]
        });

        await communityStatus.execute(interaction);

        const embed = interaction.editReplyPayload().embeds[0].toJSON();
        const permissionGaps = embed.fields.find(field => field.name === 'Permission Gaps').value;
        expect(permissionGaps).toContain('Birthdays: Manage Roles');
        expect(permissionGaps).toContain('Achievement Roles: Manage Roles');
    });

    test('reports the enabled-by-default achievement role behavior when no role config exists', async () => {
        const interaction = createInteraction({
            guildRecord: { achievementsEnabled: true },
            botPermissions: [PermissionFlagsBits.ManageChannels]
        });

        await communityStatus.execute(interaction);

        const embed = interaction.editReplyPayload().embeds[0].toJSON();
        expect(embed.fields.find(field => field.name === 'Achievement Roles').value).toContain('Enabled');
        expect(embed.fields.find(field => field.name === 'Missing Configuration').value).not.toContain('Achievement role reward settings');
        expect(embed.fields.find(field => field.name === 'Permission Gaps').value).toContain('Achievement Roles: Manage Roles');
    });

    test('reports unavailable and wrong-type configured BytePod resources as configuration gaps', async () => {
        const interaction = createInteraction({
            guildRecord: { achievementsEnabled: true, voiceHubChannelId: 'deleted-hub', voiceHubCategoryId: 'wrong-category' },
            channelPermissions: { 'wrong-category': [PermissionFlagsBits.ManageChannels] },
            channelTypes: { 'wrong-category': ChannelType.GuildText }
        });

        await communityStatus.execute(interaction);

        const embed = interaction.editReplyPayload().embeds[0].toJSON();
        const missing = embed.fields.find(field => field.name === 'Missing Configuration').value;
        expect(missing).toContain('BytePods hub channel is unavailable');
        expect(missing).toContain('BytePods category is not a category');
        expect(embed.fields.find(field => field.name === 'BytePods').value).not.toContain('Enabled');
    });

    test('reports stale and non-sendable configured announcement resources as configuration gaps', async () => {
        const interaction = createInteraction({
            guildRecord: { achievementsEnabled: true, welcomeEnabled: true, welcomeChannel: 'deleted-welcome' },
            birthday: { enabled: true, channelId: 'voice-birthday' },
            starboard: { enabled: true, channelId: 'category-starboard' },
            suggestions: { enabled: true, channelId: 'thread-suggestions' },
            channelPermissions: {
                'voice-birthday': [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
                'category-starboard': [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
                'thread-suggestions': [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AddReactions]
            },
            channelTypes: {
                'voice-birthday': ChannelType.GuildVoice,
                'category-starboard': ChannelType.GuildCategory,
                'thread-suggestions': ChannelType.PublicThread
            }
        });

        await communityStatus.execute(interaction);

        const embed = interaction.editReplyPayload().embeds[0].toJSON();
        const missing = embed.fields.find(field => field.name === 'Missing Configuration').value;
        expect(missing).toContain('Welcome channel is unavailable');
        expect(missing).toContain('Birthdays channel is not a supported sendable text channel');
        expect(missing).toContain('Starboard channel is not a supported sendable text channel');
        expect(missing).toContain('Suggestions channel is not a supported sendable text channel');
    });

    test('shows achievements and activity streaks enabled by default without a guild record', async () => {
        const interaction = createInteraction();

        await communityStatus.execute(interaction);

        const fields = interaction.editReplyPayload().embeds[0].toJSON().fields;
        expect(fields.find(field => field.name === 'Achievements').value).toContain('Enabled');
        expect(fields.find(field => field.name === 'Activity Streaks').value).toContain('Enabled');
    });

    test('reports BytePod permissions denied by configured channel and category overwrites', async () => {
        const interaction = createInteraction({
            guildRecord: { achievementsEnabled: true, voiceHubChannelId: 'voice-hub', voiceHubCategoryId: 'voice-category' },
            channelPermissions: {
                'voice-hub': [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
                'voice-category': [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
            },
            channelTypes: { 'voice-hub': ChannelType.GuildVoice, 'voice-category': ChannelType.GuildCategory }
        });

        await communityStatus.execute(interaction);

        const embed = interaction.editReplyPayload().embeds[0].toJSON();
        const gaps = embed.fields.find(field => field.name === 'Permission Gaps').value;
        expect(gaps).toContain('BytePods hub channel: Manage Channels, Move Members, Send Messages, Embed Links');
        expect(gaps).toContain('BytePods category: Manage Channels, Move Members, Send Messages, Embed Links');
    });

    test('uses the hub parent category when BytePods have no explicit category configuration', async () => {
        const interaction = createInteraction({
            guildRecord: { achievementsEnabled: true, voiceHubChannelId: 'voice-hub', voiceHubCategoryId: null }
        });
        interaction.guild.channels.fetch.mockImplementation(id => Promise.resolve(id === 'voice-hub'
            ? { id, type: ChannelType.GuildVoice, parentId: 'inherited-category', permissionsFor: jest.fn(() => ({ has: jest.fn(() => true) })) }
            : { id, type: ChannelType.GuildCategory, permissionsFor: jest.fn(() => ({ has: jest.fn(() => true) })) }));

        await communityStatus.execute(interaction);

        const fields = interaction.editReplyPayload().embeds[0].toJSON().fields;
        expect(fields.find(field => field.name === 'BytePods').value).toContain('Enabled');
        expect(fields.find(field => field.name === 'Missing Configuration').value).not.toContain('BytePods category');
    });

    test('reports deleted, managed, and unmanageable configured role resources', async () => {
        const interaction = createInteraction({
            guildRecord: { achievementsEnabled: true },
            birthday: { enabled: true, channelId: 'birthday-channel', roleId: 'deleted-birthday-role' },
            achievementRoles: { enabled: true },
            achievementRoleRecords: [
                { roleId: 'managed-achievement-role' },
                { roleId: 'high-achievement-role' }
            ],
            channelPermissions: { 'birthday-channel': [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] },
            channelTypes: { 'birthday-channel': ChannelType.GuildText },
            roles: {
                'managed-achievement-role': { id: 'managed-achievement-role', managed: true, position: 2 },
                'high-achievement-role': { id: 'high-achievement-role', managed: false, position: 10 }
            },
            botHighestRolePosition: 10
        });

        await communityStatus.execute(interaction);

        const fields = interaction.editReplyPayload().embeds[0].toJSON().fields;
        const missing = fields.find(field => field.name === 'Missing Configuration').value;
        const gaps = fields.find(field => field.name === 'Permission Gaps').value;
        expect(missing).toContain('Birthdays role is unavailable');
        expect(gaps).toContain('Achievement Roles: configured role is managed by an integration');
        expect(gaps).toContain('Achievement Roles: configured role is above or equal to the bot\'s highest role');
    });

    test('bounds many stale and misconfigured achievement roles within Discord embed field limits', async () => {
        const achievementRoleRecords = Array.from({ length: 80 }, (_, index) => ({ roleId: `achievement-role-${index}` }));
        const roles = Object.fromEntries(
            achievementRoleRecords
                .filter((_, index) => index % 2 === 1)
                .map(({ roleId }) => [roleId, { id: roleId, managed: true, position: 2 }])
        );
        const interaction = createInteraction({
            guildRecord: { achievementsEnabled: true },
            achievementRoles: { enabled: true },
            achievementRoleRecords,
            roles
        });

        await communityStatus.execute(interaction);

        const fields = interaction.editReplyPayload().embeds[0].toJSON().fields;
        const missing = fields.find(field => field.name === 'Missing Configuration').value;
        const gaps = fields.find(field => field.name === 'Permission Gaps').value;
        expect(missing.length).toBeLessThanOrEqual(1024);
        expect(gaps.length).toBeLessThanOrEqual(1024);
        expect(missing).toMatch(/… and \d+ more items/);
        expect(gaps).toMatch(/… and \d+ more items/);
        expect(interaction.guild.channels.create).toBeUndefined();
        expect(interaction.guild.roles.create).toBeUndefined();
    });

    test('reports missing and unmanageable configured suggestion review roles while preserving suggestion channel checks', async () => {
        const interaction = createInteraction({
            guildRecord: { achievementsEnabled: true },
            suggestions: { enabled: true, channelId: 'suggestion-channel', reviewRoleId: 'deleted-review-role' },
            achievementRoles: { enabled: false },
            channelPermissions: {
                'suggestion-channel': [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]
            },
            channelTypes: { 'suggestion-channel': ChannelType.GuildText },
            botPermissions: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]
        });

        await communityStatus.execute(interaction);

        const fields = interaction.editReplyPayload().embeds[0].toJSON().fields;
        const missing = fields.find(field => field.name === 'Missing Configuration').value;
        const gaps = fields.find(field => field.name === 'Permission Gaps').value;
        expect(missing).toContain('Suggestions role is unavailable');
        expect(gaps).toContain('Suggestions: Manage Roles');
        expect(gaps).toContain('Suggestions: Add Reactions');

        const managedInteraction = createInteraction({
            guildRecord: { achievementsEnabled: true },
            suggestions: { enabled: true, channelId: 'suggestion-channel', reviewRoleId: 'managed-review-role' },
            achievementRoles: { enabled: false },
            channelPermissions: {
                'suggestion-channel': [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AddReactions]
            },
            channelTypes: { 'suggestion-channel': ChannelType.GuildText },
            roles: { 'managed-review-role': { id: 'managed-review-role', managed: true, position: 2 } }
        });

        await communityStatus.execute(managedInteraction);

        const managedGaps = managedInteraction.editReplyPayload().embeds[0].toJSON().fields.find(field => field.name === 'Permission Gaps').value;
        expect(managedGaps).toContain('Suggestions: configured role is managed by an integration');
    });

    test('reports suggestion review roles above the bot hierarchy', async () => {
        const interaction = createInteraction({
            guildRecord: { achievementsEnabled: true },
            suggestions: { enabled: true, channelId: 'suggestion-channel', reviewRoleId: 'high-review-role' },
            achievementRoles: { enabled: false },
            channelPermissions: {
                'suggestion-channel': [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AddReactions]
            },
            channelTypes: { 'suggestion-channel': ChannelType.GuildText },
            roles: { 'high-review-role': { id: 'high-review-role', managed: false, position: 10 } },
            botHighestRolePosition: 10
        });

        await communityStatus.execute(interaction);

        const gaps = interaction.editReplyPayload().embeds[0].toJSON().fields.find(field => field.name === 'Permission Gaps').value;
        expect(gaps).toContain("Suggestions: configured role is above or equal to the bot's highest role");
    });

    test('shows stateless community features as available without server configuration', async () => {
        const interaction = createInteraction({ guildRecord: { achievementsEnabled: true } });

        await communityStatus.execute(interaction);

        const fields = interaction.editReplyPayload().embeds[0].toJSON().fields;
        expect(fields.find(field => field.name === 'Reminders').value).toContain('Available');
        expect(fields.find(field => field.name === 'Bookmarks').value).toContain('Available');
        expect(fields.find(field => field.name === 'Games').value).toContain('Available');
    });
});
