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
    for (let index = 0; index < 15; index += 1) {
        expect(limiter.consume('guild-user-last', `open-guild-${index}`).allowed).toBe(true);
    }
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
    const dockerignore = fs.readFileSync(path.join(__dirname, '..', '.dockerignore'), 'utf8');
    const logger = fs.readFileSync(path.join(__dirname, '..', 'src/utils/logger.js'), 'utf8');
    expect(dockerfile).toContain('ENV NODE_OPTIONS=--max-old-space-size=640');
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toContain('touch /app/.command-cache.json');
    expect(dockerfile).toContain('chown -R node:node /app/data /app/logs /app/.command-cache.json');
    expect(dockerfile).toContain('CMD ["npm", "start"]');
    expect(compose).toContain('DATABASE_URL: /app/data/sqlite.db');
    expect(compose).toContain('cpus: 1.0');
    expect(compose).toContain('mem_limit: 1g');
    expect(compose).toContain('pids_limit: 128');
    expect(compose).toContain('bytebot-logs:/app/logs');
    expect(dockerignore).toContain('.npmrc');
    expect(dockerignore).toContain('config.local.json');
    expect(dockerignore).toContain('*.db-wal');
    expect(dockerignore).toContain('*.db-shm');
    expect(logger).toContain('MAX_LOG_BYTES = 10 * 1024 * 1024');
    expect(logger).toContain('14 * 86400000');
});

test('heartbeat starts before Discord login and Sharp stays lazy', () => {
    const index = fs.readFileSync(path.join(__dirname, '..', 'src/index.js'), 'utf8');
    expect(index.indexOf('startHeartbeat()')).toBeLessThan(index.indexOf('client.login'));
    expect(index).toContain('process.exit(1)');
    jest.resetModules();
    require('../src/services/imageManipulationService');
    expect(Object.keys(require.cache).some(filename => filename.includes('/sharp/dist/index.'))).toBe(false);
});

test('/bot stats exposes cached helper readiness without spawning work', async () => {
    const command = require('../src/commands/developer/bot');
    const reply = jest.fn();
    await command.execute({
        options: { getSubcommand: () => 'stats', getSubcommandGroup: () => false }, reply
    }, {
        guilds: { cache: { size: 2 } }, commands: { size: 45 }, ws: { ping: 12 },
        helperHealth: {
            sharp: { ready: true, detail: '0.35.3' }, tesseract: { ready: true, detail: 'tesseract 5.3.0' }, espeak: { ready: false },
            music: { ready: true }
        }, musicService: null
    });
    const field = reply.mock.calls[0][0].embeds[0].data.fields.find(item => item.name === 'Helpers');
    expect(field.value).toBe('Sharp 0.35.3 • OCR tesseract 5.3.0 • Speech unavailable • Music disabled');
});
