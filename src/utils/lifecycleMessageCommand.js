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
    return embeds.brand(`${type[0].toUpperCase()}${type.slice(1)} Settings`, [
        `Status: **${config?.enabled ? 'enabled' : 'disabled'}**`,
        `Channel: ${config?.channel_id ? `<#${config.channel_id}>` : '**not set**'}`,
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
                if (!lifecycle.getConfig(interaction.guild.id, type)?.channel_id) {
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
