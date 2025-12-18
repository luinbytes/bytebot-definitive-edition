const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('coinflip')
        .setDescription('Flip a coin!'),

    async execute(interaction) {
        const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
        const image = result === 'Heads'
            ? '🪙'
            : '🪙'; // Could use different emojis or custom ones

        await interaction.reply({
            embeds: [embeds.brand('Coin Flip', `The coin landed on: **${result}** ${image}`)]
        });
    },
};
