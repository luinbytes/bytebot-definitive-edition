const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { glob } = require('glob');
const embeds = require('../utils/embeds');

function execute(event, client, args) {
    const resource = args.find(arg => arg?.guildId || arg?.guild?.id || arg?.message?.guild?.id);
    const guildId = resource?.guildId || resource?.guild?.id || resource?.message?.guild?.id;
    return embeds.withGuild(client, guildId, () => event.execute(...args, client));
}

module.exports = async (client) => {
    const eventFiles = await glob('src/events/**/*.js');

    logger.info(`Found ${eventFiles.length} event files.`);

    for (const file of eventFiles) {
        const filePath = path.resolve(file);
        const event = require(filePath);

        if (event.once) {
            client.once(event.name, (...args) => execute(event, client, args));
        } else {
            client.on(event.name, (...args) => execute(event, client, args));
        }
    }

    logger.info(`Loaded ${eventFiles.length} Events.`);
};
