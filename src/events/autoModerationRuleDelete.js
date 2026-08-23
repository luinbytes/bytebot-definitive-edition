const { Events } = require('discord.js');
const { forgetNativeRule } = require('../services/automodService');

module.exports = {
    name: Events.AutoModerationRuleDelete,
    execute(rule) {
        forgetNativeRule(rule.guild.id, rule.id);
    }
};
