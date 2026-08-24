const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const { privateAddress } = require('./serverPresentationService');

function evaluateExpression(input) {
    const expression = String(input || '').trim();
    if (!expression || expression.length > 500) throw new Error('Invalid expression.');

    const tokens = [];
    for (let offset = 0; offset < expression.length;) {
        const remaining = expression.slice(offset);
        const whitespace = remaining.match(/^\s+/);
        if (whitespace) {
            offset += whitespace[0].length;
            continue;
        }
        const token = remaining.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|^\*\*|^[()+\-*/%]/i)?.[0];
        if (!token) throw new Error('Invalid expression.');
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
            if (!take(')')) throw new Error('Invalid expression.');
            return value;
        }
        const token = tokens[index++];
        const value = Number(token);
        if (!token || !Number.isFinite(value)) throw new Error('Invalid expression.');
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
    if (index !== tokens.length) throw new Error('Invalid expression.');
    if (!Number.isFinite(result)) throw new Error('The result must be finite.');
    return result;
}

class InformationLookupService {
    constructor(options = {}) {
        this.fetch = options.fetch || globalThis.fetch;
        this.lookup = options.lookup || (hostname => dns.lookup(hostname, { all: true, verbatim: true }));
        this.screenshotProvider = options.screenshotProvider ?? process.env.SCREENSHOT_API_URL;
        this.translationProvider = options.translationProvider ?? process.env.LIBRETRANSLATE_URL;
        this.translationKey = options.translationKey ?? process.env.LIBRETRANSLATE_API_KEY;
        this.sqlite = options.sqlite;
        this.randomUUID = options.randomUUID || crypto.randomUUID;
    }

    async json(url, options = {}) {
        const response = await this.fetch(url, {
            ...options,
            redirect: 'error',
            signal: options.signal || AbortSignal.timeout(10000)
        });
        if (!response.ok) throw new Error('Lookup provider request failed.');
        const type = response.headers.get('content-type') || '';
        const length = Number(response.headers.get('content-length') || 0);
        if (!type.toLowerCase().includes('application/json') || length > 2 * 1024 * 1024) {
            throw new Error('Lookup provider returned an invalid payload.');
        }
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > 2 * 1024 * 1024) throw new Error('Lookup provider returned an invalid payload.');
        try { return JSON.parse(Buffer.from(bytes).toString('utf8')); }
        catch { throw new Error('Lookup provider returned an invalid payload.'); }
    }

    async image(url) {
        const response = await this.fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
        const type = response.headers.get('content-type') || '';
        const length = Number(response.headers.get('content-length') || 0);
        if (!response.ok || !/^image\/(?:png|jpe?g|webp)$/i.test(type.split(';')[0].trim())
            || length > 8 * 1024 * 1024) throw new Error('Image provider returned an invalid payload.');
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('Image provider returned an invalid payload.');
        return Buffer.from(bytes);
    }

    async publicUrl(input, httpsOnly = false) {
        const value = String(input || '').trim();
        if (!value || value.length > 2048) throw new Error('Use a valid public website URL.');
        let url;
        try { url = new URL(value); } catch { throw new Error('Use a valid public website URL.'); }
        if ((httpsOnly ? url.protocol !== 'https:' : !['http:', 'https:'].includes(url.protocol))
            || url.username || url.password) throw new Error('Use a valid public website URL.');
        const literal = url.hostname.replace(/^\[|\]$/g, '');
        if (net.isIP(literal) && privateAddress(literal)) throw new Error('The URL must use a public address.');
        const resolved = await this.lookup(url.hostname);
        const addresses = Array.isArray(resolved) ? resolved : [resolved];
        if (!addresses.length || addresses.some(entry => privateAddress(entry.address || entry))) {
            throw new Error('The URL must use a public address.');
        }
        return url;
    }

    async qr(input) {
        const url = await this.publicUrl(input);
        return this.image(new URL(`https://quickchart.io/qr?text=${encodeURIComponent(url.toString())}`));
    }

    async screenshot(input) {
        const url = await this.publicUrl(input, true);
        if (!this.screenshotProvider) throw new Error('Screenshot service is not configured.');
        if (!this.screenshotProvider.includes('{url}')) throw new Error('Screenshot service is not configured correctly.');
        let provider;
        try { provider = new URL(this.screenshotProvider.replace('{url}', encodeURIComponent(url.toString()))); }
        catch { throw new Error('Screenshot service is not configured correctly.'); }
        if (provider.protocol !== 'https:' || provider.username || provider.password) {
            throw new Error('Screenshot service is not configured correctly.');
        }
        return this.image(provider);
    }

    async weather(input) {
        const location = String(input || '').trim();
        if (!location || location.length > 100) throw new Error('Provide a location up to 100 characters.');
        const search = new URL('https://geocoding-api.open-meteo.com/v1/search');
        search.searchParams.set('name', location);
        search.searchParams.set('count', '1');
        search.searchParams.set('language', 'en');
        search.searchParams.set('format', 'json');
        const place = (await this.json(search))?.results?.[0];
        if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)
            || typeof place.name !== 'string') throw new Error(`No weather data found for ${location}.`);

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
            throw new Error('Weather provider returned an invalid payload.');
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
        if (!word || word.length > 100) throw new Error('Provide a word up to 100 characters.');
        const url = new URL('https://api.urbandictionary.com/v0/define');
        url.searchParams.set('term', word);
        const rows = (await this.json(url))?.list;
        if (!Array.isArray(rows)) throw new Error('Definition provider returned an invalid payload.');
        const definitions = rows.slice(0, 5).map(row => {
            let permalink;
            try {
                const parsed = new URL(row.permalink);
                if (parsed.protocol === 'https:' && ['urbandictionary.com', 'www.urbandictionary.com'].includes(parsed.hostname)) {
                    permalink = parsed.toString();
                }
            } catch { /* Invalid provider URL is omitted. */ }
            if (typeof row.definition !== 'string' || !Number.isFinite(row.thumbs_up) || !Number.isFinite(row.thumbs_down)) {
                throw new Error('Definition provider returned an invalid payload.');
            }
            return {
                definition: row.definition.slice(0, 1000),
                example: typeof row.example === 'string' ? row.example.slice(0, 1000) : '',
                up: row.thumbs_up,
                down: row.thumbs_down,
                ...(permalink && { url: permalink })
            };
        });
        if (!definitions.length) throw new Error(`No definitions found for ${word}.`);
        return definitions;
    }

    async translate(languageInput, textInput) {
        const requestedLanguage = String(languageInput || '').trim();
        const text = String(textInput || '').trim();
        if (!requestedLanguage || requestedLanguage.length > 50 || !/^[a-z][a-z -]*$/i.test(requestedLanguage)) {
            throw new Error('Use a valid language code or name.');
        }
        if (!text || text.length > 2000) throw new Error('Provide 1-2000 characters to translate.');
        if (!this.translationProvider) throw new Error('Translation service is not configured.');
        let endpoint;
        try { endpoint = new URL('translate', this.translationProvider); }
        catch { throw new Error('Translation service is not configured correctly.'); }
        if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
            throw new Error('Translation service is not configured correctly.');
        }
        let language = requestedLanguage.toLowerCase();
        if (!/^[a-z]{2,3}(?:-[a-z]{2})?$/.test(language)) {
            const languages = await this.json(new URL('languages', this.translationProvider));
            const match = Array.isArray(languages) && languages.find(entry =>
                typeof entry?.name === 'string'
                && entry.name.toLowerCase() === language
                && typeof entry.code === 'string'
                && /^[a-z]{2,3}(?:-[a-z]{2})?$/i.test(entry.code));
            if (!match) throw new Error(`Language ${requestedLanguage} was not found.`);
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
            throw new Error('Translation provider returned an invalid payload.');
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
