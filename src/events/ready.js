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
                { name: 'Doomscrolling 🟣', type: ActivityType.Competing }, // Competing in Doomscrolling
                { name: 'you Touch Grass 🟣', type: ActivityType.Watching }, // Watching you Touch Grass
                { name: 'Disassociation Sim 🟣', type: ActivityType.Playing }, // Playing Disassociation Sim
            ];

            client.user.setPresence({
                activities: [activities[i]],
                status: 'online',
            });
            i = ++i % activities.length;
        }, 10_000);
    },
};

