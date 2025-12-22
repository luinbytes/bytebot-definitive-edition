const { ApplicationCommandType } = require('discord.js');

describe('User Context Menus', () => {
    const contextMenuFiles = [
        'avatar',
        'userinfo',
        'copyid',
        'modactions'
    ];

    contextMenuFiles.forEach(filename => {
        describe(`${filename} context menu`, () => {
            let contextMenu;

            beforeAll(() => {
                contextMenu = require(`../src/commands/context-menus/${filename}`);
            });

            test('should have proper structure', () => {
                expect(contextMenu.data).toBeDefined();
                expect(contextMenu.execute).toBeDefined();
                expect(typeof contextMenu.execute).toBe('function');
            });

            test('should be a user context menu', () => {
                expect(contextMenu.data.type).toBe(ApplicationCommandType.User);
            });

            test('should have a valid name', () => {
                expect(contextMenu.data.name).toBeDefined();
                expect(contextMenu.data.name.length).toBeGreaterThan(0);
                expect(contextMenu.data.name.length).toBeLessThanOrEqual(32);
            });

            test('should have cooldown configured', () => {
                expect(contextMenu.cooldown).toBeDefined();
                expect(typeof contextMenu.cooldown).toBe('number');
                expect(contextMenu.cooldown).toBeGreaterThan(0);
            });
        });
    });

    describe('modactions context menu', () => {
        let modactions;

        beforeAll(() => {
            modactions = require('../src/commands/context-menus/modactions');
        });

        test('should have button handler', () => {
            expect(modactions.handleButton).toBeDefined();
            expect(typeof modactions.handleButton).toBe('function');
        });

        test('should have modal handler', () => {
            expect(modactions.handleModal).toBeDefined();
            expect(typeof modactions.handleModal).toBe('function');
        });

        test('should require ManageMessages permission', () => {
            expect(modactions.permissions).toBeDefined();
            expect(modactions.permissions.length).toBeGreaterThan(0);
        });

        test('should be guild-only', () => {
            expect(modactions.data.dm_permission).toBe(false);
        });
    });

    describe('avatar context menu', () => {
        let avatar;

        beforeAll(() => {
            avatar = require('../src/commands/context-menus/avatar');
        });

        test('should allow DM usage', () => {
            expect(avatar.data.dm_permission).not.toBe(false);
        });
    });

    describe('copyid context menu', () => {
        let copyid;

        beforeAll(() => {
            copyid = require('../src/commands/context-menus/copyid');
        });

        test('should allow DM usage', () => {
            expect(copyid.data.dm_permission).not.toBe(false);
        });

        test('should have short cooldown', () => {
            expect(copyid.cooldown).toBe(1); // Quick action
        });
    });

    describe('userinfo context menu', () => {
        let userinfo;

        beforeAll(() => {
            userinfo = require('../src/commands/context-menus/userinfo');
        });

        test('should allow DM usage', () => {
            expect(userinfo.data.dm_permission).not.toBe(false);
        });

        test('should use longRunning flag', () => {
            expect(userinfo.longRunning).toBe(true);
        });
    });
});

describe('Message Context Menus', () => {
    describe('bookmark context menu', () => {
        let bookmark;

        beforeAll(() => {
            bookmark = require('../src/commands/context-menus/bookmark');
        });

        test('should have proper structure', () => {
            expect(bookmark.data).toBeDefined();
            expect(bookmark.execute).toBeDefined();
            expect(typeof bookmark.execute).toBe('function');
        });

        test('should be a message context menu', () => {
            expect(bookmark.data.type).toBe(ApplicationCommandType.Message);
        });

        test('should have correct name', () => {
            expect(bookmark.data.name).toBe('Bookmark Message');
        });

        test('should allow DM usage', () => {
            expect(bookmark.data.dm_permission).not.toBe(false);
        });

        test('should use longRunning flag', () => {
            expect(bookmark.longRunning).toBe(true);
        });
    });
});
