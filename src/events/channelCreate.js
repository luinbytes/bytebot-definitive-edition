const { Events } = require('discord.js');
const { sqlite } = require('../database');
const { applyModerationOverwrites } = require('../services/moderationSetupService');
const logger = require('../utils/logger');

module.exports = {
    name: Events.ChannelCreate,
    async execute(channel) {
        if (!channel.guild) return;
        channel.client.voiceMasterService?.handleChannelEvent(channel);
        try {
            const config = sqlite.prepare('SELECT * FROM moderation_config WHERE guild_id = ? AND setup_status = ?')
                .get(channel.guild.id, 'ready');
            if (!config) return;
            await applyModerationOverwrites(channel, config);
        } catch (error) {
            logger.error(`Failed to apply moderation overwrites to ${channel.id}: ${error.message}`);
        }
    }
};
