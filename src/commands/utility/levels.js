const { ChannelType, SlashCommandBuilder } = require('discord.js');

const enabled = option => option
    .setName('enabled')
    .setDescription('Whether this level feature is enabled')
    .setRequired(true);

const member = option => option
    .setName('member')
    .setDescription('Server member')
    .setRequired(true);

const page = option => option
    .setName('page')
    .setDescription('Page number')
    .setMinValue(1)
    .setMaxValue(100);

const metric = option => option
    .setName('metric')
    .setDescription('XP source')
    .addChoices(
        { name: 'Total XP', value: 'total' },
        { name: 'Text XP', value: 'text' },
        { name: 'Voice XP', value: 'voice' }
    );

const target = subcommand => subcommand
    .addRoleOption(option => option.setName('role').setDescription('Multiplier role'))
    .addChannelOption(option => option.setName('channel').setDescription('Multiplier channel'));

const data = new SlashCommandBuilder()
    .setName('levels')
    .setDescription('View and configure server levels')
    .setDMPermission(false)
    .addSubcommand(subcommand => subcommand
        .setName('rank')
        .setDescription('View a member rank card')
        .addUserOption(option => option.setName('member').setDescription('Member to view'))
        .addBooleanOption(option => option.setName('private').setDescription('Show only to you')))
    .addSubcommand(subcommand => subcommand
        .setName('leaderboard')
        .setDescription('View the XP leaderboard')
        .addStringOption(metric)
        .addIntegerOption(page)
        .addBooleanOption(option => option.setName('private').setDescription('Show only to you')))
    .addSubcommand(subcommand => subcommand
        .setName('roles')
        .setDescription('View level role rewards')
        .addIntegerOption(page)
        .addBooleanOption(option => option.setName('private').setDescription('Show only to you')))
    .addSubcommand(subcommand => subcommand
        .setName('setup')
        .setDescription('Open interactive level setup'))
    .addSubcommandGroup(group => group
        .setName('config')
        .setDescription('Configure XP and announcements')
        .addSubcommand(subcommand => subcommand.setName('text').setDescription('Enable or disable text XP').addBooleanOption(enabled))
        .addSubcommand(subcommand => subcommand.setName('voice').setDescription('Enable or disable voice XP').addBooleanOption(enabled))
        .addSubcommand(subcommand => subcommand.setName('dm').setDescription('Send level-up messages by DM').addBooleanOption(enabled))
        .addSubcommand(subcommand => subcommand.setName('antiafk').setDescription('Require active voice participation').addBooleanOption(enabled))
        .addSubcommand(subcommand => subcommand
            .setName('channel')
            .setDescription('Set the level-up channel')
            .addChannelOption(option => option.setName('channel').setDescription('Award channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand(subcommand => subcommand
            .setName('rate')
            .setDescription('Set the server XP multiplier')
            .addNumberOption(option => option.setName('multiplier').setDescription('Multiplier from 0 to 10').setMinValue(0).setMaxValue(10).setRequired(true))))
    .addSubcommandGroup(group => group
        .setName('live')
        .setDescription('Create a live XP leaderboard')
        .addSubcommand(subcommand => subcommand.setName('text').setDescription('Create a text XP board')
            .addChannelOption(option => option.setName('channel').setDescription('Destination').addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(subcommand => subcommand.setName('voice').setDescription('Create a voice XP board')
            .addChannelOption(option => option.setName('channel').setDescription('Destination').addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(subcommand => subcommand.setName('recover').setDescription('Resolve an uncertain live board')
            .addStringOption(option => option.setName('action').setDescription('Recovery action').setRequired(true).addChoices(
                { name: 'List uncertain boards', value: 'list' },
                { name: 'Force a replacement', value: 'force' },
                { name: 'Abandon the board', value: 'abandon' }
            ))
            .addChannelOption(option => option.setName('channel').setDescription('Board channel').addChannelTypes(ChannelType.GuildText))
            .addStringOption(option => option.setName('metric').setDescription('Board metric').addChoices(
                { name: 'Text XP', value: 'text' }, { name: 'Voice XP', value: 'voice' }
            ))
            .addBooleanOption(option => option.setName('confirm').setDescription('Confirm force or abandon'))))
    .addSubcommandGroup(group => group
        .setName('boost')
        .setDescription('Manage role and channel XP multipliers')
        .addSubcommand(subcommand => target(subcommand.setName('add').setDescription('Add an XP multiplier')
            .addNumberOption(option => option.setName('multiplier').setDescription('Multiplier from 0 to 10').setMinValue(0).setMaxValue(10).setRequired(true))))
        .addSubcommand(subcommand => target(subcommand.setName('remove').setDescription('Remove an XP multiplier')))
        .addSubcommand(subcommand => subcommand.setName('list').setDescription('List XP multipliers')))
    .addSubcommandGroup(group => group
        .setName('admin')
        .setDescription('Manage member XP')
        .addSubcommand(subcommand => subcommand.setName('award').setDescription('Award XP').addUserOption(member)
            .addIntegerOption(option => option.setName('amount').setDescription('XP to award').setMinValue(1).setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName('removexp').setDescription('Remove XP').addUserOption(member)
            .addIntegerOption(option => option.setName('amount').setDescription('XP to remove').setMinValue(1).setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName('setxp').setDescription('Set total XP').addUserOption(member)
            .addIntegerOption(option => option.setName('xp').setDescription('Total XP').setMinValue(0).setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName('setlevel').setDescription('Set level').addUserOption(member)
            .addIntegerOption(option => option.setName('level').setDescription('Level').setMinValue(1).setMaxValue(999).setRequired(true))))
    .addSubcommandGroup(group => group
        .setName('reward')
        .setDescription('Manage level role rewards')
        .addSubcommand(subcommand => subcommand.setName('add').setDescription('Add a role reward')
            .addRoleOption(option => option.setName('role').setDescription('Reward role').setRequired(true))
            .addIntegerOption(option => option.setName('level').setDescription('Required level').setMinValue(1).setMaxValue(999).setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName('remove').setDescription('Remove a role reward')
            .addRoleOption(option => option.setName('role').setDescription('Reward role').setRequired(true))
            .addIntegerOption(option => option.setName('level').setDescription('Required level').setMinValue(1).setMaxValue(999).setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName('sync').setDescription('Sync level roles for all members'))
        .addSubcommand(subcommand => subcommand.setName('stack').setDescription('Configure role stacking')
            .addStringOption(option => option.setName('mode').setDescription('Role behavior').setRequired(true)
                .addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' }))))
    .addSubcommandGroup(group => group
        .setName('ignore')
        .setDescription('Manage XP exclusions')
        .addSubcommand(subcommand => subcommand.setName('channel').setDescription('Toggle an ignored channel')
            .addChannelOption(option => option.setName('channel').setDescription('Channel').setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName('role').setDescription('Toggle an ignored role')
            .addRoleOption(option => option.setName('role').setDescription('Role').setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName('list').setDescription('List XP exclusions')))
    .addSubcommandGroup(group => group
        .setName('message')
        .setDescription('Manage level-up messages')
        .addSubcommand(subcommand => subcommand.setName('set').setDescription('Set the level-up script')
            .addStringOption(option => option.setName('script').setDescription('Message or embed script').setMaxLength(2000).setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName('view').setDescription('View the level-up script'))
        .addSubcommand(subcommand => subcommand.setName('disable').setDescription('Disable level-up messages')))
    .addSubcommandGroup(group => group
        .setName('rankcard')
        .setDescription('View and customize rank cards')
        .addSubcommand(subcommand => subcommand.setName('view').setDescription('View a rank card')
            .addUserOption(option => option.setName('member').setDescription('Member to view')))
        .addSubcommand(subcommand => subcommand.setName('color').setDescription('Set or reset the accent color')
            .addStringOption(option => option.setName('color').setDescription('Hex color or reset').setMaxLength(7).setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName('style').setDescription('Customize rank card styling')
            .addAttachmentOption(option => option.setName('background').setDescription('Background image up to 5 MiB'))
            .addStringOption(option => option.setName('background_url').setDescription('HTTPS background image URL').setMaxLength(2000))
            .addStringOption(option => option.setName('layout').setDescription('Card layout')
                .addChoices({ name: 'Classic', value: 'classic' }, { name: 'Compact', value: 'compact' }))
            .addIntegerOption(option => option.setName('avatar_border').setDescription('Avatar border width').setMinValue(0).setMaxValue(20))))
    .addSubcommandGroup(group => group
        .setName('reset')
        .setDescription('Reset level data')
        .addSubcommand(subcommand => subcommand.setName('user').setDescription('Reset one member').addUserOption(member))
        .addSubcommand(subcommand => subcommand.setName('all').setDescription('Reset all server XP')));

module.exports = {
    data,
    permissions: [],
    cooldown: 2,
    async execute(interaction, client) {
        if (!client.levelAnalyticsService) throw new Error('Level service is unavailable');
        return client.levelAnalyticsService.execute(interaction);
    },
    async handleInteraction(interaction, client) {
        if (!client.levelAnalyticsService) throw new Error('Level service is unavailable');
        return client.levelAnalyticsService.handleInteraction(interaction);
    }
};
