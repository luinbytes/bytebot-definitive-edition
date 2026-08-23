const { createAutomationCommand } = require('../../utils/automationCommand');
module.exports = createAutomationCommand({ name: 'stickymessage', description: 'Keep one message at the bottom of a channel', actions: [
    { name: 'add', options: ['text_channel', 'message'] }, { name: 'update', options: ['text_channel', 'message'] }, { name: 'enable', options: ['text_channel'] }, { name: 'disable', options: ['text_channel'] }, { name: 'remove', options: ['text_channel'] }, { name: 'list' }, { name: 'view', options: ['text_channel'] }
] });
