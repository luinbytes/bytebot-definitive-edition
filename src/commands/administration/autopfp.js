const { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');

const unavailable = 'AutoPFP needs a licensed category image provider. No configuration or webhook was created.';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autopfp')
        .setDescription('Configure automatic profile-picture posts')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub.setName('add').setDescription('Add an AutoPFP channel')
            .addChannelOption(opt => opt.setName('channel').setDescription('Posting channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
            .addStringOption(opt => opt.setName('categories').setDescription('Comma-separated image categories').setRequired(true)))
        .addSubcommand(sub => sub.setName('interval').setDescription('Change a channel posting interval')
            .addChannelOption(opt => opt.setName('channel').setDescription('Configured channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
            .addStringOption(opt => opt.setName('duration').setDescription('Between 2 minutes and 1 day').setRequired(true)))
        .addSubcommand(sub => sub.setName('test').setDescription('Test an AutoPFP post')
            .addChannelOption(opt => opt.setName('channel').setDescription('Channel to test').addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(sub => sub.setName('list').setDescription('List AutoPFP channels'))
        .addSubcommand(sub => sub.setName('remove').setDescription('Remove an AutoPFP channel')
            .addChannelOption(opt => opt.setName('channel').setDescription('Configured channel').addChannelTypes(ChannelType.GuildText).setRequired(true))),
    permissions: [PermissionFlagsBits.Administrator],

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ embeds: [embeds.error('Access Denied', 'You need Administrator to manage AutoPFP.')], flags: [MessageFlags.Ephemeral] });
        }
        const list = interaction.options.getSubcommand() === 'list';
        return interaction.reply({
            embeds: [list
                ? embeds.brand('AutoPFP Channels', `No AutoPFP channels are configured. ${unavailable}`)
                : embeds.error('AutoPFP Unavailable', unavailable)],
            flags: [MessageFlags.Ephemeral]
        });
    }
};
