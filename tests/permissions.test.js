const { checkUserPermissions } = require('../src/utils/permissions');
const { db } = require('../src/database');
const { commandPermissions } = require('../src/database/schema');
const { PermissionFlagsBits } = require('discord.js');

// Mock the database
jest.mock('../src/database', () => ({
    db: {
        select: jest.fn(),
        insert: jest.fn(),
        delete: jest.fn()
    }
}));

describe('RBAC Permission System', () => {
    beforeEach(() => {
        // Reset all mocks before each test
        jest.clearAllMocks();
    });

    describe('checkUserPermissions', () => {
        describe('Database Override Permissions', () => {
            test('should allow user with overridden role', async () => {
                // Mock database returning overrides
                const mockOverrides = [
                    { roleId: 'role123', commandName: 'testcommand', guildId: 'guild123' }
                ];

                db.select.mockReturnValue({
                    from: jest.fn().mockReturnValue({
                        where: jest.fn().mockResolvedValue(mockOverrides)
                    })
                });

                const mockInteraction = {
                    guild: { id: 'guild123' },
                    member: {
                        roles: {
                            cache: new Map([['role123', {}]])
                        },
                        permissions: {
                            has: jest.fn().mockReturnValue(false)
                        }
                    }
                };

                const mockCommand = {
                    data: { name: 'testcommand' },
                    permissions: []
                };

                const result = await checkUserPermissions(mockInteraction, mockCommand);

                expect(result.allowed).toBe(true);
                expect(result.error).toBeUndefined();
            });

            test('should deny user without overridden role', async () => {
                const mockOverrides = [
                    { roleId: 'role123', commandName: 'testcommand', guildId: 'guild123' }
                ];

                db.select.mockReturnValue({
                    from: jest.fn().mockReturnValue({
                        where: jest.fn().mockResolvedValue(mockOverrides)
                    })
                });

                const mockInteraction = {
                    guild: { id: 'guild123' },
                    member: {
                        roles: {
                            cache: new Map([['differentRole', {}]])
                        },
                        permissions: {
                            has: jest.fn().mockReturnValue(false)
                        }
                    }
                };

                const mockCommand = {
                    data: { name: 'testcommand' },
                    permissions: []
                };

                const result = await checkUserPermissions(mockInteraction, mockCommand);

                expect(result.allowed).toBe(false);
                expect(result.error).toBeDefined();
                expect(result.error.data.description).toContain('<@&role123>');
            });

            test('should allow Administrator even without overridden role', async () => {
                const mockOverrides = [
                    { roleId: 'role123', commandName: 'testcommand', guildId: 'guild123' }
                ];

                db.select.mockReturnValue({
                    from: jest.fn().mockReturnValue({
                        where: jest.fn().mockResolvedValue(mockOverrides)
                    })
                });

                const mockInteraction = {
                    guild: { id: 'guild123' },
                    member: {
                        roles: {
                            cache: new Map([['differentRole', {}]])
                        },
                        permissions: {
                            has: jest.fn().mockReturnValue(true) // Has Administrator
                        }
                    }
                };

                const mockCommand = {
                    data: { name: 'testcommand' },
                    permissions: []
                };

                const result = await checkUserPermissions(mockInteraction, mockCommand);

                expect(result.allowed).toBe(true);
                expect(mockInteraction.member.permissions.has).toHaveBeenCalledWith(PermissionFlagsBits.Administrator);
            });

            test('should handle multiple role overrides', async () => {
                const mockOverrides = [
                    { roleId: 'role123', commandName: 'testcommand', guildId: 'guild123' },
                    { roleId: 'role456', commandName: 'testcommand', guildId: 'guild123' },
                    { roleId: 'role789', commandName: 'testcommand', guildId: 'guild123' }
                ];

                db.select.mockReturnValue({
                    from: jest.fn().mockReturnValue({
                        where: jest.fn().mockResolvedValue(mockOverrides)
                    })
                });

                const mockInteraction = {
                    guild: { id: 'guild123' },
                    member: {
                        roles: {
                            cache: new Map([['role456', {}]]) // Has middle role
                        },
                        permissions: {
                            has: jest.fn().mockReturnValue(false)
                        }
                    }
                };

                const mockCommand = {
                    data: { name: 'testcommand' },
                    permissions: []
                };

                const result = await checkUserPermissions(mockInteraction, mockCommand);

                expect(result.allowed).toBe(true);
            });
        });

        describe('Default Code-Defined Permissions', () => {
            test('should allow user with required permissions when no overrides exist', async () => {
                // Mock database returning no overrides
                db.select.mockReturnValue({
                    from: jest.fn().mockReturnValue({
                        where: jest.fn().mockResolvedValue([])
                    })
                });

                const mockInteraction = {
                    guild: { id: 'guild123' },
                    member: {
                        permissions: {
                            has: jest.fn().mockReturnValue(true)
                        }
                    }
                };

                const mockCommand = {
                    data: { name: 'testcommand' },
                    permissions: [PermissionFlagsBits.ManageMessages]
                };

                const result = await checkUserPermissions(mockInteraction, mockCommand);

                expect(result.allowed).toBe(true);
                expect(mockInteraction.member.permissions.has).toHaveBeenCalledWith([PermissionFlagsBits.ManageMessages]);
            });

            test('should deny user without required permissions when no overrides exist', async () => {
                db.select.mockReturnValue({
                    from: jest.fn().mockReturnValue({
                        where: jest.fn().mockResolvedValue([])
                    })
                });

                const mockInteraction = {
                    guild: { id: 'guild123' },
                    member: {
                        permissions: {
                            has: jest.fn().mockReturnValue(false)
                        }
                    }
                };

                const mockCommand = {
                    data: { name: 'testcommand' },
                    permissions: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.KickMembers]
                };

                const result = await checkUserPermissions(mockInteraction, mockCommand);

                expect(result.allowed).toBe(false);
                expect(result.error).toBeDefined();
                expect(result.error.data.description).toContain('permissions');
            });

            test('should allow command with no permission requirements', async () => {
                db.select.mockReturnValue({
                    from: jest.fn().mockReturnValue({
                        where: jest.fn().mockResolvedValue([])
                    })
                });

                const mockInteraction = {
                    guild: { id: 'guild123' },
                    member: {
                        permissions: {
                            has: jest.fn().mockReturnValue(false)
                        }
                    }
                };

                const mockCommand = {
                    data: { name: 'testcommand' },
                    permissions: []
                };

                const result = await checkUserPermissions(mockInteraction, mockCommand);

                expect(result.allowed).toBe(true);
            });
        });

        describe('Override Priority', () => {
            test('should ignore code permissions when database overrides exist', async () => {
                const mockOverrides = [
                    { roleId: 'role123', commandName: 'testcommand', guildId: 'guild123' }
                ];

                db.select.mockReturnValue({
                    from: jest.fn().mockReturnValue({
                        where: jest.fn().mockResolvedValue(mockOverrides)
                    })
                });

                const mockInteraction = {
                    guild: { id: 'guild123' },
                    member: {
                        roles: {
                            cache: new Map([['role123', {}]])
                        },
                        permissions: {
                            has: jest.fn()
                                .mockReturnValueOnce(false) // Not Administrator
                        }
                    }
                };

                const mockCommand = {
                    data: { name: 'testcommand' },
                    permissions: [PermissionFlagsBits.BanMembers] // Code requires BanMembers
                };

                const result = await checkUserPermissions(mockInteraction, mockCommand);

                // Should be allowed even though user doesn't have BanMembers permission
                expect(result.allowed).toBe(true);
                // Should not check for BanMembers permission because overrides exist
                expect(mockInteraction.member.permissions.has).not.toHaveBeenCalledWith([PermissionFlagsBits.BanMembers]);
            });
        });

        describe('Edge Cases', () => {
            test('should handle empty permissions array in command', async () => {
                db.select.mockReturnValue({
                    from: jest.fn().mockReturnValue({
                        where: jest.fn().mockResolvedValue([])
                    })
                });

                const mockInteraction = {
                    guild: { id: 'guild123' },
                    member: {
                        permissions: {
                            has: jest.fn()
                        }
                    }
                };

                const mockCommand = {
                    data: { name: 'testcommand' },
                    permissions: []
                };

                const result = await checkUserPermissions(mockInteraction, mockCommand);

                expect(result.allowed).toBe(true);
            });

            test('should handle undefined permissions in command', async () => {
                db.select.mockReturnValue({
                    from: jest.fn().mockReturnValue({
                        where: jest.fn().mockResolvedValue([])
                    })
                });

                const mockInteraction = {
                    guild: { id: 'guild123' },
                    member: {
                        permissions: {
                            has: jest.fn()
                        }
                    }
                };

                const mockCommand = {
                    data: { name: 'testcommand' }
                    // No permissions property
                };

                const result = await checkUserPermissions(mockInteraction, mockCommand);

                expect(result.allowed).toBe(true);
            });

            test('should handle user with no roles', async () => {
                const mockOverrides = [
                    { roleId: 'role123', commandName: 'testcommand', guildId: 'guild123' }
                ];

                db.select.mockReturnValue({
                    from: jest.fn().mockReturnValue({
                        where: jest.fn().mockResolvedValue(mockOverrides)
                    })
                });

                const mockInteraction = {
                    guild: { id: 'guild123' },
                    member: {
                        roles: {
                            cache: new Map() // Empty roles
                        },
                        permissions: {
                            has: jest.fn().mockReturnValue(false)
                        }
                    }
                };

                const mockCommand = {
                    data: { name: 'testcommand' },
                    permissions: []
                };

                const result = await checkUserPermissions(mockInteraction, mockCommand);

                expect(result.allowed).toBe(false);
                expect(result.error).toBeDefined();
            });
        });
    });
});
