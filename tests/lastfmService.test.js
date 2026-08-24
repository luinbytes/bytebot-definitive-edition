const Database = require('better-sqlite3');

function schema(sqlite) {
    sqlite.exec(`
        CREATE TABLE lastfm_accounts (
            user_id TEXT PRIMARY KEY, username TEXT NOT NULL, session_key TEXT,
            presentation TEXT, reactions TEXT, command_alias TEXT,
            linked_at INTEGER NOT NULL, refreshed_at INTEGER NOT NULL
        );
        CREATE TABLE lastfm_artists (
            user_id TEXT NOT NULL REFERENCES lastfm_accounts(user_id) ON DELETE CASCADE,
            artist TEXT NOT NULL, playcount INTEGER NOT NULL, updated_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, artist)
        );
        CREATE TABLE lastfm_oauth_states (state TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    `);
}

function response(body, headers = {}) {
    headers['content-type'] ??= 'application/json';
    return {
        ok: true,
        headers: { get: name => headers[name.toLowerCase()] || null },
        text: async () => JSON.stringify(body)
    };
}

describe('LastfmService', () => {
    let sqlite;
    beforeEach(() => { sqlite = new Database(':memory:'); schema(sqlite); });
    afterEach(() => sqlite.close());

    test('verifies links, caches successful reads, and never caches provider errors', async () => {
        const fetch = jest.fn()
            .mockResolvedValueOnce(response({ user: { name: 'Alice', playcount: '42', url: 'https://www.last.fm/user/Alice' } }, { 'cache-control': 'max-age=30' }))
            .mockResolvedValueOnce(response({ error: 29, message: 'Rate limit exceeded' }));
        const { LastfmService } = require('../src/services/lastfmService');
        const service = new LastfmService({ sqlite, fetch, apiKey: 'key', now: () => 1000 });

        await expect(service.link('discord-1', ' Alice ')).resolves.toMatchObject({ username: 'Alice' });
        await service.userInfo('Alice');
        expect(fetch).toHaveBeenCalledTimes(1);
        await expect(service.request('user.getInfo', { user: 'Bob' })).rejects.toThrow('Rate limit');
        await expect(service.request('user.getInfo', { user: 'Bob' })).rejects.toThrow();
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    test('rejects unknown methods, oversized bodies, malformed payloads, and missing configuration', async () => {
        const { LastfmService } = require('../src/services/lastfmService');
        await expect(new LastfmService({ sqlite }).request('user.getInfo', { user: 'a' })).rejects.toThrow('configured');
        const service = new LastfmService({ sqlite, apiKey: 'key', fetch: jest.fn(async () => ({
            ok: true, headers: { get: name => name === 'content-length' ? String(2 * 1024 * 1024 + 1) : null }, text: async () => '{}'
        })) });
        await expect(service.request('track.scrobble', {})).rejects.toThrow('method');
        await expect(service.request('user.getInfo', { user: 'a' })).rejects.toThrow('large');
        service.fetch = jest.fn(async () => response([]));
        await expect(service.request('user.getInfo', { user: 'a' })).rejects.toThrow('payload');
        service.fetch = jest.fn(async () => response({ nope: true }));
        await expect(service.recentTracks('a')).rejects.toThrow('malformed recent');
    });

    test('honors no-store and stops a chunked body above two MiB', async () => {
        const { LastfmService } = require('../src/services/lastfmService');
        const fetch = jest.fn(async () => response({ user: { name: 'Alice' } }, { 'cache-control': 'no-store' }));
        const service = new LastfmService({ sqlite, apiKey: 'key', fetch });
        await service.userInfo('Alice');
        await service.userInfo('Alice');
        expect(fetch).toHaveBeenCalledTimes(2);

        const chunks = [new Uint8Array(1024 * 1024 + 1), new Uint8Array(1024 * 1024)];
        service.fetch = jest.fn(async () => ({
            ok: true, headers: { get: name => name === 'content-type' ? 'application/json' : null },
            body: { getReader: () => ({ read: async () => chunks.length ? { done: false, value: chunks.shift() } : { done: true }, cancel: jest.fn() }) }
        }));
        await expect(service.request('user.getInfo', { user: 'Bob' })).rejects.toThrow('large');
    });

    test('replaces a bounded artist index and computes deterministic rankings and taste', async () => {
        const { LastfmService } = require('../src/services/lastfmService');
        const service = new LastfmService({ sqlite, apiKey: 'key', fetch: jest.fn(), now: () => 5000 });
        sqlite.prepare(`INSERT INTO lastfm_accounts
            (user_id, username, linked_at, refreshed_at) VALUES (?, ?, 1, 1)`).run('u1', 'alice');
        sqlite.prepare(`INSERT INTO lastfm_accounts
            (user_id, username, linked_at, refreshed_at) VALUES (?, ?, 1, 1)`).run('u2', 'bob');
        service.library = jest.fn(async username => ({
            artists: username === 'alice'
                ? [{ name: 'A', playcount: 10 }, { name: 'B', playcount: 5 }]
                : [{ name: 'A', playcount: 10 }, { name: 'C', playcount: 2 }],
            totalPages: 1
        }));

        await service.updateIndex('u1');
        await service.updateIndex('u2');
        expect(service.rankings('A', ['u2', 'u1'])).toEqual([
            { userId: 'u1', username: 'alice', playcount: 10 },
            { userId: 'u2', username: 'bob', playcount: 10 }
        ]);
        service.top = jest.fn(async (_kind, username) => username === 'alice'
            ? [{ name: 'A', playcount: 10 }, { name: 'B', playcount: 5 }]
            : [{ name: 'A', playcount: 8 }, { name: 'C', playcount: 4 }]);
        await expect(service.taste('u1', 'u2', 'overall')).resolves.toMatchObject({ common: ['A'], score: 33 });
        sqlite.prepare(`INSERT INTO lastfm_accounts
            (user_id, username, linked_at, refreshed_at) VALUES (?, ?, 1, 1)`).run('u3', 'carol');
        expect(service.indexCoverage(['u1', 'u2', 'u3'])).toEqual({ total: 3, indexed: 2, stale: 0 });
    });

    test('uses single-use expiring OAuth state and signed session exchange', async () => {
        const { LastfmService } = require('../src/services/lastfmService');
        const service = new LastfmService({
            sqlite, apiKey: 'key', sharedSecret: 'secret', callbackUrl: 'https://bot.example/lastfm/callback',
            sessionEncryptionKey: '0123456789abcdef0123456789abcdef', now: () => 1000,
            randomBytes: size => Buffer.alloc(size, 7),
            fetch: jest.fn(async (_url, options) => response({ session: { name: 'Alice', key: 'session-secret' } }))
        });
        sqlite.prepare(`INSERT INTO lastfm_accounts (user_id, username, linked_at, refreshed_at)
            VALUES ('discord-1', 'old-user', 1, 1)`).run();
        sqlite.prepare(`INSERT INTO lastfm_artists (user_id, artist, playcount, updated_at)
            VALUES ('discord-1', 'Old Artist', 10, 1)`).run();
        const login = service.beginOAuth('discord-1');
        expect(login.url).toContain('cb=https%3A%2F%2Fbot.example%2Flastfm%2Fcallback');
        await expect(service.completeOAuth(login.state, 'token')).resolves.toMatchObject({ username: 'Alice' });
        expect(sqlite.prepare('SELECT session_key FROM lastfm_accounts').get().session_key).not.toContain('session-secret');
        expect(sqlite.prepare('SELECT COUNT(*) count FROM lastfm_artists').get().count).toBe(0);
        await expect(service.completeOAuth(login.state, 'token')).rejects.toThrow('state');
        expect(service.fetch.mock.calls[0][1].method).toBe('POST');
        expect(service.fetch.mock.calls[0][1].redirect).toBe('error');
    });

    test('requires HTTPS callback and a 32-character encryption secret for OAuth', () => {
        const { LastfmService, trustedUrl } = require('../src/services/lastfmService');
        expect(new LastfmService({ sqlite, apiKey: 'key', sharedSecret: 'secret', callbackUrl: 'http://localhost/callback', sessionEncryptionKey: 'short' }).oauthReady()).toBe(false);
        expect(trustedUrl('https://lastfm.freetls.fastly.net/i/u/300x300/a.jpg', true)).toContain('fastly');
        expect(trustedUrl('https://attacker.example/a.jpg', true)).toBeNull();
    });
});
