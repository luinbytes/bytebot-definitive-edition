const { ChannelType, MessageFlags, SlashCommandBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');

const voiceChannel = (subcommand, required = true) => subcommand.addChannelOption(option => option
    .setName('channel')
    .setDescription('Join-to-create voice channel')
    .addChannelTypes(ChannelType.GuildVoice)
    .setRequired(required));

const regionOption = subcommand => subcommand.addStringOption(option => option
    .setName('region')
    .setDescription('Voice region ID, or auto')
    .setAutocomplete(true));

module.exports = {
    data: new SlashCommandBuilder()
        .setName('voicemaster')
        .setDescription('Create and manage temporary voice channels')
        .setDMPermission(false)
        .addSubcommand(sub => sub.setName('setup').setDescription('Setup the voicemaster interface'))
        .addSubcommand(sub => sub.setName('reset').setDescription('Reset the voicemaster interface'))
        .addSubcommand(sub => sub.setName('sendinterface').setDescription('Forcefully resend the VoiceMaster interface'))
        .addSubcommandGroup(group => group
            .setName('secondary')
            .setDescription('Manage secondary join-to-create channels')
            .addSubcommand(sub => voiceChannel(sub.setName('add').setDescription('Add a secondary join-to-create channel (Premium)')))
            .addSubcommand(sub => voiceChannel(sub.setName('remove').setDescription('Remove a secondary join-to-create channel (Premium)')))
            .addSubcommand(sub => sub.setName('list').setDescription('List all secondary join-to-create channels (Premium)'))
            .addSubcommand(sub => voiceChannel(sub
                .setName('category')
                .setDescription('Set the category for a secondary join-to-create channel (Premium)'))
                .addChannelOption(option => option
                    .setName('category')
                    .setDescription('Category for temporary channels')
                    .addChannelTypes(ChannelType.GuildCategory)
                    .setRequired(true))))
        .addSubcommand(sub => sub
            .setName('bitrate')
            .setDescription('Change the bitrate of your current voice channel')
            .addIntegerOption(option => option.setName('bitrate').setDescription('Bitrate in bits per second').setMinValue(8000).setRequired(true)))
        .addSubcommand(sub => regionOption(sub.setName('region').setDescription('Change the region of your current voice channel')))
        .addSubcommand(sub => sub
            .setName('status')
            .setDescription('Set the voice status for your current voice channel')
            .addStringOption(option => option.setName('status').setDescription('Status, or clear').setMaxLength(500)))
        .addSubcommand(sub => sub
            .setName('limit')
            .setDescription('Set the user limit for your voice channel')
            .addIntegerOption(option => option.setName('limit').setDescription('0 means unlimited').setMinValue(0).setMaxValue(99).setRequired(true)))
        .addSubcommand(sub => sub
            .setName('rename')
            .setDescription('Rename your voice channel')
            .addStringOption(option => option.setName('name').setDescription('New channel name').setMinLength(1).setMaxLength(100).setRequired(true)))
        .addSubcommand(sub => sub.setName('lock').setDescription('Lock your voice channel'))
        .addSubcommand(sub => sub.setName('unlock').setDescription('Unlock your voice channel'))
        .addSubcommand(sub => sub.setName('hide').setDescription('Hide your voice channel'))
        .addSubcommand(sub => sub.setName('reveal').setDescription('Reveal your hidden voice channel'))
        .addSubcommand(sub => sub.setName('claim').setDescription('Claim an unclaimed voice channel'))
        .addSubcommand(sub => sub.setName('information').setDescription('View information about your voice channel'))
        .addSubcommand(sub => sub.setName('delete').setDescription('Delete your voice channel'))
        .addSubcommand(sub => sub
            .setName('drag')
            .setDescription('Drag a user into your voice channel')
            .addUserOption(option => option.setName('user').setDescription('User to move').setRequired(true)))
        .addSubcommand(sub => sub
            .setName('permit')
            .setDescription('Permit a user to access your voice channel')
            .addUserOption(option => option.setName('user').setDescription('User to permit').setRequired(true)))
        .addSubcommand(sub => sub
            .setName('reject')
            .setDescription('Reject a user from accessing your voice channel')
            .addUserOption(option => option.setName('user').setDescription('User to reject').setRequired(true)))
        .addSubcommand(sub => sub
            .setName('joinrole')
            .setDescription('Set a role that members get when joining any VoiceMaster channel')
            .addRoleOption(option => option.setName('role').setDescription('Role to grant; omit to clear')))
        .addSubcommand(sub => sub
            .setName('template')
            .setDescription('Set the template for voice channel names')
            .addStringOption(option => option.setName('template').setDescription('Use {owner}, or omit to reset').setMaxLength(32)))
        .addSubcommand(sub => sub
            .setName('temporary')
            .setDescription('Toggle temporary voice channels that auto-delete when empty')
            .addBooleanOption(option => option.setName('enabled').setDescription('Delete owned channels when empty').setRequired(true)))
        .addSubcommandGroup(group => group
            .setName('default')
            .setDescription('Configure default settings for new voice channels')
            .addSubcommand(sub => sub
                .setName('role')
                .setDescription('Set the default role for new voice channels')
                .addRoleOption(option => option.setName('role').setDescription('Visitor role; omit for @everyone')))
            .addSubcommand(sub => sub
                .setName('name')
                .setDescription('Set the default name template for new voice channels')
                .addStringOption(option => option.setName('template').setDescription('Template containing {owner}').setMaxLength(32).setRequired(true)))
            .addSubcommand(sub => sub
                .setName('bitrate')
                .setDescription('Set the default bitrate for new voice channels')
                .addIntegerOption(option => option.setName('bitrate').setDescription('Bitrate in bits per second').setMinValue(8000).setRequired(true)))
            .addSubcommand(sub => regionOption(sub.setName('region').setDescription('Set the default region for new voice channels')))
            .addSubcommand(sub => sub
                .setName('interface')
                .setDescription('Toggle sending interface to new voice channels')
                .addBooleanOption(option => option.setName('enabled').setDescription('Send controls in new channels').setRequired(true)))),

    permissions: [],
    longRunning: true,
    deferEphemeral: true,

    async execute(interaction, client) {
        if (client.voiceMasterService) return client.voiceMasterService.execute(interaction);
        return interaction.editReply({
            embeds: [embeds.error('VoiceMaster Unavailable', 'Temporary voice channels are temporarily unavailable.')],
            flags: [MessageFlags.Ephemeral]
        });
    },

    autocomplete(interaction, client) {
        return client.voiceMasterService?.autocomplete(interaction) || interaction.respond([]);
    }
};
