const { createAutomationCommand } = require('../../utils/automationCommand');
module.exports = createAutomationCommand({ name: 'poj', kind: 'pingonjoin', description: 'Alias for ping on join', actions: [
    { name: 'enable', options: ['notify_channel', 'threshold'] }, { name: 'disable' }, { name: 'info' }, { name: 'message', options: ['message'] }
] });
