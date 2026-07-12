jest.mock('../src/database', () => ({ db: {} }));
jest.mock('../src/database/schema', () => ({
    activityStreaks: {},
    activityAchievements: {},
    activityLogs: {},
    achievementDefinitions: {},
    customAchievements: {},
    achievementRoleConfig: {},
    achievementRoles: {},
    guilds: {},
    users: {}
}));
jest.mock('drizzle-orm', () => ({
    eq: () => ({}),
    and: () => ({}),
    desc: () => ({})
}));
jest.mock('../src/utils/dbLogger', () => ({
    dbLog: { select: jest.fn() }
}));
jest.mock('../src/utils/logger', () => ({
    info: jest.fn(), success: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));
jest.mock('../src/utils/ephemeralHelper', () => ({ shouldBeEphemeral: jest.fn(async () => true) }));
jest.mock('../src/utils/discordApiUtil', () => ({
    fetchMember: jest.fn(), RoleManager: { addRole: jest.fn(), removeRole: jest.fn() }
}));

const ActivityStreakService = require('../src/services/activityStreakService');
const streakCommand = require('../src/commands/utility/streak');
const { ACHIEVEMENT_CHAINS } = require('../src/data/achievementDefinitions');
const { dbLog } = require('../src/utils/dbLogger');

describe('Achievement chain progress', () => {
    function buildService(definitions) {
        const service = new ActivityStreakService({});
        service.achievementManager = {
            getById: jest.fn(async id => definitions[id] || null)
        };
        return service;
    }

    beforeEach(() => jest.clearAllMocks());

    test('derives an incomplete chain and its next step from durable achievement rows', async () => {
        const chain = ACHIEVEMENT_CHAINS.find(definition => definition.id === 'message_milestones');
        const definitions = Object.fromEntries(chain.steps.map((step, index) => [
            step.achievementId,
            { id: step.achievementId, title: `Message ${index + 1}`, emoji: '💬' }
        ]));
        const service = buildService(definitions);
        dbLog.select.mockResolvedValueOnce([
            { achievementId: chain.steps[0].achievementId },
            { achievementId: chain.steps[1].achievementId }
        ]);

        const [progress] = await service.getAchievementChainProgress('user-1', 'guild-1', [chain]);

        expect(progress).toMatchObject({
            id: 'message_milestones',
            completedSteps: 2,
            totalSteps: chain.steps.length,
            complete: false,
            nextStep: {
                achievementId: chain.steps[2].achievementId,
                title: 'Message 3'
            }
        });
        expect(progress.steps.map(step => step.complete)).toEqual([
            true, true, ...Array(chain.steps.length - 2).fill(false)
        ]);
    });

    test('reports a completed chain and remains stable across repeated reads without writing state', async () => {
        const chain = ACHIEVEMENT_CHAINS.find(definition => definition.id === 'voice_milestones');
        const definitions = Object.fromEntries(chain.steps.map((step, index) => [
            step.achievementId,
            { id: step.achievementId, title: `Voice ${index + 1}`, emoji: '🎤' }
        ]));
        const service = buildService(definitions);
        const rows = chain.steps.map(step => ({ achievementId: step.achievementId }));
        dbLog.select.mockResolvedValue(rows);

        const first = await service.getAchievementChainProgress('user-1', 'guild-1', [chain]);
        const second = await service.getAchievementChainProgress('user-1', 'guild-1', [chain]);

        expect(first).toEqual(second);
        expect(first[0]).toMatchObject({
            completedSteps: chain.steps.length,
            totalSteps: chain.steps.length,
            complete: true,
            nextStep: null
        });
        expect(dbLog.select).toHaveBeenCalledTimes(2);
    });

    test('renders chain progress at the public /streak progress interaction seam', async () => {
        const editReply = jest.fn();
        const interaction = {
            user: { id: 'user-1', username: 'Member', displayAvatarURL: () => 'https://example.com/avatar.png' },
            guild: { id: 'guild-1' },
            options: {
                getSubcommand: () => 'progress',
                getUser: () => null,
                getBoolean: () => null
            },
            deferReply: jest.fn(),
            editReply
        };
        const chainProgress = [{
            id: 'message_milestones',
            title: 'Message Milestones',
            emoji: '💬',
            completedSteps: 2,
            totalSteps: 8,
            complete: false,
            nextStep: { title: 'Chatterbox', emoji: '💬', available: true }
        }, {
            id: 'voice_milestones',
            title: 'Voice Milestones',
            emoji: '🎤',
            completedSteps: 8,
            totalSteps: 8,
            complete: true,
            nextStep: null
        }];
        const client = {
            activityStreakService: {
                getUserStreak: jest.fn(async () => ({ currentStreak: 1, totalActiveDays: 1, achievements: [] })),
                getUserTotals: jest.fn(async () => ({ totalMessages: 1, totalVoiceMinutes: 0 })),
                getAchievementChainProgress: jest.fn(async () => chainProgress)
            }
        };

        await streakCommand.execute(interaction, client);

        expect(client.activityStreakService.getAchievementChainProgress).toHaveBeenCalledWith('user-1', 'guild-1');
        expect(require('../src/utils/logger').error).not.toHaveBeenCalled();
        const embed = editReply.mock.calls[0][0].embeds[0].toJSON();
        const chains = embed.fields.find(field => field.name === '🏆 Achievement Chains');
        expect(chains.value).toContain('💬 **Message Milestones** — 2/8');
        expect(chains.value).toContain('Next: 💬 **Chatterbox**');
        expect(chains.value).toContain('🎤 **Voice Milestones** — 8/8');
        expect(chains.value).toContain('✅ Complete');
    });

    test('renders durable chain progress even when streak and totals rows are absent', async () => {
        const editReply = jest.fn();
        const interaction = {
            user: { id: 'user-1', username: 'Member', displayAvatarURL: () => 'https://example.com/avatar.png' },
            guild: { id: 'guild-1' },
            options: {
                getSubcommand: () => 'progress',
                getUser: () => null,
                getBoolean: () => null
            },
            deferReply: jest.fn(),
            editReply
        };
        const client = {
            activityStreakService: {
                getUserStreak: jest.fn(async () => null),
                getUserTotals: jest.fn(async () => null),
                getAchievementChainProgress: jest.fn(async () => [{
                    id: 'message_milestones',
                    title: 'Message Milestones',
                    emoji: '💬',
                    completedSteps: 2,
                    totalSteps: 8,
                    complete: false,
                    nextStep: { title: 'Chatterbox', emoji: '💬' }
                }])
            }
        };

        await streakCommand.execute(interaction, client);

        expect(client.activityStreakService.getAchievementChainProgress).toHaveBeenCalledWith('user-1', 'guild-1');
        const embed = editReply.mock.calls[0][0].embeds[0].toJSON();
        expect(embed.description).toBe('No activity data yet. Start your journey!');
        const chains = embed.fields.find(field => field.name === '🏆 Achievement Chains');
        expect(chains.value).toContain('💬 **Message Milestones** — 2/8');
    });

    test('skips malformed chains and missing achievement definitions safely', async () => {
        const service = buildService({ known: { id: 'known', title: 'Known', emoji: '✅' } });
        dbLog.select.mockResolvedValue([{ achievementId: 'known' }]);

        const progress = await service.getAchievementChainProgress('user-1', 'guild-1', [
            { id: 'invalid_empty', title: 'Invalid', steps: [] },
            { id: 'invalid_missing_id', title: 'Invalid', steps: [{}] },
            {
                id: 'safe_partial',
                title: 'Safe',
                steps: [{ achievementId: 'known' }, { achievementId: 'missing' }]
            }
        ]);

        expect(progress).toEqual([expect.objectContaining({
            id: 'safe_partial',
            completedSteps: 1,
            totalSteps: 2,
            complete: false,
            nextStep: expect.objectContaining({ achievementId: 'missing', available: false }),
            steps: [
                expect.objectContaining({ achievementId: 'known', complete: true, available: true }),
                expect.objectContaining({ achievementId: 'missing', complete: false, available: false })
            ]
        })]);
    });
});
