const { Events } = require('discord.js');
const { handleNativeActionExecution } = require('../services/automodService');
const logger = require('../utils/logger');

module.exports = {
    name: Events.AutoModerationActionExecution,
    async execute(execution) {
        try {
            await handleNativeActionExecution(execution);
        } catch (error) {
            logger.error(`Native AutoMod action handling failed in ${execution.guildId}: ${error.message}`);
        }
    }
};
