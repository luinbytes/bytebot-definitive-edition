const { createAutomationCommand } = require('../../utils/automationCommand');
module.exports = createAutomationCommand({ name: 'vanity', description: 'Reward members who advertise a vanity', actions: [
    { name: 'set', options: ['vanity'] }, { name: 'setup', options: ['vanity'] }, { name: 'enable' }, { name: 'disable' }, { name: 'message', options: ['message'] },
    { name: 'channel', options: ['notify_channel'] }, { name: 'strict', options: ['strict'] }, { name: 'view' },
    { name: 'role-add', options: ['role'] }, { name: 'role-remove', options: ['role'] }, { name: 'role-list' },
    { name: 'role', options: ['role'] }, { name: 'removerole', options: ['role'] }, { name: 'rewards' }, { name: 'settings' }, { name: 'remove' }
] });
