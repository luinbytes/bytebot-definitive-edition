const { REST, Routes } = require('discord.js');
const path = require('path');
const logger = require('../utils/logger');
const { glob } = require('glob');
const crypto = require('crypto');
const fs = require('fs');
require('dotenv').config();

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

        // Note: Deploying to a specific guild for development speed.
        // In production, use Routes.applicationCommands(clientId) for global deployment.
        const data = await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands },
        );

        logger.success(`Successfully registered ${data.length} application commands.`);

        // Cache the command hash to avoid unnecessary re-registrations
        fs.writeFileSync(COMMAND_CACHE_FILE, JSON.stringify({ hash: commandHash, timestamp: Date.now() }));
    } catch (error) {
        logger.error(error);
        logger.warn('Commands may not be available. Check Discord Developer Portal or use --deploy flag.');
    }
};
