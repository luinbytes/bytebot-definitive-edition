const { glob } = require('glob');
const path = require('path');

describe('Command Structural Integrity', () => {
    let commandFiles;

    beforeAll(async () => {
        commandFiles = await glob('src/commands/**/*.js');
    });

    test('should have at least one command', () => {
        expect(commandFiles.length).toBeGreaterThan(0);
    });

    test('every command should have mandatory properties', () => {
        commandFiles.forEach((file) => {
            const command = require(path.resolve(file));

            // Check for 'data' property
            expect(command).toHaveProperty('data');
            expect(command.data).toHaveProperty('name');

            // Context menus (type 2 or 3) don't have descriptions
            // Slash commands (type 1 or undefined) do have descriptions
            const isContextMenu = command.data.type === 2 || command.data.type === 3;
            if (!isContextMenu) {
                expect(command.data).toHaveProperty('description');
            }

            // Check for 'execute' function
            expect(command).toHaveProperty('execute');
            expect(typeof command.execute).toBe('function');

            // Optional but recommended: cooldown check if it exists
            if (command.cooldown) {
                expect(typeof command.cooldown).toBe('number');
            }
        });
    });
});

describe('Grouped Slash Command Appearance', () => {
    function getCommand(commandPath) {
        return require(path.resolve(commandPath)).data.toJSON();
    }

    function optionNames(options = []) {
        return options.map(option => option.name);
    }

    function expectGroups(commandPath, expectedGroups) {
        const command = getCommand(commandPath);
        const groups = command.options.filter(option => option.type === 2);
        const actual = Object.fromEntries(groups.map(group => [
            group.name,
            optionNames(group.options)
        ]));

        expect(actual).toEqual(expectedGroups);
        expect(command.options.every(option => option.type === 2)).toBe(true);
    }

    test('utility commands with several actions are grouped by intent', () => {
        expectGroups('src/commands/utility/reminder.js', {
            create: ['me', 'here'],
            manage: ['list', 'cancel']
        });

        expectGroups('src/commands/utility/bookmark.js', {
            browse: ['list', 'search', 'view'],
            manage: ['delete', 'clear']
        });
    });

    test('administration commands are grouped by setup and review task', () => {
        expectGroups('src/commands/administration/welcome.js', {
            configure: ['channel', 'message', 'enabled', 'format'],
            preview: ['variables', 'test', 'view']
        });

        expectGroups('src/commands/administration/autorespond.js', {
            manage: ['add', 'edit', 'remove', 'toggle'],
            browse: ['list']
        });
    });

    test('moderation command uses intent groups instead of a flat action list', () => {
        expectGroups('src/commands/moderation/mod.js', {
            user: [
                'ban', 'kick', 'timeout', 'untimeout', 'softban', 'hardban', 'unban',
                'imute', 'iunmute', 'rmute', 'runmute', 'jail', 'unjail', 'warn',
                'unwarn', 'warn-clear', 'strip', 'staffstrip', 'nickname', 'nickname-remove',
                'nickname-force', 'nickname-unforce', 'history'
            ],
            status: ['hardbans', 'jailed', 'image-muted', 'reaction-muted', 'timeouts', 'warnings'],
            bulk: ['unban-all', 'untimeout-all', 'unjail-all'],
            logs: ['recent', 'by-moderator', 'audit'],
            channel: [
                'clear', 'lock', 'unlock', 'cleanup', 'selfpurge', 'purge', 'lockdown', 'unlockdown',
                'lockdown-all', 'unlockdown-all', 'lockdown-role', 'lockdown-ignore',
                'lockdown-unignore', 'lockdown-ignored', 'slowmode', 'slowmode-disable',
                'topic', 'topic-remove', 'nsfw'
            ],
            role: ['add', 'remove', 'restore', 'bulk', 'create', 'delete', 'color', 'hoist', 'mentionable', 'rename', 'icon'],
            case: ['view', 'undo', 'reset'],
            template: ['set', 'remove', 'view', 'reset', 'list', 'test', 'variables'],
            config: [
                'view', 'setup', 'reset', 'modlog', 'imuted', 'rmuted', 'jail',
                'staff-add', 'staff-remove', 'staff-list', 'warn-add', 'warn-remove', 'warn-list'
            ]
        });
    });
});
