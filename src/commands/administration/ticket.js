const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');

const data = new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Create and manage support tickets')
    .setDMPermission(false)
    .addSubcommand(sub => sub.setName('setup').setDescription('Set up the default ticket panel')
        .addChannelOption(option => option.setName('channel').setDescription('Panel channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(sub => sub.setName('support').setDescription('Set the default support role')
        .addRoleOption(option => option.setName('role').setDescription('Support role').setRequired(true)))
    .addSubcommand(sub => sub.setName('category').setDescription('Set the default ticket category')
        .addChannelOption(option => option.setName('category').setDescription('Ticket category').addChannelTypes(ChannelType.GuildCategory).setRequired(true)))
    .addSubcommand(sub => sub.setName('message').setDescription('Set the opening ticket message')
        .addStringOption(option => option.setName('message').setDescription('Opening message').setMaxLength(2000).setRequired(true)))
    .addSubcommand(sub => sub.setName('button').setDescription('Set the default panel button')
        .addStringOption(option => option.setName('label').setDescription('Button label').setMaxLength(80).setRequired(true))
        .addStringOption(option => option.setName('style').setDescription('Button style').addChoices(
            { name: 'Primary', value: 'primary' }, { name: 'Secondary', value: 'secondary' },
            { name: 'Success', value: 'success' }, { name: 'Danger', value: 'danger' }
        )))
    .addSubcommand(sub => sub.setName('reset').setDescription('Reset ticket configuration without deleting tickets')
        .addBooleanOption(option => option.setName('confirm').setDescription('Confirm the reset').setRequired(true)))
    .addSubcommand(sub => sub.setName('add').setDescription('Add a member or role to this ticket')
        .addUserOption(option => option.setName('member').setDescription('Member to add'))
        .addRoleOption(option => option.setName('role').setDescription('Role to add')))
    .addSubcommand(sub => sub.setName('remove').setDescription('Remove a member or role from this ticket')
        .addUserOption(option => option.setName('member').setDescription('Member to remove'))
        .addRoleOption(option => option.setName('role').setDescription('Role to remove')))
    .addSubcommand(sub => sub.setName('rename').setDescription('Rename this ticket')
        .addStringOption(option => option.setName('name').setDescription('New channel name').setMinLength(1).setMaxLength(100).setRequired(true)))
    .addSubcommand(sub => sub.setName('claim').setDescription('Claim this ticket'))
    .addSubcommand(sub => sub.setName('unclaim').setDescription('Release this ticket'))
    .addSubcommand(sub => sub.setName('close').setDescription('Close this ticket')
        .addStringOption(option => option.setName('reason').setDescription('Closure reason').setMaxLength(1000)))
    .addSubcommand(sub => sub.setName('reopen').setDescription('Reopen this ticket'))
    .addSubcommand(sub => sub.setName('delete').setDescription('Transcribe and delete this ticket')
        .addBooleanOption(option => option.setName('confirm').setDescription('Confirm deletion').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Deletion reason').setMaxLength(1000)))
    .addSubcommand(sub => sub.setName('transcript').setDescription('Create or retrieve a ticket transcript')
        .addIntegerOption(option => option.setName('id').setDescription('Archived transcript ID; omit for this channel').setMinValue(1)))
    .addSubcommand(sub => sub.setName('move').setDescription('Move this ticket to a category')
        .addChannelOption(option => option.setName('category').setDescription('Destination category').addChannelTypes(ChannelType.GuildCategory).setRequired(true)))
    .addSubcommand(sub => sub.setName('reason').setDescription('Edit this ticket reason')
        .addStringOption(option => option.setName('reason').setDescription('Ticket reason').setMaxLength(1000).setRequired(true)))
    .addSubcommand(sub => sub.setName('list').setDescription('List tickets you may access')
        .addStringOption(option => option.setName('status').setDescription('Status filter').addChoices(
            { name: 'Open', value: 'open' }, { name: 'Closed', value: 'closed' }, { name: 'All', value: 'all' }
        )))
    .addSubcommand(sub => sub.setName('stats').setDescription('View ticket and staff totals')
        .addUserOption(option => option.setName('member').setDescription('Optional staff member')))
    .addSubcommandGroup(group => group.setName('panel').setDescription('Manage ticket panels')
        .addSubcommand(sub => sub.setName('create').setDescription('Create a ticket panel')
            .addStringOption(option => option.setName('name').setDescription('Panel name').setMinLength(1).setMaxLength(100).setRequired(true))
            .addStringOption(option => option.setName('mode').setDescription('Panel control').addChoices(
                { name: 'Dropdown', value: 'dropdown' }, { name: 'Buttons', value: 'button' }
            )))
        .addSubcommand(sub => sub.setName('send').setDescription('Publish a configured panel')
            .addStringOption(option => option.setName('panel').setDescription('Panel name').setRequired(true).setAutocomplete(true))
            .addChannelOption(option => option.setName('channel').setDescription('Destination channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand(sub => sub.setName('manage').setDescription('Open the option and form manager')
            .addStringOption(option => option.setName('panel').setDescription('Panel name').setRequired(true).setAutocomplete(true))
            .addIntegerOption(option => option.setName('option_id').setDescription('Open one option by ID'))
            .addIntegerOption(option => option.setName('form_id').setDescription('Open one form by ID')))
        .addSubcommand(sub => sub.setName('remove').setDescription('Remove a panel without deleting tickets')
            .addStringOption(option => option.setName('panel').setDescription('Panel name').setRequired(true).setAutocomplete(true))
            .addBooleanOption(option => option.setName('confirm').setDescription('Confirm removal').setRequired(true)))
        .addSubcommand(sub => sub.setName('list').setDescription('List ticket panels')))
    .addSubcommandGroup(group => group.setName('topics').setDescription('Manage ticket topics')
        .addSubcommand(sub => sub.setName('add').setDescription('Add a ticket topic')
            .addStringOption(option => option.setName('name').setDescription('Topic name').setMinLength(1).setMaxLength(100).setRequired(true))
            .addStringOption(option => option.setName('description').setDescription('Topic description').setMaxLength(1000)))
        .addSubcommand(sub => sub.setName('remove').setDescription('Remove a ticket topic')
            .addStringOption(option => option.setName('topic').setDescription('Topic name').setRequired(true).setAutocomplete(true)))
        .addSubcommand(sub => sub.setName('category').setDescription('Set a topic category')
            .addStringOption(option => option.setName('topic').setDescription('Topic name').setRequired(true).setAutocomplete(true))
            .addChannelOption(option => option.setName('category').setDescription('Ticket category').addChannelTypes(ChannelType.GuildCategory).setRequired(true)))
        .addSubcommand(sub => sub.setName('role').setDescription('Add or remove a topic access role')
            .addStringOption(option => option.setName('action').setDescription('Role action').setRequired(true).addChoices(
                { name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }
            ))
            .addStringOption(option => option.setName('topic').setDescription('Topic name').setRequired(true).setAutocomplete(true))
            .addRoleOption(option => option.setName('role').setDescription('Access role').setRequired(true)))
        .addSubcommand(sub => sub.setName('embed').setDescription('Set or clear a topic message')
            .addStringOption(option => option.setName('topic').setDescription('Topic name').setRequired(true).setAutocomplete(true))
            .addStringOption(option => option.setName('script').setDescription('Rich-message script; omit to clear').setMaxLength(2000)))
        .addSubcommand(sub => sub.setName('list').setDescription('List ticket topics')))
    .addSubcommandGroup(group => group.setName('settings').setDescription('Manage ticket settings')
        .addSubcommand(sub => sub.setName('view').setDescription('View ticket settings'))
        .addSubcommand(sub => sub.setName('dms').setDescription('Enable or disable ticket DMs')
            .addBooleanOption(option => option.setName('enabled').setDescription('DM status').setRequired(true)))
        .addSubcommand(sub => sub.setName('inactivity').setDescription('Set inactivity checking')
            .addIntegerOption(option => option.setName('hours').setDescription('1–168 hours; omit to disable').setMinValue(1).setMaxValue(168)))
        .addSubcommand(sub => sub.setName('limit').setDescription('Set the member opening limit')
            .addStringOption(option => option.setName('mode').setDescription('Opening policy').setRequired(true).addChoices(
                { name: 'One ticket total', value: 'one_total' }, { name: 'One per topic', value: 'one_per_topic' },
                { name: 'Unlimited', value: 'unlimited' }
            )))
        .addSubcommand(sub => sub.setName('logs').setDescription('Set or clear the ticket log channel')
            .addChannelOption(option => option.setName('channel').setDescription('Log channel').addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(sub => sub.setName('rating').setDescription('Enable or disable deletion ratings')
            .addBooleanOption(option => option.setName('enabled').setDescription('Rating status').setRequired(true)))
        .addSubcommand(sub => sub.setName('vouch').setDescription('Set or clear the rating vouch channel')
            .addChannelOption(option => option.setName('channel').setDescription('Vouch channel').addChannelTypes(ChannelType.GuildText))))
    .addSubcommandGroup(group => group.setName('access').setDescription('Manage the ticket opening blacklist')
        .addSubcommand(sub => sub.setName('blacklist').setDescription('Block a member or role from opening tickets')
            .addUserOption(option => option.setName('member').setDescription('Member to block'))
            .addRoleOption(option => option.setName('role').setDescription('Role to block')))
        .addSubcommand(sub => sub.setName('unblacklist').setDescription('Remove a member or role from the blacklist')
            .addUserOption(option => option.setName('member').setDescription('Member to unblock'))
            .addRoleOption(option => option.setName('role').setDescription('Role to unblock')))
        .addSubcommand(sub => sub.setName('list').setDescription('List blocked members and roles')))
    .addSubcommandGroup(group => group.setName('profile').setDescription('Manage claim greetings')
        .addSubcommand(sub => sub.setName('set').setDescription('Set your claim greeting')
            .addStringOption(option => option.setName('greeting').setDescription('Claim greeting').setMinLength(1).setMaxLength(2000).setRequired(true)))
        .addSubcommand(sub => sub.setName('view').setDescription('View a claim greeting')
            .addUserOption(option => option.setName('member').setDescription('Staff member; defaults to you')))
        .addSubcommand(sub => sub.setName('clear').setDescription('Clear your claim greeting')));

module.exports = {
    data,
    permissions: [],
    cooldown: 2,
    longRunning: true,
    deferEphemeral: true,

    async autocomplete(interaction, client) {
        if (!client.ticketService) return interaction.respond([]);
        return client.ticketService.autocomplete(interaction);
    },

    async execute(interaction, client) {
        if (!client.ticketService) return interaction.editReply({ content: 'Ticket service is unavailable.', flags: [MessageFlags.Ephemeral] });
        return client.ticketService.handleCommand(interaction);
    }
};
