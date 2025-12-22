const { REST, Routes } = require('discord.js');
const path = require('path');
const logger = require('../utils/logger');
const { glob } = require('glob');
const crypto = require('crypto');
const fs = require('fs');
// Don't load .env here - index.js already loaded the correct environment file

const COMMAND_CACHE_FILE = '.command-cache.json';

module.exports = async (client) => {
    const commands = [];

    // --- Load Slash Commands ---
    const commandFiles = await glob('src/commands/**/!(context-menus)/*.js');
    const loadedCommands = [];

    for (const file of commandFiles) {
        const filePath = path.resolve(file);
        const command = require(filePath);

        if ('data' in command && 'execute' in command) {
            // Extract category from path (e.g., src/commands/utility/ping.js -> utility)
            const parts = file.split(/[\\/]/);
            const category = parts[parts.length - 2];
            command.category = category.charAt(0).toUpperCase() + category.slice(1);

            client.commands.set(command.data.name, command);
            commands.push(command.data.toJSON());
            loadedCommands.push(command.data.name);
        } else {
            logger.warn(`The command at ${file} is missing a required "data" or "execute" property.`);
        }
    }

    logger.info(`Loaded ${loadedCommands.length} Slash Commands: ${loadedCommands.join(', ')}`);

    // --- Load Context Menus ---
    const contextMenuFiles = await glob('src/commands/context-menus/*.js');
    const loadedContextMenus = [];

    for (const file of contextMenuFiles) {
        const filePath = path.resolve(file);
        const menu = require(filePath);

        if ('data' in menu && 'execute' in menu) {
            client.contextMenus.set(menu.data.name, menu);
            commands.push(menu.data.toJSON());
            loadedContextMenus.push(menu.data.name);
        } else {
            logger.warn(`The context menu at ${file} is missing a required "data" or "execute" property.`);
        }
    }

    if (loadedContextMenus.length > 0) {
        logger.info(`Loaded ${loadedContextMenus.length} Context Menus: ${loadedContextMenus.join(', ')}`);
    }

    // Check if we should skip command registration
    const forceRegister = process.argv.includes('--deploy');

    // Calculate hash of all commands to detect changes
    const commandHash = crypto.createHash('sha256')
        .update(JSON.stringify(commands))
        .digest('hex');

    // Load cached hash
    let cachedHash = null;
    try {
        if (fs.existsSync(COMMAND_CACHE_FILE)) {
            const cache = JSON.parse(fs.readFileSync(COMMAND_CACHE_FILE, 'utf8'));
            cachedHash = cache.hash;
        }
    } catch (err) {
        logger.debug('Could not load command cache, will register commands');
    }

    // Only register if commands changed or --deploy flag is passed
    if (!forceRegister && commandHash === cachedHash) {
        logger.info(`Commands unchanged (${commands.length} cached), skipping registration. Use --deploy to force.`);
        return;
    }

    const rest = new REST().setToken(process.env.DISCORD_TOKEN);

    try {
        logger.info(`Registering ${commands.length} application commands to Discord...`);
        logger.debug(`Guild ID: ${process.env.GUILD_ID}, Client ID: ${process.env.CLIENT_ID}`);

        // Note: Deploying to a specific guild for development speed.
        // In production, use Routes.applicationCommands(clientId) for global deployment.

        // Add timeout to prevent infinite hang (30 seconds)
        const registrationPromise = rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands },
        );

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('TIMEOUT')), 30000)
        );

        const data = await Promise.race([registrationPromise, timeoutPromise]);

        logger.success(`Successfully registered ${data.length} application commands.`);

        // Cache the command hash to avoid unnecessary re-registrations
        fs.writeFileSync(COMMAND_CACHE_FILE, JSON.stringify({ hash: commandHash, timestamp: Date.now() }));
    } catch (error) {
        if (error.message === 'TIMEOUT') {
            logger.error('Command registration timed out after 30 seconds.');
            logger.warn('This could indicate:');
            logger.warn('  1. Network/firewall blocking Discord API');
            logger.warn('  2. Discord API is down (check https://discordstatus.com)');
            logger.warn('  3. Rate limit (200 creates/day/guild) - wait 24 hours');
            logger.warn('  4. Invalid GUILD_ID or CLIENT_ID in .env');
            logger.warn('\nBot will continue without commands. Check your .env configuration.');
        } else {
            // Discord API errors have specific structure
            if (error.code) {
                logger.error(`Discord API Error ${error.code}: ${error.message}`);
                if (error.rawError?.errors) {
                    logger.error('Validation Errors:');
                    logger.error(JSON.stringify(error.rawError.errors, null, 2));
                }
            } else {
                logger.errorContext('Command registration failed', error, {
                    guildId: process.env.GUILD_ID,
                    clientId: process.env.CLIENT_ID,
                    commandCount: commands.length
                });
            }
            logger.warn('Commands may not be available. Check Discord Developer Portal or use --deploy flag.');
        }
    }
};
