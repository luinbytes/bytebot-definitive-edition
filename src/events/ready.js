const { Events, ActivityType } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    name: Events.ClientReady,
    once: true,
    execute(client) {
        logger.success(`Ready! Logged in as ${client.user.tag}`);
        logger.info(`Bot is active in ${client.guilds.cache.size} guilds.`);

        let i = 0;
        setInterval(() => {
            const activities = [
                { name: 'Doomscrolling (Ranked) 🟣', type: ActivityType.Playing },
                { name: 'Touch Grass (Any%) 🟣', type: ActivityType.Playing },
                { name: 'Existential Dread (Hard Mode) 🟣', type: ActivityType.Playing },
            ];

            client.user.setPresence({
                activities: [activities[i]],
                status: 'online',
            });
            i = ++i % activities.length;
        }, 10_000);
    },
};

