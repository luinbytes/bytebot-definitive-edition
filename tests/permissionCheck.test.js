const { checkBotPermissions } = require('../src/utils/permissionCheck');
const { PermissionFlagsBits } = require('discord.js');

// Mock logger
jest.mock('../src/utils/logger', () => ({
    warn: jest.fn(),
    error: jest.fn()
}));

describe('BytePod Permission Check', () => {
    let mockGuild;
    let mockBotMember;
    let mockTriggerMember;

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup mock bot member
        mockBotMember = {
            permissions: {
                has: jest.fn()
            }
        };

        // Setup mock trigger member (user who triggered the action)
        mockTriggerMember = {
            id: 'user123',
            send: jest.fn().mockResolvedValue()
        };

        // Setup mock guild
        mockGuild = {
            id: 'guild123',
            name: 'Test Guild',
            ownerId: 'owner456',
            members: {
                cache: {
                    get: jest.fn().mockReturnValue(mockBotMember)
                }
            },
            client: {
                user: {
                    id: 'bot123'
                }
            },
            fetchOwner: jest.fn().mockResolvedValue({
                send: jest.fn().mockResolvedValue()
            })
        };
    });

    describe('Required Permissions', () => {
        test('should return true when bot has all required permissions', async () => {
            mockBotMember.permissions.has.mockReturnValue(true);

            const result = await checkBotPermissions(mockGuild, mockTriggerMember);

            expect(result).toBe(true);
            expect(mockBotMember.permissions.has).toHaveBeenCalledWith(PermissionFlagsBits.ManageChannels);
            expect(mockBotMember.permissions.has).toHaveBeenCalledWith(PermissionFlagsBits.MoveMembers);
            expect(mockBotMember.permissions.has).toHaveBeenCalledWith(PermissionFlagsBits.Connect);
        });

        test('should return false when missing ManageChannels permission', async () => {
            mockBotMember.permissions.has.mockImplementation((perm) => {
                return perm !== PermissionFlagsBits.ManageChannels;
            });

            const result = await checkBotPermissions(mockGuild, mockTriggerMember);

            expect(result).toBe(false);
        });

        test('should return false when missing MoveMembers permission', async () => {
            mockBotMember.permissions.has.mockImplementation((perm) => {
                return perm !== PermissionFlagsBits.MoveMembers;
            });

            const result = await checkBotPermissions(mockGuild, mockTriggerMember);

            expect(result).toBe(false);
        });

        test('should return false when missing Connect permission', async () => {
            mockBotMember.permissions.has.mockImplementation((perm) => {
                return perm !== PermissionFlagsBits.Connect;
            });

            const result = await checkBotPermissions(mockGuild, mockTriggerMember);

            expect(result).toBe(false);
        });

        test('should return false when missing multiple permissions', async () => {
            mockBotMember.permissions.has.mockReturnValue(false);

            const result = await checkBotPermissions(mockGuild, mockTriggerMember);

            expect(result).toBe(false);
        });
    });

    describe('User Notifications', () => {
        test('should notify trigger member when permissions are missing', async () => {
            mockBotMember.permissions.has.mockReturnValue(false);

            await checkBotPermissions(mockGuild, mockTriggerMember);

            expect(mockTriggerMember.send).toHaveBeenCalled();
            const embedData = mockTriggerMember.send.mock.calls[0][0].embeds[0].data;
            expect(embedData.title).toContain('Missing Permissions');
        });

        test('should handle user DM failure gracefully', async () => {
            mockBotMember.permissions.has.mockReturnValue(false);
            mockTriggerMember.send.mockRejectedValue(new Error('Cannot send DM'));

            // Should not throw
            await expect(
                checkBotPermissions(mockGuild, mockTriggerMember)
            ).resolves.toBe(false);
        });

        test('should not notify when permissions are valid', async () => {
            mockBotMember.permissions.has.mockReturnValue(true);

            await checkBotPermissions(mockGuild, mockTriggerMember);

            expect(mockTriggerMember.send).not.toHaveBeenCalled();
        });

        test('should work without trigger member provided', async () => {
            mockBotMember.permissions.has.mockReturnValue(false);

            // Should not throw
            await expect(
                checkBotPermissions(mockGuild, null)
            ).resolves.toBe(false);
        });
    });

    describe('Owner Notifications', () => {
        test('should notify guild owner when permissions are missing', async () => {
            mockBotMember.permissions.has.mockReturnValue(false);
            mockTriggerMember.id = 'differentUser'; // Not the owner

            await checkBotPermissions(mockGuild, mockTriggerMember);

            expect(mockGuild.fetchOwner).toHaveBeenCalled();
        });

        test('should not notify owner if trigger member is the owner', async () => {
            mockBotMember.permissions.has.mockReturnValue(false);
            mockTriggerMember.id = mockGuild.ownerId; // Same as owner

            await checkBotPermissions(mockGuild, mockTriggerMember);

            expect(mockGuild.fetchOwner).not.toHaveBeenCalled();
        });

        test('should handle owner notification failure gracefully', async () => {
            mockBotMember.permissions.has.mockReturnValue(false);
            mockGuild.fetchOwner.mockRejectedValue(new Error('Cannot fetch owner'));

            // Should not throw
            await expect(
                checkBotPermissions(mockGuild, mockTriggerMember)
            ).resolves.toBe(false);
        });

        test('should handle owner DM failure gracefully', async () => {
            mockBotMember.permissions.has.mockReturnValue(false);
            const mockOwner = {
                send: jest.fn().mockRejectedValue(new Error('Cannot send DM'))
            };
            mockGuild.fetchOwner.mockResolvedValue(mockOwner);

            // Should not throw
            await expect(
                checkBotPermissions(mockGuild, mockTriggerMember)
            ).resolves.toBe(false);
        });

        test('owner notification should include guild name', async () => {
            mockBotMember.permissions.has.mockReturnValue(false);
            const mockOwner = {
                send: jest.fn().mockResolvedValue()
            };
            mockGuild.fetchOwner.mockResolvedValue(mockOwner);

            await checkBotPermissions(mockGuild, mockTriggerMember);

            expect(mockOwner.send).toHaveBeenCalled();
            const notification = mockOwner.send.mock.calls[0][0];
            expect(notification.content).toContain(mockGuild.name);
        });
    });

    describe('Edge Cases', () => {
        test('should return false when bot member not found', async () => {
            mockGuild.members.cache.get.mockReturnValue(null);

            const result = await checkBotPermissions(mockGuild, mockTriggerMember);

            expect(result).toBe(false);
        });

        test('should handle undefined bot member', async () => {
            mockGuild.members.cache.get.mockReturnValue(undefined);

            const result = await checkBotPermissions(mockGuild, mockTriggerMember);

            expect(result).toBe(false);
        });

        test('should list all missing permissions in notification', async () => {
            mockBotMember.permissions.has.mockReturnValue(false);

            await checkBotPermissions(mockGuild, mockTriggerMember);

            const embedData = mockTriggerMember.send.mock.calls[0][0].embeds[0].data;
            expect(embedData.description).toContain('Manage Channels');
            expect(embedData.description).toContain('Move Members');
            expect(embedData.description).toContain('Connect');
        });

        test('should list only missing permissions when some are granted', async () => {
            mockBotMember.permissions.has.mockImplementation((perm) => {
                return perm === PermissionFlagsBits.Connect; // Only Connect granted
            });

            await checkBotPermissions(mockGuild, mockTriggerMember);

            const embedData = mockTriggerMember.send.mock.calls[0][0].embeds[0].data;
            expect(embedData.description).toContain('Manage Channels');
            expect(embedData.description).toContain('Move Members');
            expect(embedData.description).not.toContain('Connect');
        });
    });

    describe('Permission Name Formatting', () => {
        test('should format permission names with spaces', async () => {
            mockBotMember.permissions.has.mockImplementation((perm) => {
                return perm !== PermissionFlagsBits.ManageChannels;
            });

            await checkBotPermissions(mockGuild, mockTriggerMember);

            const embedData = mockTriggerMember.send.mock.calls[0][0].embeds[0].data;
            // Should have space before capital letters
            expect(embedData.description).toMatch(/Manage\s+Channels/);
        });
    });
});
