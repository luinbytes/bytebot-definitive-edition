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
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction,
    ],
});

client.commands = new Collection();
client.contextMenus = new Collection();
client.cooldowns = new Collection();

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
        if (client.starboardService && client.starboardService.cleanup) {
            await client.starboardService.cleanup();
        }

        // Destroy Discord client
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
    }
})();
