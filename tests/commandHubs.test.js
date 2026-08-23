const path = require('path');
const { PermissionFlagsBits } = require('discord.js');
const { loadCommands } = require('../src/utils/commandDeployer');

function commandJson(commandPath) {
    return require(path.resolve(commandPath)).data.toJSON();
}

function commandModule(commandPath) {
    return require(path.resolve(commandPath));
}

function optionNames(options = []) {
    return options.map(option => option.name);
}

function findOption(command, name) {
    return command.options.find(option => option.name === name);
}

describe('Intent command hubs', () => {
    test('personal hub exposes standardized user-owned command paths', () => {
        const command = commandJson('src/commands/utility/me.js');

        expect(command.name).toBe('me');
        expect(command.dm_permission).toBe(false);
        expect(optionNames(command.options)).toEqual(expect.arrayContaining([
            'avatar',
            'info',
            'settings',
            'reminder',
            'bookmark',
            'birthday',
            'streak',
            'achievement'
        ]));

        expect(optionNames(findOption(command, 'settings').options)).toEqual([
            'view',
            'privacy',
            'achievements',
            'pod-summaries'
        ]);
        expect(optionNames(findOption(command, 'reminder').options)).toEqual([
            'add',
            'list',
            'cancel'
        ]);
        expect(optionNames(findOption(command, 'bookmark').options)).toEqual([
            'list',
            'search',
            'view',
            'remove',
            'clear'
        ]);
    });

    test('server hub groups admin and community systems by intent', () => {
        const command = commandJson('src/commands/administration/server.js');

        expect(command.name).toBe('server');
        expect(command.dm_permission).toBe(false);
        expect(optionNames(command.options)).toEqual(expect.arrayContaining([
            'info',
            'stats',
            'config',
            'logs',
            'welcome',
            'starboard',
            'suggestion',
            'birthday',
            'permissions',
            'achievement',
            'streak',
            'community'
        ]));

        expect(optionNames(findOption(command, 'suggestion').options)).toEqual(expect.arrayContaining([
            'submit',
            'view',
            'list',
            'top',
            'setup',
            'approve',
            'deny',
            'implement'
        ]));
        expect(optionNames(findOption(command, 'permissions').options)).toEqual([
            'add',
            'remove',
            'list',
            'reset',
            'disable',
            'enable',
            'allow',
            'deny',
            'fake',
            'protect'
        ]);
        expect(findOption(findOption(command, 'permissions').options.find(option => option.name === 'add'), 'command').autocomplete).toBe(true);
        expect(optionNames(findOption(command, 'permissions').options.find(option => option.name === 'disable').options)).toEqual([
            'command', 'channel', 'role', 'member'
        ]);
        expect(optionNames(findOption(command, 'permissions').options.find(option => option.name === 'fake').options)).toEqual([
            'action', 'role', 'permission'
        ]);
        expect(optionNames(findOption(command, 'permissions').options.find(option => option.name === 'protect').options)).toEqual([
            'action', 'member', 'role'
        ]);
        expect(optionNames(findOption(command, 'achievement').options.find(option => option.name === 'setup').options)).toEqual([
            'enabled',
            'prefix',
            'use_rarity_colors',
            'cleanup_orphaned',
            'notify_on_earn'
        ]);
        expect(optionNames(findOption(command, 'achievement').options.find(option => option.name === 'enable').options)).toEqual([]);
        expect(optionNames(findOption(command, 'achievement').options.find(option => option.name === 'disable').options)).toEqual([]);
        expect(optionNames(findOption(command, 'community').options)).toEqual(['view']);
    });

    test('pod and game hubs expose the accepted top-level areas', () => {
        const pod = commandJson('src/commands/utility/pod.js');
        const game = commandJson('src/commands/games/game.js');

        expect(pod.name).toBe('pod');
        expect(pod.dm_permission).toBe(false);
        expect(optionNames(pod.options)).toEqual(expect.arrayContaining([
            'panel',
            'stats',
            'top',
            'settings',
            'preset',
            'template',
            'setup',
            'disable'
        ]));
        expect(optionNames(findOption(pod, 'settings').options)).toEqual([
            'autolock',
            'name-style'
        ]);

        expect(game.name).toBe('game');
        expect(optionNames(game.options)).toEqual(['f1', 'warthunder']);
        expect(optionNames(findOption(game, 'f1').options)).toEqual([
            'schedule',
            'standings',
            'circuit',
            'drivers'
        ]);
    });

    test('moderation hub uses user, logs, and channel intent groups', () => {
        const command = commandJson('src/commands/moderation/mod.js');
        const mod = commandModule('src/commands/moderation/mod.js');

        expect(command.name).toBe('mod');
        expect(command.dm_permission).toBe(false);
        expect(command.default_member_permissions).toBe(PermissionFlagsBits.ModerateMembers.toString());
        expect(mod.permissions).toEqual([PermissionFlagsBits.ModerateMembers]);
        expect(optionNames(command.options)).toEqual([
            'user',
            'logs',
            'channel'
        ]);
        expect(optionNames(findOption(command, 'user').options)).toEqual([
            'ban',
            'kick',
            'warn',
            'unwarn',
            'history'
        ]);
        expect(optionNames(findOption(command, 'logs').options)).toEqual([
            'recent',
            'by-moderator'
        ]);
        expect(optionNames(findOption(command, 'channel').options)).toEqual([
            'clear',
            'lock',
            'unlock'
        ]);
    });

    test('bot hub exposes help, health, deployment, guild, and achievement operations', () => {
        const command = commandJson('src/commands/developer/bot.js');

        expect(command.name).toBe('bot');
        expect(command.dm_permission).toBe(false);
        expect(optionNames(command.options)).toEqual([
            'help',
            'ping',
            'stats',
            'deploy',
            'unregister',
            'guild',
            'achievement'
        ]);
        expect(optionNames(findOption(command, 'guild').options)).toEqual([
            'list',
            'manage'
        ]);
        expect(optionNames(findOption(command, 'achievement').options)).toEqual([
            'check'
        ]);
    });

    test('fun hub exposes UwUify and the Manage Server UwU Lock paths', () => {
        const command = commandJson('src/commands/fun/fun.js');
        const uwuLock = findOption(command, 'uwulock');
        const protect = findOption(uwuLock, 'protect');

        expect(optionNames(command.options)).toEqual([
            '8ball', 'coin', 'dice', 'joke', 'uwuify', 'uwulock'
        ]);
        expect(uwuLock.description).toContain('Manage Server');
        expect(optionNames(uwuLock.options)).toEqual(['add', 'remove', 'list', 'protect']);
        expect(optionNames(protect.options)).toEqual(['action', 'member']);
        expect(findOption(protect, 'action').choices.map(choice => choice.value)).toEqual([
            'add', 'remove', 'list'
        ]);
    });

    test('legacy top-level commands stay executable but are not registered after hub rollout', () => {
        const legacyCommandFiles = [
            'src/commands/utility/avatar.js',
            'src/commands/utility/userinfo.js',
            'src/commands/utility/settings.js',
            'src/commands/utility/reminder.js',
            'src/commands/utility/bookmark.js',
            'src/commands/utility/birthday.js',
            'src/commands/utility/streak.js',
            'src/commands/utility/serverinfo.js',
            'src/commands/utility/stats.js',
            'src/commands/utility/help.js',
            'src/commands/utility/ping.js',
            'src/commands/utility/bytepod.js',
            'src/commands/administration/config.js',
            'src/commands/administration/welcome.js',
            'src/commands/administration/starboard.js',
            'src/commands/administration/suggestion.js',
            'src/commands/administration/perm.js',
            'src/commands/administration/achievement.js',
            'src/commands/moderation/clear.js',
            'src/commands/moderation/lockchannel.js',
            'src/commands/games/f1.js',
            'src/commands/games/warthunder.js',
            'src/commands/developer/deploy.js',
            'src/commands/developer/unregister.js',
            'src/commands/developer/guild.js',
            'src/commands/developer/check-achievements.js'
        ];

        expect(legacyCommandFiles.map(file => commandModule(file).data.name)).toEqual([
            'avatar',
            'userinfo',
            'settings',
            'reminder',
            'bookmark',
            'birthday',
            'streak',
            'serverinfo',
            'stats',
            'help',
            'ping',
            'bytepod',
            'config',
            'welcome',
            'starboard',
            'suggestion',
            'perm',
            'achievement',
            'clear',
            'lockchannel',
            'f1',
            'warthunder',
            'deploy',
            'unregister',
            'guild',
            'check-achievements'
        ]);
        legacyCommandFiles.forEach(file => {
            const command = commandModule(file);
            expect(command.execute).toEqual(expect.any(Function));
            expect(command.register).toBe(false);
        });
    });

    test('deployment payload excludes legacy aliases in favor of hub commands', async () => {
        const { commands } = await loadCommands();
        const publicCommandNames = commands.map(command => command.name);

        expect(publicCommandNames).toEqual(expect.arrayContaining([
            'community',
            'me',
            'server',
            'pod',
            'mod',
            'game',
            'bot'
        ]));
        expect(publicCommandNames).not.toEqual(expect.arrayContaining([
            'bytepod',
            'avatar',
            'suggestion',
            'clear',
            'f1',
            'deploy'
        ]));
    });
});
