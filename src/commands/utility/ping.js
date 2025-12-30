const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const { shouldBeEphemeral } = require('../../utils/ephemeralHelper');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Replies with Pong!')
        .addBooleanOption(option =>
            option
                .setName('private')
                .setDescription('Make response visible only to you')
                .setRequired(false)),

    cooldown: 5,

    async execute(interaction, client) {
        const isEphemeral = await shouldBeEphemeral(interaction, {
            commandDefault: false, // Default public
            userOverride: interaction.options.getBoolean('private')
        });

        await interaction.reply({
            embeds: [embeds.brand('Pinging...', 'Measuring latency and heartbeat...')],
            flags: isEphemeral ? [MessageFlags.Ephemeral] : []
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
