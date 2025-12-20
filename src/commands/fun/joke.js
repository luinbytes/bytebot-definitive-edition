const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');
const logger = require('../../utils/logger');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('joke')
        .setDescription('Tells a random joke.'),

    async execute(interaction) {
        await interaction.deferReply();

        try {
            const response = await axios.get('https://official-joke-api.appspot.com/random_joke');
            const joke = response.data;

            await interaction.editReply({
                embeds: [
                    embeds.brand('Random Joke', `**${joke.setup}**\n\n*${joke.punchline}*`)
                ]
            });
        } catch (error) {
            logger.error(error);
            await interaction.editReply({
                embeds: [embeds.error('Error', 'Failed to fetch a joke. Try again later!')]
            });
        }
    },
};
