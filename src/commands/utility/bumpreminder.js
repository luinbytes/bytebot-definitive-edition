const { createAutomationCommand } = require('../../utils/automationCommand');
module.exports = createAutomationCommand({ name: 'bumpreminder', description: 'Thank bumpers and remind after two hours', groups: [
    { name: 'test', actions: [{ name: 'reminder' }, { name: 'thankyou' }] },
    { name: 'view', actions: [{ name: 'reminder' }, { name: 'thankyou' }] }
], actions: [
    { name: 'enable', options: ['text_channel'] }, { name: 'disable' }, { name: 'reminder', options: ['message'] }, { name: 'thankyou', options: ['message'] },
    { name: 'leaderboard' }, { name: 'test-reminder' }, { name: 'test-thankyou' }, { name: 'view-reminder' }, { name: 'view-thankyou' }, { name: 'remove' }
] });
