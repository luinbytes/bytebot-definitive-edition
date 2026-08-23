const { createAutomationCommand } = require('../../utils/automationCommand');
module.exports = createAutomationCommand({ name: 'timer', description: 'Send recurring channel messages', actions: [
    { name: 'add', options: ['text_channel', 'interval', 'message'] }, { name: 'update', options: ['text_channel', 'interval', 'message'] }, { name: 'enable', options: ['text_channel'] }, { name: 'disable', options: ['text_channel'] }, { name: 'remove', options: ['text_channel'] }, { name: 'list' }, { name: 'view', options: ['text_channel'] }
] });
