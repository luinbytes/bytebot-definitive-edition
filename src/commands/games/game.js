const { SlashCommandBuilder } = require('discord.js');
const { executeAliasCommand } = require('../../utils/commandAlias');

function aliasFor(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand(false);

    if (group === 'f1') {
        return {
            commandName: 'f1',
            requirePath: 'src/commands/games/f1.js',
            subcommand: subcommand === 'circuit' ? 'info' : subcommand,
            subcommandGroup: null
        };
    }

    return {
        commandName: 'warthunder',
        requirePath: 'src/commands/games/warthunder.js',
        subcommand,
        subcommandGroup: null
    };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('game')
        .setDescription('Game integrations')
        .addSubcommandGroup(group => group
            .setName('f1')
            .setDescription('Formula 1 racing data')
            .addSubcommand(sub => sub.setName('schedule').setDescription('Show upcoming F1 races'))
            .addSubcommand(sub => sub.setName('standings').setDescription('Show current F1 standings'))
            .addSubcommand(sub => sub
                .setName('circuit')
                .setDescription('Get info about a race circuit')
                .addStringOption(opt => opt.setName('circuit').setDescription('Circuit name').setRequired(true))
                .addIntegerOption(opt => opt.setName('year').setDescription('Season year').setMinValue(2018)))
            .addSubcommand(sub => sub
                .setName('drivers')
                .setDescription('Show F1 drivers for a season')
                .addIntegerOption(opt => opt.setName('year').setDescription('Season year').setMinValue(2018))))
        .addSubcommandGroup(group => group
            .setName('warthunder')
            .setDescription('War Thunder statistics and tools')
            .addSubcommand(sub => sub
                .setName('stats')
                .setDescription('Get War Thunder player statistics')
                .addStringOption(opt => opt.setName('nickname').setDescription('Player nickname'))
                .addBooleanOption(opt => opt.setName('private').setDescription('Show only to you')))
            .addSubcommand(sub => sub
                .setName('bind')
                .setDescription('Bind your War Thunder account')
                .addStringOption(opt => opt.setName('nickname').setDescription('Your War Thunder nickname').setRequired(true)))),

    async execute(interaction, client) {
        return executeAliasCommand(interaction, client, aliasFor(interaction));
    }
};
