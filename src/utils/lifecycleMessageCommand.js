const {
    ChannelType, MessageFlags, PermissionFlagsBits, SystemChannelFlagsBitField
} = require('discord.js');
const lifecycle = require('../services/lifecycleMessageService');
const embeds = require('./embeds');
const { executeRecordedAction } = require('../services/moderationService');

function addMessageGroup(builder, type) {
    const label = type[0].toUpperCase() + type.slice(1);
    return builder.addSubcommandGroup(group => {
        group
        .setName(type)
        .setDescription(`${label} message settings`)
        .addSubcommand(sub => sub.setName('setup').setDescription(`Set the ${type} channel`)
            .addChannelOption(opt => opt.setName('channel').setDescription(`${label} channel`).addChannelTypes(ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread).setRequired(true)))
        .addSubcommand(sub => sub.setName('channel').setDescription(`Change the ${type} channel`)
            .addChannelOption(opt => opt.setName('channel').setDescription(`${label} channel`).addChannelTypes(ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread).setRequired(true)))
        .addSubcommand(sub => sub.setName('message').setDescription(`Set the ${type} template`)
            .addStringOption(opt => opt.setName('text').setDescription('Message template').setMinLength(1).setMaxLength(2000).setRequired(true))
            .addIntegerOption(opt => opt.setName('auto_delete').setDescription('Delete after 1-30 seconds').setMinValue(1).setMaxValue(30)))
        .addSubcommand(sub => sub.setName('enable').setDescription(`Enable ${type} messages`))
        .addSubcommand(sub => sub.setName('disable').setDescription(`Disable ${type} messages`))
        .addSubcommand(sub => sub.setName('format').setDescription(`Set the ${type} format`)
            .addStringOption(opt => opt.setName('format').setDescription('Message format').setRequired(true)
                .addChoices({ name: 'Text', value: 'text' }, { name: 'Embed', value: 'embed' })))
        .addSubcommand(sub => sub.setName('variables').setDescription(`View ${type} variables`))
        .addSubcommand(sub => sub.setName('test').setDescription(`Send a test ${type} message`))
        .addSubcommand(sub => sub.setName('view').setDescription(`View ${type} settings`))
        .addSubcommand(sub => sub.setName('reset').setDescription(`Reset ${type} settings`));
        if (type === 'welcome' || type === 'goodbye') {
            group.addSubcommand(sub => sub.setName('channels').setDescription(`Manage up to four ${type} channels`)
                .addStringOption(opt => opt.setName('action').setDescription('Channel action').setRequired(true).addChoices(
                    { name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }, { name: 'List', value: 'list' }
                ))
                .addChannelOption(opt => opt.setName('channel').setDescription(`${label} channel`).addChannelTypes(ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread)));
        }
        if (type === 'welcome') {
            group.addSubcommand(sub => sub.setName('dm').setDescription('Manage join direct messages')
                .addStringOption(opt => opt.setName('action').setDescription('Join DM action').setRequired(true).addChoices(
                    { name: 'Enable', value: 'enable' }, { name: 'Disable', value: 'disable' },
                    { name: 'Message', value: 'message' }, { name: 'View', value: 'view' }
                ))
                .addStringOption(opt => opt.setName('text').setDescription('Join DM template').setMinLength(1).setMaxLength(2000)));
        }
        if (type === 'boost') {
            group
                .addSubcommand(sub => sub.setName('settings').setDescription('View boost settings'))
                .addSubcommand(sub => sub.setName('remove').setDescription('Remove boost settings'));
        }
        return group;
    });
}

function addLifecycleGroups(builder) {
    addMessageGroup(builder, 'welcome');
    addMessageGroup(builder, 'goodbye');
    addMessageGroup(builder, 'boost');
    builder.addSubcommandGroup(group => group.setName('system').setDescription('Discord native system messages')
        .addSubcommand(sub => sub.setName('channel').setDescription('Set or remove the system channel')
            .addChannelOption(opt => opt.setName('channel').setDescription('Leave empty to remove').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
        .addSubcommand(sub => sub.setName('welcome').setDescription('Toggle native welcome messages'))
        .addSubcommand(sub => sub.setName('boost').setDescription('Toggle native boost messages'))
        .addSubcommand(sub => sub.setName('sticker').setDescription('Toggle welcome sticker replies')));
    return builder;
}

function settingsEmbed(type, config) {
    const channels = type === 'join_dm' || !config?.guild_id ? [] : lifecycle.listLifecycleChannels(config.guild_id, type);
    return embeds.brand(`${type[0].toUpperCase()}${type.slice(1)} Settings`, [
        `Status: **${config?.enabled ? 'enabled' : 'disabled'}**`,
        ...(type === 'join_dm' ? [] : [`Channels: ${channels.length ? channels.map(id => `<#${id}>`).join(', ') : '**not set**'}`]),
        `Format: **${config?.format || 'embed'}**`,
        `Auto-delete: **${config?.delete_after_seconds ? `${config.delete_after_seconds} seconds` : 'off'}**`,
        `Template: ${config?.template ? `\n${config.template}` : '**default**'}`
    ].join('\n'));
}

async function recorded(interaction, action, perform) {
    return executeRecordedAction({
        guildId: interaction.guild.id, targetId: interaction.guild.id, executorId: interaction.user.id,
        action, reason: action.replaceAll('_', ' ').toLowerCase(), perform
    });
}

async function executeSystem(interaction, subcommand) {
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageGuild)) {
        throw new Error('I need Manage Server to change Discord system messages.');
    }
    if (subcommand === 'channel') {
        const channel = interaction.options.getChannel('channel');
        await recorded(interaction, 'SYSTEM_CHANNEL', () => interaction.guild.setSystemChannel(channel));
        return interaction.editReply({ embeds: [embeds.success('System Messages Updated', channel ? `System messages will use ${channel}.` : 'The system channel was removed.')] });
    }
    const flag = {
        welcome: SystemChannelFlagsBitField.Flags.SuppressJoinNotifications,
        boost: SystemChannelFlagsBitField.Flags.SuppressPremiumSubscriptions,
        sticker: SystemChannelFlagsBitField.Flags.SuppressJoinNotificationReplies
    }[subcommand];
    const flags = new SystemChannelFlagsBitField(interaction.guild.systemChannelFlags?.bitfield ?? 0);
    const enabled = flags.has(flag);
    enabled ? flags.remove(flag) : flags.add(flag);
    await recorded(interaction, `SYSTEM_${subcommand.toUpperCase()}`, () => interaction.guild.setSystemChannelFlags(flags));
    return interaction.editReply({ embeds: [embeds.success('System Messages Updated', `${subcommand} messages are now **${enabled ? 'enabled' : 'disabled'}**.`)] });
}

async function executeLifecycle(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [embeds.error('Access Denied', 'You need Manage Server to change lifecycle messages.')], flags: [MessageFlags.Ephemeral] });
    }
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const type = interaction.options.getSubcommandGroup();
    const subcommand = interaction.options.getSubcommand();
    try {
        if (type === 'system') return executeSystem(interaction, subcommand);
        if (type === 'welcome' && subcommand === 'dm') {
            const action = interaction.options.getString('action', true);
            const dmType = 'join_dm';
            if (action === 'view') return interaction.editReply({ embeds: [settingsEmbed(dmType, lifecycle.getConfig(interaction.guild.id, dmType))] });
            const changes = {};
            if (action === 'enable' || action === 'disable') changes.enabled = action === 'enable';
            if (action === 'message') changes.template = interaction.options.getString('text', true);
            await recorded(interaction, `LIFECYCLE_JOIN_DM_${action.toUpperCase()}`, () => lifecycle.setConfig(interaction.guild.id, dmType, changes));
            return interaction.editReply({ embeds: [settingsEmbed(dmType, lifecycle.getConfig(interaction.guild.id, dmType))] });
        }
        if ((type === 'welcome' || type === 'goodbye') && subcommand === 'channels') {
            const action = interaction.options.getString('action', true);
            const channel = interaction.options.getChannel('channel');
            if (action === 'list') {
                const channels = lifecycle.listLifecycleChannels(interaction.guild.id, type);
                return interaction.editReply({ embeds: [embeds.brand(`${type} Channels`, channels.length ? channels.map(id => `<#${id}>`).join('\n') : 'No channels configured.')] });
            }
            if (!channel) throw new Error('Choose a channel for add or remove.');
            if (action === 'add' && !interaction.guild.members.me.permissionsIn(channel)
                .has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
                throw new Error('I need Send Messages and Embed Links in that lifecycle channel.');
            }
            await recorded(interaction, `LIFECYCLE_${type.toUpperCase()}_CHANNEL_${action.toUpperCase()}`, () =>
                action === 'add' ? lifecycle.addLifecycleChannel(interaction.guild.id, type, channel.id)
                    : lifecycle.removeLifecycleChannel(interaction.guild.id, type, channel.id));
            return interaction.editReply({ embeds: [settingsEmbed(type, lifecycle.getConfig(interaction.guild.id, type))] });
        }
        if (subcommand === 'view' || subcommand === 'settings') return interaction.editReply({ embeds: [settingsEmbed(type, lifecycle.getConfig(interaction.guild.id, type))] });
        if (subcommand === 'variables') {
            return interaction.editReply({ embeds: [embeds.brand('Lifecycle Variables', '`{user}` `{username}` `{displayname}` `{server}` `{memberCount}` `{memberNumber}` `{joinedAt}` `{createdAt}` `{accountAgeDays}` `{boostCount}` `{boostLevel}`\nGreed aliases such as `{user.name}`, `{user.mention}`, and `{guild.name}` are also supported.')] });
        }
        if (subcommand === 'test') {
            const result = await lifecycle.sendLifecycleMessage(type, interaction.member, { test: true });
            if (result.status !== 'sent') throw new Error(`Test could not be sent: ${result.status}.`);
            return interaction.editReply({ embeds: [embeds.success('Test Sent', `A test ${type} message was sent.`)] });
        }
        if (subcommand === 'reset' || subcommand === 'remove') {
            await recorded(interaction, `LIFECYCLE_${type.toUpperCase()}_RESET`, () => lifecycle.resetConfig(interaction.guild.id, type));
        } else {
            const changes = {};
            if (subcommand === 'setup' || subcommand === 'channel') {
                const channel = interaction.options.getChannel('channel', true);
                if (!interaction.guild.members.me.permissionsIn(channel)
                    .has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
                    throw new Error('I need Send Messages and Embed Links in that lifecycle channel.');
                }
                changes.channelId = channel.id;
            }
            if (subcommand === 'message') {
                if (!lifecycle.listLifecycleChannels(interaction.guild.id, type).length) {
                    throw new Error(`Set the ${type} channel before configuring its message.`);
                }
                changes.template = interaction.options.getString('text', true);
                changes.deleteAfterSeconds = interaction.options.getInteger('auto_delete');
            }
            if (subcommand === 'setup' || subcommand === 'channel') changes.enabled = true;
            if (subcommand === 'enable' || subcommand === 'disable') changes.enabled = subcommand === 'enable';
            if (subcommand === 'format') changes.format = interaction.options.getString('format', true);
            await recorded(interaction, `LIFECYCLE_${type.toUpperCase()}_${subcommand.toUpperCase()}`, () => lifecycle.setConfig(interaction.guild.id, type, changes));
        }
        return interaction.editReply({ embeds: [settingsEmbed(type, lifecycle.getConfig(interaction.guild.id, type))] });
    } catch (error) {
        return interaction.editReply({ embeds: [embeds.error('Lifecycle Message Error', error.message)] });
    }
}

module.exports = { addLifecycleGroups, executeLifecycle };
