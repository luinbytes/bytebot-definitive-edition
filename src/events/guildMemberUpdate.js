const { Events } = require('discord.js');
const { enforceForcedNickname } = require('../services/roleModerationService');
const logger = require('../utils/logger');

module.exports = {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {
        if (oldMember.nickname === newMember.nickname) return;
        try {
            await enforceForcedNickname(newMember);
        } catch (error) {
            logger.error(`Failed to enforce forced nickname for ${newMember.id}: ${error.message}`);
        }
    }
};
