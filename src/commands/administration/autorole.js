const { createAutomationCommand } = require('../../utils/automationCommand');
module.exports = createAutomationCommand({ name: 'autorole', description: 'Assign roles to new members or bots', actions: [
    { name: 'add', options: ['role'] }, { name: 'enable', options: ['role'] }, { name: 'disable', options: ['role'] }, { name: 'remove', options: ['role'] }, { name: 'list' }, { name: 'clear', options: ['confirm'] },
    { name: 'bots-add', options: ['role'] }, { name: 'bots-remove', options: ['role'] }, { name: 'bots-list' }
] });
