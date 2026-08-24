const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { formatRules } = require('../../utils/automationCommand');

const METRIC_CHOICES = [
    { name: 'Members', value: 'members' }, { name: 'Bots', value: 'bots' },
    { name: 'Online members', value: 'online' }, { name: 'Voice members', value: 'voice' }
];

const data = new SlashCommandBuilder().setName('counter').setDescription('Configure counting and metric channels')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).setDMPermission(false)
    .addSubcommand(sub => sub.setName('enable').setDescription('Enable or resume a counter channel')
        .addChannelOption(option => option.setName('channel').setDescription('Counting or metric channel').setRequired(true)))
    .addSubcommand(sub => sub.setName('disable').setDescription('Disable a counter and reset sequential counting')
        .addChannelOption(option => option.setName('channel').setDescription('Counting or metric channel').setRequired(true)))
    .addSubcommand(sub => sub.setName('add').setDescription('Create a live metric channel')
        .addStringOption(option => option.setName('metric').setDescription('Metric').setRequired(true).addChoices(...METRIC_CHOICES))
        .addStringOption(option => option.setName('kind').setDescription('Channel kind').setRequired(true).addChoices(
            { name: 'Voice', value: 'voice' }, { name: 'Text', value: 'text' }, { name: 'Category', value: 'category' },
            { name: 'Announcement', value: 'announcement' }, { name: 'Stage', value: 'stage' })))
    .addSubcommand(sub => sub.setName('options').setDescription('Show metric and channel options'))
    .addSubcommand(sub => sub.setName('list').setDescription('List configured counting and metric channels'))
    .addSubcommand(sub => sub.setName('update').setDescription('Change a live counter metric')
        .addChannelOption(option => option.setName('channel').setDescription('Metric channel').setRequired(true))
        .addStringOption(option => option.setName('metric').setDescription('Metric').setRequired(true).addChoices(...METRIC_CHOICES)))
    .addSubcommand(sub => sub.setName('remove').setDescription('Stop updating a metric channel')
        .addChannelOption(option => option.setName('channel').setDescription('Metric channel').setRequired(true)));

module.exports = {
    data,
    permissions: [PermissionFlagsBits.ManageGuild],
    cooldown: 2,
    longRunning: true,
    async execute(interaction, client) {
        const service = client.automationService;
        const action = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;
        if (action === 'options') return interaction.editReply({
            content: 'Counting: `/counter enable #channel`. Metrics: `members`, `bots`, `online`, `voice`. Channel kinds: `voice`, `text`, `category`, `announcement`, `stage`.',
            flags: [MessageFlags.Ephemeral]
        });
        if (action === 'list') {
            const rows = await service.list(guildId, 'counter');
            const content = formatRules('counter', rows);
            return interaction.editReply({ content, allowedMentions: { parse: [] }, flags: [MessageFlags.Ephemeral] });
        }
        if (action === 'add') {
            const metric = interaction.options.getString('metric');
            const kind = interaction.options.getString('kind');
            const type = {
                voice: ChannelType.GuildVoice, text: ChannelType.GuildText, category: ChannelType.GuildCategory,
                announcement: ChannelType.GuildAnnouncement, stage: ChannelType.GuildStageVoice
            }[kind];
            const channel = await interaction.guild.channels.create({ name: `${metric}-0`, type, reason: `Metric counter created by ${interaction.user.id}` });
            try {
                await service.upsert({ guildId, kind: 'counter', key: channel.id, config: {
                    mode: 'metric', channelId: channel.id, metric, kind, owned: true, intervalMs: 300000
                }, nextRunAt: Date.now(), createdBy: interaction.user.id });
            } catch (error) {
                await channel.delete('Counter setup failed').catch(() => null);
                throw error;
            }
            return interaction.editReply({ content: `Metric counter created in ${channel}.`, flags: [MessageFlags.Ephemeral] });
        }
        const channel = interaction.options.getChannel('channel');
        if (action === 'update') {
            const rule = await service.get(guildId, 'counter', channel.id);
            const config = rule && JSON.parse(rule.config || '{}');
            if (config?.mode !== 'metric') return interaction.editReply({ content: 'That is not a metric counter.', flags: [MessageFlags.Ephemeral] });
            await service.upsert({ guildId, kind: 'counter', key: channel.id, config: {
                ...config, metric: interaction.options.getString('metric')
            }, enabled: rule.enabled, nextRunAt: rule.nextRunAt, createdBy: interaction.user.id });
            return interaction.editReply({ content: `Metric counter updated in ${channel}.`, flags: [MessageFlags.Ephemeral] });
        }
        if (action === 'enable') {
            const existing = await service.get(guildId, 'counter', channel.id);
            if (existing) {
                await service.setEnabled(guildId, 'counter', channel.id, true);
                return interaction.editReply({ content: `Counter re-enabled in ${channel}.`, flags: [MessageFlags.Ephemeral] });
            }
            if (channel.type !== ChannelType.GuildText) {
                return interaction.editReply({ content: 'Sequential counting can only be enabled in a text channel.', flags: [MessageFlags.Ephemeral] });
            }
            await service.upsert({ guildId, kind: 'counter', key: channel.id, config: {
                mode: 'counting', channelId: channel.id, current: 0, lastUserId: null
            }, createdBy: interaction.user.id });
            return interaction.editReply({ content: `Counting enabled in ${channel}. Start from **1**.`, flags: [MessageFlags.Ephemeral] });
        }
        if (action === 'disable') {
            const rule = await service.get(guildId, 'counter', channel.id);
            if (!rule) return interaction.editReply({ content: 'That is not a counter channel.', flags: [MessageFlags.Ephemeral] });
            const config = JSON.parse(rule.config || '{}');
            const reset = config.mode === 'counting' ? { ...config, current: 0, lastUserId: null } : config;
            await service.upsert({ guildId, kind: 'counter', key: channel.id, config: reset, enabled: false, createdBy: interaction.user.id });
            return interaction.editReply({ content: `Counter disabled${config.mode === 'counting' ? ' and reset' : ''} in ${channel}.`, flags: [MessageFlags.Ephemeral] });
        }
        const rule = await service.get(guildId, 'counter', channel.id);
        if (rule) {
            const config = JSON.parse(rule.config || '{}');
            if (config.mode === 'metric' && config.owned) await channel.delete(`Metric counter removed by ${interaction.user.id}`);
        }
        const removed = await service.remove(guildId, 'counter', channel.id);
        return interaction.editReply({ content: removed ? `Counter removed from ${channel}.` : 'That channel is not configured.', flags: [MessageFlags.Ephemeral] });
    }
};
