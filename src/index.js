const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const logger = require('./utils/logger');

// Support --dev flag to use .env.dev instead of .env
const envFile = process.argv.includes('--dev') ? '.env.dev' : '.env';
require('dotenv').config({ path: envFile });
logger.debug(`Loaded environment from: ${envFile}`);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildExpressions,
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.AutoModerationConfiguration,
        GatewayIntentBits.AutoModerationExecution,
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction,
    ],
});

const { InformationLookupService } = require('./services/informationLookupService');
const { LocalAiMediaService } = require('./services/localAiMediaService');
const { CommandRateLimiter } = require('./utils/commandRateLimit');
const { inspectHelpers } = require('./utils/helperHealth');
const { startHeartbeat } = require('./utils/runtimeHeartbeat');
const { ProcessingQueue } = require('./services/mediaService');

client.commands = new Collection();
client.contextMenus = new Collection();
client.cooldowns = new Collection();
client.informationLookupService = new InformationLookupService();
client.aiMediaService = new LocalAiMediaService();
client.commandRateLimiter = new CommandRateLimiter();
client.imageProcessingQueue = new ProcessingQueue();
client.musicConfigured = Boolean(process.env.MUSIC_LIBRARY_PATH);
const stopHeartbeat = startHeartbeat();
client.helperHealth = inspectHelpers();

// Error handling for future-proofing
process.on('unhandledRejection', (reason, promise) => {
    logger.error(`Unhandled Rejection at: ${promise} reason: ${reason}`);
});

process.on('uncaughtException', (err) => {
    logger.error(`Uncaught Exception: ${err}`);
});

// Graceful shutdown handlers
const shutdown = async (signal) => {
    logger.info(`Received ${signal} signal, shutting down gracefully...`);

    try {
        // Cleanup services
        if (client.reminderService && client.reminderService.cleanup) {
            await client.reminderService.cleanup();
        }
        if (client.birthdayService && client.birthdayService.cleanup) {
            await client.birthdayService.cleanup();
        }
        if (client.autoResponderService && client.autoResponderService.cleanup) {
            await client.autoResponderService.cleanup();
        }
        if (client.automationService?.cleanup) {
            await client.automationService.cleanup();
        }
        client.giveawayService?.cleanup?.();
        client.ticketService?.cleanup?.();
        client.voiceMasterService?.cleanup?.();
        client.eventLoggingService?.cleanup?.();
        client.levelAnalyticsService?.cleanup?.();
        await client.musicService?.cleanup?.();
        await client.aiMediaService?.close?.();
        await client.imageProcessingQueue?.close?.();
        client.communityUtilityService?.cleanup?.();
        client.funService?.cleanup?.();
        await client.lastfmOAuthServer?.close?.();
        await require('./services/automodService').cleanup();
        require('./services/antiraidService').clearWindows();
        if (client.starboardService && client.starboardService.cleanup) {
            await client.starboardService.cleanup();
        }
        if (client.activityStreakService && client.activityStreakService.cleanup) {
            await client.activityStreakService.cleanup();
        }

        // Destroy Discord client
        stopHeartbeat();
        client.destroy();
        logger.success('Bot shutdown complete');
        process.exit(0);
    } catch (error) {
        logger.error(`Error during shutdown: ${error.message}`);
        process.exit(1);
    }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

(async () => {
    try {
        // Load Handlers
        const eventHandler = require('./handlers/eventHandler');
        const commandHandler = require('./handlers/commandHandler');

        const { runMigrations } = require('./database/index');
        await runMigrations();

        await eventHandler(client);
        await commandHandler(client);

        await client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
        logger.error(`Initialization Error: ${error}`);
        stopHeartbeat();
        client.destroy();
        process.exit(1);
    }
})();
