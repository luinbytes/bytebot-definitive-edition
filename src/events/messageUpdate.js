const { Events } = require('discord.js');
const { handleMassMention } = require('../services/antiraidService');
const { handleMessage } = require('../services/automodService');
const logger = require('../utils/logger');

module.exports = {
    name: Events.MessageUpdate,
    async execute(oldMessage, newMessage, client) {
        try {
            if (newMessage.partial) newMessage = await newMessage.fetch();
            if (!newMessage.guild || newMessage.author?.bot || oldMessage.content === newMessage.content) return;
            client.funService?.captureEdited(oldMessage, newMessage);
            if (await handleMassMention(newMessage)) return;
            await handleMessage(newMessage);
        } catch (error) {
            logger.error(`Security message-update handler failed for ${newMessage.id}: ${error.message}`);
        }
    }
};
