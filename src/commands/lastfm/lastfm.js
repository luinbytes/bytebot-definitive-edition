const { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const periods = option => option.addChoices(
    { name: '7 days', value: '7d' }, { name: '1 month', value: '1m' },
    { name: '3 months', value: '3m' }, { name: '6 months', value: '6m' },
    { name: '1 year', value: '1y' }, { name: 'Lifetime', value: 'lifetime' }
);
const member = option => option.addUserOption(value => value.setName('member').setDescription('Linked Discord member'));
const chart = (subcommand, name, description) => member(subcommand.setName(name).setDescription(description)
    .addStringOption(option => periods(option.setName('period').setDescription('Chart period'))));

const data = new SlashCommandBuilder()
    .setName('lastfm')
    .setDescription('Last.fm listening, charts, community, and account settings')
    .setDMPermission(false)
    .addSubcommand(subcommand => member(subcommand.setName('now').setDescription('Show what a linked member is listening to')))
    .addSubcommandGroup(group => group.setName('account').setDescription('Link and manage your Last.fm account')
        .addSubcommand(subcommand => subcommand.setName('link').setDescription('Link a Last.fm username')
            .addStringOption(option => option.setName('username').setDescription('Last.fm username').setRequired(true).setMinLength(1).setMaxLength(64)))
        .addSubcommand(subcommand => subcommand.setName('oauth').setDescription('Link through Last.fm OAuth'))
        .addSubcommand(subcommand => subcommand.setName('refresh').setDescription('Refresh your linked Last.fm profile'))
        .addSubcommand(subcommand => subcommand.setName('unlink').setDescription('Delete your Last.fm link and settings')))
    .addSubcommandGroup(group => group.setName('listening').setDescription('Recent listening activity')
        .addSubcommand(subcommand => member(subcommand.setName('recent').setDescription('Show a member\'s recent tracks')))
        .addSubcommand(subcommand => subcommand.setName('server').setDescription('Show recent tracks from linked server members')))
    .addSubcommandGroup(group => group.setName('charts').setDescription('Top charts and collages')
        .addSubcommand(subcommand => chart(subcommand, 'artists', 'Show top artists'))
        .addSubcommand(subcommand => chart(subcommand, 'albums', 'Show top albums'))
        .addSubcommand(subcommand => chart(subcommand, 'tracks', 'Show top tracks'))
        .addSubcommand(subcommand => member(subcommand.setName('collage').setDescription('Generate a 2x2-5x5 chart collage')
            .addStringOption(option => option.setName('type').setDescription('Collage data').setRequired(true).addChoices(
                { name: 'Artists', value: 'artists' }, { name: 'Albums', value: 'albums' }, { name: 'Tracks', value: 'tracks' }))
            .addIntegerOption(option => option.setName('size').setDescription('Grid width and height').setRequired(true).setMinValue(2).setMaxValue(5))
            .addStringOption(option => periods(option.setName('period').setDescription('Chart period'))))))
    .addSubcommandGroup(group => group.setName('library').setDescription('Artist and indexed-library tools')
        .addSubcommand(subcommand => subcommand.setName('artist').setDescription('Show artist information')
            .addStringOption(option => option.setName('name').setDescription('Artist; defaults to your latest').setMaxLength(300)))
        .addSubcommand(subcommand => subcommand.setName('milestone').setDescription('Find your numbered scrobble')
            .addIntegerOption(option => option.setName('number').setDescription('Scrobble number').setRequired(true).setMinValue(1)))
        .addSubcommand(subcommand => subcommand.setName('update').setDescription('Index up to 5,000 library artists')))
    .addSubcommandGroup(group => group.setName('community').setDescription('Server rankings and taste comparison')
        .addSubcommand(subcommand => subcommand.setName('whoknows').setDescription('Rank listeners for an artist')
            .addStringOption(option => option.setName('artist').setDescription('Artist; defaults to your latest').setMaxLength(300))
            .addStringOption(option => option.setName('scope').setDescription('Ranking scope').addChoices(
                { name: 'Server', value: 'server' }, { name: 'Global', value: 'global' })))
        .addSubcommand(subcommand => subcommand.setName('crowns').setDescription('Show members with the most artist crowns'))
        .addSubcommand(subcommand => subcommand.setName('taste').setDescription('Compare music taste')
            .addUserOption(option => option.setName('member').setDescription('Linked member').setRequired(true))
            .addStringOption(option => periods(option.setName('period').setDescription('Comparison period')))))
    .addSubcommandGroup(group => group.setName('customize').setDescription('Customize your now-playing presentation')
        .addSubcommand(subcommand => subcommand.setName('presentation').setDescription('Set or reset a safe presentation template')
            .addStringOption(option => option.setName('template').setDescription('Variables: {track} {artist} {album} {username} {scrobbles}').setMaxLength(1000)))
        .addSubcommand(subcommand => subcommand.setName('view').setDescription('View your private Last.fm settings'))
        .addSubcommand(subcommand => subcommand.setName('variables').setDescription('View safe presentation variables'))
        .addSubcommand(subcommand => subcommand.setName('reactions').setDescription('Set now-playing up/down reactions')
            .addStringOption(option => option.setName('up').setDescription('Up reaction').setRequired(true).setMaxLength(50))
            .addStringOption(option => option.setName('down').setDescription('Down reaction').setRequired(true).setMaxLength(50)))
        .addSubcommand(subcommand => subcommand.setName('copy').setDescription('Copy a member\'s public presentation template')
            .addUserOption(option => option.setName('member').setDescription('Member to copy').setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName('alias').setDescription('Set or reset your compatibility alias')
            .addStringOption(option => option.setName('name').setDescription('Display alias; Discord slash names stay fixed').setMaxLength(32))));

function accountFor(service, user) {
    return service.requireAccount(user.id);
}

function target(interaction, service) {
    const user = interaction.options.getUser('member') || interaction.user;
    return { user, account: accountFor(service, user) };
}

function linkedIds(interaction, service, global = false) {
    if (global) return service.sqlite.prepare('SELECT user_id FROM lastfm_accounts ORDER BY user_id LIMIT 1000').all().map(row => row.user_id);
    return [...interaction.guild.members.cache.keys()].filter(id => service.account(id)).slice(0, 1000);
}

function embed(title, description) {
    return new EmbedBuilder().setColor(0xD51007).setTitle(title).setDescription(description || 'No results.')
        .setFooter({ text: 'Listening data from Last.fm' }).setURL('https://www.last.fm/');
}

function rows(items, empty = 'No Last.fm results found.') {
    if (!items.length) return empty;
    return items.slice(0, 25).map((item, index) => {
        const label = item.artist ? `${item.artist} — ${item.name}` : item.name;
        const count = item.playcount ? ` — ${item.playcount.toLocaleString()} plays` : '';
        return `**${index + 1}.** ${label}${count}`;
    }).join('\n').slice(0, 4000);
}

async function latestArtist(service, userId) {
    const account = service.requireAccount(userId);
    const recent = await service.recentTracks(account.username, 1);
    if (!recent[0]?.artist) throw new Error('No recent Last.fm track found.');
    return recent[0].artist;
}

function renderNow(account, track) {
    const fallback = `**${track.name}**\n${track.artist}${track.album ? ` — ${track.album}` : ''}`;
    if (!account.presentation) return fallback;
    return account.presentation.replace(/\{(track|artist|album|username|scrobbles)\}/g, (_match, key) => ({
        track: track.name, artist: track.artist || '', album: track.album || '', username: account.username, scrobbles: track.playcount || 0
    })[key]).slice(0, 4000);
}

async function defer(interaction, privateReply) {
    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: privateReply ? [MessageFlags.Ephemeral] : [] });
    }
}

module.exports = {
    data,
    cooldown: 3,
    botPermissions: interaction => interaction.options.getSubcommandGroup(false) === 'charts'
        && interaction.options.getSubcommand() === 'collage' ? [PermissionFlagsBits.AttachFiles] : [],

    async execute(interaction, client) {
        const service = client.lastfmService;
        if (!service) throw new Error('Last.fm service is unavailable.');
        const group = interaction.options.getSubcommandGroup(false);
        const action = interaction.options.getSubcommand();
        const privateReply = group === 'account' || group === 'customize' || (group === 'library' && action === 'update');
        await defer(interaction, privateReply);

        if (!group && action === 'now') {
            const selected = target(interaction, service);
            const track = (await service.recentTracks(selected.account.username, 1))[0];
            if (!track) throw new Error('No recent Last.fm track found.');
            const card = embed(track.nowPlaying ? 'Now playing' : 'Last played', renderNow(selected.account, track));
            if (track.image) card.setThumbnail(track.image);
            return interaction.editReply({ embeds: [card], allowedMentions: { parse: [] } });
        }

        if (group === 'account') {
            if (action === 'link') {
                const result = await service.link(interaction.user.id, interaction.options.getString('username'));
                return interaction.editReply({ content: `Linked Last.fm account **${result.username}**.`, allowedMentions: { parse: [] } });
            }
            if (action === 'oauth') {
                const login = service.beginOAuth(interaction.user.id);
                return interaction.editReply({ content: `Authorize Last.fm: ${login.url}`, allowedMentions: { parse: [] } });
            }
            if (action === 'refresh') {
                const result = await service.refresh(interaction.user.id);
                return interaction.editReply({ content: `Refreshed Last.fm account **${result.username}**.`, allowedMentions: { parse: [] } });
            }
            service.unlink(interaction.user.id);
            return interaction.editReply({ content: 'Deleted your Last.fm link, settings, OAuth state, and library index.' });
        }

        if (group === 'listening') {
            if (action === 'recent') {
                const selected = target(interaction, service);
                const tracks = await service.recentTracks(selected.account.username, 10);
                return interaction.editReply({ embeds: [embed(`${selected.account.username}'s recent tracks`, rows(tracks))] });
            }
            const members = linkedIds(interaction, service).slice(0, 25);
            const results = (await Promise.all(members.map(async userId => {
                const account = service.account(userId);
                try { return { userId, account, track: (await service.recentTracks(account.username, 1))[0] }; } catch { return null; }
            }))).filter(result => result?.track).sort((a, b) => b.track.timestamp - a.track.timestamp);
            const description = results.map(result => `<@${result.userId}> — **${result.track.name}** by ${result.track.artist}`).join('\n').slice(0, 4000);
            return interaction.editReply({ embeds: [embed('Server recent tracks', description)], allowedMentions: { parse: [] } });
        }

        if (group === 'charts') {
            const selected = target(interaction, service);
            const requestedPeriod = interaction.options.getString('period') || 'lifetime';
            if (action === 'collage') {
                const result = await service.collage(selected.account.username, interaction.options.getString('type'), requestedPeriod,
                    interaction.options.getInteger('size'), interaction.attachmentSizeLimit || 10 * 1024 * 1024);
                return interaction.editReply({ content: `${selected.account.username}'s ${requestedPeriod} ${interaction.options.getString('type')} collage — data from https://www.last.fm/`, files: [{ attachment: result.buffer, name: result.filename }] });
            }
            const items = await service.top(action, selected.account.username, requestedPeriod, 10);
            return interaction.editReply({ embeds: [embed(`${selected.account.username}'s top ${action}`, rows(items))] });
        }

        if (group === 'library') {
            if (action === 'update') {
                const result = await service.updateIndex(interaction.user.id);
                return interaction.editReply({ content: `Indexed **${result.artists.toLocaleString()}** Last.fm artists.` });
            }
            if (action === 'milestone') {
                const result = await service.milestone(interaction.user.id, interaction.options.getInteger('number'));
                return interaction.editReply({ embeds: [embed(`Milestone #${result.number}`, `**${result.name}** by ${result.artist}\n<t:${result.timestamp}:F>\n${result.username} • ${result.total.toLocaleString()} scrobbles`)] });
            }
            const account = service.requireAccount(interaction.user.id);
            const artist = interaction.options.getString('name') || await latestArtist(service, interaction.user.id);
            const info = await service.artistInfo(artist, account.username);
            const card = embed(info.name, `${info.summary || 'No biography available.'}\n\n${info.listeners.toLocaleString()} listeners • ${info.plays.toLocaleString()} plays • ${info.userPlays.toLocaleString()} by ${account.username}`);
            if (info.image) card.setThumbnail(info.image);
            return interaction.editReply({ embeds: [card] });
        }

        if (group === 'community') {
            const ids = linkedIds(interaction, service, action === 'whoknows' && interaction.options.getString('scope') === 'global');
            if (action === 'crowns') {
                const result = service.crowns(ids);
                return interaction.editReply({ embeds: [embed('Most Last.fm crowns', result.map((item, index) => `**${index + 1}.** <@${item.userId}> — ${item.crowns}`).join('\n'))], allowedMentions: { parse: [] } });
            }
            if (action === 'taste') {
                const other = interaction.options.getUser('member');
                const result = await service.taste(interaction.user.id, other.id, interaction.options.getString('period') || 'overall');
                return interaction.editReply({ embeds: [embed(`${result.first} v ${result.second}`, `**${result.score}% overlap**\n${result.common.join(', ') || 'No common top artists.'}`)] });
            }
            const artist = interaction.options.getString('artist') || await latestArtist(service, interaction.user.id);
            const result = service.rankings(artist, ids);
            return interaction.editReply({ embeds: [embed(`${artist} most plays`, result.map((item, index) => `**${index + 1}.** <@${item.userId}> — ${item.playcount.toLocaleString()}`).join('\n'))], allowedMentions: { parse: [] } });
        }

        const account = service.requireAccount(interaction.user.id);
        if (action === 'variables') return interaction.editReply({ content: '`{track}` `{artist}` `{album}` `{username}` `{scrobbles}`' });
        if (action === 'view') return interaction.editReply({ content: `Username: **${account.username}**\nPresentation: \`${account.presentation || 'default'}\`\nReactions: ${account.reactions || 'default'}\nAlias: \`${account.command_alias || 'none'}\``, allowedMentions: { parse: [] } });
        if (action === 'copy') {
            service.copyPresentation(interaction.user.id, interaction.options.getUser('member').id);
            return interaction.editReply({ content: 'Copied that member\'s Last.fm presentation.' });
        }
        if (action === 'reactions') {
            const value = JSON.stringify({ up: interaction.options.getString('up'), down: interaction.options.getString('down') });
            service.setCustomization(interaction.user.id, 'reactions', value);
            return interaction.editReply({ content: 'Updated your Last.fm reactions.' });
        }
        const field = action === 'presentation' ? 'presentation' : 'alias';
        const value = interaction.options.getString(action === 'presentation' ? 'template' : 'name');
        service.setCustomization(interaction.user.id, field, value);
        return interaction.editReply({ content: value ? `Updated your Last.fm ${field}.` : `Reset your Last.fm ${field}.` });
    }
};
