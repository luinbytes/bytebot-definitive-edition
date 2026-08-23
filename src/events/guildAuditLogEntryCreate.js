const { Events } = require('discord.js');
const logger = require('../utils/logger');
const { evaluateAuditEntry } = require('../services/antinukeService');

module.exports = {
    name: Events.GuildAuditLogEntryCreate,
    async execute(entry, guild) {
        try {
            await evaluateAuditEntry(entry, guild);
        } catch (error) {
            logger.error(`AntiNuke evaluation failed in ${guild.id}: ${error.message}`);
        }
    }
};
