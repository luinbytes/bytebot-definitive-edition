const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const { privateAddress } = require('./serverPresentationService');
const { UserFacingError } = require('../utils/errorHandlerUtil');

function providerError(message, kind) {
    const error = new UserFacingError(message);
    error.providerKind = kind;
    return error;
}

function httpsUrl(value, hosts) {
    try {
        const url = new URL(value);
        if (url.protocol === 'https:' && hosts.includes(url.hostname) && !url.username && !url.password) return url.toString();
    } catch { /* Invalid provider URL. */ }
    throw new UserFacingError('Lookup provider returned an invalid payload.');
}

function robloxImageUrl(value) {
    try {
        const url = new URL(value);
        if (url.protocol === 'https:' && (url.hostname === 'rbxcdn.com' || url.hostname.endsWith('.rbxcdn.com'))
            && !url.username && !url.password) return url.toString();
    } catch { /* Invalid provider URL. */ }
    throw new UserFacingError('Roblox returned an invalid profile.');
}

function evaluateExpression(input) {
    const expression = String(input || '').trim();
    if (!expression || expression.length > 500) throw new UserFacingError('Invalid expression.');

    const tokens = [];
    for (let offset = 0; offset < expression.length;) {
        const remaining = expression.slice(offset);
        const whitespace = remaining.match(/^\s+/);
        if (whitespace) {
            offset += whitespace[0].length;
            continue;
        }
        const token = remaining.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|^\*\*|^[()+\-*/%]/i)?.[0];
        if (!token) throw new UserFacingError('Invalid expression.');
        tokens.push(token);
        offset += token.length;
    }

    let index = 0;
    const peek = () => tokens[index];
    const take = value => {
        if (peek() !== value) return false;
        index++;
        return true;
    };

    function primary() {
        if (take('(')) {
            const value = add();
            if (!take(')')) throw new UserFacingError('Invalid expression.');
            return value;
        }
        const token = tokens[index++];
        const value = Number(token);
        if (!token || !Number.isFinite(value)) throw new UserFacingError('Invalid expression.');
        return value;
    }

    function power() {
        const left = primary();
        return take('**') ? left ** unary() : left;
    }

    function unary() {
        if (take('+')) return unary();
        if (take('-')) return -unary();
        return power();
    }

    function multiply() {
        let value = unary();
        while (['*', '/', '%'].includes(peek())) {
            const operator = tokens[index++];
            const right = unary();
            if (operator === '*') value *= right;
            else if (operator === '/') value /= right;
            else value %= right;
        }
        return value;
    }

    function add() {
        let value = multiply();
        while (['+', '-'].includes(peek())) {
            const operator = tokens[index++];
            const right = multiply();
            value = operator === '+' ? value + right : value - right;
        }
        return value;
    }

    const result = add();
    if (index !== tokens.length) throw new UserFacingError('Invalid expression.');
    if (!Number.isFinite(result)) throw new UserFacingError('The result must be finite.');
    return result;
}

class InformationLookupService {
    constructor(options = {}) {
        this.fetch = options.fetch || globalThis.fetch;
        this.lookup = options.lookup || (hostname => dns.lookup(hostname, { all: true, verbatim: true }));
        this.lookupTimeout = options.lookupTimeout || 5000;
        this.screenshotProvider = options.screenshotProvider ?? process.env.SCREENSHOT_API_URL;
        this.translationProvider = options.translationProvider ?? process.env.LIBRETRANSLATE_URL;
        this.translationKey = options.translationKey ?? process.env.LIBRETRANSLATE_API_KEY;
        this.sqlite = options.sqlite;
        this.randomUUID = options.randomUUID || crypto.randomUUID;
        this.now = options.now || Date.now;
        this.cacheTtl = options.cacheTtl ?? 60_000;
        this.cache = new Map();
    }

    async cached(key, load) {
        const hit = this.cache.get(key);
        if (hit?.expiresAt > this.now()) return hit.value;
        this.cache.delete(key);
        const value = await load();
        if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value);
        this.cache.set(key, { value, expiresAt: this.now() + this.cacheTtl });
        return value;
    }

    retryHint(response) {
        const retryAfter = response.headers.get('retry-after');
        let seconds = /^\d+$/.test(retryAfter || '') ? Number(retryAfter) : NaN;
        if (!Number.isFinite(seconds) && retryAfter) seconds = Math.ceil((Date.parse(retryAfter) - this.now()) / 1000);
        const reset = response.headers.get('x-ratelimit-reset');
        if (!Number.isFinite(seconds) && /^\d+$/.test(reset || '')) {
            seconds = Math.ceil(Number(reset) - this.now() / 1000);
        }
        return Number.isFinite(seconds) && seconds > 0
            ? ` Try again in ${Math.min(Math.ceil(seconds), 86_400)} seconds.` : ' Try again later.';
    }

    async json(url, options = {}) {
        const { errors = {}, ...request } = options;
        let response;
        try {
            response = await this.fetch(url, {
                ...request,
                redirect: 'error',
                signal: request.signal || AbortSignal.timeout(10000)
            });
        } catch { throw providerError(errors.failed || 'Lookup provider request failed.', 'failed'); }
        if (!response.ok) {
            const remaining = response.headers.get('x-ratelimit-remaining');
            const exhausted = response.status === 429
                || (response.status === 403 && (remaining === '0' || response.headers.has('retry-after')));
            if (exhausted) {
                throw providerError(
                    `${errors.rateLimited || 'Lookup provider rate limit reached.'}${this.retryHint(response)}`,
                    'rate-limited'
                );
            }
            if (response.status === 404 && errors.notFound) throw providerError(errors.notFound, 'not-found');
            if (response.status === 400 && errors.badRequest) throw providerError(errors.badRequest, 'inaccessible');
            if ([401, 403].includes(response.status) && errors.inaccessible) {
                throw providerError(errors.inaccessible, 'inaccessible');
            }
            throw providerError(errors.failed || 'Lookup provider request failed.', 'failed');
        }
        const type = response.headers.get('content-type') || '';
        if (!type.toLowerCase().includes('application/json')) {
            throw new UserFacingError('Lookup provider returned an invalid payload.');
        }
        const bytes = await this.boundedBody(response, 2 * 1024 * 1024, 'Lookup provider returned an invalid payload.');
        try { return JSON.parse(bytes.toString('utf8')); }
        catch { throw new UserFacingError('Lookup provider returned an invalid payload.'); }
    }

    async image(url) {
        let response;
        try {
            response = await this.fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
        } catch { throw new UserFacingError('Image provider request failed.'); }
        const type = response.headers.get('content-type') || '';
        if (!response.ok || !/^image\/(?:png|jpe?g|webp)$/i.test(type.split(';')[0].trim())) {
            throw new UserFacingError('Image provider returned an invalid payload.');
        }
        return this.boundedBody(response, 8 * 1024 * 1024, 'Image provider returned an invalid payload.');
    }

    async boundedBody(response, limit, message) {
        const declared = response.headers.get('content-length');
        if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
            throw new UserFacingError(message);
        }
        const reader = response.body?.getReader?.();
        if (!reader) throw new UserFacingError(message);
        const chunks = [];
        let size = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > limit) {
                    await reader.cancel();
                    throw new UserFacingError(message);
                }
                chunks.push(Buffer.from(value));
            }
        } catch (error) {
            if (error instanceof UserFacingError) throw error;
            throw new UserFacingError(message);
        }
        return Buffer.concat(chunks, size);
    }

    async publicUrl(input, httpsOnly = false) {
        const value = String(input || '').trim();
        if (!value || value.length > 2048) throw new UserFacingError('Use a valid public website URL.');
        let url;
        try { url = new URL(value); } catch { throw new UserFacingError('Use a valid public website URL.'); }
        if ((httpsOnly ? url.protocol !== 'https:' : !['http:', 'https:'].includes(url.protocol))
            || url.username || url.password) throw new UserFacingError('Use a valid public website URL.');
        const literal = url.hostname.replace(/^\[|\]$/g, '');
        if (net.isIP(literal) && privateAddress(literal)) throw new UserFacingError('The URL must use a public address.');
        let resolved;
        let timeout;
        try {
            resolved = await Promise.race([
                this.lookup(url.hostname),
                new Promise((_, reject) => {
                    timeout = setTimeout(() => reject(new Error('DNS timeout')), this.lookupTimeout);
                    timeout.unref?.();
                })
            ]);
        }
        catch { throw new UserFacingError('The website address could not be resolved.'); }
        finally { clearTimeout(timeout); }
        const addresses = Array.isArray(resolved) ? resolved : [resolved];
        if (!addresses.length || addresses.some(entry => privateAddress(entry.address || entry))) {
            throw new UserFacingError('The URL must use a public address.');
        }
        return url;
    }

    async qr(input) {
        const url = await this.publicUrl(input);
        return this.image(new URL(`https://quickchart.io/qr?text=${encodeURIComponent(url.toString())}`));
    }

    async screenshot(input) {
        const url = await this.publicUrl(input, true);
        if (!this.screenshotProvider) throw new UserFacingError('Screenshot service is not configured.');
        if (!this.screenshotProvider.includes('{url}')) throw new UserFacingError('Screenshot service is not configured correctly.');
        let provider;
        try { provider = new URL(this.screenshotProvider.replace('{url}', encodeURIComponent(url.toString()))); }
        catch { throw new UserFacingError('Screenshot service is not configured correctly.'); }
        if (provider.protocol !== 'https:' || provider.username || provider.password) {
            throw new UserFacingError('Screenshot service is not configured correctly.');
        }
        return this.image(provider);
    }

    async githubJson(path, errors) {
        const url = new URL(path, 'https://api.github.com');
        return this.cached(`github:${url}`, () => this.json(url, {
            headers: {
                accept: 'application/vnd.github+json',
                'x-github-api-version': '2022-11-28',
                'user-agent': 'ByteBot'
            },
            errors
        }));
    }

    async githubUser(input) {
        const username = String(input || '').trim();
        if (!/^(?!-)(?!.*--)[a-z\d-]{1,39}(?<!-)$/i.test(username)) {
            throw new UserFacingError('Please provide a valid GitHub username.');
        }
        const row = await this.githubJson(`/users/${encodeURIComponent(username)}`, {
            notFound: `GitHub user **${username}** not found.`,
            inaccessible: 'That GitHub profile is not publicly accessible.',
            rateLimited: 'GitHub rate limit reached.',
            failed: 'Failed to fetch GitHub data. Please try again later.'
        });
        const numbers = ['id', 'public_repos', 'public_gists', 'followers', 'following'];
        if (typeof row?.login !== 'string' || !numbers.every(key => Number.isSafeInteger(row[key]) && row[key] >= 0)
            || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))) {
            throw new UserFacingError('GitHub returned an invalid profile.');
        }
        const optional = key => typeof row[key] === 'string' && row[key] ? row[key] : null;
        return {
            username: row.login,
            id: row.id,
            url: httpsUrl(row.html_url, ['github.com']),
            avatar: httpsUrl(row.avatar_url, ['avatars.githubusercontent.com']),
            name: optional('name'),
            bio: optional('bio'),
            company: optional('company'),
            location: optional('location'),
            website: optional('blog'),
            repositories: row.public_repos,
            gists: row.public_gists,
            followers: row.followers,
            following: row.following,
            createdAt: row.created_at
        };
    }

    async githubRepositories(input) {
        const query = String(input || '').trim();
        if (!query || query.length > 100) throw new UserFacingError('Provide a repository search up to 100 characters.');
        const url = new URL('/search/repositories', 'https://api.github.com');
        url.searchParams.set('q', `${query} in:name`);
        url.searchParams.set('per_page', '5');
        const rows = (await this.githubJson(url, {
            notFound: 'GitHub repository search was not found.',
            inaccessible: 'GitHub repository search is not publicly accessible.',
            rateLimited: 'GitHub search rate limit reached.',
            failed: 'Failed to fetch GitHub data. Please try again later.'
        }))?.items;
        if (!Array.isArray(rows)) throw new UserFacingError('GitHub returned an invalid repository search.');
        const repositories = rows.slice(0, 5).filter(row => row?.private === false).map(row => {
            if (!Number.isSafeInteger(row.id) || typeof row.full_name !== 'string'
                || !Number.isSafeInteger(row.stargazers_count) || !Number.isSafeInteger(row.forks_count)
                || typeof row.archived !== 'boolean' || typeof row.updated_at !== 'string'
                || !Number.isFinite(Date.parse(row.updated_at))) {
                throw new UserFacingError('GitHub returned an invalid repository search.');
            }
            return {
                id: row.id,
                name: row.full_name,
                url: httpsUrl(row.html_url, ['github.com']),
                description: typeof row.description === 'string' && row.description ? row.description : null,
                stars: row.stargazers_count,
                forks: row.forks_count,
                language: typeof row.language === 'string' && row.language ? row.language : null,
                archived: row.archived,
                updatedAt: row.updated_at
            };
        });
        if (!repositories.length) throw new UserFacingError('No accessible public GitHub repositories found.');
        return repositories;
    }

    async githubEmail(input) {
        const email = String(input || '').trim();
        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new UserFacingError('Use a valid email address.');
        }
        const url = new URL('/search/commits', 'https://api.github.com');
        url.searchParams.set('q', `author-email:${email}`);
        url.searchParams.set('per_page', '5');
        const rows = (await this.githubJson(url, {
            notFound: 'GitHub commit search was not found.',
            inaccessible: 'GitHub commit search is not publicly accessible.',
            rateLimited: 'GitHub search rate limit reached.',
            failed: 'Failed to fetch GitHub data. Please try again later.'
        }))?.items;
        if (!Array.isArray(rows)) throw new UserFacingError('GitHub returned an invalid commit search.');
        const commits = rows.slice(0, 5).map(row => {
            const authoredAt = row?.commit?.author?.date;
            if (typeof row?.sha !== 'string' || typeof row?.repository?.full_name !== 'string'
                || typeof row?.commit?.message !== 'string' || typeof authoredAt !== 'string'
                || !Number.isFinite(Date.parse(authoredAt))) {
                throw new UserFacingError('GitHub returned an invalid commit search.');
            }
            return {
                sha: row.sha,
                url: httpsUrl(row.html_url, ['github.com']),
                repository: row.repository.full_name,
                repositoryUrl: httpsUrl(row.repository.html_url, ['github.com']),
                message: row.commit.message,
                author: typeof row.author?.login === 'string' ? row.author.login : null,
                authoredAt
            };
        });
        if (!commits.length) throw new UserFacingError('No public commits found for that email.');
        return commits;
    }

    async robloxJson(url, options = {}) {
        const key = `roblox:${options.method || 'GET'}:${url}:${options.body || ''}`;
        return this.cached(key, () => this.json(url, {
            ...options,
            errors: {
                notFound: 'That Roblox account or resource was not found.',
                badRequest: 'That Roblox account or resource is not publicly accessible.',
                inaccessible: 'That Roblox account or resource is not publicly accessible.',
                rateLimited: 'Roblox rate limit reached.',
                failed: 'Failed to fetch Roblox user information\n-# Please try again later'
            }
        }));
    }

    async robloxUser(input) {
        const username = String(input || '').trim();
        if (!/^(?=.{3,20}$)(?!_)(?!.*_$)(?!.*_.*_)(?!\d+$)[a-z\d_]+$/i.test(username)) {
            throw new UserFacingError('Please provide a Roblox username\n-# Use: roblox (username)');
        }
        const payload = await this.robloxJson(new URL('https://users.roblox.com/v1/usernames/users'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
        });
        if (!Array.isArray(payload?.data)) throw new UserFacingError('Roblox returned an invalid profile.');
        if (!payload.data.length) throw new UserFacingError('No Roblox user found with that name');
        const row = payload.data[0];
        if (!row || typeof row !== 'object' || Array.isArray(row)
            || !Number.isSafeInteger(row.id) || row.id <= 0 || typeof row.name !== 'string'
            || typeof row.displayName !== 'string') throw new UserFacingError('Roblox returned an invalid profile.');
        return { id: row.id, username: row.name, displayName: row.displayName };
    }

    async robloxProfile(input) {
        const user = await this.robloxUser(input);
        const id = user.id;
        const historyUnavailable = Symbol('history unavailable');
        const count = kind => this.robloxJson(new URL(`https://friends.roblox.com/v1/users/${id}/${kind}/count`));
        const [profile, followers, following, friends, presenceData, badgesData, historyData, thumbnailData] = await Promise.all([
            this.robloxJson(new URL(`https://users.roblox.com/v1/users/${id}`)),
            count('followers'),
            count('followings'),
            count('friends'),
            this.robloxJson(new URL('https://presence.roblox.com/v1/presence/users'), {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userIds: [id] })
            }),
            this.robloxJson(new URL(`https://accountinformation.roblox.com/v1/users/${id}/roblox-badges`)),
            this.robloxJson(new URL(`https://users.roblox.com/v1/users/${id}/username-history?limit=10&sortOrder=Desc`))
                .catch(error => {
                    if (['not-found', 'inaccessible'].includes(error.providerKind)) return historyUnavailable;
                    throw error;
                }),
            this.robloxJson(new URL(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${id}&size=420x420&format=Png&isCircular=false`))
        ]);
        const counts = [followers?.count, following?.count, friends?.count];
        const presence = presenceData?.userPresences?.[0];
        const badges = badgesData;
        const history = historyData?.data;
        const thumbnail = thumbnailData?.data?.[0];
        if (profile?.id !== id || typeof profile.description !== 'string' || typeof profile.created !== 'string'
            || !Number.isFinite(Date.parse(profile.created)) || typeof profile.isBanned !== 'boolean'
            || typeof profile.hasVerifiedBadge !== 'boolean'
            || counts.some(value => !Number.isSafeInteger(value) || value < 0)
            || !Number.isInteger(presence?.userPresenceType) || presence.userPresenceType < 0 || presence.userPresenceType > 3
            || presence.userId !== id || !Array.isArray(badges)
            || (historyData !== historyUnavailable && !Array.isArray(history))
            || thumbnail?.targetId !== id || thumbnail.state !== 'Completed') {
            throw new UserFacingError('Roblox returned an invalid profile.');
        }
        const badgeNames = badges.slice(0, 5).map(row => {
            if (typeof row?.name !== 'string') throw new UserFacingError('Roblox returned an invalid profile.');
            return row.name;
        });
        const names = historyData === historyUnavailable ? null : history.slice(0, 5).map(row => {
            if (typeof row?.name !== 'string') throw new UserFacingError('Roblox returned an invalid profile.');
            return row.name;
        });
        return {
            ...user,
            description: profile.description,
            createdAt: profile.created,
            banned: profile.isBanned,
            verified: profile.hasVerifiedBadge,
            followers: followers.count,
            following: following.count,
            friends: friends.count,
            presence: {
                status: ['Offline', 'Online', 'In Game', 'In Studio'][presence.userPresenceType],
                location: typeof presence.lastLocation === 'string' && presence.lastLocation ? presence.lastLocation : null,
                lastOnline: typeof presence.lastOnline === 'string' && Number.isFinite(Date.parse(presence.lastOnline))
                    ? presence.lastOnline : null
            },
            badgeCount: badges.length,
            badges: badgeNames,
            nameHistory: names,
            avatar: robloxImageUrl(thumbnail.imageUrl)
        };
    }

    async robloxGames(input) {
        const user = await this.robloxUser(input);
        const data = await this.robloxJson(new URL(
            `https://games.roblox.com/v2/users/${user.id}/games?accessFilter=2&limit=10&sortOrder=Desc`
        ));
        if (!Array.isArray(data?.data)) throw new UserFacingError('Roblox returned an invalid games list.');
        const games = data.data.slice(0, 5).map(row => {
            const placeId = row?.rootPlace?.id;
            if (!Number.isSafeInteger(row?.id) || !Number.isSafeInteger(placeId) || typeof row.name !== 'string'
                || typeof row.description !== 'string' || !Number.isSafeInteger(row.placeVisits) || row.placeVisits < 0
                || typeof row.created !== 'string' || !Number.isFinite(Date.parse(row.created))
                || typeof row.updated !== 'string' || !Number.isFinite(Date.parse(row.updated))) {
                throw new UserFacingError('Roblox returned an invalid games list.');
            }
            return {
                id: row.id,
                name: row.name,
                description: row.description,
                placeId,
                url: `https://www.roblox.com/games/${placeId}`,
                createdAt: row.created,
                updatedAt: row.updated,
                visits: row.placeVisits
            };
        });
        if (!games.length) throw new UserFacingError('This Roblox user has no public games.');
        return { user, games };
    }

    async robloxGroups(input) {
        const user = await this.robloxUser(input);
        const data = await this.robloxJson(new URL(`https://groups.roblox.com/v1/users/${user.id}/groups/roles`));
        if (!Array.isArray(data?.data)) throw new UserFacingError('Roblox returned an invalid groups list.');
        const groups = data.data.slice(0, 5).map(row => {
            const group = row?.group;
            const role = row?.role;
            if (!Number.isSafeInteger(group?.id) || typeof group.name !== 'string'
                || !Number.isSafeInteger(group.memberCount) || group.memberCount < 0 || typeof group.isLocked !== 'boolean'
                || typeof role?.name !== 'string' || !Number.isSafeInteger(role.rank)) {
                throw new UserFacingError('Roblox returned an invalid groups list.');
            }
            return {
                id: group.id,
                name: group.name,
                members: group.memberCount,
                locked: group.isLocked,
                role: role.name,
                rank: role.rank,
                url: `https://www.roblox.com/communities/${group.id}`
            };
        });
        if (!groups.length) throw new UserFacingError('This Roblox user is not in any groups');
        return { user, groups };
    }

    async robloxOutfits(input) {
        const user = await this.robloxUser(input);
        const data = await this.robloxJson(new URL(
            `https://avatar.roblox.com/v2/avatar/users/${user.id}/outfits?itemsPerPage=5&page=1`
        ));
        if (!Array.isArray(data?.data)) throw new UserFacingError('Roblox returned an invalid outfits list.');
        const outfits = data.data.slice(0, 5).map(row => {
            if (!Number.isSafeInteger(row?.id) || typeof row.name !== 'string'
                || typeof row.isEditable !== 'boolean' || typeof row.outfitType !== 'string') {
                throw new UserFacingError('Roblox returned an invalid outfits list.');
            }
            return { id: row.id, name: row.name, editable: row.isEditable, type: row.outfitType };
        });
        if (!outfits.length) throw new UserFacingError('This Roblox user has no public outfits.');
        return { user, outfits };
    }

    async weather(input) {
        const location = String(input || '').trim();
        if (!location || location.length > 100) throw new UserFacingError('Provide a location up to 100 characters.');
        const search = new URL('https://geocoding-api.open-meteo.com/v1/search');
        search.searchParams.set('name', location);
        search.searchParams.set('count', '1');
        search.searchParams.set('language', 'en');
        search.searchParams.set('format', 'json');
        const place = (await this.json(search))?.results?.[0];
        if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)
            || typeof place.name !== 'string') throw new UserFacingError(`No weather data found for ${location}.`);

        const forecast = new URL('https://api.open-meteo.com/v1/forecast');
        forecast.searchParams.set('latitude', String(place.latitude));
        forecast.searchParams.set('longitude', String(place.longitude));
        forecast.searchParams.set('current', 'temperature_2m,relative_humidity_2m,wind_speed_10m,visibility');
        forecast.searchParams.set('daily', 'sunrise,sunset');
        forecast.searchParams.set('timezone', 'auto');
        const data = await this.json(forecast);
        const current = data?.current;
        const values = [current?.temperature_2m, current?.relative_humidity_2m, current?.wind_speed_10m, current?.visibility];
        if (values.some(value => !Number.isFinite(value))
            || typeof data?.daily?.sunrise?.[0] !== 'string'
            || typeof data?.daily?.sunset?.[0] !== 'string') {
            throw new UserFacingError('Weather provider returned an invalid payload.');
        }
        return {
            location: [place.name, place.country].filter(value => typeof value === 'string').join(', '),
            temperature: current.temperature_2m,
            humidity: current.relative_humidity_2m,
            wind: current.wind_speed_10m,
            visibility: current.visibility,
            sunrise: data.daily.sunrise[0],
            sunset: data.daily.sunset[0]
        };
    }

    async define(input) {
        const word = String(input || '').trim();
        if (!word || word.length > 100) throw new UserFacingError('Provide a word up to 100 characters.');
        const url = new URL('https://api.urbandictionary.com/v0/define');
        url.searchParams.set('term', word);
        const rows = (await this.json(url))?.list;
        if (!Array.isArray(rows)) throw new UserFacingError('Definition provider returned an invalid payload.');
        const definitions = rows.slice(0, 5).map(row => {
            let permalink;
            try {
                const parsed = new URL(row.permalink);
                if (parsed.protocol === 'https:' && ['urbandictionary.com', 'www.urbandictionary.com'].includes(parsed.hostname)) {
                    permalink = parsed.toString();
                }
            } catch { /* Invalid provider URL is omitted. */ }
            if (typeof row.definition !== 'string' || !Number.isFinite(row.thumbs_up) || !Number.isFinite(row.thumbs_down)) {
                throw new UserFacingError('Definition provider returned an invalid payload.');
            }
            return {
                definition: row.definition.slice(0, 1000),
                example: typeof row.example === 'string' ? row.example.slice(0, 1000) : '',
                up: row.thumbs_up,
                down: row.thumbs_down,
                ...(permalink && { url: permalink })
            };
        });
        if (!definitions.length) throw new UserFacingError(`No definitions found for ${word}.`);
        return definitions;
    }

    async translate(languageInput, textInput) {
        const requestedLanguage = String(languageInput || '').trim();
        const text = String(textInput || '').trim();
        if (!requestedLanguage || requestedLanguage.length > 50 || !/^[a-z][a-z -]*$/i.test(requestedLanguage)) {
            throw new UserFacingError('Use a valid language code or name.');
        }
        if (!text || text.length > 2000) throw new UserFacingError('Provide 1-2000 characters to translate.');
        if (!this.translationProvider) throw new UserFacingError('Translation service is not configured.');
        let endpoint;
        try { endpoint = new URL('translate', this.translationProvider); }
        catch { throw new UserFacingError('Translation service is not configured correctly.'); }
        if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
            throw new UserFacingError('Translation service is not configured correctly.');
        }
        let language = requestedLanguage.toLowerCase();
        if (!/^[a-z]{2,3}(?:-[a-z]{2})?$/.test(language)) {
            const languages = await this.json(new URL('languages', this.translationProvider));
            const match = Array.isArray(languages) && languages.find(entry =>
                typeof entry?.name === 'string'
                && entry.name.toLowerCase() === language
                && typeof entry.code === 'string'
                && /^[a-z]{2,3}(?:-[a-z]{2})?$/i.test(entry.code));
            if (!match) throw new UserFacingError(`Language ${requestedLanguage} was not found.`);
            language = match.code.toLowerCase();
        }
        const payload = await this.json(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                q: text,
                source: 'auto',
                target: language,
                format: 'text',
                ...(this.translationKey && { api_key: this.translationKey })
            })
        });
        if (typeof payload?.translatedText !== 'string' || !payload.translatedText
            || payload.translatedText.length > 4000) {
            throw new UserFacingError('Translation provider returned an invalid payload.');
        }
        return payload.translatedText;
    }

    database() {
        return this.sqlite || require('../database').sqlite;
    }

    recordNameChange(guildIds, userId, username, recordedAt = Date.now()) {
        const name = String(username || '').trim();
        if (!/^\d{17,19}$/.test(String(userId)) || !name || name.length > 32) return;
        const sqlite = this.database();
        const insert = sqlite.prepare(`INSERT INTO automation_rules
            (guild_id, kind, key, config, enabled, run_count, created_by, created_at, updated_at)
            VALUES (?, 'name-history', ?, ?, 0, 0, ?, ?, ?)`);
        const trim = sqlite.prepare(`DELETE FROM automation_rules
            WHERE guild_id = ? AND kind = 'name-history' AND key LIKE ?
              AND id NOT IN (SELECT id FROM automation_rules
                WHERE guild_id = ? AND kind = 'name-history' AND key LIKE ?
                ORDER BY updated_at DESC, id DESC LIMIT 25)`);
        sqlite.transaction(() => {
            for (const guildId of [...new Set(guildIds)]) {
                if (!/^\d{17,19}$/.test(String(guildId))) continue;
                const prefix = `${userId}:%`;
                insert.run(guildId, `${userId}:${recordedAt}:${this.randomUUID()}`,
                    JSON.stringify({ name }), userId, recordedAt, recordedAt);
                trim.run(guildId, prefix, guildId, prefix);
            }
        })();
    }

    nameHistory(guildId, userId) {
        if (!/^\d{17,19}$/.test(String(guildId)) || !/^\d{17,19}$/.test(String(userId))) return [];
        return this.database().prepare(`SELECT config, updated_at FROM automation_rules
            WHERE guild_id = ? AND kind = 'name-history' AND key LIKE ?
            ORDER BY updated_at DESC, id DESC LIMIT 25`).all(guildId, `${userId}:%`).flatMap(row => {
            try {
                const name = JSON.parse(row.config)?.name;
                return typeof name === 'string' && name ? [{ name, recordedAt: row.updated_at }] : [];
            } catch { return []; }
        });
    }
}

module.exports = { InformationLookupService, evaluateExpression };
