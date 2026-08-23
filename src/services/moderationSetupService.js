const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { sqlite } = require('../database');

async function applyModerationOverwrites(channel, config) {
    if (!channel?.permissionOverwrites?.edit || channel.isThread?.()) return;
    if (config.image_mute_role_id) {
        await channel.permissionOverwrites.edit(config.image_mute_role_id, {
            AttachFiles: false,
            EmbedLinks: false
        }, { reason: 'ByteBot moderation setup' });
    }
    if (config.reaction_mute_role_id) {
        await channel.permissionOverwrites.edit(config.reaction_mute_role_id, {
            AddReactions: false,
            UseExternalEmojis: false,
            UseExternalStickers: false
        }, { reason: 'ByteBot moderation setup' });
    }
    if (config.jail_role_id && channel.id !== config.jail_channel_id) {
        await channel.permissionOverwrites.edit(config.jail_role_id, { ViewChannel: false }, { reason: 'ByteBot moderation setup' });
    }
}

async function setupModeration(guild) {
    const current = sqlite.prepare('SELECT managed_resources FROM moderation_config WHERE guild_id = ?').get(guild.id);
    if (current?.managed_resources) throw new Error('Moderation setup already owns resources in this server. Reset it first.');
    if (!guild.members.me.permissions.has([PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels])) {
        throw new Error('I need Manage Roles and Manage Channels to set up moderation.');
    }

    const resources = { channels: [], roles: [] };
    try {
        const category = await guild.channels.create({ name: 'greed-mod', type: ChannelType.GuildCategory, reason: 'ByteBot moderation setup' });
        resources.channels.push(category);
        const imute = await guild.roles.create({ name: 'imute', reason: 'ByteBot moderation setup' });
        const rmute = await guild.roles.create({ name: 'rmute', reason: 'ByteBot moderation setup' });
        const jailed = await guild.roles.create({ name: 'jailed', reason: 'ByteBot moderation setup' });
        resources.roles.push(imute, rmute, jailed);
        const logs = await guild.channels.create({ name: 'logs', type: ChannelType.GuildText, parent: category.id, reason: 'ByteBot moderation setup' });
        const jail = await guild.channels.create({
            name: 'jail',
            type: ChannelType.GuildText,
            parent: category.id,
            reason: 'ByteBot moderation setup',
            permissionOverwrites: [
                { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: jailed.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] }
            ]
        });
        resources.channels.push(logs, jail);

        const config = {
            image_mute_role_id: imute.id,
            reaction_mute_role_id: rmute.id,
            jail_role_id: jailed.id,
            jail_channel_id: jail.id
        };
        for (const channel of guild.channels.cache.values()) await applyModerationOverwrites(channel, config);

        const owned = JSON.stringify({
            channels: resources.channels.map(resource => resource.id),
            roles: resources.roles.map(resource => resource.id)
        });
        sqlite.prepare(`
            INSERT INTO moderation_config
                (guild_id, log_channel_id, image_mute_role_id, reaction_mute_role_id,
                 jail_role_id, jail_channel_id, managed_resources, setup_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'ready')
            ON CONFLICT (guild_id) DO UPDATE SET
                log_channel_id = excluded.log_channel_id,
                image_mute_role_id = excluded.image_mute_role_id,
                reaction_mute_role_id = excluded.reaction_mute_role_id,
                jail_role_id = excluded.jail_role_id,
                jail_channel_id = excluded.jail_channel_id,
                managed_resources = excluded.managed_resources,
                setup_status = 'ready'
        `).run(guild.id, logs.id, imute.id, rmute.id, jailed.id, jail.id, owned);
        return config;
    } catch (error) {
        const rollback = await Promise.allSettled([...resources.channels, ...resources.roles].reverse().map(resource =>
            resource.delete('ByteBot moderation setup rollback')));
        const remaining = [...resources.channels, ...resources.roles]
            .filter((_, index) => rollback[rollback.length - 1 - index]?.status === 'rejected');
        if (remaining.length) {
            sqlite.prepare(`
                INSERT INTO moderation_config (guild_id, managed_resources, setup_status) VALUES (?, ?, 'cleanup_required')
                ON CONFLICT (guild_id) DO UPDATE SET managed_resources = excluded.managed_resources, setup_status = 'cleanup_required'
            `).run(guild.id, JSON.stringify({
                channels: remaining.filter(resource => resources.channels.includes(resource)).map(resource => resource.id),
                roles: remaining.filter(resource => resources.roles.includes(resource)).map(resource => resource.id)
            }));
        }
        throw error;
    }
}

async function resetModeration(guild) {
    const config = sqlite.prepare('SELECT managed_resources FROM moderation_config WHERE guild_id = ?').get(guild.id);
    const owned = config?.managed_resources ? JSON.parse(config.managed_resources) : { channels: [], roles: [] };
    const resources = [
        ...owned.channels.map(id => ({ type: 'channels', id, resource: guild.channels.cache.get(id) })),
        ...owned.roles.map(id => ({ type: 'roles', id, resource: guild.roles.cache.get(id) }))
    ].filter(item => item.resource);
    const deleted = await Promise.allSettled(resources.map(item => item.resource.delete('ByteBot moderation setup reset')));
    const remaining = { channels: [], roles: [] };
    deleted.forEach((result, index) => {
        if (result.status === 'rejected') remaining[resources[index].type].push(resources[index].id);
    });
    const failure = deleted.find(result => result.status === 'rejected');
    if (failure) {
        sqlite.prepare(`
            UPDATE moderation_config SET managed_resources = ?, setup_status = 'cleanup_required'
            WHERE guild_id = ?
        `).run(JSON.stringify(remaining), guild.id);
        throw new Error(`Reset is incomplete: ${failure.reason.message}`);
    }

    sqlite.prepare(`
        UPDATE moderation_config SET log_channel_id = NULL, image_mute_role_id = NULL,
            reaction_mute_role_id = NULL, jail_role_id = NULL, jail_channel_id = NULL,
            managed_resources = NULL, setup_status = NULL WHERE guild_id = ?
    `).run(guild.id);
}

module.exports = { applyModerationOverwrites, setupModeration, resetModeration };
