const { SlashCommandBuilder } = require('discord.js');
const { executeAliasCommand } = require('../../utils/commandAlias');
const embeds = require('../../utils/embeds');
const { UserFacingError } = require('../../utils/errorHandlerUtil');

function robloxSubcommand(subcommand, name, description) {
    return subcommand.setName(name).setDescription(description)
        .addStringOption(option => option.setName('username').setDescription('Roblox username')
            .setRequired(true).setMinLength(3).setMaxLength(20));
}

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
                .addStringOption(opt => opt.setName('nickname').setDescription('Your War Thunder nickname').setRequired(true))))
        .addSubcommandGroup(group => group
            .setName('roblox')
            .setDescription('Look up public Roblox profiles and creations')
            .addSubcommand(sub => robloxSubcommand(sub, 'profile', 'Look up a public Roblox profile'))
            .addSubcommand(sub => robloxSubcommand(sub, 'games', 'Show public games created by a Roblox user'))
            .addSubcommand(sub => robloxSubcommand(sub, 'groups', 'Show a Roblox user’s public groups'))
            .addSubcommand(sub => robloxSubcommand(sub, 'outfits', 'Show a Roblox user’s public outfits'))),

    longRunning: true,
    sourceCategories: ['Games'],

    async execute(interaction, client) {
        const group = interaction.options.getSubcommandGroup(false);
        if (group === 'roblox') {
            const action = interaction.options.getSubcommand();
            const username = interaction.options.getString('username', true);
            const service = client.informationLookupService;
            if (!service) throw new UserFacingError('Lookup service is temporarily unavailable.');
            if (action === 'profile') {
                const user = await service.robloxProfile(username);
                const embed = embeds.brand(`${user.displayName} (@${user.username})`,
                    (user.description || 'No public description.').slice(0, 4000))
                    .setURL(`https://www.roblox.com/users/${user.id}/profile`)
                    .setThumbnail(user.avatar)
                    .addFields(
                        { name: 'Followers', value: String(user.followers), inline: true },
                        { name: 'Following', value: String(user.following), inline: true },
                        { name: 'Friends', value: String(user.friends), inline: true },
                        { name: `Presence (${user.presence.status})`, value: user.presence.status, inline: true },
                        { name: 'Location', value: (user.presence.location || 'Unavailable').slice(0, 1024), inline: true },
                        { name: 'Last Online', value: user.presence.lastOnline
                            ? `<t:${Math.floor(Date.parse(user.presence.lastOnline) / 1000)}:R>` : 'Unavailable', inline: true },
                        { name: 'Account Created', value: `<t:${Math.floor(Date.parse(user.createdAt) / 1000)}:D>`, inline: true },
                        { name: 'Account', value: [user.verified && 'Verified', user.banned && 'Banned'].filter(Boolean).join(' · ') || 'Active', inline: true },
                        { name: `Badges (${user.badgeCount})`, value: user.badges.join(', ').slice(0, 1024) || 'None' },
                        { name: 'Name History', value: user.nameHistory.join(', ').slice(0, 1024) || 'None' }
                    );
                return interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
            }
            if (action === 'games') {
                const result = await service.robloxGames(username);
                const body = result.games.map(game => `**[${game.name}](${game.url})** · ${game.visits} visits\n${game.description || 'No description.'}`)
                    .join('\n\n').slice(0, 4000);
                return interaction.editReply({
                    embeds: [embeds.brand(`${result.user.displayName}’s Roblox games`, body)],
                    allowedMentions: { parse: [] }
                });
            }
            if (action === 'groups') {
                const result = await service.robloxGroups(username);
                const body = result.groups.map(row => `**[${row.name}](${row.url})** · ${row.role}\n${row.members} members${row.locked ? ' · Locked' : ''}`)
                    .join('\n\n').slice(0, 4000);
                return interaction.editReply({
                    embeds: [embeds.brand(`${result.user.username}'s Groups`, body)],
                    allowedMentions: { parse: [] }
                });
            }
            const result = await service.robloxOutfits(username);
            const body = result.outfits.map(row => `**${row.name}** · ${row.type}\nID ${row.id}${row.editable ? ' · Editable' : ''}`)
                .join('\n\n').slice(0, 4000);
            return interaction.editReply({
                embeds: [embeds.brand(`${result.user.displayName}’s Roblox outfits`, body)],
                allowedMentions: { parse: [] }
            });
        }
        return executeAliasCommand(interaction, client, aliasFor(interaction));
    }
};
