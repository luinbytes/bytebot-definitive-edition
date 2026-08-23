const { createAutomationCommand } = require('../../utils/automationCommand');
module.exports = createAutomationCommand({ name: 'tracking', description: 'Track username and vanity availability', publicActions: ['lookup', 'dropped', 'notify-add', 'notify-remove', 'notify-list'], groups: [
    { name: 'notify', actions: [
        { name: 'add', options: ['tracking_type', 'desired', 'confirm'] }, { name: 'remove', options: ['tracking_type', 'desired'] }, { name: 'list' }
    ] },
    { name: 'username', actions: [{ name: 'channel', options: ['notify_channel'] }, { name: 'unset' }] },
    { name: 'vanity', actions: [{ name: 'set', options: ['notify_channel', 'optional_message'] }, { name: 'unset' }] }
], actions: [
    { name: 'add', options: ['notify_channel', 'tracking_type_optional', 'availability_days'] }, { name: 'enable', options: ['notify_channel'] }, { name: 'disable', options: ['notify_channel'] }, { name: 'remove', options: ['notify_channel', 'tracking_type_optional'] }, { name: 'list' }, { name: 'lookup', options: ['resource_type', 'length'] }, { name: 'dropped', options: ['resource_type', 'length'] },
    { name: 'notify-add', options: ['tracking_type', 'desired', 'confirm'] }, { name: 'notify-remove', options: ['tracking_type', 'desired'] }, { name: 'notify-list' },
    { name: 'username-channel', options: ['notify_channel'] }, { name: 'username-unset' }, { name: 'vanity-set', options: ['notify_channel', 'optional_message'] }, { name: 'vanity-unset' }
] });
