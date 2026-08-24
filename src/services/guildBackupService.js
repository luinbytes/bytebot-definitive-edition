const crypto = require('crypto');
const { PermissionFlagsBits } = require('discord.js');

const SCHEMA_VERSION = 1;
const MAX_BACKUPS = 5;
const SECTIONS = ['roles', 'channels', 'emojis', 'stickers', 'bytebot'];
const RESTORABLE_CHANNEL_TYPES = new Set([0, 2, 4, 13, 15]);
const BYTEBOT_TABLES = [
    { name: 'guilds', guild: 'id', keys: ['id'], preserveId: true, omit: ['joined_at'] },
    { name: 'lifecycle_messages', keys: ['guild_id', 'type'] },
    { name: 'moderation_config', keys: ['guild_id'], omit: ['next_case_number'] },
    { name: 'lockdown_ignores', keys: ['guild_id', 'channel_id'] },
    { name: 'forced_nicknames', keys: ['guild_id', 'user_id'] },
    { name: 'antinuke_config', keys: ['guild_id'] },
    { name: 'antinuke_modules', keys: ['guild_id', 'module'] },
    { name: 'antinuke_admins', keys: ['guild_id', 'user_id'] },
    { name: 'antinuke_whitelist', keys: ['guild_id', 'user_id'] },
    { name: 'antiraid_config', keys: ['guild_id'] },
    { name: 'antiraid_modules', keys: ['guild_id', 'module'] },
    { name: 'antiraid_username_patterns', keys: ['guild_id', 'pattern'] },
    { name: 'antiraid_exemptions', keys: ['guild_id', 'target_type', 'target_id'] },
    { name: 'automod_config', keys: ['guild_id'], omit: ['native_rule_id', 'native_nsfw_rule_id'] },
    { name: 'automod_filters', keys: ['guild_id', 'filter'] },
    { name: 'automod_rules', keys: ['guild_id', 'kind', 'name'] },
    { name: 'automod_exemptions', keys: ['guild_id', 'target_type', 'target_id'] },
    { name: 'automod_strike_levels', keys: ['guild_id', 'level'] },
    { name: 'moderation_templates', keys: ['guild_id', 'action', 'message_type'] },
    { name: 'moderation_staff_roles', keys: ['guild_id', 'role_id'] },
    { name: 'warning_punishments', keys: ['guild_id', 'threshold'] },
    { name: 'command_permissions', keys: ['guild_id', 'command_name', 'role_id'] },
    { name: 'command_access_rules', keys: ['guild_id', 'command_path', 'effect', 'scope_type', 'scope_id'] },
    { name: 'fake_permissions', keys: ['guild_id', 'role_id', 'permission'] },
    { name: 'denied_role_permissions', keys: ['guild_id', 'permission'] },
    { name: 'protected_targets', keys: ['guild_id', 'target_type', 'target_id'] },
    { name: 'uwu_lock_members', keys: ['guild_id', 'user_id'] },
    { name: 'birthday_config', keys: ['guild_id'], omit: ['last_check'] },
    { name: 'auto_responses', keys: ['guild_id', 'trigger', 'channel_id', 'match_type'] },
    { name: 'automation_rules', keys: ['guild_id', 'kind', 'key'], omit: ['last_run_at', 'last_message_id', 'run_count', 'lease_token', 'lease_expires_at'],
        where: "kind NOT IN ('delete-message', 'temp-role', 'booster-lost')" },
    { name: 'starboard_config', keys: ['guild_id'] },
    { name: 'honeypot_config', keys: ['guild_id'] },
    { name: 'honeypot_exempt_users', keys: ['guild_id', 'user_id'] },
    { name: 'honeypot_exempt_roles', keys: ['guild_id', 'role_id'] },
    { name: 'suggestion_config', keys: ['guild_id'] },
    { name: 'achievement_role_config', keys: ['guild_id'] },
    { name: 'custom_achievements', keys: ['guild_id', 'achievement_id'] },
    { name: 'ticket_configs', keys: ['guild_id'], omit: ['next_number'] },
    { name: 'giveaway_configs', keys: ['guild_id'] },
    { name: 'giveaway_presets', keys: ['guild_id', 'name'] },
    { name: 'giveaway_blacklist', keys: ['guild_id', 'role_id'] },
    { name: 'giveaway_role_limits', keys: ['guild_id', 'role_id'] },
    { name: 'customization_presets', keys: ['guild_id', 'name'] },
    { name: 'server_listings', keys: ['guild_id'] }
];
const BYTEBOT_TABLE_NAMES = new Set(BYTEBOT_TABLES.map(table => table.name));

function sqlIdentifier(value) {
    return `"${value.replaceAll('"', '""')}"`;
}

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
        .sort((left, right) => Number(right.type === 4) - Number(left.type === 4)
            || left.position - right.position || left.id.localeCompare(right.id))
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

function serializeBytebot(sqlite, guildId) {
    return Object.fromEntries(BYTEBOT_TABLES.map(table => {
        const guildColumn = table.guild || 'guild_id';
        const extra = table.where ? ` AND ${table.where}` : '';
        const rows = sqlite.prepare(`SELECT * FROM ${sqlIdentifier(table.name)} WHERE ${sqlIdentifier(guildColumn)} = ?${extra}`)
            .all(guildId).map(row => {
                const copy = { ...row };
                if (!table.preserveId) delete copy.id;
                for (const column of table.omit || []) delete copy[column];
                return copy;
            }).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
        return [table.name, rows];
    }));
}

function countBytebot(bytebot) {
    return Object.values(bytebot).reduce((total, rows) => total + rows.length, 0);
}

function rowToBackup(row) {
    if (!row) return null;
    const payload = JSON.parse(row.payload);
    if (digest(row.payload) !== row.digest) throw new Error('Backup integrity check failed.');
    if (row.schema_version !== SCHEMA_VERSION) throw new Error(`Unsupported backup schema version ${row.schema_version}.`);
    if (!payload || !['roles', 'channels', 'emojis', 'stickers'].every(section => Array.isArray(payload[section]))
        || !payload.bytebot || typeof payload.bytebot !== 'object'
        || Object.entries(payload.bytebot).some(([table, rows]) => !BYTEBOT_TABLE_NAMES.has(table) || !Array.isArray(rows))) {
        throw new Error('Backup payload is invalid.');
    }
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
        this.sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    }

    create({ guild, creatorId, name, description = null }) {
        const cleanName = String(name || '').trim();
        const cleanDescription = description == null ? null : String(description).trim();
        if (!cleanName || cleanName.length > 100) throw new Error('Backup names must be 1-100 characters.');
        if (cleanDescription?.length > 500) throw new Error('Backup descriptions cannot exceed 500 characters.');
        return this.sqlite.transaction(() => {
            const count = this.sqlite.prepare('SELECT COUNT(*) count FROM guild_backups WHERE guild_id = ? AND creator_id = ?')
                .get(guild.id, creatorId).count;
            if (count >= MAX_BACKUPS) throw new Error('You can keep at most five backups for this server.');
            const payloadText = JSON.stringify({
                roles: serializeRoles(guild),
                channels: serializeChannels(guild),
                emojis: serializeEmojis(guild),
                stickers: serializeStickers(guild),
                bytebot: serializeBytebot(this.sqlite, guild.id)
            });
            const now = this.now();
            const id = this.randomUUID();
            this.sqlite.prepare(`INSERT INTO guild_backups
                (id, guild_id, creator_id, name, description, schema_version, payload, digest, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(id, guild.id, creatorId, cleanName, cleanDescription, SCHEMA_VERSION, payloadText, digest(payloadText), now, now);
            return this.view(guild.id, creatorId, id);
        }).immediate();
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
                ? (Array.isArray(backup.payload[section]) ? backup.payload[section].length : countBytebot(backup.payload.bytebot))
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

    requirePermissions(guild, sections, mode, backup) {
        const required = [
            ['roles', PermissionFlagsBits.ManageRoles, 'Manage Roles'],
            ['channels', PermissionFlagsBits.ManageChannels, 'Manage Channels'],
            ['emojis', PermissionFlagsBits.ManageGuildExpressions, 'Manage Expressions'],
            ['stickers', PermissionFlagsBits.ManageGuildExpressions, 'Manage Expressions']
        ];
        for (const [section, permission, name] of required) {
            if (sections.includes(section) && !guild.members.me.permissions.has(permission)) {
                throw new Error(`I need ${name} to restore ${section}.`);
            }
        }
        if (mode === 'destructive' && sections.includes('roles')) {
            const blocked = [...guild.roles.cache.values()].find(role => role.id !== guild.id && !role.managed && role.editable === false);
            if (blocked) throw new Error(`Role ${blocked.name} is above ByteBot and cannot be removed.`);
        }
        if (mode === 'destructive' && sections.includes('channels')) {
            const blocked = [...guild.channels.cache.values()].find(channel =>
                RESTORABLE_CHANNEL_TYPES.has(channel.type) && channel.deletable === false);
            if (blocked) throw new Error(`Channel ${blocked.name} cannot be removed by ByteBot.`);
        }
        if (sections.includes('roles')) {
            const denied = this.sqlite.prepare('SELECT permission FROM denied_role_permissions WHERE guild_id = ?').all(guild.id);
            for (const role of backup.payload.roles) {
                const permissions = BigInt(role.permissions);
                if (!guild.members.me.permissions.has(permissions)) {
                    throw new Error(`ByteBot cannot recreate all permissions on role ${role.name}.`);
                }
                const blocked = denied.find(({ permission }) => {
                    const flag = PermissionFlagsBits[permission];
                    return flag !== undefined && (permissions & flag) === flag;
                });
                if (blocked) throw new Error(`Role ${role.name} carries the blocked permission ${blocked.permission}.`);
                if (guild.members.me.roles?.highest && role.position >= guild.members.me.roles.highest.position) {
                    throw new Error(`Role ${role.name} is above ByteBot's highest role.`);
                }
            }
        }
    }

    async restore({ guild, creatorId, id, mode = 'merge', sections = SECTIONS, confirmed = false }) {
        if (!confirmed) throw new Error('Restore requires explicit confirmation.');
        const plan = this.preview({ guild, creatorId, id, mode, sections });
        const backup = this.view(guild.id, creatorId, id);
        this.requirePermissions(guild, plan.sections, mode, backup);
        const created = Object.fromEntries(SECTIONS.map(section => [section, 0]));
        const removed = Object.fromEntries(SECTIONS.map(section => [section, 0]));
        const failures = [];
        const roleIds = new Map([[backup.guildId, guild.roles.everyone.id]]);
        const channelIds = new Map();

        if (mode === 'destructive') {
            const removals = [
                ['channels', serializeChannels(guild)],
                ['roles', serializeRoles(guild)],
                ['emojis', serializeEmojis(guild)],
                ['stickers', serializeStickers(guild)]
            ];
            for (const [section, items] of removals) {
                if (!plan.sections.includes(section)) continue;
                const cache = guild[section].cache;
                for (const item of [...items].reverse()) {
                    try {
                        await cache.get(item.sourceId).delete(`ByteBot destructive restore ${backup.id}`);
                        removed[section]++;
                    } catch (error) {
                        failures.push({ section, name: item.name, error: `Remove failed: ${error.message}` });
                    }
                    if (section === 'roles' || section === 'channels') await this.sleep(250);
                }
            }
        }

        if (plan.sections.includes('roles')) {
            for (const role of backup.payload.roles) {
                try {
                    const restored = await guild.roles.create({
                        name: role.name,
                        color: role.color,
                        permissions: role.permissions,
                        position: role.position,
                        hoist: role.hoist,
                        mentionable: role.mentionable,
                        icon: role.icon,
                        reason: `ByteBot backup ${backup.id}`
                    });
                    roleIds.set(role.sourceId, restored.id);
                    created.roles++;
                } catch (error) {
                    failures.push({ section: 'roles', name: role.name, error: error.message });
                }
                await this.sleep(250);
            }
        }

        if (plan.sections.includes('channels')) {
            for (const channel of backup.payload.channels) {
                try {
                    const permissionOverwrites = channel.overwrites.map(overwrite => {
                        const mappedId = overwrite.type === 0
                            ? (roleIds.get(overwrite.sourceId) || guild.roles.cache.get(overwrite.sourceId)?.id)
                            : overwrite.sourceId;
                        if (!mappedId) throw new Error(`Referenced role ${overwrite.sourceId} was not restored.`);
                        return { id: mappedId, type: overwrite.type, allow: overwrite.allow, deny: overwrite.deny };
                    });
                    const options = {
                        name: channel.name,
                        type: channel.type,
                        position: channel.position,
                        parent: channel.parentSourceId ? channelIds.get(channel.parentSourceId) : null,
                        permissionOverwrites,
                        reason: `ByteBot backup ${backup.id}`
                    };
                    if (channel.parentSourceId && !options.parent) {
                        throw new Error(`Parent category ${channel.parentSourceId} was not restored.`);
                    }
                    if (channel.type !== 4) {
                        options.nsfw = channel.nsfw;
                        options.rateLimitPerUser = channel.slowmode;
                    }
                    if ([0, 15].includes(channel.type)) options.topic = channel.topic;
                    const restored = await guild.channels.create(options);
                    channelIds.set(channel.sourceId, restored.id);
                    created.channels++;
                } catch (error) {
                    failures.push({ section: 'channels', name: channel.name, error: error.message });
                }
                await this.sleep(250);
            }
        }

        if (plan.sections.includes('emojis')) {
            for (const emoji of backup.payload.emojis) {
                try {
                    const roles = emoji.roleSourceIds.map(sourceId => roleIds.get(sourceId) || guild.roles.cache.get(sourceId)?.id)
                        .filter(Boolean);
                    await guild.emojis.create({
                        attachment: emoji.url,
                        name: emoji.name,
                        roles,
                        reason: `ByteBot backup ${backup.id}`
                    });
                    created.emojis++;
                } catch (error) {
                    failures.push({ section: 'emojis', name: emoji.name, error: error.message });
                }
            }
        }

        if (plan.sections.includes('stickers')) {
            for (const sticker of backup.payload.stickers) {
                try {
                    await guild.stickers.create({
                        file: sticker.url,
                        name: sticker.name,
                        tags: sticker.tags,
                        description: sticker.description,
                        reason: `ByteBot backup ${backup.id}`
                    });
                    created.stickers++;
                } catch (error) {
                    failures.push({ section: 'stickers', name: sticker.name, error: error.message });
                }
            }
        }

        if (plan.sections.includes('bytebot')) {
            const remap = value => {
                if (typeof value === 'string') {
                    if (roleIds.has(value)) return roleIds.get(value);
                    if (channelIds.has(value)) return channelIds.get(value);
                    if (/^[{[]/.test(value)) {
                        try { return JSON.stringify(remap(JSON.parse(value))); } catch { return value; }
                    }
                    return value;
                }
                if (Array.isArray(value)) return value.map(remap);
                if (value && typeof value === 'object') {
                    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, remap(child)]));
                }
                return value;
            };
            let restoredRows = 0;
            const restoreConfig = this.sqlite.transaction(() => {
                for (const table of BYTEBOT_TABLES) {
                    const guildColumn = table.guild || 'guild_id';
                    if (mode === 'destructive') {
                        removed.bytebot += this.sqlite.prepare(
                            `DELETE FROM ${sqlIdentifier(table.name)} WHERE ${sqlIdentifier(guildColumn)} = ?`
                        ).run(guild.id).changes;
                    }
                    for (const original of backup.payload.bytebot[table.name] || []) {
                        const row = remap(original);
                        if (mode === 'merge') {
                            const where = table.keys.map(column => `${sqlIdentifier(column)} IS ?`).join(' AND ');
                            this.sqlite.prepare(`DELETE FROM ${sqlIdentifier(table.name)} WHERE ${where}`)
                                .run(...table.keys.map(column => row[column]));
                        }
                        const columns = Object.keys(row);
                        this.sqlite.prepare(`INSERT INTO ${sqlIdentifier(table.name)}
                            (${columns.map(sqlIdentifier).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
                            .run(...columns.map(column => row[column]));
                        restoredRows++;
                    }
                }
            });
            try {
                restoreConfig.immediate();
                created.bytebot += restoredRows;
            } catch (error) {
                failures.push({ section: 'bytebot', name: 'configuration', error: error.message });
            }
        }

        return { backupId: backup.id, mode, created, removed, failures };
    }
}

module.exports = { BYTEBOT_TABLES, GuildBackupService, SCHEMA_VERSION, SECTIONS };
