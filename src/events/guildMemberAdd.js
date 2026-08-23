const { Events } = require('discord.js');
const logger = require('../utils/logger');
const { handleMemberJoin } = require('../services/antiraidService');
const { handleMemberUpdate: handleAutomodMemberUpdate } = require('../services/automodService');
const { sendLifecycleMessage } = require('../services/lifecycleMessageService');

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        try {
            const incident = await handleMemberJoin(member);
            if (incident?.status === 'punished') return;
            try {
                await handleAutomodMemberUpdate({ displayName: null, nickname: null }, member);
            } catch (error) {
                logger.error(`AutoMod nickname handler failed for joining member ${member.id}: ${error.message}`);
            }
            await sendLifecycleMessage('welcome', member);
        } catch (error) {
            logger.error(`Failed to process member join in guild ${member.guild.id}:`, error);
        }
    }
};
