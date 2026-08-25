const { ChannelType, SlashCommandBuilder } = require('discord.js');
const { executeCommunityUtilityAdmin } = require('../../utils/communityUtilityCommand');

const target = sub => sub.addChannelOption(option => option.setName('thread')
    .setDescription('Thread; defaults to the current thread')
    .addChannelTypes(ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread))
    .addStringOption(option => option.setName('reason').setDescription('Audit-log reason').setMaxLength(512));

const data = new SlashCommandBuilder().setName('thread').setDescription('Manage Discord threads').setDMPermission(false)
    .addSubcommand(sub => target(sub.setName('add').setDescription('Add a member to a thread')
        .addUserOption(option => option.setName('member').setDescription('Member').setRequired(true))))
    .addSubcommand(sub => target(sub.setName('remove').setDescription('Remove a member from a thread')
        .addUserOption(option => option.setName('member').setDescription('Member').setRequired(true))))
    .addSubcommand(sub => target(sub.setName('rename').setDescription('Rename a thread')
        .addStringOption(option => option.setName('name').setDescription('New name').setMinLength(1).setMaxLength(100).setRequired(true))))
    .addSubcommand(sub => target(sub.setName('slowmode').setDescription('Set thread slowmode')
        .addIntegerOption(option => option.setName('seconds').setDescription('0 to 21600 seconds').setMinValue(0).setMaxValue(21600).setRequired(true))))
    .addSubcommand(sub => target(sub.setName('lock').setDescription('Lock a thread')))
    .addSubcommand(sub => target(sub.setName('unlock').setDescription('Unlock a thread')))
    .addSubcommand(sub => target(sub.setName('archive').setDescription('Archive a thread')))
    .addSubcommand(sub => target(sub.setName('unarchive').setDescription('Unarchive a thread')))
    .addSubcommand(sub => target(sub.setName('solved').setDescription('Mark a forum thread solved and lock it')))
    .addSubcommand(sub => target(sub.setName('delete').setDescription('Permanently delete a thread')
        .addBooleanOption(option => option.setName('confirm').setDescription('Confirm permanent deletion').setRequired(true))));

module.exports = { data, execute: executeCommunityUtilityAdmin };
