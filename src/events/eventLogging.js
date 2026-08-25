const crypto = require('crypto');
const { Events } = require('discord.js');
const logger = require('../utils/logger');

const GROUPS = {
    [Events.MessageUpdate]: 'messages',
    [Events.MessageDelete]: 'messages',
    [Events.GuildMemberAdd]: 'members',
    [Events.GuildMemberRemove]: 'members',
    [Events.GuildMemberUpdate]: 'members',
    [Events.AutoModerationActionExecution]: 'moderation',
    [Events.GuildAuditLogEntryCreate]: 'moderation',
    [Events.GuildUpdate]: 'server',
    [Events.VoiceStateUpdate]: 'voice',
    [Events.ChannelCreate]: 'channels',
    [Events.ChannelDelete]: 'channels',
    [Events.ChannelUpdate]: 'channels',
    [Events.GuildRoleCreate]: 'roles',
    [Events.GuildRoleDelete]: 'roles',
    [Events.GuildRoleUpdate]: 'roles',
    [Events.InviteCreate]: 'invites',
    [Events.InviteDelete]: 'invites',
    [Events.GuildEmojiCreate]: 'emojis',
    [Events.GuildEmojiDelete]: 'emojis',
    [Events.GuildEmojiUpdate]: 'emojis',
    [Events.GuildStickerCreate]: 'stickers',
    [Events.GuildStickerDelete]: 'stickers',
    [Events.GuildStickerUpdate]: 'stickers',
    [Events.GuildIntegrationsUpdate]: 'integrations',
    [Events.GuildSoundboardSoundCreate]: 'soundboard',
    [Events.GuildSoundboardSoundDelete]: 'soundboard',
    [Events.GuildSoundboardSoundUpdate]: 'soundboard',
    [Events.GuildSoundboardSoundsUpdate]: 'soundboard'
};

function entity(args) {
    return args.find(value => value?.guild?.id || value?.guildId) || args[0];
}

function guildOf(name, args, client) {
    if (name === Events.GuildAuditLogEntryCreate) return args[1];
    if (name === Events.GuildSoundboardSoundsUpdate) return args[1];
    const value = entity(args);
    return value?.guild || client.guilds.cache.get(value?.guildId) || (value?.id && value?.members ? value : null);
}

function eventKey(name, args) {
    if (name === Events.GuildSoundboardSoundsUpdate) {
        const sounds = [...args[0].values()].map(sound => [sound.id, sound.name, sound.volume, sound.emoji?.id || sound.emoji?.name]).sort();
        return `${name}:${crypto.createHash('sha256').update(JSON.stringify(sounds)).digest('hex').slice(0, 24)}:${crypto.randomUUID()}`;
    }
    const current = args[1]?.id ? args[1] : args[0];
    if (name === Events.GuildMemberAdd || name === Events.GuildMemberRemove) {
        return `${name}:${current?.id}:${current?.joinedTimestamp || current?.joinedAt?.getTime?.() || 'unknown'}`;
    }
    const stable = name === Events.GuildAuditLogEntryCreate ? args[0]?.id
        : name === Events.AutoModerationActionExecution ? args[0]?.id
            : name === Events.MessageUpdate ? `${args[1]?.id}:${args[1]?.editedTimestamp}`
                : name === Events.MessageDelete ? args[0]?.id : null;
    if (stable) return `${name}:${stable}`;
    const state = JSON.stringify({
        id: current?.id || current?.code || current?.user?.id || current?.member?.id,
        name: current?.name, channelId: current?.channelId, nickname: current?.nickname,
        type: current?.type, parentId: current?.parentId, topic: current?.topic,
        position: current?.position, color: current?.color, hoist: current?.hoist,
        mentionable: current?.mentionable, permissions: current?.permissions?.bitfield?.toString(),
        mute: current?.mute, deaf: current?.deaf, streaming: current?.streaming, video: current?.selfVideo,
        icon: current?.icon, banner: current?.banner, description: current?.description,
        tags: current?.tags, format: current?.format, volume: current?.volume,
        roles: current?.roles?.cache ? [...current.roles.cache.keys()].sort() : undefined,
        overwrites: current?.permissionOverwrites?.cache
            ? [...current.permissionOverwrites.cache.values()].map(row => [row.id, row.allow?.bitfield?.toString(), row.deny?.bitfield?.toString()]).sort()
            : undefined,
        timestamp: current?.createdTimestamp || current?.deletedTimestamp
    });
    return `${name}:${crypto.createHash('sha256').update(state).digest('hex').slice(0, 24)}:${crypto.randomUUID()}`;
}

function details(name, args) {
    const oldValue = args[0];
    const value = args[1]?.guild || args[1]?.guildId ? args[1] : args[0];
    if (name === Events.MessageUpdate) return {
        title: 'Message edited',
        description: `Message ${value.id} in <#${value.channelId}>\nBefore: ${oldValue.content ?? '[content unavailable]'}\nAfter: ${value.content ?? '[content unavailable]'}`,
        actorId: value.author?.id, channelId: value.channelId
    };
    if (name === Events.MessageDelete) return {
        title: 'Message deleted', description: `Message ${value.id} in <#${value.channelId}>\n${value.content ?? '[content unavailable]'}`,
        actorId: value.author?.id, channelId: value.channelId
    };
    if (name === Events.GuildAuditLogEntryCreate) return {
        title: 'Moderation audit event',
        description: `Action ${oldValue.action} by <@${oldValue.executorId || 'unknown'}> on ${oldValue.targetId || 'unknown target'}`,
        actorId: oldValue.executorId
    };
    if (name === Events.AutoModerationActionExecution) return {
        title: 'AutoMod action', description: `Action ${value.action?.type ?? 'unknown'} for <@${value.userId}> in <#${value.channelId}>`,
        actorId: value.userId, channelId: value.channelId
    };
    const id = value?.id || value?.code || value?.user?.id || value?.member?.id || value?.guildId || 'unknown';
    const label = name.replace(/([A-Z])/g, ' $1').trim();
    return {
        title: label,
        description: `${label} · ${value?.name || value?.user?.username || value?.member?.displayName || id}`,
        actorId: value?.user?.id || value?.member?.id,
        channelId: value?.channelId || (value?.isTextBased?.() ? value.id : null)
    };
}

module.exports = {
    names: Object.keys(GROUPS),
    async execute(name, ...args) {
        const client = args.pop();
        const value = entity(args);
        if (!client.eventLoggingService || value?.author?.bot || value?.user?.bot || value?.member?.user?.bot) return;
        const guild = guildOf(name, args, client);
        if (!guild) return;
        try {
            let key = eventKey(name, args);
            if (name === Events.GuildIntegrationsUpdate && guild.fetchIntegrations) {
                const integrations = await guild.fetchIntegrations();
                const state = [...integrations.values()].map(item => [item.id, item.name, item.type, item.enabled, item.syncing, item.role?.id]).sort();
                key = `${name}:${crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex').slice(0, 24)}:${crypto.randomUUID()}`;
            }
            await client.eventLoggingService.log(guild, GROUPS[name], key, details(name, args));
        } catch (error) {
            logger.error(`Event logging failed for ${name} in ${guild.id}: ${error.message}`);
        }
    }
};

module.exports.eventKey = eventKey;
