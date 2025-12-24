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

    // Check deployment mode from command-line arguments
    const forceRegister = process.argv.includes('--deploy');
    const deployAll = process.argv.includes('--deploy-all');
    const deployGlobal = process.argv.includes('--deploy-global');

    // Sort commands by name to ensure consistent hash (glob returns files in non-deterministic order)
    const sortedCommands = commands.slice().sort((a, b) => a.name.localeCompare(b.name));

    // Calculate hash of all commands to detect changes
    const commandHash = crypto.createHash('sha256')
        .update(JSON.stringify(sortedCommands))
        .digest('hex');

    // Load cached hash
    let cachedHash = null;
    const cachePath = path.resolve(COMMAND_CACHE_FILE);
    try {
        if (fs.existsSync(COMMAND_CACHE_FILE)) {
            const cache = JSON.parse(fs.readFileSync(COMMAND_CACHE_FILE, 'utf8'));
            cachedHash = cache.hash;
            logger.debug(`Loaded cache from: ${cachePath} (hash: ${cachedHash.substring(0, 12)}...)`);
        } else {
            logger.debug(`No cache file found at: ${cachePath}`);
        }
    } catch (err) {
        logger.debug(`Could not load command cache: ${err.message}`);
    }

    // Only register if commands changed or deployment flag is passed
    if (!forceRegister && !deployAll && !deployGlobal && commandHash === cachedHash) {
        logger.success(`✓ Using cached commands (${commands.length} commands, hash: ${commandHash.substring(0, 8)}...)`);
        logger.info(`Skipping registration - commands unchanged. Use --deploy, --deploy-all, or --deploy-global to force.`);
        return;
    }

    if (forceRegister) {
        logger.info(`--deploy flag detected, forcing command registration to ${process.env.GUILD_ID}...`);
    } else if (deployAll) {
        logger.info(`--deploy-all flag detected, deploying to all guilds...`);
    } else if (deployGlobal) {
        logger.info(`--deploy-global flag detected, deploying globally...`);
    } else {
        if (cachedHash) {
            logger.debug(`Hash mismatch - Cached: ${cachedHash.substring(0, 12)}... Current: ${commandHash.substring(0, 12)}...`);
        }
        logger.info(`Command changes detected (hash mismatch), registering...`);
    }

    const rest = new REST().setToken(process.env.DISCORD_TOKEN);

    try {
        if (deployGlobal) {
            // Deploy globally (all guilds)
            logger.info(`Deploying ${commands.length} commands globally...`);
            logger.warn('⚠️  Global commands take up to 1 hour to propagate!');

            const registrationPromise = rest.put(
                Routes.applicationCommands(process.env.CLIENT_ID),
                { body: commands }
            );
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('TIMEOUT')), 30000)
            );
            const data = await Promise.race([registrationPromise, timeoutPromise]);

            logger.success(`✓ Successfully deployed ${data.length} commands globally`);
            logger.info('Commands will be available in all guilds within 1 hour');

        } else if (deployAll) {
            // Deploy to all guilds the bot is in
            const guilds = Array.from(client.guilds.cache.values());
            logger.info(`Deploying ${commands.length} commands to ${guilds.length} guilds...`);

            let successCount = 0;
            let failCount = 0;

            for (const guild of guilds) {
                try {
                    const registrationPromise = rest.put(
                        Routes.applicationGuildCommands(process.env.CLIENT_ID, guild.id),
                        { body: commands }
                    );
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('TIMEOUT')), 30000)
                    );
                    await Promise.race([registrationPromise, timeoutPromise]);

                    successCount++;
                    logger.success(`✓ ${guild.name} (${guild.id})`);
                } catch (err) {
                    failCount++;
                    logger.error(`✗ ${guild.name} (${guild.id}): ${err.message}`);
                }
            }

            logger.info(`\nDeployment complete: ${successCount} succeeded, ${failCount} failed`);

        } else {
            // Deploy to specific guild (default/development mode)
            logger.info(`Registering ${commands.length} application commands to Discord...`);
            logger.debug(`Guild ID: ${process.env.GUILD_ID}, Client ID: ${process.env.CLIENT_ID}`);

            const registrationPromise = rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
                { body: commands },
            );
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('TIMEOUT')), 30000)
            );
            const data = await Promise.race([registrationPromise, timeoutPromise]);

            logger.success(`Successfully registered ${data.length} application commands.`);
        }

        // Cache the command hash to avoid unnecessary re-registrations
        const cachePath = path.resolve(COMMAND_CACHE_FILE);
        fs.writeFileSync(COMMAND_CACHE_FILE, JSON.stringify({ hash: commandHash, timestamp: Date.now() }));
        logger.debug(`Command cache saved to: ${cachePath}`);
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
