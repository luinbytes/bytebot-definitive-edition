const { SlashCommandBuilder } = require('discord.js');

const amountOrAll = sub => sub
    .addIntegerOption(option => option.setName('amount').setDescription('Whole currency amount').setMinValue(1).setMaxValue(1000000000000))
    .addBooleanOption(option => option.setName('all').setDescription('Move the entire available balance'));

const memberAmountReason = sub => sub
    .addUserOption(option => option.setName('member').setDescription('Server member').setRequired(true))
    .addIntegerOption(option => option.setName('amount').setDescription('Whole currency amount').setMinValue(1).setMaxValue(1000000000000).setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Audit reason').setMinLength(1).setMaxLength(256).setRequired(true));

const confirmation = sub => sub.addStringOption(option => option.setName('confirmation').setDescription('Code from the exact action preview').setMinLength(10).setMaxLength(10));

const data = new SlashCommandBuilder()
    .setName('economy')
    .setDescription('Earn, bank, spend, and manage virtual currency')
    .setDMPermission(false)
    .addSubcommand(sub => sub.setName('open').setDescription('Create an economy account'))
    .addSubcommand(sub => sub.setName('balance').setDescription('View a wallet, bank, total, and rank')
        .addUserOption(option => option.setName('member').setDescription('Member; defaults to you'))
        .addStringOption(option => option.setName('scope').setDescription('Balance scope')
            .addChoices({ name: 'Guild', value: 'guild' }, { name: 'Global', value: 'global' })))
    .addSubcommand(sub => sub.setName('mode').setDescription('View or change your economy mode')
        .addStringOption(option => option.setName('scope').setDescription('New mode')
            .addChoices({ name: 'Guild', value: 'guild' }, { name: 'Global', value: 'global' })))
    .addSubcommand(sub => amountOrAll(sub.setName('deposit').setDescription('Move wallet currency into your bank')))
    .addSubcommand(sub => amountOrAll(sub.setName('withdraw').setDescription('Move bank currency into your wallet')))
    .addSubcommand(sub => sub.setName('daily').setDescription('Claim the 750-coin daily payout'))
    .addSubcommand(sub => sub.setName('work').setDescription('Work a job for a 1.5x payout')
        .addStringOption(option => option.setName('job').setDescription('Job name or ID').setAutocomplete(true)))
    .addSubcommand(sub => sub.setName('transfer').setDescription('Transfer wallet currency to a member')
        .addUserOption(option => option.setName('member').setDescription('Recipient').setRequired(true))
        .addIntegerOption(option => option.setName('amount').setDescription('Whole currency amount').setMinValue(1).setMaxValue(1000000000000).setRequired(true)))
    .addSubcommand(sub => sub.setName('config').setDescription('View or change guild economy configuration')
        .addStringOption(option => option.setName('currency_name').setDescription('Currency name').setMinLength(1).setMaxLength(32))
        .addStringOption(option => option.setName('currency_emoji').setDescription('Currency emoji').setMinLength(1).setMaxLength(32))
        .addIntegerOption(option => option.setName('starting_balance').setDescription('New-account starting wallet').setMinValue(0).setMaxValue(1000000))
        .addIntegerOption(option => option.setName('daily_cap').setDescription('Daily work plus daily cap').setMinValue(1).setMaxValue(50000)))
    .addSubcommand(sub => sub.setName('circulation').setDescription('View committed economy circulation')
        .addStringOption(option => option.setName('scope').setDescription('Circulation scope')
            .addChoices({ name: 'Guild', value: 'guild' }, { name: 'Global', value: 'global' })))
    .addSubcommand(sub => sub.setName('enable').setDescription('Enable this guild economy'))
    .addSubcommand(sub => sub.setName('preset').setDescription('Apply the standard economy preset')
        .addStringOption(option => option.setName('name').setDescription('Preset').setRequired(true)
            .addChoices({ name: 'Standard', value: 'standard' })))
    .addSubcommand(sub => memberAmountReason(sub.setName('grant').setDescription('Mint currency to a member')))
    .addSubcommand(sub => memberAmountReason(sub.setName('remove').setDescription('Remove currency from a member')))
    .addSubcommand(sub => confirmation(sub.setName('reset').setDescription("Reset a member's guild economy account")
        .addUserOption(option => option.setName('member').setDescription('Member').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Audit reason').setMinLength(1).setMaxLength(256).setRequired(true))))
    .addSubcommand(sub => confirmation(memberAmountReason(sub.setName('destroy').setDescription('Destroy member currency'))))
    .addSubcommand(sub => confirmation(sub.setName('disable').setDescription('Disable this guild economy without deleting data')
        .addStringOption(option => option.setName('reason').setDescription('Audit reason').setMinLength(1).setMaxLength(256).setRequired(true))))
    .addSubcommandGroup(group => group.setName('job').setDescription('View and manage guild jobs')
        .addSubcommand(sub => sub.setName('list').setDescription('List available jobs'))
        .addSubcommand(sub => sub.setName('add').setDescription('Add a guild job')
            .addStringOption(option => option.setName('name').setDescription('Job name').setMinLength(1).setMaxLength(32).setRequired(true))
            .addIntegerOption(option => option.setName('minimum').setDescription('Minimum base payout').setMinValue(1).setMaxValue(49999).setRequired(true))
            .addIntegerOption(option => option.setName('maximum').setDescription('Maximum base payout').setMinValue(2).setMaxValue(50000).setRequired(true))
            .addIntegerOption(option => option.setName('cooldown_seconds').setDescription('60 to 604800 seconds').setMinValue(60).setMaxValue(604800).setRequired(true)))
        .addSubcommand(sub => sub.setName('remove').setDescription('Remove a custom job')
            .addStringOption(option => option.setName('job').setDescription('Job name or ID').setAutocomplete(true).setRequired(true))))
    .addSubcommandGroup(group => group.setName('shop').setDescription('Browse and manage the guild role shop')
        .addSubcommand(sub => sub.setName('list').setDescription('List role-shop items'))
        .addSubcommand(sub => sub.setName('buy').setDescription('Buy a role')
            .addStringOption(option => option.setName('item').setDescription('Shop item ID').setAutocomplete(true).setRequired(true)))
        .addSubcommand(sub => sub.setName('add').setDescription('Add a role to the shop')
            .addRoleOption(option => option.setName('role').setDescription('Role').setRequired(true))
            .addIntegerOption(option => option.setName('price').setDescription('Role price').setMinValue(1).setMaxValue(1000000000000).setRequired(true)))
        .addSubcommand(sub => sub.setName('remove').setDescription('Remove a role from the shop')
            .addStringOption(option => option.setName('item').setDescription('Shop item ID').setAutocomplete(true).setRequired(true))));

module.exports = {
    data,
    permissions: [],
    cooldown: 2,
    async execute(interaction, client) {
        if (!client.economyService) throw new Error('Economy service is unavailable.');
        return client.economyService.handleCommand(interaction);
    },
    autocomplete(interaction, client) {
        return client.economyService?.autocomplete(interaction) || interaction.respond([]);
    }
};
