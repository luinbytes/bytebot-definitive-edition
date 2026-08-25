const fs = require('node:fs');

function heartbeatFresh(filename, maxAgeMs = 45000, now = Date.now()) {
    try {
        const timestamp = Number(fs.readFileSync(filename, 'utf8'));
        return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= maxAgeMs;
    } catch {
        return false;
    }
}

function startHeartbeat(options = {}) {
    const filename = options.filename || process.env.BYTEBOT_HEALTH_FILE || '/tmp/bytebot-health';
    const intervalMs = options.intervalMs || 15000;
    const now = options.now || Date.now;
    const write = () => fs.writeFileSync(filename, String(now()), { mode: 0o600 });
    write();
    const interval = setInterval(write, intervalMs);
    interval.unref?.();
    return () => {
        clearInterval(interval);
        try { fs.unlinkSync(filename); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    };
}

module.exports = { heartbeatFresh, startHeartbeat };
