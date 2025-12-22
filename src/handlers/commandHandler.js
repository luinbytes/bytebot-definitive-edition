const { REST, Routes } = require('discord.js');
const path = require('path');
const logger = require('../utils/logger');
const { glob } = require('glob');
require('dotenv').config();

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

    const rest = new REST().setToken(process.env.DISCORD_TOKEN);

    try {
        logger.info(`Started refreshing ${commands.length} application commands (slash + context menus).`);

        // Note: Deploying to a specific guild for development speed.
        // In production, use Routes.applicationCommands(clientId) for global deployment.
        const data = await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands },
        );

        logger.success(`Successfully reloaded ${data.length} application commands.`);
    } catch (error) {
        logger.error(`Error refreshing commands: ${error}`);
    }
};
