const { Client, Collection, GatewayIntentBits } = require('discord.js');
const logger = require('./utils/logger');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.commands = new Collection();
client.cooldowns = new Collection();

// Error handling for future-proofing
process.on('unhandledRejection', (reason, promise) => {
    logger.error(`Unhandled Rejection at: ${promise} reason: ${reason}`);
});

process.on('uncaughtException', (err) => {
    logger.error(`Uncaught Exception: ${err}`);
});

(async () => {
    try {
        // Load Handlers
        const eventHandler = require('./handlers/eventHandler');
        const commandHandler = require('./handlers/commandHandler');

        await eventHandler(client);
        await commandHandler(client);

        await client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
        logger.error(`Initialization Error: ${error}`);
    }
})();
