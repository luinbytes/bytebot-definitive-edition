const { REST, Routes } = require('discord.js');
const path = require('path');
const logger = require('./logger');
const { glob } = require('glob');
const crypto = require('crypto');
const fs = require('fs');

const COMMAND_CACHE_FILE = '.command-cache.json';

/**
 * Load all commands from the commands directory
 * @returns {Promise<{commands: Array, hash: string}>}
 */
async function loadCommands() {
    const commands = [];

    // Load Slash Commands
    const commandFiles = await glob('src/commands/**/!(context-menus)/*.js');

    for (const file of commandFiles) {
        const filePath = path.resolve(file);
        // Clear require cache to get latest version
        delete require.cache[filePath];
        const command = require(filePath);

        if ('data' in command && 'execute' in command) {
            commands.push(command.data.toJSON());
        }
    }

    // Load Context Menus
    const contextMenuFiles = await glob('src/commands/context-menus/*.js');

    for (const file of contextMenuFiles) {
        const filePath = path.resolve(file);
        // Clear require cache to get latest version
        delete require.cache[filePath];
        const menu = require(filePath);

        if ('data' in menu && 'execute' in menu) {
            commands.push(menu.data.toJSON());
        }
    }

    // Sort commands by name to ensure consistent hash
    const sortedCommands = commands.slice().sort((a, b) => a.name.localeCompare(b.name));

    // Calculate hash of all commands
    const commandHash = crypto.createHash('sha256')
        .update(JSON.stringify(sortedCommands))
        .digest('hex');

    return { commands, hash: commandHash };
}

/**
 * Deploy commands to Discord
 * @param {string} scope - 'guild' (current guild), 'global' (all guilds)
 * @param {string} guildId - Guild ID for guild-scoped deployment
 * @returns {Promise<{success: boolean, count: number, error?: string}>}
 */
async function deployCommands(scope = 'guild', guildId = null) {
    try {
        const { commands, hash } = await loadCommands();

        const rest = new REST().setToken(process.env.DISCORD_TOKEN);

        let route;
        let scopeDescription;

        if (scope === 'global') {
            route = Routes.applicationCommands(process.env.CLIENT_ID);
            scopeDescription = 'globally (all guilds)';
        } else if (scope === 'guild') {
            if (!guildId) {
                throw new Error('Guild ID required for guild-scoped deployment');
            }
            route = Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId);
            scopeDescription = `to guild ${guildId}`;
        } else {
            throw new Error(`Invalid scope: ${scope}. Must be 'guild' or 'global'`);
        }

        logger.info(`Deploying ${commands.length} commands ${scopeDescription}...`);

        // Deploy with timeout
        const registrationPromise = rest.put(route, { body: commands });
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('TIMEOUT')), 30000)
        );

        const data = await Promise.race([registrationPromise, timeoutPromise]);

        // Update cache
        const cachePath = path.resolve(COMMAND_CACHE_FILE);
        fs.writeFileSync(COMMAND_CACHE_FILE, JSON.stringify({
            hash,
            timestamp: Date.now(),
            lastDeployment: {
                scope,
                guildId: scope === 'guild' ? guildId : null,
                count: data.length
            }
        }));

        logger.success(`Successfully deployed ${data.length} commands ${scopeDescription}`);
        logger.debug(`Cache updated with hash: ${hash.substring(0, 12)}...`);

        return { success: true, count: data.length };
    } catch (error) {
        if (error.message === 'TIMEOUT') {
            const errorMsg = 'Command deployment timed out after 30 seconds. Check Discord API status.';
            logger.error(errorMsg);
            return { success: false, count: 0, error: errorMsg };
        }

        if (error.code) {
            const errorMsg = `Discord API Error ${error.code}: ${error.message}`;
            logger.error(errorMsg);
            if (error.rawError?.errors) {
                logger.error('Validation Errors:', JSON.stringify(error.rawError.errors, null, 2));
            }
            return { success: false, count: 0, error: errorMsg };
        }

        logger.errorContext('Command deployment failed', error);
        return { success: false, count: 0, error: error.message };
    }
}

/**
 * Get cached command hash
 * @returns {string|null}
 */
function getCachedHash() {
    try {
        if (fs.existsSync(COMMAND_CACHE_FILE)) {
            const cache = JSON.parse(fs.readFileSync(COMMAND_CACHE_FILE, 'utf8'));
            return cache.hash;
        }
    } catch (err) {
        logger.debug(`Could not load command cache: ${err.message}`);
    }
    return null;
}

module.exports = {
    loadCommands,
    deployCommands,
    getCachedHash
};
