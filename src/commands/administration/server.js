const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { executeAliasCommand } = require('../../utils/commandAlias');

const TARGETS = {
    info: { commandName: 'serverinfo', requirePath: 'src/commands/utility/serverinfo.js' },
    stats: { commandName: 'stats', requirePath: 'src/commands/utility/stats.js', subcommand: 'server' },
    config: { commandName: 'config', requirePath: 'src/commands/administration/config.js' },
    logs: { commandName: 'config', requirePath: 'src/commands/administration/config.js', map: { set: 'logs' } },
    welcome: { commandName: 'welcome', requirePath: 'src/commands/administration/welcome.js', map: { enable: 'toggle', disable: 'toggle', format: 'embed' } },
    starboard: { commandName: 'starboard', requirePath: 'src/commands/administration/starboard.js', map: { view: 'config' } },
    suggestion: { commandName: 'suggestion', requirePath: 'src/commands/administration/suggestion.js', map: { top: 'leaderboard' } },
    birthday: { commandName: 'birthday', requirePath: 'src/commands/utility/birthday.js' },
    permissions: { commandName: 'perm', requirePath: 'src/commands/administration/perm.js' },
    achievement: { commandName: 'achievement', requirePath: 'src/commands/administration/achievement.js', map: { roles: 'list_roles' } },
    streak: { commandName: 'streak', requirePath: 'src/commands/utility/streak.js', map: { top: 'leaderboard' } }
};

function aliasFor(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand(false);

    if (!group) {
        return {
            ...TARGETS[subcommand],
            subcommand: TARGETS[subcommand].subcommand || null,
            subcommandGroup: null
        };
    }

    const target = TARGETS[group];
    const legacySubcommand = target.map?.[subcommand] || subcommand;
    const optionValues = {};

    if (group === 'welcome' && (subcommand === 'enable' || subcommand === 'disable')) {
        optionValues.enabled = subcommand === 'enable';
    }

    if (group === 'welcome' && subcommand === 'format') {
        optionValues.use_embed = interaction.options.getBoolean('use_embed');
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
        .setName('server')
        .setDescription('Server information, setup, and community systems')
        .setDMPermission(false)
        .addSubcommand(sub => sub.setName('info').setDescription('View server information'))
        .addSubcommand(sub => sub
            .setName('stats')
            .setDescription('View server statistics')
            .addBooleanOption(opt => opt.setName('private').setDescription('Show only to you')))
        .addSubcommandGroup(group => group
            .setName('config')
            .setDescription('Server configuration')
            .addSubcommand(sub => sub.setName('view').setDescription('View server configuration')))
        .addSubcommandGroup(group => group
            .setName('logs')
            .setDescription('Moderation log settings')
            .addSubcommand(sub => sub
                .setName('set')
                .setDescription('Set the moderation log channel')
                .addChannelOption(opt => opt
                    .setName('channel')
                    .setDescription('Log channel')
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true))))
        .addSubcommandGroup(group => group
            .setName('welcome')
            .setDescription('Welcome message system')
            .addSubcommand(sub => sub
                .setName('setup')
                .setDescription('Set the welcome channel')
                .addChannelOption(opt => opt.setName('channel').setDescription('Welcome channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
            .addSubcommand(sub => sub
                .setName('message')
                .setDescription('Set the welcome message')
                .addStringOption(opt => opt.setName('text').setDescription('Message text').setRequired(true).setMaxLength(2000)))
            .addSubcommand(sub => sub.setName('enable').setDescription('Enable welcome messages'))
            .addSubcommand(sub => sub.setName('disable').setDescription('Disable welcome messages'))
            .addSubcommand(sub => sub
                .setName('format')
                .setDescription('Set welcome message format')
                .addBooleanOption(opt => opt.setName('use_embed').setDescription('Send as an embed?').setRequired(true)))
            .addSubcommand(sub => sub.setName('variables').setDescription('View welcome variables'))
            .addSubcommand(sub => sub.setName('test').setDescription('Send a test welcome message'))
            .addSubcommand(sub => sub.setName('view').setDescription('View welcome settings')))
        .addSubcommandGroup(group => group
            .setName('starboard')
            .setDescription('Starboard system')
            .addSubcommand(sub => sub
                .setName('setup')
                .setDescription('Set up starboard')
                .addChannelOption(opt => opt.setName('channel').setDescription('Starboard channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
                .addIntegerOption(opt => opt.setName('threshold').setDescription('Stars required').setMinValue(1).setMaxValue(50))
                .addStringOption(opt => opt.setName('emoji').setDescription('Emoji to track')))
            .addSubcommand(sub => sub.setName('view').setDescription('View starboard settings'))
            .addSubcommand(sub => sub.setName('enable').setDescription('Enable starboard'))
            .addSubcommand(sub => sub.setName('disable').setDescription('Disable starboard'))
            .addSubcommand(sub => sub
                .setName('top')
                .setDescription('View top starred messages')
                .addIntegerOption(opt => opt.setName('limit').setDescription('Messages to show').setMinValue(1).setMaxValue(25))))
        .addSubcommandGroup(group => group
            .setName('suggestion')
            .setDescription('Suggestion system')
            .addSubcommand(sub => sub
                .setName('submit')
                .setDescription('Submit a suggestion')
                .addStringOption(opt => opt.setName('idea').setDescription('Suggestion idea').setRequired(true).setMaxLength(2000))
                .addBooleanOption(opt => opt.setName('anonymous').setDescription('Submit anonymously')))
            .addSubcommand(sub => sub
                .setName('view')
                .setDescription('View a suggestion')
                .addIntegerOption(opt => opt.setName('id').setDescription('Suggestion ID').setRequired(true)))
            .addSubcommand(sub => sub
                .setName('list')
                .setDescription('List suggestions')
                .addStringOption(opt => opt.setName('status').setDescription('Filter by status'))
                .addIntegerOption(opt => opt.setName('limit').setDescription('Suggestions to show').setMinValue(1).setMaxValue(25)))
            .addSubcommand(sub => sub
                .setName('top')
                .setDescription('View top suggestions')
                .addIntegerOption(opt => opt.setName('limit').setDescription('Suggestions to show').setMinValue(1).setMaxValue(25)))
            .addSubcommand(sub => sub
                .setName('setup')
                .setDescription('Configure suggestions')
                .addChannelOption(opt => opt.setName('channel').setDescription('Suggestion channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
                .addRoleOption(opt => opt.setName('review_role').setDescription('Review role'))
                .addBooleanOption(opt => opt.setName('allow_anonymous').setDescription('Allow anonymous suggestions')))
            .addSubcommand(sub => sub
                .setName('approve')
                .setDescription('Approve a suggestion')
                .addIntegerOption(opt => opt.setName('id').setDescription('Suggestion ID').setRequired(true))
                .addStringOption(opt => opt.setName('reason').setDescription('Reason').setMaxLength(500)))
            .addSubcommand(sub => sub
                .setName('deny')
                .setDescription('Deny a suggestion')
                .addIntegerOption(opt => opt.setName('id').setDescription('Suggestion ID').setRequired(true))
                .addStringOption(opt => opt.setName('reason').setDescription('Reason').setMaxLength(500)))
            .addSubcommand(sub => sub
                .setName('implement')
                .setDescription('Mark a suggestion implemented')
                .addIntegerOption(opt => opt.setName('id').setDescription('Suggestion ID').setRequired(true))
                .addStringOption(opt => opt.setName('note').setDescription('Implementation note').setMaxLength(500))))
        .addSubcommandGroup(group => group
            .setName('birthday')
            .setDescription('Server birthday system')
            .addSubcommand(sub => sub
                .setName('upcoming')
                .setDescription('View upcoming birthdays')
                .addIntegerOption(opt => opt.setName('days').setDescription('Days ahead').setMinValue(1).setMaxValue(30)))
            .addSubcommand(sub => sub
                .setName('setup')
                .setDescription('Set birthday announcement channel')
                .addChannelOption(opt => opt.setName('channel').setDescription('Announcement channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
            .addSubcommand(sub => sub
                .setName('role')
                .setDescription('Set birthday role')
                .addRoleOption(opt => opt.setName('role').setDescription('Birthday role'))))
        .addSubcommandGroup(group => group
            .setName('permissions')
            .setDescription('Command role permissions')
            .addSubcommand(sub => sub.setName('add').setDescription('Allow a role to use a command').addStringOption(opt => opt.setName('command').setDescription('Command name').setRequired(true)).addRoleOption(opt => opt.setName('role').setDescription('Allowed role').setRequired(true)))
            .addSubcommand(sub => sub.setName('remove').setDescription('Remove a command role').addStringOption(opt => opt.setName('command').setDescription('Command name').setRequired(true)).addRoleOption(opt => opt.setName('role').setDescription('Allowed role').setRequired(true)))
            .addSubcommand(sub => sub.setName('list').setDescription('List command role permissions'))
            .addSubcommand(sub => sub.setName('reset').setDescription('Reset command role permissions').addStringOption(opt => opt.setName('command').setDescription('Command name').setRequired(true))))
        .addSubcommandGroup(group => group
            .setName('achievement')
            .setDescription('Server achievement administration')
            .addSubcommand(sub => sub
                .setName('setup')
                .setDescription('Configure achievement roles')
                .addBooleanOption(opt => opt.setName('enabled').setDescription('Enable or disable role rewards'))
                .addStringOption(opt => opt.setName('prefix').setDescription('Role name prefix').setMaxLength(10))
                .addBooleanOption(opt => opt.setName('use_rarity_colors').setDescription('Use rarity-based colors'))
                .addBooleanOption(opt => opt.setName('cleanup_orphaned').setDescription('Delete roles with no members'))
                .addBooleanOption(opt => opt.setName('notify_on_earn').setDescription('Send achievement DM notifications')))
            .addSubcommand(sub => sub.setName('view').setDescription('View achievement settings'))
            .addSubcommand(sub => sub.setName('cleanup').setDescription('Clean up achievement roles'))
            .addSubcommand(sub => sub.setName('roles').setDescription('List achievement roles'))
            .addSubcommand(sub => sub.setName('create').setDescription('Create a custom achievement'))
            .addSubcommand(sub => sub.setName('award').setDescription('Award an achievement').addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true)).addStringOption(opt => opt.setName('achievement').setDescription('Achievement ID').setRequired(true)))
            .addSubcommand(sub => sub.setName('remove').setDescription('Remove an achievement').addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true)).addStringOption(opt => opt.setName('achievement').setDescription('Achievement ID').setRequired(true)))
            .addSubcommand(sub => sub.setName('enable').setDescription('Enable the achievement system'))
            .addSubcommand(sub => sub.setName('disable').setDescription('Disable the achievement system')))
        .addSubcommandGroup(group => group
            .setName('streak')
            .setDescription('Server streak rankings')
            .addSubcommand(sub => sub
                .setName('top')
                .setDescription('View streak leaderboard')
                .addStringOption(opt => opt.setName('type').setDescription('Leaderboard type')))),

    async execute(interaction, client) {
        return executeAliasCommand(interaction, client, aliasFor(interaction));
    }
};
