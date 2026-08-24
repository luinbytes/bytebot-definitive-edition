const crypto = require('crypto');

const SCHEMA_VERSION = 1;
const MAX_BACKUPS = 5;
const SECTIONS = ['roles', 'channels', 'emojis', 'stickers', 'bytebot'];
const RESTORABLE_CHANNEL_TYPES = new Set([0, 2, 4, 13, 15]);

function digest(payload) {
    return crypto.createHash('sha256').update(payload).digest('hex');
}

function serializeRoles(guild) {
    return [...guild.roles.cache.values()]
        .filter(role => role.id !== guild.id && !role.managed)
        .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
        .map(role => ({
            sourceId: role.id,
            name: role.name,
            color: role.color,
            permissions: role.permissions.bitfield.toString(),
            position: role.position,
            hoist: Boolean(role.hoist),
            mentionable: Boolean(role.mentionable),
            icon: role.iconURL?.() || null
        }));
}

function serializeOverwrites(channel) {
    return [...(channel.permissionOverwrites?.cache?.values() || [])]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(overwrite => ({
            sourceId: overwrite.id,
            type: overwrite.type,
            allow: overwrite.allow.bitfield.toString(),
            deny: overwrite.deny.bitfield.toString()
        }));
}

function serializeChannels(guild) {
    return [...guild.channels.cache.values()]
        .filter(channel => RESTORABLE_CHANNEL_TYPES.has(channel.type))
        .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
        .map(channel => ({
            sourceId: channel.id,
            type: channel.type,
            name: channel.name,
            position: channel.position,
            parentSourceId: channel.parentId || null,
            topic: channel.topic || null,
            slowmode: channel.rateLimitPerUser || 0,
            nsfw: Boolean(channel.nsfw),
            overwrites: serializeOverwrites(channel)
        }));
}

function serializeEmojis(guild) {
    return [...guild.emojis.cache.values()]
        .filter(emoji => !emoji.managed)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(emoji => ({
            sourceId: emoji.id,
            name: emoji.name,
            animated: Boolean(emoji.animated),
            url: emoji.url,
            roleSourceIds: [...(emoji.roles?.cache?.keys() || [])].sort()
        }));
}

function serializeStickers(guild) {
    return [...guild.stickers.cache.values()]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(sticker => ({
            sourceId: sticker.id,
            name: sticker.name,
            description: sticker.description || null,
            tags: sticker.tags,
            url: sticker.url
        }));
}

function rowToBackup(row) {
    if (!row) return null;
    const payload = JSON.parse(row.payload);
    if (digest(row.payload) !== row.digest) throw new Error('Backup integrity check failed.');
    if (row.schema_version !== SCHEMA_VERSION) throw new Error(`Unsupported backup schema version ${row.schema_version}.`);
    return {
        id: row.id,
        guildId: row.guild_id,
        creatorId: row.creator_id,
        name: row.name,
        description: row.description,
        schemaVersion: row.schema_version,
        payload,
        digest: row.digest,
        size: Buffer.byteLength(row.payload),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

class GuildBackupService {
    constructor(options) {
        this.sqlite = options.sqlite;
        this.now = options.now || Date.now;
        this.randomUUID = options.randomUUID || crypto.randomUUID;
    }

    create({ guild, creatorId, name, description = null }) {
        const cleanName = String(name || '').trim();
        const cleanDescription = description == null ? null : String(description).trim();
        if (!cleanName || cleanName.length > 100) throw new Error('Backup names must be 1-100 characters.');
        if (cleanDescription?.length > 500) throw new Error('Backup descriptions cannot exceed 500 characters.');
        const count = this.sqlite.prepare('SELECT COUNT(*) count FROM guild_backups WHERE guild_id = ? AND creator_id = ?')
            .get(guild.id, creatorId).count;
        if (count >= MAX_BACKUPS) throw new Error('You can keep at most five backups for this server.');

        const payloadText = JSON.stringify({
            roles: serializeRoles(guild),
            channels: serializeChannels(guild),
            emojis: serializeEmojis(guild),
            stickers: serializeStickers(guild),
            bytebot: {}
        });
        const now = this.now();
        const id = this.randomUUID();
        this.sqlite.prepare(`INSERT INTO guild_backups
            (id, guild_id, creator_id, name, description, schema_version, payload, digest, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, guild.id, creatorId, cleanName, cleanDescription, SCHEMA_VERSION, payloadText, digest(payloadText), now, now);
        return this.view(guild.id, creatorId, id);
    }

    list(guildId, creatorId) {
        return this.sqlite.prepare(`SELECT * FROM guild_backups WHERE guild_id = ? AND creator_id = ?
            ORDER BY created_at DESC, id`).all(guildId, creatorId).map(rowToBackup);
    }

    view(guildId, creatorId, id) {
        return rowToBackup(this.sqlite.prepare(
            'SELECT * FROM guild_backups WHERE id = ? AND guild_id = ? AND creator_id = ?'
        ).get(id, guildId, creatorId));
    }

    rename(guildId, creatorId, id, name) {
        const cleanName = String(name || '').trim();
        if (!cleanName || cleanName.length > 100) throw new Error('Backup names must be 1-100 characters.');
        const row = this.sqlite.prepare(`UPDATE guild_backups SET name = ?, updated_at = ?
            WHERE id = ? AND guild_id = ? AND creator_id = ? RETURNING *`)
            .get(cleanName, this.now(), id, guildId, creatorId);
        return rowToBackup(row);
    }

    delete(guildId, creatorId, id) {
        return Boolean(this.sqlite.prepare(
            'DELETE FROM guild_backups WHERE id = ? AND guild_id = ? AND creator_id = ?'
        ).run(id, guildId, creatorId).changes);
    }

    preview({ guild, creatorId, id, mode = 'merge', sections = SECTIONS }) {
        if (!['merge', 'destructive'].includes(mode)) throw new Error('Restore mode must be merge or destructive.');
        const selected = [...new Set(sections)];
        if (!selected.length || selected.some(section => !SECTIONS.includes(section))) throw new Error('Select valid backup sections.');
        const backup = this.view(guild.id, creatorId, id);
        if (!backup) throw new Error('Backup not found.');
        const counts = Object.fromEntries(SECTIONS.map(section => [section,
            selected.includes(section)
                ? (Array.isArray(backup.payload[section]) ? backup.payload[section].length : Object.keys(backup.payload[section]).length)
                : 0
        ]));
        const remove = Object.fromEntries(SECTIONS.map(section => [section, 0]));
        if (mode === 'destructive') {
            remove.roles = selected.includes('roles') ? serializeRoles(guild).length : 0;
            remove.channels = selected.includes('channels') ? serializeChannels(guild).length : 0;
            remove.emojis = selected.includes('emojis') ? serializeEmojis(guild).length : 0;
            remove.stickers = selected.includes('stickers') ? serializeStickers(guild).length : 0;
        }
        return { backupId: backup.id, mode, sections: selected, create: counts, remove };
    }
}

module.exports = { GuildBackupService, SCHEMA_VERSION, SECTIONS };
