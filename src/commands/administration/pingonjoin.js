const { createAutomationCommand } = require('../../utils/automationCommand');
module.exports = createAutomationCommand({ name: 'pingonjoin', description: 'Notify a channel when a member joins', actions: [
    { name: 'enable', options: ['notify_channel', 'threshold'] }, { name: 'disable' }, { name: 'info' }, { name: 'message', options: ['message'] }, { name: 'remove' }
] });
