const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Replies with Pong!'),

    cooldown: 5,

    async execute(interaction, client) {
        await interaction.reply({
            embeds: [embeds.brand('Pinging...', 'Measuring latency and heartbeat...')],
        });

        const sent = await interaction.fetchReply();

        const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
        const heartbeat = client.ws.ping;

        await interaction.editReply({
            embeds: [
                embeds.success('Pong!', `**Roundtrip latency:** ${roundtrip}ms\n**Websocket heartbeat:** ${heartbeat}ms`)
            ]
        });
    },
};
