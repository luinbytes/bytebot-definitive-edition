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
            'afk',
            'timezone',
            'diary',
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
            'cancel',
            'snooze'
        ]);
        expect(optionNames(findOption(command, 'afk').options)).toEqual(['set', 'embed', 'reset']);
        expect(optionNames(findOption(command, 'timezone').options)).toEqual(['view', 'set', 'remove']);
        expect(optionNames(findOption(command, 'diary').options)).toEqual(['create', 'view', 'delete']);
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
        const thread = commandJson('src/commands/administration/thread.js');

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
            'backup',
            'customize',
            'discovery',
            'permissions',
            'achievement',
            'streak',
            'security',
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
        expect(optionNames(findOption(command, 'backup').options)).toEqual([
            'create', 'list', 'view', 'rename', 'delete', 'restore'
        ]);
        expect(optionNames(findOption(command, 'backup').options.find(option => option.name === 'restore').options)).toEqual([
            'backup_id', 'mode', 'roles', 'channels', 'emojis', 'stickers', 'bytebot', 'confirmation'
        ]);
        expect(optionNames(findOption(command, 'customize').options)).toEqual([
            'name', 'avatar', 'banner', 'bio', 'reset', 'preset'
        ]);
        expect(optionNames(findOption(command, 'customize').options.find(option => option.name === 'preset').options)).toEqual([
            'action', 'name_or_id', 'confirm'
        ]);
        expect(optionNames(findOption(command, 'discovery').options)).toEqual([
            'publish', 'list', 'view', 'bump', 'remove'
        ]);
        expect(optionNames(findOption(command, 'permissions').options)).toEqual([
            'view',
            'add',
            'remove',
            'list',
            'reset',
            'disable',
            'enable',
            'allow',
            'deny',
            'unrestrict',
            'fake',
            'denyperm',
            'protect'
        ]);
        expect(findOption(findOption(command, 'permissions').options.find(option => option.name === 'add'), 'command').autocomplete).toBe(true);
        expect(optionNames(findOption(command, 'permissions').options.find(option => option.name === 'disable').options)).toEqual([
            'command', 'channel', 'role', 'member'
        ]);
        expect(optionNames(findOption(command, 'permissions').options.find(option => option.name === 'fake').options)).toEqual([
            'action', 'role', 'permissions'
        ]);
        expect(optionNames(findOption(command, 'permissions').options.find(option => option.name === 'denyperm').options)).toEqual([
            'action', 'permission'
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
        expect(optionNames(findOption(command, 'community').options)).toEqual(['view', 'image-only', 'pin', 'unpin']);
        expect(optionNames(findOption(command, 'confessions').options)).toEqual([
            'view', 'setup', 'remove', 'category', 'blacklist', 'emojis', 'mute', 'unmute', 'report'
        ]);
        expect(optionNames(thread.options)).toEqual([
            'add', 'remove', 'rename', 'slowmode', 'lock', 'unlock', 'archive', 'unarchive', 'solved', 'delete'
        ]);
        expect(optionNames(findOption(command, 'security').options)).toEqual([
            'antinuke-settings',
            'antinuke-toggle',
            'antinuke-punishment',
            'antinuke-window',
            'antinuke-module',
            'antinuke-admin',
            'antinuke-whitelist',
            'antinuke-incidents',
            'antinuke-log'
        ]);
        const moduleOption = findOption(findOption(command, 'security').options.find(option => option.name === 'antinuke-module'), 'module');
        expect(moduleOption.autocomplete).toBe(true);
        expect(optionNames(findOption(command, 'antiraid').options)).toEqual([
            'settings', 'toggle', 'punishment', 'module', 'username', 'massmention',
            'unverifiedbots', 'lockdown', 'whitelist', 'cleanup'
        ]);
        expect(optionNames(findOption(command, 'automod').options)).toEqual([
            'settings', 'toggle', 'timeout', 'filter', 'keywords', 'regex',
            'blacklist', 'allowlinks', 'allowwords', 'strikes', 'whitelist', 'migration'
        ]);
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
        expect(commandModule('src/commands/games/game.js').sourceCategories).toEqual(['Games']);
        expect(optionNames(game.options)).toEqual(['f1', 'warthunder', 'roblox']);
        expect(optionNames(findOption(game, 'f1').options)).toEqual([
            'schedule',
            'standings',
            'circuit',
            'drivers'
        ]);
        const roblox = findOption(game, 'roblox');
        expect(roblox.description).toBe('Look up a user on Roblox');
        expect(roblox.options[0].description).toBe('Look up a user on Roblox');
        expect(optionNames(roblox.options)).toEqual([
            'profile', 'games', 'groups', 'outfits'
        ]);
    });

    test('game hub renders a public Roblox profile without entering an alias command', async () => {
        const game = commandModule('src/commands/games/game.js');
        const interaction = {
            options: {
                getSubcommandGroup: jest.fn().mockReturnValue('roblox'),
                getSubcommand: jest.fn().mockReturnValue('profile'),
                getString: jest.fn().mockReturnValue('Builderman')
            },
            editReply: jest.fn().mockResolvedValue()
        };
        const client = { informationLookupService: { robloxProfile: jest.fn().mockResolvedValue({
            id: 156, username: 'builderman', displayName: 'builderman', description: 'Roblox founder',
            createdAt: '2006-02-27T21:06:40Z', banned: false, verified: true,
            followers: 1000, following: 10, friends: 200,
            presence: { status: 'In Game', location: 'Example game', lastOnline: '2026-08-25T00:00:00Z' },
            badgeCount: 1, badges: ['Administrator'], nameHistory: ['Builderman'], avatar: 'https://tr.rbxcdn.com/avatar.png'
        }) } };

        await game.execute(interaction, client);

        expect(client.informationLookupService.robloxProfile).toHaveBeenCalledWith('Builderman');
        const embed = interaction.editReply.mock.calls[0][0].embeds[0].data;
        expect(embed.url).toBe('https://www.roblox.com/users/156/profile');
        expect(embed.fields).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'Presence (In Game)' }),
            expect.objectContaining({ name: 'Location', value: 'Example game' }),
            expect.objectContaining({ name: 'Badges (1)', value: 'Administrator' })
        ]));
    });

    test.each([
        ['games', 'robloxGames', { user: { displayName: 'Builderman' }, games: [{
            name: 'Game', url: 'https://www.roblox.com/games/20', visits: 30, description: 'Public'
        }] }],
        ['groups', 'robloxGroups', { user: { displayName: 'Builderman' }, groups: [{
            name: 'Group', url: 'https://www.roblox.com/communities/40', role: 'Member', members: 50, locked: false
        }] }],
        ['outfits', 'robloxOutfits', { user: { displayName: 'Builderman' }, outfits: [{
            id: 60, name: 'Outfit', type: 'Avatar', editable: true
        }] }]
    ])('game hub renders Roblox %s results from the matching provider adapter', async (action, method, result) => {
        const game = commandModule('src/commands/games/game.js');
        const interaction = {
            options: {
                getSubcommandGroup: jest.fn().mockReturnValue('roblox'),
                getSubcommand: jest.fn().mockReturnValue(action),
                getString: jest.fn().mockReturnValue('Builderman')
            },
            editReply: jest.fn().mockResolvedValue()
        };
        const client = { informationLookupService: { [method]: jest.fn().mockResolvedValue(result) } };

        await game.execute(interaction, client);

        expect(client.informationLookupService[method]).toHaveBeenCalledWith('Builderman');
        expect(interaction.editReply.mock.calls[0][0].embeds[0].data.description).toBeTruthy();
    });

    test('Roblox profile rendering stays within Discord aggregate embed limits', async () => {
        const game = commandModule('src/commands/games/game.js');
        const interaction = {
            options: {
                getSubcommandGroup: jest.fn().mockReturnValue('roblox'),
                getSubcommand: jest.fn().mockReturnValue('profile'),
                getString: jest.fn().mockReturnValue('Builderman')
            },
            editReply: jest.fn().mockResolvedValue()
        };
        const client = { informationLookupService: { robloxProfile: jest.fn().mockResolvedValue({
            id: 156, username: 'builderman', displayName: 'builderman', description: 'd'.repeat(10_000),
            createdAt: '2006-02-27T21:06:40Z', banned: false, verified: true,
            followers: 1, following: 2, friends: 3,
            presence: { status: 'Online', location: 'l'.repeat(10_000), lastOnline: null },
            badgeCount: 5, badges: ['b'.repeat(2_000)], nameHistory: ['n'.repeat(2_000)],
            avatar: 'https://tr.rbxcdn.com/avatar.png'
        }) } };

        await game.execute(interaction, client);

        const embed = interaction.editReply.mock.calls[0][0].embeds[0].data;
        const characters = (embed.title?.length || 0) + (embed.description?.length || 0)
            + (embed.footer?.text?.length || 0)
            + embed.fields.reduce((total, field) => total + field.name.length + field.value.length, 0);
        expect(characters).toBeLessThanOrEqual(6000);
    });

    test('moderation hub uses user, logs, and channel intent groups', () => {
        const command = commandJson('src/commands/moderation/mod.js');
        const mod = commandModule('src/commands/moderation/mod.js');

        expect(command.name).toBe('mod');
        expect(command.dm_permission).toBe(false);
        expect(command.default_member_permissions).toBeUndefined();
        expect(mod.permissions).toEqual([]);
        expect(optionNames(command.options)).toEqual([
            'user',
            'status',
            'bulk',
            'logs',
            'channel',
            'role',
            'case',
            'template',
            'config'
        ]);
        expect(optionNames(findOption(command, 'user').options)).toEqual([
            'ban',
            'kick',
            'timeout',
            'untimeout',
            'softban',
            'hardban',
            'unban',
            'imute',
            'iunmute',
            'rmute',
            'runmute',
            'jail',
            'unjail',
            'warn',
            'unwarn',
            'warn-clear',
            'strip',
            'staffstrip',
            'nickname',
            'nickname-remove',
            'nickname-force',
            'nickname-unforce',
            'history'
        ]);
        expect(optionNames(findOption(command, 'status').options)).toEqual([
            'hardbans', 'jailed', 'image-muted', 'reaction-muted', 'timeouts', 'warnings'
        ]);
        expect(optionNames(findOption(command, 'bulk').options)).toEqual([
            'unban-all', 'untimeout-all', 'unjail-all'
        ]);
        expect(optionNames(findOption(command, 'logs').options)).toEqual([
            'recent',
            'by-moderator',
            'audit'
        ]);
        expect(optionNames(findOption(command, 'channel').options)).toEqual([
            'clear', 'lock', 'unlock', 'cleanup', 'selfpurge', 'purge', 'lockdown', 'unlockdown',
            'lockdown-all', 'unlockdown-all', 'lockdown-role', 'lockdown-ignore',
            'lockdown-unignore', 'lockdown-ignored', 'slowmode', 'slowmode-disable',
            'topic', 'topic-remove', 'nsfw'
        ]);
        expect(optionNames(findOption(command, 'role').options)).toEqual([
            'add', 'remove', 'restore', 'bulk', 'create', 'delete', 'color',
            'hoist', 'mentionable', 'rename', 'icon'
        ]);
        expect(optionNames(findOption(command, 'case').options)).toEqual([
            'view', 'undo', 'reset'
        ]);
        expect(optionNames(findOption(command, 'template').options)).toEqual([
            'set', 'remove', 'view', 'reset', 'list', 'test', 'variables'
        ]);
        expect(optionNames(findOption(command, 'config').options)).toEqual([
            'view', 'setup', 'reset', 'modlog', 'imuted', 'rmuted', 'jail',
            'staff-add', 'staff-remove', 'staff-list', 'warn-add', 'warn-remove', 'warn-list'
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
            '8ball', 'coin', 'dice', 'joke', 'uwuify', 'choose', 'random-member', 'quote', 'poll', 'uwulock'
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
