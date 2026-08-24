const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { sqlite } = require('../database');

const EPHEMERAL = { flags: [MessageFlags.Ephemeral], allowedMentions: { parse: [], repliedUser: false } };

function memberHas(interaction, permission) {
    return Boolean(interaction.memberPermissions?.has(permission) || interaction.member?.permissions?.has(permission));
}

function requireMember(interaction, permission, label) {
    if (!memberHas(interaction, permission)) throw new Error(`You need the real Discord ${label} permission for this action.`);
}

function requireBot(interaction, channel, permissions, labels) {
    if (!interaction.guild.members.me.permissionsIn(channel).has(permissions)) throw new Error(`I need ${labels.join(', ')} in ${channel}.`);
}

async function confessionAdmin(interaction, service, subcommand) {
    const guildId = interaction.guildId;
    if (subcommand === 'view') {
        requireMember(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server');
        const config = service.confessionConfig(guildId);
        const categories = service.confessionCategories(guildId);
        const blacklist = service.configureBlacklist(guildId, 'list', null, interaction.user.id);
        const muted = sqlite.prepare('SELECT COUNT(*) AS count FROM confession_mutes WHERE guild_id = ?').get(guildId).count;
        return interaction.reply({ ...EPHEMERAL, content: config
            ? `Confessions are **${config.enabled ? 'enabled' : 'disabled'}** in <#${config.channel_id}>.\nCategories: **${categories.length}** · blocked phrases: **${blacklist.length}** · muted authors: **${muted}**\nReactions: ${config.up_emoji} / ${config.down_emoji}`
            : 'Confessions are not configured.' });
    }
    if (subcommand === 'setup') {
        requireMember(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server');
        const channel = interaction.options.getChannel('channel', true);
        requireBot(interaction, channel, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AddReactions, PermissionFlagsBits.ManageMessages], ['View Channel', 'Send Messages', 'Embed Links', 'Add Reactions', 'Manage Messages']);
        service.setConfessionConfig(guildId, channel.id);
        const panel = await channel.send(service.panelPayload(guildId));
        service.setPanelMessage(guildId, panel.id);
        return interaction.reply({ ...EPHEMERAL, content: `Confessions are enabled in ${channel}; the submission panel is ${panel.url}.` });
    }
    if (subcommand === 'remove') {
        requireMember(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server');
        if (!interaction.options.getBoolean('confirm', true)) throw new Error('Set confirm to true to disable confessions.');
        service.disableConfessions(guildId);
        return interaction.reply({ ...EPHEMERAL, content: 'Confessions are disabled. Existing moderation records were retained.' });
    }
    if (subcommand === 'category') {
        requireMember(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server');
        const action = interaction.options.getString('action', true);
        const name = interaction.options.getString('name');
        const channel = interaction.options.getChannel('channel');
        if (action === 'add' && (!name || !channel)) throw new Error('name and channel are required when adding a category.');
        if (action === 'remove' && !name) throw new Error('name is required when removing a category.');
        if (channel) requireBot(interaction, channel, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
            ['View Channel', 'Send Messages', 'Embed Links']);
        const rows = service.configureCategory(guildId, action, name, channel?.id);
        return interaction.reply({ ...EPHEMERAL, content: rows.length ? rows.map(row => `**${row.name}** → <#${row.channel_id}>`).join('\n') : 'No confession categories configured.' });
    }
    if (subcommand === 'blacklist') {
        requireMember(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server');
        const action = interaction.options.getString('action', true);
        const phrase = interaction.options.getString('phrase');
        if (['add', 'remove'].includes(action) && !phrase) throw new Error('phrase is required for that action.');
        const rows = service.configureBlacklist(guildId, action, phrase, interaction.user.id);
        return interaction.reply({ ...EPHEMERAL, content: rows.length ? rows.map(row => `• ${row.phrase}`).join('\n') : 'The confession blacklist is empty.' });
    }
    if (subcommand === 'emojis') {
        requireMember(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server');
        const action = interaction.options.getString('action', true);
        const up = interaction.options.getString('up');
        const down = interaction.options.getString('down');
        if (action === 'set' && (!up || !down)) throw new Error('up and down are required when setting reaction emojis.');
        const config = service.setConfessionEmojis(guildId, action, up, down);
        return interaction.reply({ ...EPHEMERAL, content: `Confession reactions: ${config.up_emoji} / ${config.down_emoji}` });
    }
    requireMember(interaction, PermissionFlagsBits.ManageMessages, 'Manage Messages');
    if (subcommand === 'mute') {
        const number = interaction.options.getInteger('number', true);
        service.muteConfessionAuthor(guildId, number, interaction.user.id, interaction.options.getString('reason'));
        return interaction.reply({ ...EPHEMERAL, content: `The author of confession #${number} is muted from confessions and replies.` });
    }
    if (subcommand === 'unmute') {
        const all = interaction.options.getBoolean('all') || false;
        const number = interaction.options.getInteger('number');
        if (!all && !number) throw new Error('Provide a confession number or set all to true.');
        const count = service.unmuteConfessionAuthor(guildId, number, all);
        return interaction.reply({ ...EPHEMERAL, content: `Removed ${count} confession mute${count === 1 ? '' : 's'}.` });
    }
    if (subcommand === 'report') {
        const number = interaction.options.getInteger('number', true);
        const confession = service.confessionByNumber(guildId, number);
        if (!confession) throw new Error('That confession was not found.');
        const reason = interaction.options.getString('reason', true);
        sqlite.prepare(`INSERT INTO moderation_logs (guild_id, target_id, executor_id, action, reason, timestamp)
            VALUES (?, ?, ?, 'CONFESSION_AUTHOR_VIEWED', ?, ?)`).run(guildId, confession.author_id, interaction.user.id, `Confession #${number}: ${reason}`, service.now());
        return interaction.reply({ ...EPHEMERAL, content: `Confession #${number} was submitted by <@${confession.author_id}>. The lookup was recorded.` });
    }
}

async function communityAdmin(interaction, service, subcommand) {
    if (subcommand === 'image-only') {
        requireMember(interaction, PermissionFlagsBits.ManageChannels, 'Manage Channels');
        const action = interaction.options.getString('action', true);
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        if (action === 'view') return interaction.reply({ ...EPHEMERAL, content: `${channel} is **${service.isImageOnly(interaction.guildId, channel.id) ? '' : 'not '}image-only**.` });
        requireBot(interaction, channel, PermissionFlagsBits.ManageMessages, ['Manage Messages']);
        service.setImageOnly(interaction.guildId, channel.id, action === 'enable', interaction.user.id);
        return interaction.reply({ ...EPHEMERAL, content: `${channel} is now **${action === 'enable' ? '' : 'not '}image-only**.` });
    }
    const message = await service.resolveMessage(interaction, interaction.options.getString('message', true));
    requireMember(interaction, PermissionFlagsBits.PinMessages, 'Pin Messages');
    requireBot(interaction, message.channel, PermissionFlagsBits.PinMessages, ['Pin Messages']);
    if (subcommand === 'pin') {
        if (message.pinned) throw new Error('That message is already pinned.');
        await message.pin(`Pinned by ${interaction.user.tag}`);
    } else {
        if (!message.pinned) throw new Error('That message is not pinned.');
        await message.unpin(`Unpinned by ${interaction.user.tag}`);
    }
    return interaction.reply({ ...EPHEMERAL, content: `${subcommand === 'pin' ? 'Pinned' : 'Unpinned'} ${message.url}.` });
}

async function threadAdmin(interaction, subcommand) {
    const thread = interaction.options.getChannel('thread') || interaction.channel;
    if (!thread?.isThread()) throw new Error('Choose a thread or run this command inside one.');
    requireMember(interaction, PermissionFlagsBits.ManageThreads, 'Manage Threads');
    requireBot(interaction, thread, PermissionFlagsBits.ManageThreads, ['Manage Threads']);
    const reason = interaction.options.getString('reason') || `Thread ${subcommand} by ${interaction.user.tag}`;
    if (subcommand === 'add') await thread.members.add(interaction.options.getUser('member', true).id, reason);
    else if (subcommand === 'remove') await thread.members.remove(interaction.options.getUser('member', true).id, reason);
    else if (subcommand === 'rename') await thread.setName(interaction.options.getString('name', true), reason);
    else if (subcommand === 'slowmode') await thread.setRateLimitPerUser(interaction.options.getInteger('seconds', true), reason);
    else if (subcommand === 'lock') await thread.setLocked(true, reason);
    else if (subcommand === 'unlock') await thread.setLocked(false, reason);
    else if (subcommand === 'archive') await thread.setArchived(true, reason);
    else if (subcommand === 'unarchive') await thread.setArchived(false, reason);
    else if (subcommand === 'solved') await thread.edit({ locked: true, archived: true }, reason);
    else if (subcommand === 'delete') {
        if (!interaction.options.getBoolean('confirm', true)) throw new Error('Set confirm to true to permanently delete the thread.');
        await interaction.reply({ ...EPHEMERAL, content: `Deleting **${thread.name}** permanently.` });
        await thread.delete(reason);
        return;
    }
    return interaction.reply({ ...EPHEMERAL, content: `Thread **${thread.name}** updated: ${subcommand}.` });
}

async function executeCommunityUtilityAdmin(interaction, client) {
    if (!client.communityUtilityService) throw new Error('Community utilities are unavailable.');
    try {
        const group = interaction.options.getSubcommandGroup(false);
        const subcommand = interaction.options.getSubcommand();
        if (group === 'confessions') return await confessionAdmin(interaction, client.communityUtilityService, subcommand);
        if (group === 'thread') return await threadAdmin(interaction, subcommand);
        return await communityAdmin(interaction, client.communityUtilityService, subcommand);
    } catch (error) {
        return interaction.reply({ ...EPHEMERAL, content: error.message || 'That community administration action failed.' });
    }
}

module.exports = { executeCommunityUtilityAdmin, memberHas };
