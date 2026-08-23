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
        jest.resetAllMocks();
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
            test('should prefer the deepest command-path override over the root override', async () => {
                const mockOverrides = [
                    { roleId: 'rootRole', commandName: 'fun', guildId: 'guild123' },
                    { roleId: 'uwuRole', commandName: 'fun uwulock add', guildId: 'guild123' }
                ];

                db.select.mockReturnValue({
                    from: jest.fn().mockReturnValue({
                        where: jest.fn().mockResolvedValue(mockOverrides)
                    })
                });

                const mockInteraction = {
                    guild: { id: 'guild123' },
                    options: {
                        getSubcommandGroup: jest.fn().mockReturnValue('uwulock'),
                        getSubcommand: jest.fn().mockReturnValue('add')
                    },
                    member: {
                        roles: {
                            cache: new Map([['rootRole', {}]])
                        },
                        permissions: {
                            has: jest.fn().mockReturnValue(false)
                        }
                    }
                };

                const result = await checkUserPermissions(mockInteraction, {
                    data: { name: 'fun' },
                    permissions: []
                });

                expect(result.allowed).toBe(false);
                expect(result.error.data.description).toContain('<@&uwuRole>');
                expect(result.error.data.description).not.toContain('<@&rootRole>');
            });

            test('should fall back to the root override for a command path', async () => {
                db.select.mockReturnValue({
                    from: jest.fn().mockReturnValue({
                        where: jest.fn().mockResolvedValue([
                            { roleId: 'rootRole', commandName: 'fun', guildId: 'guild123' }
                        ])
                    })
                });

                const mockInteraction = {
                    guild: { id: 'guild123' },
                    options: {
                        getSubcommandGroup: jest.fn().mockReturnValue('uwulock'),
                        getSubcommand: jest.fn().mockReturnValue('add')
                    },
                    member: {
                        roles: { cache: new Map([['rootRole', {}]]) },
                        permissions: { has: jest.fn().mockReturnValue(false) }
                    }
                };

                const result = await checkUserPermissions(mockInteraction, {
                    data: { name: 'fun' },
                    permissions: []
                });

                expect(result.allowed).toBe(true);
            });

            test('database role access never replaces required Discord permissions', async () => {
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

                expect(result.allowed).toBe(false);
                expect(mockInteraction.member.permissions.has).toHaveBeenCalledWith([PermissionFlagsBits.BanMembers]);
            });
        });

        describe('Scoped access rules', () => {
            test('a matching channel deny blocks the command', async () => {
                const accessRules = [{
                    commandPath: 'mod user ban',
                    effect: 'deny',
                    scopeType: 'channel',
                    scopeId: 'channel1'
                }];
                db.select
                    .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(accessRules) }) })
                    .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) });

                const result = await checkUserPermissions({
                    commandName: 'mod',
                    channelId: 'channel1',
                    guild: { id: 'guild123' },
                    user: { id: 'user1' },
                    options: {
                        getSubcommandGroup: jest.fn().mockReturnValue('user'),
                        getSubcommand: jest.fn().mockReturnValue('ban')
                    },
                    member: {
                        roles: { cache: new Map() },
                        permissions: { has: jest.fn().mockReturnValue(false) }
                    }
                }, { data: { name: 'mod' }, permissions: [] });

                expect(result.allowed).toBe(false);
                expect(result.error.data.description).toContain('disabled for you here');
            });

            test('an allow rule admits only a matching member', async () => {
                const accessRules = [{
                    commandPath: 'fun',
                    effect: 'allow',
                    scopeType: 'member',
                    scopeId: 'user1'
                }];
                db.select
                    .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(accessRules) }) })
                    .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) });

                const result = await checkUserPermissions({
                    commandName: 'fun',
                    channelId: 'channel1',
                    guild: { id: 'guild123' },
                    user: { id: 'user2' },
                    member: {
                        id: 'user2',
                        roles: { cache: new Map() },
                        permissions: { has: jest.fn().mockReturnValue(false) }
                    }
                }, { data: { name: 'fun' }, permissions: [] });

                expect(result.allowed).toBe(false);
            });
        });

        test('fake role permissions satisfy only explicitly virtual command checks', async () => {
            db.select
                .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) })
                .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) });
            const interaction = {
                commandName: 'community-status',
                guild: { id: 'guild123' },
                user: { id: 'user1' },
                member: {
                    id: 'user1',
                    roles: { cache: new Map([['role1', {}]]) },
                    permissions: { has: jest.fn().mockReturnValue(false) }
                }
            };

            const command = {
                data: { name: 'community-status' },
                virtualPermissions: [PermissionFlagsBits.Administrator]
            };

            expect((await checkUserPermissions(interaction, command)).allowed).toBe(false);

            db.select.mockReset();
            db.select
                .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) })
                .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([
                    { roleId: 'role1', permission: 'Administrator' }
                ]) }) })
                .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) });

            expect((await checkUserPermissions(interaction, command)).allowed).toBe(true);
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
