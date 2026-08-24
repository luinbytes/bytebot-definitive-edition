const { Events } = require('discord.js');
const logger = require('../utils/logger');
const { handleHoneypotMessage } = require('../utils/honeypotUtil');
const { handleUwuLockMessage } = require('../utils/uwuLockUtil');
const { handleMassMention } = require('../services/antiraidService');
const { handleMessage: handleAutomodMessage } = require('../services/automodService');
const { handleAfkMessage } = require('../services/personalUtilityService');

module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        // DISBOARD is a bot, but successful bumps are the event source for the
        // configured bump-reminder workflow.
        if (message.author.id === '302050872383242240' && client.automationService) {
            await client.automationService.handleMessage(message).catch(error => logger.error('Bump reminder error:', error));
            return;
        }
        // Ignore bot messages (prevents infinite loops)
        if (message.author.bot) return;

        // Guild only (auto-responder doesn't work in DMs)
        if (!message.guild) return;

        try {
            await handleAfkMessage(message);
        } catch (error) {
            logger.error('AFK handler error:', error);
        }

        try {
            if (await handleHoneypotMessage(message)) return;
        } catch (error) {
            logger.error('Honeypot handler error:', error);
        }

        try {
            if (await handleMassMention(message)) return;
        } catch (error) {
            logger.error('AntiRaid message handler error:', error);
        }

        try {
            if (await handleAutomodMessage(message)) return;
        } catch (error) {
            logger.error('AutoMod message handler error:', error);
        }

        try {
            if (await handleUwuLockMessage(message)) return;
        } catch (error) {
            logger.error('UwU Lock handler error:', error);
        }

        // Auto-responder check
        if (client.autoResponderService) {
            try {
                await client.autoResponderService.checkMessage(message);
            } catch (error) {
                logger.error('Auto-responder error:', error);
                // Don't crash on auto-responder errors, just log
            }
        }

        if (client.automationService) {
            try {
                await client.automationService.handleMessage(message);
            } catch (error) {
                logger.error('Automation handler error:', error);
            }
        }

        if (client.ticketService) {
            try {
                await client.ticketService.handleMessage(message);
            } catch (error) {
                logger.error('Ticket activity handler error:', error);
            }
        }

        // Activity streak tracking
        if (client.activityStreakService) {
            try {
                // Record message activity
                await client.activityStreakService.recordActivity(
                    message.author.id,
                    message.guild.id,
                    'message',
                    1
                );

                // Track active hour for time-based achievements
                const hour = new Date().getUTCHours();
                await client.activityStreakService.recordActiveHour(
                    message.author.id,
                    message.guild.id,
                    hour
                );
            } catch (error) {
                logger.error('Activity streak tracking error:', error);
                // Don't crash on tracking errors, just log
            }
        }
    }
};
