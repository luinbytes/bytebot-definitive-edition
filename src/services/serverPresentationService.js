const dns = require('dns').promises;
const net = require('net');
const crypto = require('crypto');
const { PermissionFlagsBits } = require('discord.js');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPE = /^image\/(png|jpe?g|gif|webp)$/i;

function privateAddress(address) {
    address = address.replace(/^\[|\]$/g, '');
    if (net.isIP(address) === 4) {
        const [a, b] = address.split('.').map(Number);
        return a === 0 || a === 10 || a === 127 || a >= 224
            || (a === 100 && b >= 64 && b <= 127)
            || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168)
            || (a === 198 && (b === 18 || b === 19));
    }
    const normalized = address.toLowerCase();
    if (normalized.startsWith('::ffff:')) {
        const suffix = normalized.slice(7);
        if (suffix.includes('.')) return privateAddress(suffix);
        const words = suffix.split(':').map(word => parseInt(word || '0', 16));
        if (words.length === 2 && words.every(Number.isInteger)) {
            return privateAddress(`${words[0] >> 8}.${words[0] & 255}.${words[1] >> 8}.${words[1] & 255}`);
        }
    }
    return normalized === '::' || normalized === '::1' || normalized.startsWith('fc')
        || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized) || normalized.startsWith('ff');
}

function rowToPreset(row) {
    if (!row) return null;
    return {
        id: row.id,
        guildId: row.guild_id,
        name: row.name,
        nickname: row.nickname,
        avatar: row.avatar_url,
        banner: row.banner_url,
        bio: row.bio,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function rowToListing(row) {
    if (!row) return null;
    return {
        guildId: row.guild_id,
        name: row.name,
        icon: row.icon_url,
        description: row.description,
        memberCount: row.member_count,
        invite: row.invite_url,
        tags: JSON.parse(row.tags),
        banner: row.banner_url,
        bumpedAt: row.bumped_at,
        updatedAt: row.updated_at
    };
}

function inviteCode(value) {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);
    const code = host === 'discord.gg' ? parts[0]
        : (['discord.com', 'www.discord.com'].includes(host) && parts[0] === 'invite' ? parts[1] : null);
    if (url.protocol !== 'https:' || !code || !/^[\w-]{2,64}$/.test(code)) throw new Error('Use a valid Discord invite URL.');
    return url.toString();
}

class ServerPresentationService {
    constructor(options) {
        this.sqlite = options.sqlite;
        this.fetch = options.fetch || global.fetch;
        this.lookup = options.lookup || ((hostname) => dns.lookup(hostname, { all: true, verbatim: true }));
        this.now = options.now || Date.now;
        this.randomUUID = options.randomUUID || crypto.randomUUID;
    }

    async image(input) {
        const url = new URL(typeof input === 'string' ? input : input?.url);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
            throw new Error('Images must use a public HTTP or HTTPS URL.');
        }
        if (net.isIP(url.hostname.replace(/^\[|\]$/g, '')) && privateAddress(url.hostname)) {
            throw new Error('Images must be hosted at a public address.');
        }
        if (input?.contentType && !IMAGE_TYPE.test(input.contentType)) throw new Error('Images must be PNG, JPG, GIF, or WebP.');
        if (input?.size > MAX_IMAGE_BYTES) throw new Error('Images cannot exceed 8 MB.');
        const addresses = await this.lookup(url.hostname);
        const resolved = Array.isArray(addresses) ? addresses : [addresses];
        if (!resolved.length || resolved.some(entry => privateAddress(entry.address || entry))) {
            throw new Error('Images must be hosted at a public address.');
        }
        const response = await this.fetch(url, {
            redirect: 'error',
            signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
                ? AbortSignal.timeout(10000)
                : undefined
        });
        if (!response.ok) throw new Error('Image download failed.');
        const type = response.headers.get('content-type')?.split(';')[0].trim();
        const length = Number(response.headers.get('content-length') || 0);
        if (!IMAGE_TYPE.test(type || '')) throw new Error('Images must be PNG, JPG, GIF, or WebP.');
        if (length > MAX_IMAGE_BYTES) throw new Error('Images cannot exceed 8 MB.');
        if (response.body?.getReader) {
            const reader = response.body.getReader();
            const chunks = [];
            let total = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                total += value.length;
                if (total > MAX_IMAGE_BYTES) {
                    await reader.cancel();
                    throw new Error('Images cannot exceed 8 MB.');
                }
                chunks.push(Buffer.from(value));
            }
            return Buffer.concat(chunks, total);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Images cannot exceed 8 MB.');
        return buffer;
    }

    async customize(guild, values) {
        const options = { reason: 'ByteBot server customization' };
        if (values.nickname !== undefined) {
            const nickname = String(values.nickname).trim();
            if (!nickname || nickname.length > 32) throw new Error('Nickname must be 1-32 characters.');
            options.nick = nickname;
        }
        if (values.bio !== undefined) {
            const bio = String(values.bio).trim();
            if (!bio || bio.length > 190) throw new Error('Bio must be 1-190 characters.');
            options.bio = bio;
        }
        if (values.avatar !== undefined) options.avatar = await this.image(values.avatar);
        if (values.banner !== undefined) options.banner = await this.image(values.banner);
        if (Object.keys(options).length === 1) throw new Error('Choose a profile field to update.');
        if (options.nick !== undefined && guild.members.me?.permissions
            && !guild.members.me.permissions.has(PermissionFlagsBits.ChangeNickname)) {
            throw new Error('ByteBot needs Change Nickname to update its server nickname.');
        }
        return guild.members.editMe(options);
    }

    reset(guild) {
        if (guild.members.me?.permissions && !guild.members.me.permissions.has(PermissionFlagsBits.ChangeNickname)) {
            throw new Error('ByteBot needs Change Nickname to reset its server nickname.');
        }
        return guild.members.editMe({
            nick: null,
            avatar: null,
            banner: null,
            bio: null,
            reason: 'Reset ByteBot server customization'
        });
    }

    createPreset(guild, name, actorId) {
        const cleanName = String(name || '').trim();
        if (!cleanName || cleanName.length > 50) throw new Error('Preset names must be 1-50 characters.');
        return this.sqlite.transaction(() => {
            const count = this.sqlite.prepare('SELECT COUNT(*) count FROM customization_presets WHERE guild_id = ?')
                .get(guild.id).count;
            if (count >= 10) throw new Error('This server can keep at most 10 customization presets.');
            if (this.sqlite.prepare('SELECT 1 FROM customization_presets WHERE guild_id = ? AND name = ? COLLATE NOCASE')
                .get(guild.id, cleanName)) throw new Error('A preset with that name already exists.');
            const member = guild.members.me;
            const now = this.now();
            const id = this.randomUUID();
            this.sqlite.prepare(`INSERT INTO customization_presets
                (id, guild_id, name, nickname, avatar_url, banner_url, bio, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(id, guild.id, cleanName, member.nickname || null, member.avatarURL?.() || null,
                    member.bannerURL?.() || null, member.bio || null, actorId, now, now);
            return this.previewPreset(guild.id, id);
        }).immediate();
    }

    listPresets(guildId) {
        return this.sqlite.prepare('SELECT * FROM customization_presets WHERE guild_id = ? ORDER BY name')
            .all(guildId).map(rowToPreset);
    }

    previewPreset(guildId, idOrName) {
        return rowToPreset(this.sqlite.prepare(`SELECT * FROM customization_presets
            WHERE guild_id = ? AND (id = ? OR name = ? COLLATE NOCASE)`).get(guildId, idOrName, idOrName));
    }

    async applyPreset(guild, idOrName, confirmed = false) {
        if (!confirmed) throw new Error('Preset application requires explicit confirmation.');
        const preset = this.previewPreset(guild.id, idOrName);
        if (!preset) throw new Error('Customization preset not found.');
        if (guild.members.me?.permissions && !guild.members.me.permissions.has(PermissionFlagsBits.ChangeNickname)) {
            throw new Error('ByteBot needs Change Nickname to apply this preset.');
        }
        return guild.members.editMe({
            nick: preset.nickname,
            avatar: preset.avatar ? await this.image(preset.avatar) : null,
            banner: preset.banner ? await this.image(preset.banner) : null,
            bio: preset.bio,
            reason: `Apply ByteBot customization preset ${preset.name}`
        });
    }

    removePreset(guildId, idOrName) {
        return Boolean(this.sqlite.prepare(`DELETE FROM customization_presets
            WHERE guild_id = ? AND (id = ? OR name = ? COLLATE NOCASE)`).run(guildId, idOrName, idOrName).changes);
    }

    async publish(guild, values, actorId) {
        if (values.inviteGuildId !== guild.id) throw new Error('The invite must belong to this server.');
        const description = String(values.description ?? guild.description ?? '').trim();
        if (description.length > 500) throw new Error('Listing descriptions cannot exceed 500 characters.');
        const tags = [...new Set((values.tags || []).map(tag => String(tag).trim().toLowerCase()).filter(Boolean))];
        if (tags.length > 5 || tags.some(tag => !/^[a-z0-9-]{1,20}$/.test(tag))) {
            throw new Error('Use up to five tags containing 1-20 lowercase letters, digits, or hyphens.');
        }
        const invite = inviteCode(values.invite);
        const banner = values.banner ? new URL(values.banner).toString() : null;
        if (banner) await this.image(banner);
        const now = this.now();
        this.sqlite.prepare(`INSERT INTO server_listings
            (guild_id, name, icon_url, description, member_count, invite_url, tags, banner_url, bumped_at, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (guild_id) DO UPDATE SET name = excluded.name, icon_url = excluded.icon_url,
            description = excluded.description, member_count = excluded.member_count, invite_url = excluded.invite_url,
            tags = excluded.tags, banner_url = excluded.banner_url, updated_by = excluded.updated_by,
            updated_at = excluded.updated_at`)
            .run(guild.id, guild.name, guild.iconURL?.() || null, description || null, guild.memberCount || 0,
                invite, JSON.stringify(tags), banner, now, actorId, now);
        return this.getListing(guild.id);
    }

    getListing(guildId) {
        return rowToListing(this.sqlite.prepare('SELECT * FROM server_listings WHERE guild_id = ?').get(guildId));
    }

    listListings(query = '') {
        const needle = String(query).trim().toLowerCase();
        return this.sqlite.prepare('SELECT * FROM server_listings ORDER BY bumped_at DESC LIMIT 100').all()
            .map(rowToListing)
            .filter(listing => !needle || `${listing.name} ${listing.description || ''} ${listing.tags.join(' ')}`.toLowerCase().includes(needle))
            .slice(0, 25);
    }

    bump(guildId, actorId) {
        const listing = this.getListing(guildId);
        if (!listing) throw new Error('Publish this server before bumping it.');
        const now = this.now();
        const bumped = this.sqlite.prepare(`UPDATE server_listings SET bumped_at = ?, updated_by = ?, updated_at = ?
            WHERE guild_id = ? AND bumped_at <= ? RETURNING guild_id`).get(now, actorId, now, guildId, now - 3600000);
        if (!bumped) throw new Error('Listings can be bumped once every one hour.');
        return this.getListing(guildId);
    }

    removeListing(guildId) {
        return Boolean(this.sqlite.prepare('DELETE FROM server_listings WHERE guild_id = ?').run(guildId).changes);
    }
}

module.exports = { MAX_IMAGE_BYTES, ServerPresentationService, inviteCode, privateAddress };
