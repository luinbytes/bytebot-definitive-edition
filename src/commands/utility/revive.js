const { createAutomationCommand } = require('../../utils/automationCommand');
module.exports = createAutomationCommand({ name: 'revive', description: 'Revive inactive channels on a schedule', actions: [
    { name: 'setup', options: ['text_channel', 'interval', 'message'] }, { name: 'enable', options: ['text_channel'] }, { name: 'disable', options: ['text_channel'] },
    { name: 'message', options: ['text_channel', 'message'] }, { name: 'test', options: ['text_channel'] }, { name: 'view', options: ['text_channel'] },
    { name: 'remove', options: ['text_channel'] }
] });
