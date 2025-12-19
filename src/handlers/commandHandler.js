const { REST, Routes } = require('discord.js');
const path = require('path');
const logger = require('../utils/logger');
const { glob } = require('glob');
require('dotenv').config();

module.exports = async (client) => {
    const commands = [];
    const commandFiles = await glob('src/commands/**/*.js');

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

    logger.info(`Loaded ${loadedCommands.length} Commands: ${loadedCommands.join(', ')}`);

    const rest = new REST().setToken(process.env.DISCORD_TOKEN);

    try {
        logger.info(`Started refreshing ${commands.length} application (/) commands.`);

        // Note: Deploying to a specific guild for development speed. 
        // In production, use Routes.applicationCommands(clientId) for global deployment.
        const data = await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands },
        );

        logger.success(`Successfully reloaded ${data.length} application (/) commands.`);
    } catch (error) {
        logger.error(`Error refreshing commands: ${error}`);
    }
};
