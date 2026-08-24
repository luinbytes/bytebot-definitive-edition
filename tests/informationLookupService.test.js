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
