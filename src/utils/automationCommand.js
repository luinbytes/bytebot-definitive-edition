const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { parseInterval, payloadFor } = require('../services/automationService');

const OPTION_BUILDERS = {
    text_channel: command => command.addChannelOption(option => option.setName('channel').setDescription('Target text or announcement channel').addChannelTypes(
        ChannelType.GuildText, ChannelType.GuildAnnouncement
    ).setRequired(true)),
    notify_channel: command => command.addChannelOption(option => option.setName('channel').setDescription('Target text, announcement, or forum channel').addChannelTypes(
        ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum
    ).setRequired(true)),
    message_scope_channel: command => command.addChannelOption(option => option.setName('channel').setDescription('Message channel restriction').addChannelTypes(
        ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread
    ).setRequired(true)),
    trigger: command => command.addStringOption(option => option.setName('trigger').setDescription('Keyword or event trigger').setMinLength(1).setMaxLength(100).setRequired(true)),
    trigger32: command => command.addStringOption(option => option.setName('trigger').setDescription('Keyword or event trigger').setMinLength(1).setMaxLength(32).setRequired(true)),
    reactions: command => command.addStringOption(option => option.setName('reactions').setDescription('Up to 15 emoji, separated by spaces').setMaxLength(512).setRequired(true)),
    role: command => command.addRoleOption(option => option.setName('role').setDescription('Target role').setRequired(true)),
    interval: command => command.addStringOption(option => option.setName('interval').setDescription('Interval, such as 30m, 2h, or 1d').setRequired(true)),
    message: command => command.addStringOption(option => option.setName('message').setDescription('Message template').setMinLength(1).setMaxLength(2000).setRequired(true)),
    optional_message: command => command.addStringOption(option => option.setName('message').setDescription('Optional message template').setMinLength(1).setMaxLength(2000)),
    vanity: command => command.addStringOption(option => option.setName('vanity').setDescription('Vanity text').setMinLength(1).setMaxLength(100).setRequired(true)),
    strict: command => command.addBooleanOption(option => option.setName('strict').setDescription('Use exact, case-sensitive matching').setRequired(true)),
    threshold: command => command.addIntegerOption(option => option.setName('threshold').setDescription('Optional join threshold').setMinValue(1).setMaxValue(1000000)),
    resource_type: command => command.addStringOption(option => option.setName('resource_type').setDescription('Tracked resource').addChoices(
        { name: 'Username', value: 'username' }, { name: 'Vanity', value: 'vanity' }
    )),
    tracking_type: command => command.addStringOption(option => option.setName('type').setDescription('Tracked resource').setRequired(true).addChoices(
        { name: 'Username', value: 'username' }, { name: 'Vanity', value: 'vanity' }
    )),
    tracking_type_optional: command => command.addStringOption(option => option.setName('type').setDescription('Tracked resource; omit for both').addChoices(
        { name: 'Username', value: 'username' }, { name: 'Vanity', value: 'vanity' }
    )),
    desired: command => command.addStringOption(option => option.setName('desired').setDescription('Username or vanity to watch').setRequired(true).setMinLength(1).setMaxLength(100)),
    availability_days: command => command.addIntegerOption(option => option.setName('availability_days').setDescription('Availability window override').setMinValue(1).setMaxValue(30)),
    confirm: command => command.addBooleanOption(option => option.setName('confirm').setDescription('Confirm this destructive action').setRequired(true)),
    length: command => command.addIntegerOption(option => option.setName('length').setDescription('Maximum results').setMinValue(1).setMaxValue(25)),
};

function ruleConfig(interaction, existing = {}) {
    const get = (method, name) => { try { return interaction.options[method](name); } catch { return null; } };
    const channel = get('getChannel', 'channel');
    const role = get('getRole', 'role');
    const interval = get('getString', 'interval');
    const reactions = get('getString', 'reactions');
    return {
        ...existing,
        ...(channel && { channelId: channel.id }),
        ...(role && { roleId: role.id }),
        ...(interval && { intervalMs: parseInterval(interval) }),
        ...(reactions && { reactions: [...new Set(reactions.split(/\s+/).filter(Boolean))].slice(0, 15) }),
        ...(['trigger', 'message', 'vanity'].reduce((result, name) => {
            const value = get('getString', name);
            if (value !== null) result[name] = value;
            return result;
        }, {})),
        ...(get('getBoolean', 'strict') !== null && { strict: get('getBoolean', 'strict') }),
        ...(get('getInteger', 'threshold') !== null && { threshold: get('getInteger', 'threshold') }),
        ...(get('getString', 'type') !== null && { type: get('getString', 'type') }),
        ...(get('getString', 'desired') !== null && { desired: get('getString', 'desired') }),
        ...(get('getInteger', 'availability_days') !== null && { availabilityDays: get('getInteger', 'availability_days') })
    };
}

function keyFor(kind, interaction, action) {
    const channel = (() => { try { return interaction.options.getChannel('channel'); } catch { return null; } })();
    const role = (() => { try { return interaction.options.getRole('role'); } catch { return null; } })();
    const trigger = (() => { try { return interaction.options.getString('trigger'); } catch { return null; } })();
    if (['bumpreminder', 'vanity', 'pingonjoin'].includes(kind)) return 'main';
    if (kind === 'tracking') {
        if (action.startsWith('notify-')) {
            const type = interaction.options.getString('type');
            const desired = interaction.options.getString('desired');
            if (type && desired) return `notify:${interaction.user.id}:${type}:${desired.toLowerCase()}`;
        }
        if (action.startsWith('username-')) return 'username';
        if (action.startsWith('vanity-')) return 'vanity';
    }
    if (kind === 'autorole' && role) return `${action.startsWith('bots-') ? 'bot:' : 'member:'}${role.id}`;
    if (kind === 'autoreact' && trigger) return trigger.toLowerCase();
    if (channel) return channel.id;
    return 'main';
}

function formatRules(kind, rules) {
    if (!rules.length) return `No ${kind} automations are configured.`;
    const lines = rules.slice(0, 25).map(rule => {
        const config = JSON.parse(rule.config || '{}');
        const summary = config.trigger || config.desired || config.vanity || config.message
            || (config.metric ? `${config.metric} metric` : '')
            || (config.mode === 'counting' ? `counting at ${config.current || 0}` : '')
            || config.roleId || config.channelId || rule.key;
        const scopes = [
            config.reactions?.length ? `reactions=${config.reactions.join(' ')}` : '',
            config.types?.length ? `types=${config.types.join(',')}` : '',
            config.channelIds?.length ? `channels=${config.channelIds.join(',')}` : '',
            config.roleIds?.length ? `roles=${config.roleIds.join(',')}` : ''
        ].filter(Boolean).join(' ');
        return `#${rule.id} ${rule.enabled ? '✅' : '⏸️'} **${rule.key}** — ${String(summary).slice(0, 100)}${scopes ? ` (${scopes.slice(0, 300)})` : ''}`;
    });
    const visible = [];
    while (lines.length && `${visible.join('\n')}\n${lines[0]}`.length <= 1800) visible.push(lines.shift());
    const omitted = rules.length - visible.length;
    return `${visible.join('\n')}${omitted ? `\n… ${omitted} more configured.` : ''}`;
}

function createAutomationCommand({ name, description, kind = name, actions, groups = [], publicActions = [] }) {
    const data = new SlashCommandBuilder().setName(name).setDescription(description).setDMPermission(false);
    if (!publicActions.length) data.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
    for (const action of actions) {
        data.addSubcommand(command => {
            command.setName(action.name).setDescription(action.description || `${action.name} ${description.toLowerCase()}`);
            for (const option of action.options || []) OPTION_BUILDERS[option](command);
            return command;
        });
    }
    for (const group of groups) {
        data.addSubcommandGroup(builder => {
            builder.setName(group.name).setDescription(group.description || `${group.name} ${description.toLowerCase()}`);
            for (const action of group.actions) builder.addSubcommand(command => {
                command.setName(action.name).setDescription(action.description || `${action.name} ${group.name}`);
                for (const option of action.options || []) OPTION_BUILDERS[option](command);
                return command;
            });
            return builder;
        });
    }

    return {
        data,
        permissions: publicActions.length ? [] : [PermissionFlagsBits.ManageGuild],
        cooldown: 2,
        longRunning: true,
        async execute(interaction, client) {
            const service = client.automationService;
            if (!service) return interaction.editReply({ content: 'Automation service is unavailable.', flags: [MessageFlags.Ephemeral] });
            const group = interaction.options.getSubcommandGroup?.(false) || null;
            const subcommand = interaction.options.getSubcommand();
            const action = group ? `${group}-${subcommand}` : subcommand;
            const guildId = interaction.guild.id;
            if (publicActions.length && !publicActions.includes(action) && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                return interaction.editReply({ content: 'You need **Manage Server** to configure server tracking.', flags: [MessageFlags.Ephemeral] });
            }
            const key = keyFor(kind, interaction, action);
            const existing = await service.get(guildId, kind, key);
            if (kind === 'autoreact' && ['channels-add', 'roles-add'].includes(action) && !existing) {
                return interaction.editReply({ content: 'Create that autoreaction trigger before adding restrictions.', flags: [MessageFlags.Ephemeral] });
            }
            if (kind === 'revive' && action !== 'setup' && !['list'].includes(action) && !existing) {
                return interaction.editReply({ content: 'Run `/revive setup` for that channel first.', flags: [MessageFlags.Ephemeral] });
            }
            if (kind === 'bumpreminder' && ['reminder', 'thankyou', 'test-reminder', 'test-thankyou'].includes(action) && !existing) {
                return interaction.editReply({ content: 'Enable the bump reminder first.', flags: [MessageFlags.Ephemeral] });
            }
            if (kind === 'pingonjoin' && action === 'message' && !existing) {
                return interaction.editReply({ content: 'Enable ping on join first.', flags: [MessageFlags.Ephemeral] });
            }
            if (kind === 'vanity' && ['message', 'channel', 'strict', 'role-add', 'role-remove', 'role', 'removerole'].includes(action) && !existing) {
                return interaction.editReply({ content: 'Set the vanity first.', flags: [MessageFlags.Ephemeral] });
            }

            if (kind === 'bumpreminder' && action === 'leaderboard') {
                const stats = existing ? JSON.parse(existing.config || '{}').stats || {} : {};
                const ranking = Object.entries(stats).sort((left, right) => right[1] - left[1]).slice(0, 10);
                return interaction.editReply({ content: ranking.length ? ranking.map(([userId, bumps], index) => `${index + 1}. <@${userId}> — ${bumps}`).join('\n') : 'No bumps have been recorded.', allowedMentions: { parse: [] }, flags: [MessageFlags.Ephemeral] });
            }
            if (kind === 'tracking' && ['lookup', 'dropped'].includes(action)) {
                const dropped = (await service.list(guildId, kind)).flatMap(rule => JSON.parse(rule.config || '{}').dropped || []);
                const type = interaction.options.getString('resource_type');
                const limit = interaction.options.getInteger('length') || 25;
                const selected = dropped.filter(item => item.availableAt <= Date.now() && (!type || item.type === type)).slice(-limit);
                return interaction.editReply({ content: selected.length ? selected.map(item => `**${item.value}** (${item.type}) — <t:${Math.floor(item.availableAt / 1000)}:R>`).join('\n') : 'No dropped names are being tracked.', flags: [MessageFlags.Ephemeral] });
            }
            if (kind === 'bumpreminder' && action.startsWith('view-')) {
                const config = existing ? JSON.parse(existing.config || '{}') : {};
                const field = action === 'view-reminder' ? 'reminder' : 'thankyou';
                return interaction.editReply({ content: config[field] || `No ${field} message is configured.`, allowedMentions: { parse: [] }, flags: [MessageFlags.Ephemeral] });
            }

            if (kind === 'autoreact' && ['channels-remove', 'roles-remove'].includes(action)) {
                if (!existing) return interaction.editReply({ content: 'No matching autoreact automation was found.', flags: [MessageFlags.Ephemeral] });
                const config = JSON.parse(existing.config || '{}');
                const target = action.startsWith('channels-') ? interaction.options.getChannel('channel').id : interaction.options.getRole('role').id;
                const field = action.startsWith('channels-') ? 'channelIds' : 'roleIds';
                config[field] = (config[field] || []).filter(id => id !== target);
                await service.upsert({ guildId, kind, key, config, enabled: existing.enabled, nextRunAt: existing.nextRunAt, createdBy: interaction.user.id });
                return interaction.editReply({ content: `Removed the ${field === 'channelIds' ? 'channel' : 'role'} restriction.`, flags: [MessageFlags.Ephemeral] });
            }

            if (['list', 'view', 'info', 'settings', 'rewards', 'leaderboard', 'lookup', 'notify-list', 'role-list', 'channels-list', 'roles-list', 'bots-list'].includes(action)) {
                let rules = await service.list(guildId, kind);
                if ((action === 'view' || action === 'info') && existing) rules = [existing];
                if (action === 'bots-list') rules = rules.filter(rule => rule.key.startsWith('bot:'));
                if (action === 'notify-list') rules = rules.filter(rule => rule.key.startsWith(`notify:${interaction.user.id}:`));
                return interaction.editReply({ content: formatRules(kind, rules), allowedMentions: { parse: [] }, flags: [MessageFlags.Ephemeral] });
            }
            if (action.startsWith('test-') || action === 'test') {
                const selected = existing || (await service.list(guildId, kind, true))[0];
                if (!selected) return interaction.editReply({ content: `No enabled ${kind} automation was found.`, flags: [MessageFlags.Ephemeral] });
                const config = JSON.parse(selected.config || '{}');
                const channel = interaction.guild.channels.cache.get(config.channelId || selected.key);
                if (!channel?.isTextBased?.() && typeof channel?.send !== 'function') return interaction.editReply({ content: 'The configured channel is unavailable.', flags: [MessageFlags.Ephemeral] });
                const field = action === 'test-thankyou' ? 'thankyou' : action === 'test-reminder' ? 'reminder' : 'message';
                await channel.send(payloadFor(config[field] || (field === 'thankyou' ? 'Thanks for bumping!' : field === 'reminder' ? 'It is time to bump again!' : 'This channel could use a little life!'), { guild: interaction.guild, channel }));
                return interaction.editReply({ content: `${kind} test sent.`, flags: [MessageFlags.Ephemeral] });
            }
            if (['clear', 'reset'].includes(action)) {
                if (!interaction.options.getBoolean('confirm')) return interaction.editReply({ content: 'Nothing was removed. Set `confirm` to true to clear these automations.', flags: [MessageFlags.Ephemeral] });
                const removed = await service.clear(guildId, kind);
                return interaction.editReply({ content: `Removed ${removed.length} ${kind} automation(s).`, flags: [MessageFlags.Ephemeral] });
            }
            if (action === 'disable') {
                const changed = await service.setEnabled(guildId, kind, key, false);
                return interaction.editReply({ content: changed ? `${kind} disabled.` : `No ${kind} configuration was found.`, flags: [MessageFlags.Ephemeral] });
            }
            if (action === 'enable' && existing && !['bumpreminder', 'pingonjoin'].includes(kind)) {
                await service.setEnabled(guildId, kind, key, true);
                return interaction.editReply({ content: `${kind} enabled.`, flags: [MessageFlags.Ephemeral] });
            }
            if ((action === 'username-unset' || action === 'vanity-unset') && kind === 'tracking') {
                const removed = await service.remove(guildId, kind, key);
                return interaction.editReply({ content: removed ? `${action.split('-')[0]} tracking removed.` : 'No matching tracking configuration was found.', flags: [MessageFlags.Ephemeral] });
            }
            if (kind === 'tracking' && action === 'remove' && existing && interaction.options.getString('type')) {
                const config = JSON.parse(existing.config || '{}');
                config.types = (config.types || []).filter(type => type !== interaction.options.getString('type'));
                if (config.types.length) await service.upsert({ guildId, kind, key, config, enabled: existing.enabled, createdBy: interaction.user.id });
                else await service.remove(guildId, kind, key);
                return interaction.editReply({ content: `${interaction.options.getString('type')} tracking removed from that channel.`, flags: [MessageFlags.Ephemeral] });
            }
            if (['remove', 'unset', 'channels-remove', 'roles-remove', 'bots-remove', 'notify-remove', 'role-remove', 'removerole'].includes(action)
                && !(kind === 'vanity' && ['role-remove', 'removerole'].includes(action))) {
                const removed = await service.remove(guildId, kind, key);
                return interaction.editReply({ content: removed ? `${kind} automation removed.` : `No matching ${kind} automation was found.`, flags: [MessageFlags.Ephemeral] });
            }

            const config = ruleConfig(interaction, existing ? JSON.parse(existing.config || '{}') : {});
            if (kind === 'bumpreminder' && action === 'reminder') { config.reminder = config.message; delete config.message; }
            if (kind === 'bumpreminder' && action === 'thankyou') { config.thankyou = config.message; delete config.message; }
            if (kind === 'tracking') {
                if (action === 'add') {
                    config.mode = 'channel';
                    config.types = config.type ? [config.type] : ['username', 'vanity'];
                    if (config.availabilityDays) {
                        if (config.type === 'username') config.usernameDays = config.availabilityDays;
                        else if (config.type === 'vanity') config.vanityDays = config.availabilityDays;
                        else config.usernameDays = config.vanityDays = config.availabilityDays;
                    }
                } else if (action === 'notify-add') {
                    if (!interaction.options.getBoolean('confirm')) return interaction.editReply({ content: 'Notification was not created. Set `confirm` to true to allow a future direct message.', flags: [MessageFlags.Ephemeral] });
                    config.mode = 'notify'; config.userId = interaction.user.id;
                } else if (action === 'username-channel') {
                    config.mode = 'channel'; config.types = ['username']; config.usernameDays ||= 14;
                } else if (action === 'vanity-set') {
                    config.mode = 'channel'; config.types = ['vanity']; config.vanityDays ||= 16;
                } else config.mode = action.split('-')[0];
            }
            if (kind === 'autoreact' && ['channels-add', 'roles-add'].includes(action)) {
                const target = action.startsWith('channels-') ? interaction.options.getChannel('channel').id : interaction.options.getRole('role').id;
                const field = action.startsWith('channels-') ? 'channelIds' : 'roleIds';
                config[field] = [...new Set([...(config[field] || []), target])];
                delete config.channelId;
                delete config.roleId;
            }
            if (kind === 'autoreact') {
                const event = { image: 'image', images: 'image', spoiler: 'spoiler', spoilers: 'spoiler', emoji: 'emoji', emojis: 'emoji', sticker: 'sticker', stickers: 'sticker' }[String(config.trigger || '').toLowerCase()];
                if (event) config.event = event;
                const invalidEmoji = (config.reactions || []).find(emoji => {
                    const customId = /<a?:\w+:(\d+)>/.exec(emoji)?.[1];
                    return customId && !interaction.guild.emojis.cache.has(customId);
                });
                if (invalidEmoji) return interaction.editReply({ content: `ByteBot cannot access ${invalidEmoji}. Use a server emoji or Unicode emoji.`, flags: [MessageFlags.Ephemeral] });
                if (!existing && (await service.list(guildId, kind)).length >= 1000) return interaction.editReply({ content: 'This server has reached the 1,000 autoreaction limit.', flags: [MessageFlags.Ephemeral] });
            }
            if (kind === 'vanity' && ['role-add', 'role', 'role-remove', 'removerole'].includes(action)) {
                const roleId = interaction.options.getRole('role').id;
                const roles = new Set(config.roleIds || []);
                if (action.includes('remove')) roles.delete(roleId); else roles.add(roleId);
                config.roleIds = [...roles];
                delete config.roleId;
            }
            if (interaction.options.getString?.('interval') && !config.intervalMs) {
                return interaction.editReply({ content: 'Use an interval such as `30m`, `2h`, or `1d` (minimum 6 seconds, maximum 28 days).', flags: [MessageFlags.Ephemeral] });
            }
            const role = (() => { try { return interaction.options.getRole('role'); } catch { return null; } })();
            if (role && (!role.editable || role.managed)) {
                return interaction.editReply({ content: 'That role is managed or above ByteBot and cannot be assigned safely.', flags: [MessageFlags.Ephemeral] });
            }
            const now = Date.now();
            const nextRunAt = kind === 'sticky' && action === 'add' ? now
                : ['timer', 'revive', 'counter'].includes(kind) ? now + (config.intervalMs || 3600000) : existing?.nextRunAt || null;
            await service.upsert({ guildId, kind, key, config, enabled: true, nextRunAt, createdBy: interaction.user.id });
            return interaction.editReply({ content: `${kind} ${existing ? 'updated' : 'configured'} for **${key}**.`, flags: [MessageFlags.Ephemeral] });
        }
    };
}

module.exports = { createAutomationCommand, formatRules };
