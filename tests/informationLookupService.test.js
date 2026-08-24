const { InformationLookupService, evaluateExpression } = require('../src/services/informationLookupService');
const Database = require('better-sqlite3');

test('calculator evaluates bounded arithmetic without executing code', () => {
    expect(evaluateExpression('2 + 3 * (4 - 1) ** 2')).toBe(29);
    expect(() => evaluateExpression('process.exit()')).toThrow('Invalid expression');
    expect(() => evaluateExpression('1 / 0')).toThrow('finite');
});

test('web lookups reject private destinations before contacting a provider', async () => {
    const fetch = jest.fn();
    const service = new InformationLookupService({
        fetch,
        lookup: jest.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    });

    await expect(service.qr('http://localhost/private')).rejects.toThrow('public address');
    await expect(service.screenshot('https://localhost/private')).rejects.toThrow('public address');
    expect(fetch).not.toHaveBeenCalled();
});

test('web lookup DNS validation has a bounded wait', async () => {
    const service = new InformationLookupService({
        lookup: jest.fn(() => new Promise(() => {})),
        lookupTimeout: 1
    });

    await expect(service.publicUrl('https://example.com')).rejects.toThrow('could not be resolved');
});

test('weather returns only validated current provider fields', async () => {
    const json = value => new Response(JSON.stringify(value), {
        headers: { 'content-type': 'application/json' }
    });
    const fetch = jest.fn()
        .mockResolvedValueOnce(json({ results: [{ name: 'London', country: 'United Kingdom', latitude: 51.5, longitude: -0.12 }] }))
        .mockResolvedValueOnce(json({
            current: { temperature_2m: 18.5, relative_humidity_2m: 70, wind_speed_10m: 12, visibility: 9000 },
            daily: { sunrise: ['2026-08-24T05:58'], sunset: ['2026-08-24T20:02'] }
        }));
    const service = new InformationLookupService({ fetch });

    await expect(service.weather('London')).resolves.toEqual({
        location: 'London, United Kingdom', temperature: 18.5, humidity: 70,
        wind: 12, visibility: 9000, sunrise: '2026-08-24T05:58', sunset: '2026-08-24T20:02'
    });
});

test('definition lookup bounds and validates Urban Dictionary results', async () => {
    const fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ list: [{
        definition: 'A small test definition', example: 'Used in a test', thumbs_up: 12, thumbs_down: 2,
        permalink: 'https://www.urbandictionary.com/define.php?term=test'
    }] }), { headers: { 'content-type': 'application/json' } }));
    const service = new InformationLookupService({ fetch });

    await expect(service.define('test')).resolves.toEqual([{
        definition: 'A small test definition', example: 'Used in a test', up: 12, down: 2,
        url: 'https://www.urbandictionary.com/define.php?term=test'
    }]);
});

test('translation uses an explicitly configured provider and validates its result', async () => {
    const fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ translatedText: 'hola' }), {
        headers: { 'content-type': 'application/json' }
    }));
    const service = new InformationLookupService({ fetch, translationProvider: 'https://translate.example/' });

    await expect(service.translate('es', 'hello')).resolves.toBe('hola');
    await expect(new InformationLookupService({ fetch }).translate('es', 'hello'))
        .rejects.toThrow('not configured');
});

test('translation resolves a published language name through the provider', async () => {
    const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    const fetch = jest.fn()
        .mockResolvedValueOnce(response([{ code: 'es', name: 'Spanish' }]))
        .mockResolvedValueOnce(response({ translatedText: 'hola' }));
    const service = new InformationLookupService({ fetch, translationProvider: 'https://translate.example/' });

    await expect(service.translate('Spanish', 'hello')).resolves.toBe('hola');
});

test('QR generation validates and bounds the provider image without fetching the target', async () => {
    const fetch = jest.fn().mockResolvedValue(new Response(Buffer.from([1, 2, 3]), {
        headers: { 'content-type': 'image/png' }
    }));
    const service = new InformationLookupService({
        fetch,
        lookup: jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    });

    await expect(service.qr('https://example.com')).resolves.toEqual(Buffer.from([1, 2, 3]));
    expect(fetch.mock.calls[0][0].hostname).toBe('quickchart.io');
});

test('provider bodies are stopped at the byte limit without relying on Content-Length', async () => {
    const oversized = new ReadableStream({
        start(controller) {
            controller.enqueue(new Uint8Array(2 * 1024 * 1024));
            controller.enqueue(new Uint8Array([1]));
            controller.close();
        }
    });
    const service = new InformationLookupService({
        fetch: jest.fn().mockResolvedValue(new Response(oversized, {
            headers: { 'content-type': 'application/json' }
        }))
    });

    await expect(service.json('https://provider.example/data')).rejects.toThrow('invalid payload');
});

test('GitHub user lookup returns only validated public profile fields', async () => {
    const fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
        login: 'octocat', id: 1, html_url: 'https://github.com/octocat',
        avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
        name: 'The Octocat', bio: 'A public profile', company: '@github', location: 'San Francisco',
        blog: 'https://github.blog', public_repos: 8, public_gists: 8,
        followers: 100, following: 2, created_at: '2011-01-25T18:44:36Z'
    }), { headers: { 'content-type': 'application/json' } }));
    const service = new InformationLookupService({ fetch });

    await expect(service.githubUser('octocat')).resolves.toEqual({
        username: 'octocat', id: 1, url: 'https://github.com/octocat',
        avatar: 'https://avatars.githubusercontent.com/u/1?v=4',
        name: 'The Octocat', bio: 'A public profile', company: '@github', location: 'San Francisco',
        website: 'https://github.blog', repositories: 8, gists: 8,
        followers: 100, following: 2, createdAt: '2011-01-25T18:44:36Z'
    });
    expect(fetch.mock.calls[0][0].toString()).toBe('https://api.github.com/users/octocat');
});

test('GitHub repository search returns a bounded public result set', async () => {
    const fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{
        id: 1, full_name: 'octocat/Hello-World', html_url: 'https://github.com/octocat/Hello-World',
        description: 'A repository', stargazers_count: 80, forks_count: 9,
        language: 'JavaScript', archived: false, private: false, updated_at: '2026-08-25T00:00:00Z'
    }] }), { headers: { 'content-type': 'application/json' } }));
    const service = new InformationLookupService({ fetch });

    await expect(service.githubRepositories('Hello World')).resolves.toEqual([{
        id: 1, name: 'octocat/Hello-World', url: 'https://github.com/octocat/Hello-World',
        description: 'A repository', stars: 80, forks: 9, language: 'JavaScript',
        archived: false, updatedAt: '2026-08-25T00:00:00Z'
    }]);
    expect(fetch.mock.calls[0][0].searchParams.get('q')).toBe('Hello World in:name');
    expect(fetch.mock.calls[0][0].searchParams.get('per_page')).toBe('5');
});

test('GitHub email lookup returns only public commit matches', async () => {
    const fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{
        sha: 'abc123', html_url: 'https://github.com/octocat/Hello-World/commit/abc123',
        repository: { full_name: 'octocat/Hello-World', html_url: 'https://github.com/octocat/Hello-World' },
        commit: { message: 'Initial commit', author: { date: '2026-08-25T00:00:00Z' } },
        author: { login: 'octocat' }
    }] }), { headers: { 'content-type': 'application/json' } }));
    const service = new InformationLookupService({ fetch });

    await expect(service.githubEmail('octocat@example.com')).resolves.toEqual([{
        sha: 'abc123', url: 'https://github.com/octocat/Hello-World/commit/abc123',
        repository: 'octocat/Hello-World', repositoryUrl: 'https://github.com/octocat/Hello-World',
        message: 'Initial commit', author: 'octocat', authoredAt: '2026-08-25T00:00:00Z'
    }]);
    expect(fetch.mock.calls[0][0].searchParams.get('q')).toBe('author-email:octocat@example.com');
});

test('GitHub lookups distinguish missing, rate-limited, and invalid responses', async () => {
    const missing = new InformationLookupService({ fetch: jest.fn().mockResolvedValue(new Response('{}', {
        status: 404, headers: { 'content-type': 'application/json' }
    })) });
    const limited = new InformationLookupService({ fetch: jest.fn().mockResolvedValue(new Response('{}', {
        status: 403, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '0' }
    })) });
    const malformed = new InformationLookupService({ fetch: jest.fn().mockResolvedValue(new Response(JSON.stringify({
        login: 'octocat'
    }), { headers: { 'content-type': 'application/json' } })) });

    await expect(missing.githubUser('octocat')).rejects.toThrow('GitHub user **octocat** not found.');
    await expect(limited.githubUser('octocat')).rejects.toThrow('rate limit');
    await expect(malformed.githubUser('octocat')).rejects.toThrow('invalid profile');
    await expect(malformed.githubUser('bad--name')).rejects.toThrow('Please provide a valid GitHub username.');
});

test('GitHub secondary limits include a bounded provider retry hint', async () => {
    const service = new InformationLookupService({ fetch: jest.fn().mockResolvedValue(new Response('{}', {
        status: 403,
        headers: { 'content-type': 'application/json', 'retry-after': '120' }
    })) });

    await expect(service.githubRepositories('example')).rejects.toThrow('Try again in 120 seconds');
});

test('GitHub searches distinguish missing and inaccessible provider responses', async () => {
    const response = status => new Response('{}', { status, headers: { 'content-type': 'application/json' } });
    const missing = new InformationLookupService({ fetch: jest.fn().mockResolvedValue(response(404)) });
    const inaccessible = new InformationLookupService({ fetch: jest.fn().mockResolvedValue(response(401)) });
    const forbidden = new InformationLookupService({ fetch: jest.fn().mockResolvedValue(response(403)) });
    const remaining = new InformationLookupService({ fetch: jest.fn().mockResolvedValue(new Response('{}', {
        status: 403, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '42' }
    })) });

    await expect(missing.githubEmail('octocat@example.com')).rejects.toThrow('not found');
    await expect(inaccessible.githubRepositories('example')).rejects.toThrow('not publicly accessible');
    await expect(forbidden.githubEmail('octocat@example.com')).rejects.toThrow('not publicly accessible');
    await expect(remaining.githubRepositories('example')).rejects.toThrow('not publicly accessible');
});

test('successful provider responses are cached briefly with a bounded lifetime', async () => {
    let now = 1000;
    const fetch = jest.fn().mockImplementation(async () => new Response(JSON.stringify({
        login: 'octocat', id: 1, html_url: 'https://github.com/octocat',
        avatar_url: 'https://avatars.githubusercontent.com/u/1', created_at: '2011-01-25T18:44:36Z',
        public_repos: 1, public_gists: 0, followers: 1, following: 0
    }), { headers: { 'content-type': 'application/json' } }));
    const service = new InformationLookupService({ fetch, now: () => now, cacheTtl: 100 });

    await service.githubUser('octocat');
    await service.githubUser('octocat');
    expect(fetch).toHaveBeenCalledTimes(1);

    now = 1101;
    await service.githubUser('octocat');
    expect(fetch).toHaveBeenCalledTimes(2);
});

test('Roblox profile lookup resolves a username and returns bounded public profile fields', async () => {
    const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    const fetch = jest.fn(async input => {
        const url = new URL(input);
        const route = `${url.hostname}${url.pathname}`;
        const payloads = {
            'users.roblox.com/v1/usernames/users': { data: [{ id: 156, name: 'builderman', displayName: 'builderman', requestedUsername: 'Builderman' }] },
            'users.roblox.com/v1/users/156': { id: 156, name: 'builderman', displayName: 'builderman', description: 'Roblox founder', created: '2006-02-27T21:06:40Z', isBanned: false, hasVerifiedBadge: true },
            'friends.roblox.com/v1/users/156/followers/count': { count: 1000 },
            'friends.roblox.com/v1/users/156/followings/count': { count: 10 },
            'friends.roblox.com/v1/users/156/friends/count': { count: 200 },
            'presence.roblox.com/v1/presence/users': { userPresences: [{ userId: 156, userPresenceType: 2, lastLocation: 'Example game', lastOnline: '2026-08-25T00:00:00Z' }] },
            'accountinformation.roblox.com/v1/users/156/roblox-badges': [{ id: 1, name: 'Administrator' }],
            'users.roblox.com/v1/users/156/username-history': { data: [{ name: 'Builderman' }] },
            'thumbnails.roblox.com/v1/users/avatar-headshot': { data: [{ targetId: 156, state: 'Completed', imageUrl: 'https://tr.rbxcdn.com/avatar.png' }] }
        };
        return response(payloads[route]);
    });
    const service = new InformationLookupService({ fetch });

    await expect(service.robloxProfile('Builderman')).resolves.toEqual({
        id: 156, username: 'builderman', displayName: 'builderman', description: 'Roblox founder',
        createdAt: '2006-02-27T21:06:40Z', banned: false, verified: true,
        followers: 1000, following: 10, friends: 200,
        presence: { status: 'In Game', location: 'Example game', lastOnline: '2026-08-25T00:00:00Z' },
        badgeCount: 1, badges: ['Administrator'], nameHistory: ['Builderman'], avatar: 'https://tr.rbxcdn.com/avatar.png'
    });
    expect(fetch).toHaveBeenCalledTimes(9);
});

test('Roblox collection lookups resolve once and cap games, groups, and outfits', async () => {
    const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    const fetch = jest.fn(async input => {
        const url = new URL(input);
        if (url.pathname === '/v1/usernames/users') {
            return response({ data: [{ id: 156, name: 'builderman', displayName: 'builderman' }] });
        }
        if (url.hostname === 'games.roblox.com') return response({ data: [{
            id: 10, name: 'Example game', description: 'A public game', rootPlace: { id: 20 },
            created: '2020-01-01T00:00:00Z', updated: '2026-08-25T00:00:00Z', placeVisits: 30
        }] });
        if (url.hostname === 'groups.roblox.com') return response({ data: [{
            group: { id: 40, name: 'Example group', memberCount: 50, isLocked: false },
            role: { name: 'Member', rank: 1 }
        }] });
        return response({ data: [{ id: 60, name: 'Example outfit', isEditable: true, outfitType: 'Avatar' }] });
    });
    const service = new InformationLookupService({ fetch });

    await expect(service.robloxGames('Builderman')).resolves.toEqual({ user: expect.objectContaining({ id: 156 }), games: [{
        id: 10, name: 'Example game', description: 'A public game', placeId: 20,
        url: 'https://www.roblox.com/games/20', createdAt: '2020-01-01T00:00:00Z',
        updatedAt: '2026-08-25T00:00:00Z', visits: 30
    }] });
    await expect(service.robloxGroups('Builderman')).resolves.toEqual({ user: expect.objectContaining({ id: 156 }), groups: [{
        id: 40, name: 'Example group', members: 50, locked: false, role: 'Member', rank: 1,
        url: 'https://www.roblox.com/communities/40'
    }] });
    await expect(service.robloxOutfits('Builderman')).resolves.toEqual({ user: expect.objectContaining({ id: 156 }), outfits: [{
        id: 60, name: 'Example outfit', editable: true, type: 'Avatar'
    }] });
    expect(fetch).toHaveBeenCalledTimes(4);
});

test('Roblox lookups distinguish not found, inaccessible, rate-limited, and malformed responses', async () => {
    const response = (value, status = 200) => new Response(JSON.stringify(value), {
        status, headers: { 'content-type': 'application/json' }
    });
    const resolvedUser = () => response({ data: [{ id: 156, name: 'builderman', displayName: 'builderman' }] });
    const missing = new InformationLookupService({ fetch: jest.fn().mockResolvedValue(response({ data: [] })) });
    const inaccessible = new InformationLookupService({ fetch: jest.fn()
        .mockResolvedValueOnce(resolvedUser()).mockResolvedValueOnce(response({}, 400)) });
    const limited = new InformationLookupService({ fetch: jest.fn()
        .mockResolvedValueOnce(resolvedUser()).mockResolvedValueOnce(response({}, 429)) });
    const malformed = new InformationLookupService({ fetch: jest.fn()
        .mockResolvedValueOnce(resolvedUser()).mockResolvedValueOnce(response({ data: [{ id: 'bad' }] })) });
    const failed = new InformationLookupService({ fetch: jest.fn()
        .mockResolvedValueOnce(resolvedUser()).mockResolvedValueOnce(response({}, 500)) });
    const emptyGroups = new InformationLookupService({ fetch: jest.fn()
        .mockResolvedValueOnce(resolvedUser()).mockResolvedValueOnce(response({ data: [] })) });

    await expect(missing.robloxUser('Builderman')).rejects.toMatchObject({ message: 'No Roblox user found with that name' });
    await expect(inaccessible.robloxGames('Builderman')).rejects.toThrow('not publicly accessible');
    await expect(limited.robloxGroups('Builderman')).rejects.toThrow('rate limit');
    await expect(malformed.robloxOutfits('Builderman')).rejects.toThrow('invalid outfits');
    await expect(failed.robloxGames('Builderman')).rejects.toThrow('Failed to fetch Roblox user information\n-# Please try again later');
    await expect(emptyGroups.robloxGroups('Builderman')).rejects.toMatchObject({
        message: 'This Roblox user is not in any groups'
    });
});

test('Roblox profile reports name-history failure without discarding the profile', async () => {
    const response = (value, status = 200) => new Response(JSON.stringify(value), {
        status, headers: { 'content-type': 'application/json' }
    });
    const profileFetch = historyStatus => jest.fn(async input => {
        const url = new URL(input);
        const route = `${url.hostname}${url.pathname}`;
        if (route.endsWith('/username-history')) return response({}, historyStatus);
        const payloads = {
            'users.roblox.com/v1/usernames/users': { data: [{ id: 156, name: 'builderman', displayName: 'builderman' }] },
            'users.roblox.com/v1/users/156': { id: 156, description: '', created: '2006-02-27T21:06:40Z', isBanned: false, hasVerifiedBadge: true },
            'friends.roblox.com/v1/users/156/followers/count': { count: 1 },
            'friends.roblox.com/v1/users/156/followings/count': { count: 2 },
            'friends.roblox.com/v1/users/156/friends/count': { count: 3 },
            'presence.roblox.com/v1/presence/users': { userPresences: [{ userId: 156, userPresenceType: 0 }] },
            'accountinformation.roblox.com/v1/users/156/roblox-badges': [],
            'thumbnails.roblox.com/v1/users/avatar-headshot': { data: [{ targetId: 156, state: 'Completed', imageUrl: 'https://tr.rbxcdn.com/avatar.png' }] }
        };
        return response(payloads[route]);
    });

    await expect(new InformationLookupService({ fetch: profileFetch(404) }).robloxProfile('Builderman'))
        .resolves.toMatchObject({ nameHistory: null, username: 'builderman' });
    await expect(new InformationLookupService({ fetch: profileFetch(429) }).robloxProfile('Builderman'))
        .rejects.toThrow('Roblox rate limit reached.');
});

test('name history records only observed former names in the existing automation store', () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`CREATE TABLE automation_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, kind TEXT NOT NULL,
        key TEXT NOT NULL, config TEXT NOT NULL, enabled INTEGER NOT NULL,
        next_run_at INTEGER, last_run_at INTEGER, last_message_id TEXT, run_count INTEGER NOT NULL,
        lease_token TEXT, lease_expires_at INTEGER, created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE (guild_id, kind, key)
    )`);
    const service = new InformationLookupService({ sqlite, randomUUID: () => 'event-1' });

    service.recordNameChange(['123456789012345678'], '223456789012345678', 'FormerName', 1000);

    expect(service.nameHistory('123456789012345678', '223456789012345678')).toEqual([
        { name: 'FormerName', recordedAt: 1000 }
    ]);
    sqlite.close();
});
