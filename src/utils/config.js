const fs = require('fs');
const path = require('path');

/**
 * Configuration Loader
 *
 * Merges config.json (version controlled) with config.local.json (user overrides, gitignored)
 * This prevents merge conflicts while allowing user-specific settings
 *
 * Priority: config.local.json > config.json
 */

// Note: Can't use logger here due to circular dependency (logger requires config)
let cachedConfig = null;

/**
 * Deep merge two objects
 */
function deepMerge(target, source) {
    const output = { ...target };

    if (isObject(target) && isObject(source)) {
        Object.keys(source).forEach(key => {
            if (isObject(source[key])) {
                if (!(key in target)) {
                    output[key] = source[key];
                } else {
                    output[key] = deepMerge(target[key], source[key]);
                }
            } else {
                output[key] = source[key];
            }
        });
    }

    return output;
}

function isObject(item) {
    return item && typeof item === 'object' && !Array.isArray(item);
}

/**
 * Load and merge configuration files
 * @returns {Object} Merged configuration object
 */
function loadConfig() {
    if (cachedConfig) {
        return cachedConfig;
    }

    const configPath = path.join(process.cwd(), 'config.json');
    const localConfigPath = path.join(process.cwd(), 'config.local.json');

    let config = {};
    let localConfig = {};

    // Load base config
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
        console.error('Failed to load config.json:', error.message);
        process.exit(1);
    }

    // Load local overrides (optional)
    try {
        if (fs.existsSync(localConfigPath)) {
            localConfig = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
        }
    } catch (error) {
        console.warn('Failed to load config.local.json:', error.message);
        // Continue with base config only
    }

    // Merge configs (local overrides base)
    cachedConfig = deepMerge(config, localConfig);

    return cachedConfig;
}

/**
 * Clear the config cache (useful for testing)
 */
function clearCache() {
    cachedConfig = null;
}

module.exports = loadConfig();
module.exports.loadConfig = loadConfig;
module.exports.clearCache = clearCache;
