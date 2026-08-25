const command = require('../src/commands/voice/voicemaster');

function option(parent, name) {
    return parent.options.find(item => item.name === name);
}

describe('VoiceMaster public command', () => {
    const json = command.data.toJSON();

    test('exposes every evidenced action under one valid Voice command', () => {
        expect(json.name).toBe('voicemaster');
        expect(json.dm_permission).toBe(false);
        expect(json.default_member_permissions).toBeUndefined();
        expect(json.options.map(item => item.name)).toEqual([
            'setup', 'reset', 'sendinterface', 'secondary', 'bitrate', 'region',
            'status', 'limit', 'rename', 'lock', 'unlock', 'hide', 'reveal',
            'claim', 'information', 'delete', 'drag', 'permit', 'reject',
            'joinrole', 'template', 'temporary', 'default'
        ]);
        expect(json.options).toHaveLength(23);
        expect(command.permissions).toEqual([]);
    });

    test('groups secondary actions without losing their public names', () => {
        const secondary = option(json, 'secondary');
        expect(secondary.options.map(item => item.name)).toEqual(['add', 'remove', 'list', 'category']);
        expect(secondary.options.map(item => item.description)).toEqual([
            'Add a secondary join-to-create channel',
            'Remove a secondary join-to-create channel',
            'List all secondary join-to-create channels',
            'Set the category for a secondary join-to-create channel'
        ]);
        expect(option(option(secondary, 'add'), 'channel').required).toBe(true);
        expect(option(option(secondary, 'category'), 'category').required).toBe(true);
    });

    test('publishes Discord limits in the native option schema', () => {
        const bitrate = option(option(json, 'bitrate'), 'bitrate');
        const limit = option(option(json, 'limit'), 'limit');
        const name = option(option(json, 'rename'), 'name');
        const status = option(option(json, 'status'), 'status');
        const template = option(option(json, 'template'), 'template');

        expect({ required: bitrate.required, min: bitrate.min_value }).toEqual({ required: true, min: 8000 });
        expect({ required: limit.required, min: limit.min_value, max: limit.max_value }).toEqual({ required: true, min: 0, max: 99 });
        expect({ required: name.required, min: name.min_length, max: name.max_length }).toEqual({ required: true, min: 1, max: 100 });
        expect(status.max_length).toBe(500);
        expect(template.max_length).toBe(32);
    });

    test('exposes all five default settings', () => {
        const defaults = option(json, 'default');
        expect(defaults.options.map(item => item.name)).toEqual(['role', 'name', 'bitrate', 'region', 'interface']);
        expect(option(option(defaults, 'name'), 'template').max_length).toBe(32);
        expect(option(option(defaults, 'interface'), 'enabled').required).toBe(true);
    });
});
