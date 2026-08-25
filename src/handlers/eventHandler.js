const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { glob } = require('glob');
const embeds = require('../utils/embeds');

function execute(event, client, args, eventName = event.name) {
    const resource = args.find(arg => arg?.guildId || arg?.guild?.id || arg?.message?.guild?.id);
    const guildId = resource?.guildId || resource?.guild?.id || resource?.message?.guild?.id;
    return embeds.withGuild(client, guildId, () => event.names
        ? event.execute(eventName, ...args, client)
        : event.execute(...args, client));
}

module.exports = async (client) => {
    const eventFiles = await glob('src/events/**/*.js');

    logger.info(`Found ${eventFiles.length} event files.`);

    for (const file of eventFiles) {
        const filePath = path.resolve(file);
        const event = require(filePath);

        for (const name of event.names || [event.name]) {
            if (event.once) {
                client.once(name, (...args) => execute(event, client, args, name));
            } else {
                client.on(name, (...args) => execute(event, client, args, name));
            }
        }
    }

    logger.info(`Loaded ${eventFiles.length} Events.`);
};
