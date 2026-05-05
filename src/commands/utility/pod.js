const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { executeAliasCommand } = require('../../utils/commandAlias');

function aliasFor(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand(false);

    if (group === 'settings') {
        return {
            commandName: 'bytepod',
            requirePath: 'src/commands/utility/bytepod.js',
            subcommand: subcommand === 'name-style' ? 'namestyle' : subcommand,
            subcommandGroup: null
        };
    }

    if (group === 'template') {
        return {
            commandName: 'bytepod',
            requirePath: 'src/commands/utility/bytepod.js',
            subcommand: subcommand === 'remove' ? 'delete' : subcommand,
            subcommandGroup: 'template'
        };
    }

    if (group === 'preset') {
        return {
            commandName: 'bytepod',
            requirePath: 'src/commands/utility/bytepod.js',
            subcommand,
            subcommandGroup: 'preset'
        };
    }

    return {
        commandName: 'bytepod',
        requirePath: 'src/commands/utility/bytepod.js',
        subcommand: subcommand === 'top' ? 'leaderboard' : subcommand,
        subcommandGroup: null
    };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pod')
        .setDescription('BytePod voice channel actions and settings')
        .setDMPermission(false)
        .addSubcommand(sub => sub.setName('panel').setDescription('Post your BytePod control panel'))
        .addSubcommand(sub => sub
            .setName('stats')
            .setDescription('View BytePod voice statistics')
            .addUserOption(opt => opt.setName('user').setDescription('User to view')))
        .addSubcommand(sub => sub.setName('top').setDescription('View top BytePod users'))
        .addSubcommandGroup(group => group
            .setName('settings')
            .setDescription('Personal BytePod settings')
            .addSubcommand(sub => sub
                .setName('autolock')
                .setDescription('Auto-lock newly created pods')
                .addBooleanOption(opt => opt.setName('enabled').setDescription('Auto-lock new pods?').setRequired(true)))
            .addSubcommand(sub => sub
                .setName('name-style')
                .setDescription('Set generated pod name style')
                .addStringOption(opt => opt
                    .setName('style')
                    .setDescription('Name style')
                    .setRequired(true)
                    .addChoices(
                        { name: "Username's Pod", value: 'username' },
                        { name: 'Random funny name', value: 'random' }
                    ))))
        .addSubcommandGroup(group => group
            .setName('preset')
            .setDescription('Auto-whitelist presets')
            .addSubcommand(sub => sub
                .setName('add')
                .setDescription('Add a user to your preset')
                .addUserOption(opt => opt.setName('user').setDescription('User to add').setRequired(true)))
            .addSubcommand(sub => sub
                .setName('remove')
                .setDescription('Remove a user from your preset')
                .addUserOption(opt => opt.setName('user').setDescription('User to remove').setRequired(true)))
            .addSubcommand(sub => sub.setName('list').setDescription('List preset users')))
        .addSubcommandGroup(group => group
            .setName('template')
            .setDescription('BytePod templates')
            .addSubcommand(sub => sub
                .setName('save')
                .setDescription('Save current pod settings as a template')
                .addStringOption(opt => opt.setName('name').setDescription('Template name').setRequired(true).setMaxLength(32)))
            .addSubcommand(sub => sub
                .setName('load')
                .setDescription('Load a template into your current pod')
                .addStringOption(opt => opt.setName('name').setDescription('Template name').setRequired(true)))
            .addSubcommand(sub => sub.setName('list').setDescription('List templates'))
            .addSubcommand(sub => sub
                .setName('remove')
                .setDescription('Remove a template')
                .addStringOption(opt => opt.setName('name').setDescription('Template name').setRequired(true))))
        .addSubcommand(sub => sub
            .setName('setup')
            .setDescription('Configure the Join to Create hub channel')
            .addChannelOption(opt => opt
                .setName('channel')
                .setDescription('Voice hub channel')
                .addChannelTypes(ChannelType.GuildVoice)
                .setRequired(true))
            .addChannelOption(opt => opt
                .setName('category')
                .setDescription('Category for new BytePods')
                .addChannelTypes(ChannelType.GuildCategory)))
        .addSubcommand(sub => sub.setName('disable').setDescription('Disable BytePods for this server')),

    async execute(interaction, client) {
        return executeAliasCommand(interaction, client, aliasFor(interaction));
    }
};
