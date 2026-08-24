const { SlashCommandBuilder } = require('discord.js');
const stats = require('./stats');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('analytics')
        .setDescription('View server activity analytics')
        .setDMPermission(false)
        .addIntegerOption(option => option
            .setName('days')
            .setDescription('Analytics range in days')
            .setMinValue(1)
            .setMaxValue(1095))
        .addBooleanOption(option => option
            .setName('private')
            .setDescription('Show only to you'))
        .addStringOption(option => option
            .setName('metric')
            .setDescription('Activity metric')
            .addChoices(
                { name: 'All activity', value: 'all' },
                { name: 'Messages', value: 'messages' },
                { name: 'Reactions', value: 'reactions' },
                { name: 'Voice', value: 'voice' },
                { name: 'Membership', value: 'membership' }
            )),
    permissions: [],
    cooldown: 2,
    execute: stats.execute
};
