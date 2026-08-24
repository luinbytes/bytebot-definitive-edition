const { Events } = require('discord.js');
const logger = require('../utils/logger');
const { sendLifecycleMessage } = require('../services/lifecycleMessageService');

module.exports = {
    name: Events.GuildMemberRemove,
    async execute(member, client) {
        if (client?.roleAutomationService) {
            try {
                await client.roleAutomationService.cleanupBooster(member);
            } catch (error) {
                logger.error(`Failed to clean booster role for departing member ${member.id}: ${error.message}`);
            }
        }
        try {
            await sendLifecycleMessage('goodbye', member);
        } catch (error) {
            logger.error(`Failed to process member removal in guild ${member.guild.id}:`, error);
        }
    }
};
