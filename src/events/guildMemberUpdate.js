const { Events } = require('discord.js');
const { sqlite } = require('../database');
const logger = require('../utils/logger');

module.exports = {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {
        const forced = sqlite.prepare('SELECT nickname FROM forced_nicknames WHERE guild_id = ? AND user_id = ?')
            .get(newMember.guild.id, newMember.id);
        if (!forced || newMember.nickname === forced.nickname || oldMember.nickname === newMember.nickname) return;
        try {
            await newMember.setNickname(forced.nickname, 'ByteBot forced nickname enforcement');
        } catch (error) {
            logger.error(`Failed to enforce forced nickname for ${newMember.id}: ${error.message}`);
        }
    }
};
