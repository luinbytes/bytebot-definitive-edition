const crypto = require('crypto');
const sharp = require('../utils/sharp');
const { MediaService } = require('./mediaService');

const API_URL = 'https://ws.audioscrobbler.com/2.0/';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_CACHE_BYTES = 100 * 1024 * 1024;
const METHODS = new Set([
    'album.getInfo', 'artist.getInfo', 'library.getArtists',
    'user.getInfo', 'user.getRecentTracks', 'user.getTopAlbums',
    'user.getTopArtists', 'user.getTopTracks'
]);
const PERIODS = new Set(['overall', '7day', '1month', '3month', '6month', '12month']);
const PERIOD_ALIASES = Object.freeze({ lifetime: 'overall', '7d': '7day', '1m': '1month', '3m': '3month', '6m': '6month', '1y': '12month' });
const INDEX_PAGE_SIZE = 250;
const INDEX_MAX_PAGES = 20;

function clean(value, max = 256) {
    const result = String(value ?? '').trim();
    if (!result || result.length > max) throw new Error(`Value must be 1-${max} characters.`);
    return result;
}

function positive(value) {
    const number = Number.parseInt(value, 10);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function list(value) {
    return Array.isArray(value) ? value : value ? [value] : [];
}

function text(value) {
    return typeof value === 'string' ? value : value?.['#text'] || value?.name || '';
}

function trustedUrl(value, artwork = false) {
    if (!value) return null;
    try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        const lastfm = host === 'last.fm' || host.endsWith('.last.fm');
        const cdn = artwork && (host === 'lastfm.freetls.fastly.net'
            || (host.startsWith('lastfm-') && host.endsWith('.akamaized.net')));
        return url.protocol === 'https:' && (lastfm || cdn) ? url.toString() : null;
    } catch {
        return null;
    }
}

function imageUrl(images) {
    const values = list(images).map(image => image?.['#text']).filter(Boolean);
    const value = values.at(-1);
    if (!value) return null;
    return trustedUrl(value, true);
}

function period(value) {
    const normalized = PERIOD_ALIASES[value] || value || 'overall';
    if (!PERIODS.has(normalized)) throw new Error('Invalid Last.fm period.');
    return normalized;
}

function normalizeItem(item, kind) {
    const artist = text(item.artist);
    return {
        name: clean(item.name, 300),
        artist: artist ? String(artist).slice(0, 300) : undefined,
        album: text(item.album) ? String(text(item.album)).slice(0, 300) : undefined,
        playcount: positive(item.playcount),
        url: trustedUrl(item.url) || undefined,
        image: imageUrl(item.image),
        nowPlaying: item['@attr']?.nowplaying === 'true',
        timestamp: positive(item.date?.uts),
        kind
    };
}

async function boundedText(response) {
    const length = Number(response.headers?.get?.('content-length') || 0);
    if (!Number.isFinite(length) || length < 0 || length > MAX_RESPONSE_BYTES) throw new Error('Last.fm response is too large.');
    if (!response.body?.getReader && !response.body?.[Symbol.asyncIterator]) {
        throw new Error('Last.fm response cannot be read safely.');
    }
    const chunks = [];
    let total = 0;
    if (response.body[Symbol.asyncIterator]) {
        for await (const value of response.body) {
            total += value.length;
            if (total > MAX_RESPONSE_BYTES) throw new Error('Last.fm response is too large.');
            chunks.push(Buffer.from(value));
        }
        return Buffer.concat(chunks, total).toString('utf8');
    }
    const reader = response.body.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new Error('Last.fm response is too large.');
        }
        chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total).toString('utf8');
}

class LastfmService {
    constructor(options = {}) {
        this.sqlite = options.sqlite;
        this.fetch = options.fetch || global.fetch;
        this.apiKey = options.apiKey ?? process.env.LASTFM_API_KEY;
        this.sharedSecret = options.sharedSecret ?? process.env.LASTFM_SHARED_SECRET;
        this.callbackUrl = options.callbackUrl ?? process.env.LASTFM_CALLBACK_URL;
        this.sessionEncryptionKey = options.sessionEncryptionKey ?? process.env.LASTFM_SESSION_ENCRYPTION_KEY;
        this.now = options.now || Date.now;
        this.randomBytes = options.randomBytes || crypto.randomBytes;
        this.media = options.media || new MediaService({ queue: options.queue });
        this.cache = new Map();
        this.cacheBytes = 0;
        this.indexing = new Set();
    }

    async request(method, params = {}, options = {}) {
        if (!METHODS.has(method)) throw new Error('Unsupported Last.fm method.');
        if (!this.apiKey) throw new Error('Last.fm API is not configured.');
        const query = new URLSearchParams({ method, api_key: this.apiKey, format: 'json' });
        for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) query.set(key, String(value));
        const key = `${method}?${[...query].filter(([name]) => name !== 'api_key').sort().map(pair => pair.join('=')).join('&')}`;
        const cached = this.cache.get(key);
        if (!options.fresh && cached?.expiresAt > this.now()) {
            this.cache.delete(key);
            this.cache.set(key, cached);
            return cached.value;
        }
        if (cached) {
            this.cache.delete(key);
            this.cacheBytes -= cached.bytes;
        }
        const response = await this.fetch(`${API_URL}?${query}`, { signal: AbortSignal.timeout(10000), redirect: 'error' });
        if (!response?.ok) throw new Error('Last.fm request failed.');
        const contentType = response.headers?.get?.('content-type');
        if (!/^application\/json\b/i.test(contentType || '')) throw new Error('Last.fm returned a non-JSON response.');
        const raw = await boundedText(response);
        let payload;
        try { payload = JSON.parse(raw); } catch { throw new Error('Last.fm returned invalid JSON.'); }
        if (!payload || Array.isArray(payload) || typeof payload !== 'object') throw new Error('Last.fm returned a malformed payload.');
        if (payload.error) throw new Error(`Last.fm: ${String(payload.message || 'request failed').slice(0, 200)}`);
        const cacheControl = response.headers?.get?.('cache-control') || '';
        const maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl);
        const ttl = Math.min(60000, Math.max(1000, Number(maxAge?.[1] || 60) * 1000));
        if (!/\b(?:no-store|no-cache|must-revalidate|private)\b/i.test(cacheControl) && maxAge?.[1] !== '0') {
            const bytes = Buffer.byteLength(raw);
            this.cache.set(key, { value: payload, expiresAt: this.now() + ttl, bytes });
            this.cacheBytes += bytes;
            while (this.cache.size > 256 || this.cacheBytes > MAX_CACHE_BYTES) {
                const oldest = this.cache.keys().next().value;
                this.cacheBytes -= this.cache.get(oldest).bytes;
                this.cache.delete(oldest);
            }
        }
        return payload;
    }

    account(userId) {
        return this.sqlite.prepare('SELECT * FROM lastfm_accounts WHERE user_id = ?').get(userId) || null;
    }

    requireAccount(userId) {
        const account = this.account(userId);
        if (!account) throw new Error('User has not linked a Last.fm account.');
        return account;
    }

    async userInfo(username, options) {
        const payload = await this.request('user.getInfo', { user: clean(username, 64) }, options);
        const user = payload.user;
        if (!user?.name) throw new Error('Last.fm returned an invalid user.');
        return {
            username: clean(user.name, 64), playcount: positive(user.playcount),
            url: trustedUrl(user.url) || `https://www.last.fm/user/${encodeURIComponent(user.name)}`,
            image: imageUrl(user.image)
        };
    }

    async link(userId, username) {
        const info = await this.userInfo(username, { fresh: true });
        const now = this.now();
        this.sqlite.prepare(`INSERT INTO lastfm_accounts (user_id, username, linked_at, refreshed_at)
            VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET username = excluded.username,
            session_key = NULL, linked_at = excluded.linked_at, refreshed_at = excluded.refreshed_at`)
            .run(userId, info.username, now, now);
        this.sqlite.prepare('DELETE FROM lastfm_artists WHERE user_id = ?').run(userId);
        return info;
    }

    unlink(userId) {
        this.sqlite.transaction(() => {
            this.sqlite.prepare('DELETE FROM lastfm_oauth_states WHERE user_id = ?').run(userId);
            this.sqlite.prepare('DELETE FROM lastfm_accounts WHERE user_id = ?').run(userId);
        }).immediate();
        this.invalidate();
    }

    invalidate(username) {
        for (const [key, value] of this.cache) {
            if (!username || key.toLowerCase().includes(String(username).toLowerCase())) {
                this.cache.delete(key);
                this.cacheBytes -= value.bytes;
            }
        }
    }

    async refresh(userId) {
        const account = this.requireAccount(userId);
        this.invalidate(account.username);
        const info = await this.userInfo(account.username, { fresh: true });
        this.sqlite.prepare('UPDATE lastfm_accounts SET username = ?, refreshed_at = ? WHERE user_id = ?')
            .run(info.username, this.now(), userId);
        return info;
    }

    async recentTracks(username, limit = 10, page = 1, options = {}) {
        const bounded = Math.max(1, Math.min(200, positive(limit) || 10));
        const payload = await this.request('user.getRecentTracks', {
            user: clean(username, 64), limit: bounded, page: Math.max(1, positive(page) || 1), extended: 1
        }, options);
        if (!payload.recenttracks || !Object.hasOwn(payload.recenttracks, 'track')) throw new Error('Last.fm returned malformed recent tracks.');
        return list(payload.recenttracks?.track).map(item => normalizeItem(item, 'track'));
    }

    async top(kind, username, requestedPeriod = 'overall', limit = 10) {
        const map = { artists: ['user.getTopArtists', 'topartists', 'artist'], albums: ['user.getTopAlbums', 'topalbums', 'album'], tracks: ['user.getTopTracks', 'toptracks', 'track'] };
        const config = map[kind];
        if (!config) throw new Error('Invalid Last.fm chart type.');
        const payload = await this.request(config[0], { user: clean(username, 64), period: period(requestedPeriod), limit: Math.max(1, Math.min(25, positive(limit) || 10)) });
        if (!payload[config[1]] || !Object.hasOwn(payload[config[1]], config[2])) throw new Error('Last.fm returned a malformed chart.');
        return list(payload[config[1]]?.[config[2]]).map(item => normalizeItem(item, kind.slice(0, -1)));
    }

    async artistInfo(artist, username) {
        const payload = await this.request('artist.getInfo', { artist: clean(artist, 300), username, autocorrect: 1 });
        const value = payload.artist;
        if (!value?.name) throw new Error('Last.fm returned an invalid artist.');
        return {
            name: clean(value.name, 300), url: trustedUrl(value.url) || undefined,
            image: imageUrl(value.image), listeners: positive(value.stats?.listeners), plays: positive(value.stats?.playcount),
            userPlays: positive(value.stats?.userplaycount), summary: String(value.bio?.summary || '').replace(/<[^>]+>/g, '').slice(0, 1000)
        };
    }

    async library(username, page = 1) {
        const payload = await this.request('library.getArtists', { user: clean(username, 64), limit: INDEX_PAGE_SIZE, page });
        const root = payload.artists;
        if (!root || !Object.hasOwn(root, 'artist')) throw new Error('Last.fm returned a malformed library.');
        return {
            artists: list(root?.artist).map(item => normalizeItem(item, 'artist')),
            totalPages: Math.max(1, positive(root?.['@attr']?.totalPages) || 1)
        };
    }

    async updateIndex(userId) {
        if (this.indexing.has(userId)) throw new Error('Your Last.fm library is already being indexed.');
        this.indexing.add(userId);
        try {
            const account = this.requireAccount(userId);
            const artists = [];
            for (let page = 1; page <= INDEX_MAX_PAGES; page++) {
                const result = await this.library(account.username, page);
                artists.push(...result.artists);
                if (page >= result.totalPages || !result.artists.length) break;
            }
            const replace = this.sqlite.transaction(() => {
                this.sqlite.prepare('DELETE FROM lastfm_artists WHERE user_id = ?').run(userId);
                const insert = this.sqlite.prepare('INSERT INTO lastfm_artists (user_id, artist, playcount, updated_at) VALUES (?, ?, ?, ?)');
                for (const artist of artists.slice(0, INDEX_PAGE_SIZE * INDEX_MAX_PAGES)) insert.run(userId, artist.name, artist.playcount, this.now());
                this.sqlite.prepare('UPDATE lastfm_accounts SET refreshed_at = ? WHERE user_id = ?').run(this.now(), userId);
            });
            replace.immediate();
            return { artists: Math.min(artists.length, INDEX_PAGE_SIZE * INDEX_MAX_PAGES) };
        } finally {
            this.indexing.delete(userId);
        }
    }

    rankings(artist, userIds) {
        const ids = [...new Set(userIds)].slice(0, 1000);
        if (!ids.length) return [];
        return this.sqlite.prepare(`SELECT a.user_id userId, a.username username, i.playcount playcount
            FROM lastfm_artists i JOIN lastfm_accounts a ON a.user_id = i.user_id
            WHERE i.artist = ? COLLATE NOCASE AND i.user_id IN (${ids.map(() => '?').join(',')})
            ORDER BY i.playcount DESC, a.username COLLATE NOCASE, a.user_id`).all(clean(artist, 300), ...ids);
    }

    crowns(userIds) {
        const ids = [...new Set(userIds)].slice(0, 1000);
        if (!ids.length) return [];
        return this.sqlite.prepare(`WITH ranked AS (
                SELECT i.artist, i.user_id, i.playcount,
                    ROW_NUMBER() OVER (PARTITION BY i.artist ORDER BY i.playcount DESC, a.username COLLATE NOCASE, i.user_id) position
                FROM lastfm_artists i JOIN lastfm_accounts a ON a.user_id = i.user_id
                WHERE i.user_id IN (${ids.map(() => '?').join(',')}) AND i.playcount > 0)
            SELECT r.user_id userId, a.username username, COUNT(*) crowns
            FROM ranked r JOIN lastfm_accounts a ON a.user_id = r.user_id WHERE position = 1
            GROUP BY r.user_id ORDER BY crowns DESC, a.username COLLATE NOCASE, r.user_id LIMIT 25`).all(...ids);
    }

    indexCoverage(userIds) {
        const ids = [...new Set(userIds)].slice(0, 1000);
        if (!ids.length) return { total: 0, indexed: 0, stale: 0 };
        const rows = this.sqlite.prepare(`SELECT a.user_id userId, MAX(i.updated_at) updatedAt
            FROM lastfm_accounts a LEFT JOIN lastfm_artists i ON i.user_id = a.user_id
            WHERE a.user_id IN (${ids.map(() => '?').join(',')}) GROUP BY a.user_id`).all(...ids);
        return {
            total: ids.length,
            indexed: rows.filter(row => row.updatedAt != null).length,
            stale: rows.filter(row => row.updatedAt != null && row.updatedAt < this.now() - 24 * 60 * 60 * 1000).length
        };
    }

    async taste(firstUserId, secondUserId, requestedPeriod) {
        if (firstUserId === secondUserId) throw new Error('You cannot compare music taste with yourself.');
        const first = this.requireAccount(firstUserId);
        const second = this.requireAccount(secondUserId);
        const [left, right] = await Promise.all([
            this.top('artists', first.username, requestedPeriod, 25),
            this.top('artists', second.username, requestedPeriod, 25)
        ]);
        const leftNames = new Set(left.map(item => item.name.toLocaleLowerCase()));
        const rightNames = new Set(right.map(item => item.name.toLocaleLowerCase()));
        const common = left.filter(item => rightNames.has(item.name.toLocaleLowerCase())).map(item => item.name);
        const union = new Set([...leftNames, ...rightNames]).size;
        return { first: first.username, second: second.username, common, score: union ? Math.round(common.length / union * 100) : 0 };
    }

    async milestone(userId, number) {
        const account = this.requireAccount(userId);
        const info = await this.userInfo(account.username);
        const target = positive(number);
        if (!target || target > info.playcount) throw new Error(`Milestone must be between 1 and ${info.playcount}.`);
        const offset = info.playcount - target;
        const tracks = (await this.recentTracks(account.username, 200, Math.floor(offset / 200) + 1)).filter(track => track.timestamp);
        const track = tracks[offset % 200];
        if (!track) throw new Error('Could not find that Last.fm milestone.');
        return { ...track, number: target, total: info.playcount, username: account.username };
    }

    setCustomization(userId, field, value) {
        const columns = { presentation: 'presentation', reactions: 'reactions', alias: 'command_alias' };
        const column = columns[field];
        if (!column) throw new Error('Invalid Last.fm customization.');
        this.requireAccount(userId);
        const result = value == null || value === '' ? null : clean(value, field === 'presentation' ? 1000 : field === 'reactions' ? 256 : 100);
        this.sqlite.prepare(`UPDATE lastfm_accounts SET ${column} = ? WHERE user_id = ?`).run(result, userId);
        return result;
    }

    copyPresentation(userId, sourceUserId) {
        this.requireAccount(userId);
        const source = this.requireAccount(sourceUserId);
        if (!source.presentation) throw new Error('That user has no custom Last.fm presentation.');
        return this.setCustomization(userId, 'presentation', source.presentation);
    }

    oauthReady() {
        if (!this.apiKey || !this.sharedSecret || !this.callbackUrl || String(this.sessionEncryptionKey || '').length < 32) return false;
        try {
            const callback = new URL(this.callbackUrl);
            return callback.protocol === 'https:' && !callback.username && !callback.password;
        } catch {
            return false;
        }
    }

    beginOAuth(userId) {
        if (!this.oauthReady()) throw new Error('Last.fm OAuth is not configured.');
        const state = this.randomBytes(24).toString('base64url');
        this.sqlite.transaction(() => {
            this.sqlite.prepare('DELETE FROM lastfm_oauth_states WHERE expires_at <= ? OR user_id = ?').run(this.now(), userId);
            this.sqlite.prepare('INSERT INTO lastfm_oauth_states (state, user_id, expires_at) VALUES (?, ?, ?)')
                .run(state, userId, this.now() + 10 * 60 * 1000);
        }).immediate();
        const callback = new URL(this.callbackUrl);
        callback.searchParams.set('state', state);
        const url = new URL('https://www.last.fm/api/auth/');
        url.searchParams.set('api_key', this.apiKey);
        url.searchParams.set('cb', callback.toString());
        return { state, url: url.toString() };
    }

    encryptSession(value) {
        const key = crypto.createHash('sha256').update(this.sessionEncryptionKey).digest();
        const iv = this.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
    }

    async completeOAuth(state, token) {
        state = clean(state, 128);
        token = clean(token, 128);
        let owner;
        this.sqlite.transaction(() => {
            owner = this.sqlite.prepare('SELECT * FROM lastfm_oauth_states WHERE state = ?').get(state);
            if (!owner || owner.expires_at <= this.now()) throw new Error('Invalid or expired Last.fm OAuth state.');
            this.sqlite.prepare('DELETE FROM lastfm_oauth_states WHERE state = ?').run(state);
        }).immediate();
        const signed = { api_key: this.apiKey, method: 'auth.getSession', token };
        const apiSig = crypto.createHash('md5').update(Object.keys(signed).sort().map(key => `${key}${signed[key]}`).join('') + this.sharedSecret).digest('hex');
        const body = new URLSearchParams({ ...signed, api_sig: apiSig, format: 'json' });
        const response = await this.fetch(API_URL, { method: 'POST', body, signal: AbortSignal.timeout(10000), redirect: 'error' });
        if (!response.ok) throw new Error('Last.fm OAuth exchange failed.');
        const contentType = response.headers?.get?.('content-type');
        if (!/^application\/json\b/i.test(contentType || '')) throw new Error('Last.fm OAuth returned a non-JSON response.');
        const raw = await boundedText(response);
        let payload;
        try { payload = JSON.parse(raw); } catch { throw new Error('Last.fm OAuth returned invalid JSON.'); }
        if (payload.error || !payload.session?.name || !payload.session?.key) throw new Error(`Last.fm: ${payload.message || 'OAuth exchange failed'}`);
        const now = this.now();
        this.sqlite.transaction(() => {
            this.sqlite.prepare(`INSERT INTO lastfm_accounts (user_id, username, session_key, linked_at, refreshed_at)
                VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET username = excluded.username,
                session_key = excluded.session_key, linked_at = excluded.linked_at, refreshed_at = excluded.refreshed_at`)
                .run(owner.user_id, clean(payload.session.name, 64), this.encryptSession(payload.session.key), now, now);
            this.sqlite.prepare('DELETE FROM lastfm_artists WHERE user_id = ?').run(owner.user_id);
        }).immediate();
        return { userId: owner.user_id, username: payload.session.name };
    }

    async collage(username, kind, requestedPeriod, size, maxBytes) {
        size = Math.max(2, Math.min(5, positive(size) || 3));
        const items = await this.top(kind, username, requestedPeriod, size * size);
        return this.media.queue.run(async (_directory, signal) => {
            const tileSize = Math.floor(2000 / size);
            const placeholder = await sharp({ create: { width: tileSize, height: tileSize, channels: 3, background: '#181818' } }).timeout({ seconds: 29 }).png().toBuffer();
            const tiles = [];
            for (const item of items) {
                signal.throwIfAborted();
                let input = placeholder;
                if (item.image) {
                    try { input = (await this.media.image(item.image, { maxBytes: 2 * 1024 * 1024, maxPixels: 4 * 1024 * 1024 })).buffer; } catch { /* placeholder */ }
                }
                tiles.push(await sharp(input).timeout({ seconds: 29 }).resize(tileSize, tileSize, { fit: 'cover' }).png().toBuffer());
            }
            while (tiles.length < size * size) tiles.push(placeholder);
            const buffer = await sharp({ create: { width: tileSize * size, height: tileSize * size, channels: 3, background: '#181818' } })
                .timeout({ seconds: 29 })
                .composite(tiles.map((input, index) => ({ input, left: index % size * tileSize, top: Math.floor(index / size) * tileSize })))
                .png({ compressionLevel: 9 }).toBuffer();
            if (buffer.length > maxBytes) throw new Error('Last.fm collage exceeds the Discord attachment limit.');
            return { buffer, filename: 'lastfm-collage.png', items };
        });
    }
}

module.exports = { API_URL, INDEX_MAX_PAGES, INDEX_PAGE_SIZE, LastfmService, METHODS, PERIOD_ALIASES, period, trustedUrl };
