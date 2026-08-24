const { Events } = require('discord.js');
const { enforceForcedNickname } = require('../services/roleModerationService');
const logger = require('../utils/logger');
const { handleMemberUpdate } = require('../services/automodService');
const { isNewBoost, sendLifecycleMessage } = require('../services/lifecycleMessageService');

module.exports = {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember, client) {
        if (oldMember.nickname !== newMember.nickname) {
            try {
                await enforceForcedNickname(newMember);
            } catch (error) {
                logger.error(`Failed to enforce forced nickname for ${newMember.id}: ${error.message}`);
            }
            try {
                await handleMemberUpdate(oldMember, newMember);
            } catch (error) {
                logger.error(`AutoMod nickname handler failed for ${newMember.id}: ${error.message}`);
            }
        }
        if (isNewBoost(oldMember, newMember)) {
            try {
                await sendLifecycleMessage('boost', newMember);
            } catch (error) {
                logger.error(`Failed to process boost for ${newMember.id}: ${error.message}`);
            }
        }
        if (client?.roleAutomationService) {
            try {
                await client.roleAutomationService.handleMemberUpdate(oldMember, newMember);
            } catch (error) {
                logger.error(`Failed to reconcile booster role for ${newMember.id}: ${error.message}`);
            }
        }
    }
};
