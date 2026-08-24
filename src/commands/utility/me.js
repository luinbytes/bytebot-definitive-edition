const { SlashCommandBuilder } = require('discord.js');
const { executeAliasCommand } = require('../../utils/commandAlias');
const { executePersonalUtility } = require('../../utils/personalUtilityCommand');

const PERSONAL_GROUPS = new Set(['afk', 'timezone', 'diary']);

const TARGETS = {
    avatar: { commandName: 'avatar', requirePath: 'src/commands/utility/avatar.js' },
    info: { commandName: 'userinfo', requirePath: 'src/commands/utility/userinfo.js' },
    settings: { commandName: 'settings', requirePath: 'src/commands/utility/settings.js', map: { 'pod-summaries': 'summaries' } },
    reminder: { commandName: 'reminder', requirePath: 'src/commands/utility/reminder.js' },
    bookmark: { commandName: 'bookmark', requirePath: 'src/commands/utility/bookmark.js', map: { remove: 'delete' } },
    birthday: { commandName: 'birthday', requirePath: 'src/commands/utility/birthday.js' },
    streak: { commandName: 'streak', requirePath: 'src/commands/utility/streak.js' },
    achievement: { commandName: 'streak', requirePath: 'src/commands/utility/streak.js', map: { browse: 'achievements' } }
};

function group(interaction) {
    return interaction.options.getSubcommandGroup(false);
}

function subcommand(interaction) {
    return interaction.options.getSubcommand(false);
}

function aliasFor(interaction) {
    const currentGroup = group(interaction);
    const currentSubcommand = subcommand(interaction);

    if (!currentGroup) {
        if (currentSubcommand === 'info') {
            return {
                ...TARGETS.info,
                optionValues: {
                    target: interaction.options.getUser('user')
                }
            };
        }

        return TARGETS[currentSubcommand];
    }

    const target = TARGETS[currentGroup];
    let legacySubcommand = target.map?.[currentSubcommand] || currentSubcommand;
    const optionValues = {};

    if (currentGroup === 'reminder' && currentSubcommand === 'add') {
        legacySubcommand = interaction.options.getString('delivery') === 'channel' ? 'here' : 'me';
    }

    return {
        ...target,
        subcommand: legacySubcommand,
        subcommandGroup: null,
        optionValues
    };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('me')
        .setDescription('Personal ByteBot actions and preferences')
        .setDMPermission(false)
        .addSubcommand(sub => sub
            .setName('avatar')
            .setDescription('View your avatar or another user avatar')
            .addUserOption(opt => opt.setName('user').setDescription('User to view')))
        .addSubcommand(sub => sub
            .setName('info')
            .setDescription('View your profile or another user profile')
            .addUserOption(opt => opt.setName('user').setDescription('User to view')))
        .addSubcommandGroup(group => group
            .setName('settings')
            .setDescription('Manage personal settings')
            .addSubcommand(sub => sub.setName('view').setDescription('View your current settings'))
            .addSubcommand(sub => sub
                .setName('privacy')
                .setDescription('Set response privacy')
                .addStringOption(opt => opt
                    .setName('preference')
                    .setDescription('Privacy preference')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Default (Smart)', value: 'default' },
                        { name: 'Always Private', value: 'always' },
                        { name: 'Always Public', value: 'public' }
                    )))
            .addSubcommand(sub => sub
                .setName('achievements')
                .setDescription('Enable or disable achievement tracking')
                .addBooleanOption(opt => opt.setName('enabled').setDescription('Track achievements?').setRequired(true)))
            .addSubcommand(sub => sub
                .setName('pod-summaries')
                .setDescription('Enable or disable BytePod session summary DMs')
                .addBooleanOption(opt => opt.setName('enabled').setDescription('Receive session summaries?').setRequired(true))))
        .addSubcommandGroup(group => group
            .setName('reminder')
            .setDescription('Manage reminders')
            .addSubcommand(sub => sub
                .setName('add')
                .setDescription('Add a reminder')
                .addStringOption(opt => opt
                    .setName('delivery')
                    .setDescription('Where to send the reminder')
                    .setRequired(true)
                    .addChoices(
                        { name: 'DM', value: 'dm' },
                        { name: 'This Channel', value: 'channel' }
                    ))
                .addStringOption(opt => opt.setName('time').setDescription('Time until reminder').setRequired(true))
                .addStringOption(opt => opt.setName('message').setDescription('Reminder message').setRequired(true).setMaxLength(1000)))
            .addSubcommand(sub => sub.setName('list').setDescription('List your active reminders'))
            .addSubcommand(sub => sub
                .setName('cancel')
                .setDescription('Cancel a reminder')
                .addIntegerOption(opt => opt.setName('id').setDescription('Reminder ID').setRequired(true).setMinValue(1)))
            .addSubcommand(sub => sub
                .setName('snooze')
                .setDescription('Snooze an active reminder')
                .addIntegerOption(opt => opt.setName('id').setDescription('Reminder ID').setRequired(true).setMinValue(1))
                .addStringOption(opt => opt.setName('time').setDescription('New time until reminder').setRequired(true))))
        .addSubcommandGroup(group => group
            .setName('afk')
            .setDescription('Manage your AFK status')
            .addSubcommand(sub => sub
                .setName('set')
                .setDescription('Set your AFK status')
                .addStringOption(opt => opt.setName('status').setDescription('Optional status').setMaxLength(25)))
            .addSubcommand(sub => sub
                .setName('embed')
                .setDescription('Set a custom AFK response script')
                .addStringOption(opt => opt.setName('script').setDescription('ByteBot embed or content script').setRequired(true).setMaxLength(2000)))
            .addSubcommand(sub => sub.setName('reset').setDescription('Reset your custom AFK response')))
        .addSubcommandGroup(group => group
            .setName('timezone')
            .setDescription('Manage your time zone')
            .addSubcommand(sub => sub
                .setName('view')
                .setDescription('View a saved time zone')
                .addUserOption(opt => opt.setName('user').setDescription('User to view')))
            .addSubcommand(sub => sub
                .setName('set')
                .setDescription('Set your time zone')
                .addStringOption(opt => opt.setName('timezone').setDescription('IANA zone, abbreviation, or supported city').setRequired(true).setMaxLength(100)))
            .addSubcommand(sub => sub.setName('remove').setDescription('Remove your saved time zone')))
        .addSubcommandGroup(group => group
            .setName('diary')
            .setDescription('Manage private diary entries')
            .addSubcommand(sub => sub
                .setName('create')
                .setDescription('Create today\'s diary entry')
                .addStringOption(opt => opt.setName('content').setDescription('Private diary content').setRequired(true).setMaxLength(2000)))
            .addSubcommand(sub => sub
                .setName('view')
                .setDescription('View one diary entry page')
                .addIntegerOption(opt => opt.setName('page').setDescription('Page number').setMinValue(1)))
            .addSubcommand(sub => sub
                .setName('delete')
                .setDescription('Delete one diary entry')
                .addIntegerOption(opt => opt.setName('id').setDescription('Diary entry ID').setRequired(true).setMinValue(1))))
        .addSubcommandGroup(group => group
            .setName('bookmark')
            .setDescription('Manage saved message bookmarks')
            .addSubcommand(sub => sub
                .setName('list')
                .setDescription('List your bookmarks')
                .addIntegerOption(opt => opt.setName('page').setDescription('Page number').setMinValue(1)))
            .addSubcommand(sub => sub
                .setName('search')
                .setDescription('Search bookmarks')
                .addStringOption(opt => opt.setName('query').setDescription('Search query').setRequired(true).setMinLength(2).setMaxLength(100)))
            .addSubcommand(sub => sub
                .setName('view')
                .setDescription('View a bookmark')
                .addIntegerOption(opt => opt.setName('id').setDescription('Bookmark ID').setRequired(true).setMinValue(1)))
            .addSubcommand(sub => sub
                .setName('remove')
                .setDescription('Remove a bookmark')
                .addIntegerOption(opt => opt.setName('id').setDescription('Bookmark ID').setRequired(true).setMinValue(1)))
            .addSubcommand(sub => sub.setName('clear').setDescription('Clear all bookmarks')))
        .addSubcommandGroup(group => group
            .setName('birthday')
            .setDescription('Manage your birthday')
            .addSubcommand(sub => sub
                .setName('set')
                .setDescription('Set your birthday')
                .addStringOption(opt => opt.setName('date').setDescription('Birthday date').setRequired(true)))
            .addSubcommand(sub => sub.setName('remove').setDescription('Remove your birthday'))
            .addSubcommand(sub => sub
                .setName('view')
                .setDescription('View a birthday')
                .addUserOption(opt => opt.setName('user').setDescription('User to view'))
                .addBooleanOption(opt => opt.setName('private').setDescription('Show only to you'))))
        .addSubcommandGroup(group => group
            .setName('streak')
            .setDescription('View activity streaks')
            .addSubcommand(sub => sub
                .setName('view')
                .setDescription('View streak progress')
                .addUserOption(opt => opt.setName('user').setDescription('User to view'))
                .addBooleanOption(opt => opt.setName('private').setDescription('Show only to you'))))
        .addSubcommandGroup(group => group
            .setName('achievement')
            .setDescription('Browse achievement progress')
            .addSubcommand(sub => sub
                .setName('browse')
                .setDescription('Browse achievements')
                .addStringOption(opt => opt.setName('category').setDescription('Achievement category'))
                .addStringOption(opt => opt.setName('rarity').setDescription('Achievement rarity'))
                .addStringOption(opt => opt.setName('filter').setDescription('Completion filter')))
            .addSubcommand(sub => sub
                .setName('progress')
                .setDescription('View achievement progress')
                .addUserOption(opt => opt.setName('user').setDescription('User to view'))
                .addBooleanOption(opt => opt.setName('private').setDescription('Show only to you')))),

    async execute(interaction, client) {
        if (PERSONAL_GROUPS.has(group(interaction))) return executePersonalUtility(interaction);
        return executeAliasCommand(interaction, client, aliasFor(interaction));
    }
};
