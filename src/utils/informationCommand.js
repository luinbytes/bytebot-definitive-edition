const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const embeds = require('./embeds');

async function executeMemberLookup(interaction, client) {
    const group = interaction.options.getSubcommandGroup(false);
    const action = group === 'name' ? 'name-history' : interaction.options.getSubcommand();
    const user = interaction.options.getUser('user') || interaction.user;

    if (action === 'banner') {
        const current = await client.users.fetch(user.id, { force: true }).catch(() => null);
        const url = current?.bannerURL?.({ size: 4096, extension: 'png' });
        if (!url) throw new Error(`${user.username} does not have a banner.`);
        return interaction.reply({
            embeds: [embeds.brand(`${user.username}'s Banner`).setImage(url)],
            allowedMentions: { parse: [] }
        });
    }

    if (action === 'server-avatar' || action === 'server-banner') {
        if (!interaction.guild) throw new Error('This lookup can only be used in a server.');
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) throw new Error('That user is not a member of this server.');
        const url = action === 'server-avatar'
            ? member.avatarURL?.({ size: 4096, extension: 'png' })
            : member.bannerURL?.({ size: 4096, extension: 'png' });
        if (!url) throw new Error(`${user.username} does not have a ${action.replace('-', ' ')}.`);
        return interaction.reply({
            embeds: [embeds.brand(`${user.username}'s ${action === 'server-avatar' ? 'Server Avatar' : 'Server Banner'}`).setImage(url)],
            allowedMentions: { parse: [] }
        });
    }

    const history = client.informationLookupService?.nameHistory(interaction.guild.id, user.id) || [];
    if (!history.length) throw new Error(`No name history found for ${user.username}.`);
    return interaction.reply({
        embeds: [embeds.brand(`${user.username}'s Names`, history
            .map(entry => `**${entry.name}** · <t:${Math.floor(entry.recordedAt / 1000)}:R>`)
            .join('\n'))],
        allowedMentions: { parse: [] }
    });
}

const DANGEROUS_PERMISSIONS = new Set([
    'Administrator', 'ManageGuild', 'ManageRoles', 'BanMembers', 'KickMembers',
    'ManageWebhooks', 'MentionEveryone'
]);

function inviteCode(input) {
    const value = String(input || '').trim();
    if (/^[\w-]{2,64}$/.test(value)) return value;
    let url;
    try { url = new URL(value); } catch { throw new Error('Provide a valid Discord invite code or URL.'); }
    const parts = url.pathname.split('/').filter(Boolean);
    const code = url.hostname === 'discord.gg' ? parts[0]
        : (['discord.com', 'www.discord.com'].includes(url.hostname) && parts[0] === 'invite' ? parts[1] : null);
    if (url.protocol !== 'https:' || !code || !/^[\w-]{2,64}$/.test(code)) {
        throw new Error('Provide a valid Discord invite code or URL.');
    }
    return code;
}

async function resolveServer(interaction, client, input) {
    const value = String(input || '').trim();
    if (!value) return interaction.guild;
    if (/^\d{17,19}$/.test(value)) {
        let guild = client.guilds?.cache?.get(value);
        if (!guild && client.guilds?.fetch) guild = await client.guilds.fetch(value).catch(() => null);
        if (!guild) throw new Error('ByteBot could not fetch that server.');
        return guild;
    }
    const invite = await client.fetchInvite(inviteCode(value)).catch(() => null);
    if (!invite?.guild) throw new Error('ByteBot could not fetch that server.');
    return invite.guild;
}

async function executeServerLookup(interaction, client) {
    const group = interaction.options.getSubcommandGroup(false);
    const action = interaction.options.getSubcommand();
    if (group === 'role') {
        const fallback = interaction.member?.roles?.cache
            ?.filter(role => role.id !== interaction.guild.id)
            ?.sort((left, right) => right.position - left.position)
            ?.first?.();
        const role = interaction.options.getRole('role') || fallback;
        if (!role) throw new Error('Provide a role to view.');
        if (action === 'members') {
            await interaction.guild.members.fetch();
            const members = [...role.members.values()];
            const shown = members.slice(0, 25).map(member => `<@${member.id}>`);
            return interaction.reply({
                embeds: [embeds.brand(`Members in ${role.name}`, shown.length
                    ? `${shown.join('\n')}${members.length > shown.length ? `\n…and ${members.length - shown.length} more.` : ''}`
                    : 'No members have this role.')],
                allowedMentions: { parse: [] }
            });
        }
        const permissions = role.permissions.toArray();
        const dangerous = permissions.filter(permission => DANGEROUS_PERMISSIONS.has(permission));
        const embed = embeds.brand(`Role: ${role.name}`)
            .addFields(
                { name: 'Role ID', value: role.id, inline: true },
                { name: 'Guild', value: interaction.guild.name, inline: true },
                { name: 'Color', value: role.color ? `#${role.color.toString(16).padStart(6, '0').toUpperCase()}` : 'Default', inline: true },
                { name: 'Created', value: `<t:${Math.floor(role.createdTimestamp / 1000)}:R>`, inline: true },
                { name: 'Members', value: String(role.members.size), inline: true },
                { name: 'Dangerous permissions', value: dangerous.length ? dangerous.join(', ') : 'None', inline: false }
            );
        const icon = role.iconURL?.({ size: 512 });
        if (icon) embed.setThumbnail(icon);
        return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    }
    if (group === 'invite') {
        if (action === 'bot') {
            const url = new URL('https://discord.com/oauth2/authorize');
            url.searchParams.set('client_id', client.user.id);
            url.searchParams.set('scope', 'bot applications.commands');
            url.searchParams.set('permissions', '0');
            return interaction.reply({
                embeds: [embeds.brand('Invite ByteBot', 'Add ByteBot to a server you manage.')],
                components: [new ActionRowBuilder().addComponents(new ButtonBuilder()
                    .setStyle(ButtonStyle.Link).setLabel('Invite').setURL(url.toString()))]
            });
        }
        const invite = await client.fetchInvite(inviteCode(interaction.options.getString('invite', true))).catch(() => null);
        if (!invite?.code || !invite.guild) throw new Error('Failed to fetch invite information.');
        const embed = embeds.brand(`Invite: ${invite.guild.name}`)
            .addFields(
                { name: 'Code', value: invite.code, inline: true },
                { name: 'Expires', value: invite.expiresTimestamp ? `<t:${Math.floor(invite.expiresTimestamp / 1000)}:R>` : 'Never', inline: true },
                { name: 'Server', value: `${invite.guild.name} (${invite.guild.id})`, inline: false },
                { name: 'Members', value: Number.isInteger(invite.approximateMemberCount) ? String(invite.approximateMemberCount) : 'Unavailable', inline: true },
                { name: 'Online', value: Number.isInteger(invite.approximatePresenceCount) ? String(invite.approximatePresenceCount) : 'Unavailable', inline: true }
            );
        const icon = invite.guild.iconURL?.({ size: 512 });
        if (icon) embed.setThumbnail(icon);
        return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    }
    if (group === 'permissions' && action === 'view') {
        const user = interaction.options.getUser('user') || interaction.user;
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) throw new Error('That user is not a member of this server.');
        const permissions = member.permissions.toArray();
        if (!permissions.length) throw new Error(`${user.username} has no Discord permissions here.`);
        return interaction.reply({
            embeds: [embeds.brand(`${user.username}'s Permissions`, permissions.map(value => `\`${value}\``).join(', '))],
            allowedMentions: { parse: [] }
        });
    }
    if (group === 'asset') {
        const guild = await resolveServer(interaction, client, interaction.options.getString('server'));
        const url = action === 'icon'
            ? guild.iconURL?.({ size: 4096, extension: 'png' })
            : guild.bannerURL?.({ size: 4096, extension: 'png' });
        if (!url) throw new Error(`That server does not have a ${action}.`);
        return interaction.reply({
            embeds: [embeds.brand(`${guild.name}'s ${action === 'icon' ? 'Icon' : 'Banner'}`).setImage(url)],
            allowedMentions: { parse: [] }
        });
    }
    throw new Error(`Unsupported server lookup: ${group} ${action}`);
}

module.exports = { executeMemberLookup, executeServerLookup, resolveServer };
