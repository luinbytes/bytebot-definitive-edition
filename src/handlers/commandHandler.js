const { REST, Routes } = require('discord.js');
const path = require('path');
const logger = require('../utils/logger');
const { glob } = require('glob');
require('dotenv').config();

module.exports = async (client) => {
    const commands = [];
    const commandFiles = await glob('src/commands/**/*.js');

    for (const file of commandFiles) {
        const filePath = path.resolve(file);
        const command = require(filePath);

        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
            commands.push(command.data.toJSON());
            logger.info(`Loaded Command: ${command.data.name}`);
        } else {
            logger.warn(`The command at ${file} is missing a required "data" or "execute" property.`);
        }
    }

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
