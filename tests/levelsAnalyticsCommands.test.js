const path = require('path');

function command(name) {
    return require(path.resolve(`src/commands/utility/${name}.js`)).data.toJSON();
}

function option(parent, name) {
    return parent.options.find(item => item.name === name);
}

describe('levels and analytics command contract', () => {
    test('/levels exposes the approved member and management paths', () => {
        const levels = command('levels');

        expect(levels.name).toBe('levels');
        expect(levels.default_member_permissions).toBeUndefined();
        expect(levels.dm_permission).toBe(false);
        expect(levels.options.map(item => item.name)).toEqual([
            'rank', 'leaderboard', 'roles', 'setup', 'config', 'live', 'boost',
            'admin', 'reward', 'ignore', 'message', 'rankcard', 'reset'
        ]);
        expect(option(levels, 'config').options.map(item => item.name)).toEqual([
            'text', 'voice', 'dm', 'antiafk', 'channel', 'rate'
        ]);
        expect(option(option(levels, 'boost'), 'add').options.map(item => item.name)).toEqual([
            'multiplier', 'role', 'channel'
        ]);
        expect(option(levels, 'message').options.map(item => item.name)).toEqual([
            'set', 'view', 'disable'
        ]);
        expect(option(levels, 'rankcard').options.map(item => item.name)).toEqual([
            'view', 'color', 'style'
        ]);
        expect(option(option(levels, 'rankcard'), 'style').options.map(item => item.name)).toEqual([
            'background', 'background_url', 'layout', 'avatar_border'
        ]);
    });

    test('/analytics is public and keeps the existing bounded server-stats options', () => {
        const analytics = command('analytics');

        expect(analytics.name).toBe('analytics');
        expect(analytics.default_member_permissions).toBeUndefined();
        expect(analytics.dm_permission).toBe(false);
        expect(analytics.options.map(item => item.name)).toEqual(['days', 'private', 'metric']);
        expect(option(analytics, 'days')).toEqual(expect.objectContaining({ min_value: 1, max_value: 1095 }));
        expect(option(analytics, 'metric').choices.map(choice => choice.value)).toEqual([
            'all', 'messages', 'reactions', 'voice', 'membership'
        ]);
    });
});
