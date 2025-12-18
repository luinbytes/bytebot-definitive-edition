const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { glob } = require('glob');

module.exports = async (client) => {
    const eventFiles = await glob('src/events/**/*.js');

    for (const file of eventFiles) {
        const filePath = path.resolve(file);
        const event = require(filePath);

        if (event.once) {
            client.once(event.name, (...args) => event.execute(...args, client));
        } else {
            client.on(event.name, (...args) => event.execute(...args, client));
        }

        logger.info(`Loaded Event: ${event.name}`);
    }
};
