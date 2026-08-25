const { Events } = require('discord.js');
const logger = require('../utils/logger');
const { handleMemberJoin } = require('../services/antiraidService');
const { handleMemberUpdate: handleAutomodMemberUpdate } = require('../services/automodService');
const { sendJoinDm, sendLifecycleMessage } = require('../services/lifecycleMessageService');

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member, client) {
        try {
            await client?.levelAnalyticsService?.recordMembership(member, true);
        } catch (error) {
            logger.error(`Failed to record member join analytics for ${member.id}: ${error.message}`);
        }
        try {
            const incident = await handleMemberJoin(member);
            if (incident) return;
            try {
                await handleAutomodMemberUpdate({ displayName: null, nickname: null }, member);
            } catch (error) {
                logger.error(`AutoMod nickname handler failed for joining member ${member.id}: ${error.message}`);
            }
            try {
                await sendLifecycleMessage('welcome', member);
                await sendJoinDm(member);
            } catch (error) {
                logger.error(`Welcome delivery failed for joining member ${member.id}: ${error.message}`);
            }
            if (client?.automationService) await client.automationService.handleMemberAdd(member);
        } catch (error) {
            logger.error(`Failed to process member join in guild ${member.guild.id}:`, error);
        }
    }
};
