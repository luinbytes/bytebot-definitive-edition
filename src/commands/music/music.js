const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');
const { PRESET_NAMES } = require('../../services/musicService');

const data = new SlashCommandBuilder()
    .setName('music')
    .setDescription('Play and control music in your voice channel')
    .setDMPermission(false)
    .addSubcommand(subcommand => subcommand.setName('play').setDescription('Play a song or playlist')
        .addStringOption(option => option.setName('query').setDescription('Library query or configured URL').setRequired(true).setMaxLength(2048)))
    .addSubcommand(subcommand => subcommand.setName('queue').setDescription('View the current music queue'))
    .addSubcommand(subcommand => subcommand.setName('pause').setDescription('Pause the current track'))
    .addSubcommand(subcommand => subcommand.setName('resume').setDescription('Resume the current track'))
    .addSubcommand(subcommand => subcommand.setName('skip').setDescription('Skip the current track'))
    .addSubcommand(subcommand => subcommand.setName('stop').setDescription('Stop music and disconnect'))
    .addSubcommand(subcommand => subcommand.setName('volume').setDescription('View or set playback volume')
        .addIntegerOption(option => option.setName('volume').setDescription('Volume percent').setMinValue(0).setMaxValue(200)))
    .addSubcommand(subcommand => subcommand.setName('preset').setDescription('Toggle an audio preset')
        .addStringOption(option => option.setName('name').setDescription('Audio preset').setRequired(true)
            .addChoices(...PRESET_NAMES.map(name => ({ name, value: name })))))
    .addSubcommandGroup(group => group.setName('settings').setDescription('Configure server music')
        .addSubcommand(subcommand => subcommand.setName('dj').setDescription('Set the DJ role')
            .addRoleOption(option => option.setName('role').setDescription('DJ role').setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName('autoplay').setDescription('Enable or disable autoplay')
            .addStringOption(option => option.setName('state').setDescription('Autoplay state').setRequired(true).addChoices(
                { name: 'On', value: 'on' }, { name: 'Off', value: 'off' },
                { name: 'Enable', value: 'enable' }, { name: 'Disable', value: 'disable' },
                { name: 'True', value: 'true' }, { name: 'False', value: 'false' }
            ))));

module.exports = {
    data,
    cooldown: 1,
    longRunning: true,
    async execute(interaction, client) {
        if (client.musicService) return client.musicService.execute(interaction);
        const payload = {
            embeds: [embeds.error('Music Unavailable', 'The music service is not initialized.')],
            allowedMentions: { parse: [] }
        };
        if (interaction.deferred) {
            return interaction.editReply(payload);
        }
        return interaction.reply(payload);
    }
};
