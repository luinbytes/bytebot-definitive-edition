const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');
const { handleCommandError } = require('../../utils/errorHandlerUtil');
const axios = require('axios');

// 8-ball responses
const EIGHT_BALL_RESPONSES = [
    'It is certain.',
    'It is decidedly so.',
    'Without a doubt.',
    'Yes definitely.',
    'You may rely on it.',
    'As I see it, yes.',
    'Most likely.',
    'Outlook good.',
    'Yes.',
    'Signs point to yes.',
    'Reply hazy, try again.',
    'Ask again later.',
    'Better not tell you now.',
    'Cannot predict now.',
    'Concentrate and ask again.',
    "Don't count on it.",
    'My reply is no.',
    'My sources say no.',
    'Outlook not so good.',
    'Very doubtful.'
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fun')
        .setDescription('Fun commands and games')
        .addSubcommand(sub => sub
            .setName('8ball')
            .setDescription('Ask the magic 8-ball a question')
            .addStringOption(opt => opt
                .setName('question')
                .setDescription('The question you want to ask')
                .setRequired(true)))
        .addSubcommand(sub => sub
            .setName('coin')
            .setDescription('Flip a coin'))
        .addSubcommand(sub => sub
            .setName('dice')
            .setDescription('Roll a dice')
            .addIntegerOption(opt => opt
                .setName('sides')
                .setDescription('Number of sides (default: 6)')
                .setMinValue(2)
                .setMaxValue(100)))
        .addSubcommand(sub => sub
            .setName('joke')
            .setDescription('Get a random joke')),

    cooldown: 3,

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case '8ball':
                await handle8Ball(interaction);
                break;
            case 'coin':
                await handleCoin(interaction);
                break;
            case 'dice':
                await handleDice(interaction);
                break;
            case 'joke':
                await handleJoke(interaction);
                break;
        }
    }
};

/**
 * Handle /fun 8ball
 */
async function handle8Ball(interaction) {
    const question = interaction.options.getString('question');
    const response = EIGHT_BALL_RESPONSES[Math.floor(Math.random() * EIGHT_BALL_RESPONSES.length)];

    await interaction.reply({
        embeds: [embeds.brand('Magic 8-Ball', `**Question:** ${question}\n**Answer:** ${response} 🎱`)]
    });
}

/**
 * Handle /fun coin
 */
async function handleCoin(interaction) {
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';

    await interaction.reply({
        embeds: [embeds.brand('Coin Flip', `The coin landed on: **${result}** 🪙`)]
    });
}

/**
 * Handle /fun dice
 */
async function handleDice(interaction) {
    const sides = interaction.options.getInteger('sides') ?? 6;
    const result = Math.floor(Math.random() * sides) + 1;

    await interaction.reply({
        embeds: [embeds.brand('Dice Roll', `You rolled a **${result}** on a **d${sides}** 🎲`)]
    });
}

/**
 * Handle /fun joke
 */
async function handleJoke(interaction) {
    await interaction.deferReply();

    try {
        const response = await axios.get('https://official-joke-api.appspot.com/random_joke');
        const joke = response.data;

        await interaction.editReply({
            embeds: [embeds.brand('Random Joke', `**${joke.setup}**\n\n*${joke.punchline}*`)]
        });
    } catch (error) {
        await handleCommandError(error, interaction, 'fetching a joke', { ephemeral: false });
    }
}
