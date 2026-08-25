const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('highest public command throughput applies without entitlement state', () => {
    const { CommandRateLimiter } = require('../src/utils/commandRateLimit');
    let now = 1000;
    const limiter = new CommandRateLimiter(() => now);

    for (let index = 0; index < 15; index += 1) {
        expect(limiter.consume('user-1', `guild-${index}`)).toEqual({ allowed: true, retryAt: null });
    }
    expect(limiter.consume('user-1', 'guild-extra')).toEqual({ allowed: false, retryAt: 6000 });
    now = 6001;
    expect(limiter.consume('user-1', 'guild-extra')).toEqual({ allowed: true, retryAt: null });

    for (let index = 0; index < 60; index += 1) {
        expect(limiter.consume(`guild-user-${index}`, 'busy-guild').allowed).toBe(true);
    }
    expect(limiter.consume('guild-user-last', 'busy-guild').allowed).toBe(false);
    now += 10001;
    expect(limiter.consume('guild-user-last', 'busy-guild')).toEqual({ allowed: true, retryAt: null });
});

test('helper diagnostics are bounded and distinguish unavailable binaries', () => {
    const { inspectHelpers } = require('../src/utils/helperHealth');
    const spawnSync = jest.fn((executable) => executable === 'missing'
        ? { status: null, error: new Error('ENOENT'), stdout: '', stderr: '' }
        : { status: 0, stdout: `${executable} 1.0\n`, stderr: '' });
    const health = inspectHelpers({
        paths: { tesseract: 'tesseract', espeak: 'missing', ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' },
        spawnSync,
        resolve: name => `/modules/${name}`,
        sharpVersion: () => '0.35.3'
    });

    expect(health.sharp).toEqual({ ready: true, detail: '0.35.3' });
    expect(health.tesseract.ready).toBe(true);
    expect(health.espeak.ready).toBe(false);
    expect(health.music.ready).toBe(true);
    expect(spawnSync).toHaveBeenCalledWith('tesseract', ['--version'], expect.objectContaining({ timeout: 5000, shell: false }));
});

test('runtime heartbeat reports fresh, stale, and cleaned-up state', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-heartbeat-'));
    const filename = path.join(directory, 'health');
    const { heartbeatFresh, startHeartbeat } = require('../src/utils/runtimeHeartbeat');
    const stop = startHeartbeat({ filename, intervalMs: 10000, now: () => 1000 });
    expect(heartbeatFresh(filename, 45000, 2000)).toBe(true);
    expect(heartbeatFresh(filename, 45000, 47000)).toBe(false);
    stop();
    expect(fs.existsSync(filename)).toBe(false);
    fs.rmSync(directory, { recursive: true, force: true });
});

test('production container starts the bot with hard small-VPS defaults', () => {
    const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
    const compose = fs.readFileSync(path.join(__dirname, '..', 'compose.yaml'), 'utf8');
    expect(dockerfile).toContain('ENV NODE_OPTIONS=--max-old-space-size=640');
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toContain('touch /app/.command-cache.json');
    expect(dockerfile).toContain('chown -R node:node /app/data /app/logs /app/.command-cache.json');
    expect(dockerfile).toContain('CMD ["npm", "start"]');
    expect(compose).toContain('cpus: 1.0');
    expect(compose).toContain('mem_limit: 1g');
    expect(compose).toContain('pids_limit: 128');
    expect(compose).toContain('bytebot-logs:/app/logs');
});

test('/bot stats exposes cached helper readiness without spawning work', async () => {
    const command = require('../src/commands/developer/bot');
    const reply = jest.fn();
    await command.execute({
        options: { getSubcommand: () => 'stats', getSubcommandGroup: () => false }, reply
    }, {
        guilds: { cache: { size: 2 } }, commands: { size: 45 }, ws: { ping: 12 },
        helperHealth: {
            sharp: { ready: true }, tesseract: { ready: true }, espeak: { ready: false },
            music: { ready: true }
        }, musicService: null
    });
    const field = reply.mock.calls[0][0].embeds[0].data.fields.find(item => item.name === 'Helpers');
    expect(field.value).toBe('Sharp ready • OCR ready • Speech unavailable • Music disabled');
});
