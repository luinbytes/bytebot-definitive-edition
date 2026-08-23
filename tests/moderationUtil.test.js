/**
 * Moderation Utility Tests
 * Tests centralized moderation functions
 */

const { PermissionFlagsBits } = require('discord.js');
const { logModerationAction, notifyUser, validateHierarchy, executeModerationAction } = require('../src/utils/moderationUtil');

jest.mock('../src/services/moderationService', () => ({ recordCompletedCase: jest.fn() }));

// Mock database
jest.mock('../src/database', () => ({
    db: {
        insert: jest.fn().mockReturnValue({
            values: jest.fn().mockResolvedValue({})
        })
    },
    sqlite: {
        prepare: jest.fn().mockReturnValue({
            get: jest.fn().mockReturnValue(undefined),
            all: jest.fn().mockReturnValue([])
        })
    }
}));

// Mock logger
jest.mock('../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

// Mock embeds
jest.mock('../src/utils/embeds', () => ({
    warn: jest.fn(() => ({ data: { title: 'Warning' } })),
    error: jest.fn(() => ({ data: { title: 'Error' } }))
}));

// Mock error handler
jest.mock('../src/utils/errorHandlerUtil', () => ({
    handleDMError: jest.fn()
}));

const { recordCompletedCase } = require('../src/services/moderationService');
const logger = require('../src/utils/logger');

describe('Moderation Utility', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('logModerationAction', () => {
        test('should log moderation action to database', async () => {
            await logModerationAction('guild123', 'user456', 'mod789', 'WARN', 'Test reason');

            expect(recordCompletedCase).toHaveBeenCalled();
            expect(logger.info).toHaveBeenCalled();
        });

        test('should include all required fields', async () => {
            await logModerationAction('guild123', 'user456', 'mod789', 'BAN', 'Spam');

            expect(recordCompletedCase).toHaveBeenCalledWith(
                expect.objectContaining({
                    guildId: 'guild123',
                    targetId: 'user456',
                    executorId: 'mod789',
                    action: 'BAN',
                    reason: 'Spam'
                })
            );
        });
    });

    describe('notifyUser', () => {
        test('should send DM for valid action types', async () => {
            const mockUser = {
                send: jest.fn().mockResolvedValue({}),
                tag: 'TestUser#1234'
            };

            const result = await notifyUser(mockUser, 'warn', 'Test Guild', 'Test reason', 'Mod#5678');

            expect(mockUser.send).toHaveBeenCalled();
            expect(result).toBe(true);
        });

        test('should handle DM failures gracefully', async () => {
            const mockUser = {
                send: jest.fn().mockRejectedValue(new Error('Cannot send DM')),
                tag: 'TestUser#1234',
                id: '123'
            };

            const result = await notifyUser(mockUser, 'warn', 'Test Guild', 'Test reason', 'Mod#5678');

            expect(result).toBe(false);
        });

        test('should support all action types (warn, kick, ban)', async () => {
            const mockUser = {
                send: jest.fn().mockResolvedValue({}),
                tag: 'TestUser#1234'
            };

            await notifyUser(mockUser, 'warn', 'Guild', 'Reason', 'Mod');
            await notifyUser(mockUser, 'kick', 'Guild', 'Reason', 'Mod');
            await notifyUser(mockUser, 'ban', 'Guild', 'Reason', 'Mod');

            expect(mockUser.send).toHaveBeenCalledTimes(3);
        });

        test('should handle unknown action types', async () => {
            const mockUser = {
                send: jest.fn().mockResolvedValue({}),
                tag: 'TestUser#1234'
            };

            const result = await notifyUser(mockUser, 'invalid_action', 'Guild', 'Reason', 'Mod');

            expect(result).toBe(false);
            expect(logger.error).toHaveBeenCalled();
        });
    });

    describe('validateHierarchy', () => {
        test('should reject self-moderation', () => {
            const mockMember = {
                id: '123',
                user: { bot: false },
                guild: { ownerId: '999' },
                roles: { highest: { position: 5 } },
                permissions: { has: () => false }
            };

            const result = validateHierarchy(mockMember, mockMember);

            expect(result.valid).toBe(false);
            expect(result.error).toContain('yourself');
        });

        test('should reject bot moderation by non-admins', () => {
            const executor = {
                id: '123',
                user: { bot: false },
                guild: { ownerId: '999' },
                roles: { highest: { position: 10 } },
                permissions: { has: () => false }
            };

            const target = {
                id: '456',
                user: { bot: true },
                guild: { ownerId: '999' },
                roles: { highest: { position: 5 } },
                permissions: { has: () => false }
            };

            const result = validateHierarchy(executor, target);

            expect(result.valid).toBe(false);
            expect(result.error).toContain('bot');
        });

        test('should allow bot moderation by admins', () => {
            const guild = {
                ownerId: '999',
                members: { me: { roles: { highest: { position: 20 } } } }
            };
            const executor = {
                id: '123',
                user: { bot: false },
                guild,
                roles: { highest: { position: 10 } },
                permissions: { has: (perm) => perm === PermissionFlagsBits.Administrator }
            };

            const target = {
                id: '456',
                user: { bot: true },
                guild,
                roles: { cache: new Map(), highest: { position: 5 } },
                permissions: { has: () => false }
            };

            const result = validateHierarchy(executor, target);

            expect(result.valid).toBe(true);
        });

        test('should reject targets above the bot even when the executor is an admin', () => {
            const guild = {
                ownerId: '999',
                members: { me: { roles: { highest: { position: 4 } } } }
            };
            const executor = {
                id: '123', user: { bot: false }, guild,
                roles: { highest: { position: 20 } },
                permissions: { has: perm => perm === PermissionFlagsBits.Administrator }
            };
            const target = {
                id: '456', user: { bot: false }, guild,
                roles: { cache: new Map(), highest: { position: 5 } }
            };

            expect(validateHierarchy(executor, target)).toEqual({
                valid: false,
                error: 'I cannot moderate this user. They have a higher or equal role than me.'
            });
        });

        test('should reject guild owner moderation', () => {
            const executor = {
                id: '123',
                user: { bot: false },
                guild: { ownerId: '456' },
                roles: { highest: { position: 10 } },
                permissions: { has: () => false }
            };

            const target = {
                id: '456',
                user: { bot: false },
                guild: { ownerId: '456' },
                roles: { highest: { position: 100 } },
                permissions: { has: () => false }
            };

            const result = validateHierarchy(executor, target);

            expect(result.valid).toBe(false);
            expect(result.error).toContain('owner');
        });

        test('should reject moderation of higher role users', () => {
            const executor = {
                id: '123',
                user: { bot: false },
                guild: { ownerId: '999' },
                roles: { highest: { position: 5 } },
                permissions: { has: () => false }
            };

            const target = {
                id: '456',
                user: { bot: false },
                guild: { ownerId: '999' },
                roles: { highest: { position: 10 } },
                permissions: { has: () => false }
            };

            const result = validateHierarchy(executor, target);

            expect(result.valid).toBe(false);
            expect(result.error).toContain('higher');
        });

        test('should allow moderation with proper hierarchy', () => {
            const executor = {
                id: '123',
                user: { bot: false },
                guild: {
                    ownerId: '999',
                    members: {
                        me: {
                            roles: { highest: { position: 20 } }
                        }
                    }
                },
                roles: { highest: { position: 10 } },
                permissions: { has: () => false }
            };

            const target = {
                id: '456',
                user: { bot: false },
                guild: {
                    ownerId: '999',
                    members: {
                        me: {
                            roles: { highest: { position: 20 } }
                        }
                    }
                },
                roles: { highest: { position: 5 } },
                permissions: { has: () => false }
            };

            const result = validateHierarchy(executor, target);

            expect(result.valid).toBe(true);
        });
    });

    describe('executeModerationAction', () => {
        test('does not log or notify when the Discord action fails', async () => {
            const mockUser = {
                send: jest.fn().mockResolvedValue({}),
                tag: 'Target#1234',
                id: '456'
            };
            const mockExecutor = {
                id: '789',
                user: { tag: 'Mod#5678' }
            };
            const perform = jest.fn().mockRejectedValue(new Error('Discord rejected action'));

            await expect(executeModerationAction({
                guildId: 'guild123',
                guildName: 'Test Guild',
                target: mockUser,
                executor: mockExecutor,
                action: 'BAN',
                reason: 'Test reason',
                perform
            })).rejects.toThrow('Discord rejected action');

            expect(recordCompletedCase).not.toHaveBeenCalled();
            expect(mockUser.send).not.toHaveBeenCalled();
        });

        test('should log and notify by default', async () => {
            const mockUser = {
                send: jest.fn().mockResolvedValue({}),
                tag: 'Target#1234',
                id: '456'
            };

            const mockExecutor = {
                id: '789',
                user: { tag: 'Mod#5678' }
            };

            await executeModerationAction({
                guildId: 'guild123',
                guildName: 'Test Guild',
                target: mockUser,
                executor: mockExecutor,
                action: 'WARN',
                reason: 'Test reason'
            });

            expect(recordCompletedCase).toHaveBeenCalled();
            expect(mockUser.send).toHaveBeenCalled();
        });

        test('should respect notify=false option', async () => {
            const mockUser = {
                send: jest.fn().mockResolvedValue({}),
                tag: 'Target#1234',
                id: '456'
            };

            const mockExecutor = {
                id: '789',
                user: { tag: 'Mod#5678' }
            };

            await executeModerationAction({
                guildId: 'guild123',
                guildName: 'Test Guild',
                target: mockUser,
                executor: mockExecutor,
                action: 'WARN',
                reason: 'Test reason',
                notify: false
            });

            expect(recordCompletedCase).toHaveBeenCalled();
            expect(mockUser.send).not.toHaveBeenCalled();
        });
    });
});
