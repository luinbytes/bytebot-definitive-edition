const { Events } = require('discord.js');
const logger = require('../utils/logger');
const { sendLifecycleMessage } = require('../services/lifecycleMessageService');

module.exports = {
    name: Events.GuildMemberRemove,
    async execute(member, client) {
        try {
            await client?.levelAnalyticsService?.recordMembership(member, false);
        } catch (error) {
            logger.error(`Failed to record member leave analytics for ${member.id}: ${error.message}`);
        }
        if (client?.roleAutomationService) {
            try {
                await client.roleAutomationService.cleanupBooster(member);
            } catch (error) {
                logger.error(`Failed to clean booster role for departing member ${member.id}: ${error.message}`);
            }
        }
        if (client?.ticketService) {
            try {
                await client.ticketService.handleMemberRemove(member);
            } catch (error) {
                logger.error(`Failed to process departing ticket opener ${member.id}: ${error.message}`);
            }
        }
        try {
            await sendLifecycleMessage('goodbye', member);
        } catch (error) {
            logger.error(`Failed to process member removal in guild ${member.guild.id}:`, error);
        }
    }
};
