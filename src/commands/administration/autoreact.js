const { createAutomationCommand } = require('../../utils/automationCommand');
module.exports = createAutomationCommand({ name: 'autoreact', description: 'React automatically to matching messages', actions: [
    { name: 'add', options: ['trigger32', 'reactions'] }, { name: 'update', options: ['trigger32', 'reactions'] }, { name: 'enable', options: ['trigger32'] }, { name: 'disable', options: ['trigger32'] }, { name: 'remove', options: ['trigger32'] }, { name: 'list' }, { name: 'clear', options: ['confirm'] },
    { name: 'channels-add', options: ['trigger32', 'message_scope_channel'] }, { name: 'channels-remove', options: ['trigger32', 'message_scope_channel'] }, { name: 'channels-list' },
    { name: 'roles-add', options: ['trigger32', 'role'] }, { name: 'roles-remove', options: ['trigger32', 'role'] }, { name: 'roles-list' }
] });
