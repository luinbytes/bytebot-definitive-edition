const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { executeAliasCommand } = require('../../utils/commandAlias');
const embeds = require('../../utils/embeds');

function aliasFor(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand(false);

    if (group === 'guild') {
        return {
            commandName: 'guild',
            requirePath: 'src/commands/developer/guild.js',
            subcommand,
            subcommandGroup: null
        };
    }

    if (group === 'achievement') {
        return {
            commandName: 'check-achievements',
            requirePath: 'src/commands/developer/check-achievements.js',
            subcommand: null,
            subcommandGroup: null
        };
    }

    return {
        commandName: subcommand,
        requirePath: `src/commands/${subcommand === 'help' || subcommand === 'ping' ? 'utility' : 'developer'}/${subcommand}.js`,
        subcommand: null,
        subcommandGroup: null
    };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bot')
        .setDescription('Bot help, health, and developer operations')
        .setDMPermission(false)
        .addSubcommand(sub => sub
            .setName('help')
            .setDescription('Browse ByteBot commands')
            .addStringOption(opt => opt.setName('command').setDescription('Command to inspect')))
        .addSubcommand(sub => sub
            .setName('ping')
            .setDescription('Measure bot latency')
            .addBooleanOption(opt => opt.setName('private').setDescription('Show only to you')))
        .addSubcommand(sub => sub.setName('stats').setDescription('View bot runtime statistics'))
        .addSubcommand(sub => sub
            .setName('deploy')
            .setDescription('Deploy slash commands')
            .addStringOption(opt => opt.setName('scope').setDescription('Deployment scope').setRequired(true).addChoices(
                { name: 'Current Guild', value: 'guild' },
                { name: 'Global (All Guilds)', value: 'global' }
            )))
        .addSubcommand(sub => sub
            .setName('unregister')
            .setDescription('Clear slash command registrations')
            .addStringOption(opt => opt.setName('scope').setDescription('What to clear').setRequired(true).addChoices(
                { name: 'Global Commands', value: 'global' },
                { name: 'Guild Commands (Current Server)', value: 'guild' },
                { name: 'Both Global & Guild', value: 'both' }
            )))
        .addSubcommandGroup(group => group
            .setName('guild')
            .setDescription('Guilds the bot is in')
            .addSubcommand(sub => sub.setName('list').setDescription('List guilds'))
            .addSubcommand(sub => sub.setName('manage').setDescription('Manage guilds')))
        .addSubcommandGroup(group => group
            .setName('achievement')
            .setDescription('Developer achievement operations')
            .addSubcommand(sub => sub
                .setName('check')
                .setDescription('Run achievement checks')
                .addUserOption(opt => opt.setName('user').setDescription('Specific user to check')))),

    async execute(interaction, client) {
        const subcommand = interaction.options.getSubcommand(false);

        if (subcommand === 'stats') {
            const uptimeSeconds = Math.floor(process.uptime());
            const memory = process.memoryUsage();
            const embed = embeds.brand('Bot Runtime Stats', 'Current process health')
                .addFields(
                    { name: 'Uptime', value: `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`, inline: true },
                    { name: 'Guilds', value: `${client.guilds.cache.size}`, inline: true },
                    { name: 'Commands', value: `${client.commands.size}`, inline: true },
                    { name: 'Memory', value: `${Math.round(memory.rss / 1024 / 1024)} MB RSS`, inline: true },
                    { name: 'Heartbeat', value: `${client.ws.ping}ms`, inline: true }
                );

            return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
        }

        return executeAliasCommand(interaction, client, aliasFor(interaction));
    }
};
