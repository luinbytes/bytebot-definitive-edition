const { Events } = require('discord.js');
const { sqlite } = require('../database');
const logger = require('../utils/logger');

module.exports = {
    name: Events.GuildBanRemove,
    async execute(ban) {
        try {
            const hardban = sqlite.prepare(`
                SELECT case_number FROM moderation_hardbans
                WHERE guild_id = ? AND user_id = ? AND state = 'active'
            `).get(ban.guild.id, ban.user.id);
            if (!hardban) return;
            await ban.guild.members.ban(ban.user.id, { reason: `Active hardban case #${hardban.case_number}` });
        } catch (error) {
            logger.error(`Failed to enforce hardban in ${ban.guild.id}: ${error.message}`);
        }
    }
};
