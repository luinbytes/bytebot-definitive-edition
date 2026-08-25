class CommandRateLimiter {
    constructor(now = Date.now) {
        this.now = now;
        this.users = new Map();
        this.guilds = new Map();
        this.lastSweep = now();
    }

    take(windows, key, limit, duration, now) {
        const recent = (windows.get(key) || []).filter(timestamp => timestamp > now - duration);
        if (recent.length >= limit) {
            windows.set(key, recent);
            return recent[0] + duration;
        }
        recent.push(now);
        windows.set(key, recent);
        return null;
    }

    consume(userId, guildId) {
        const now = this.now();
        if (now - this.lastSweep >= 60000) {
            for (const windows of [this.users, this.guilds]) {
                for (const [key, timestamps] of windows) {
                    if (timestamps.at(-1) <= now - 10000) windows.delete(key);
                }
            }
            this.lastSweep = now;
        }
        const userRetry = this.take(this.users, userId, 15, 5000, now);
        if (userRetry) return { allowed: false, retryAt: userRetry };
        const guildRetry = guildId ? this.take(this.guilds, guildId, 60, 10000, now) : null;
        return guildRetry
            ? { allowed: false, retryAt: guildRetry }
            : { allowed: true, retryAt: null };
    }
}

module.exports = { CommandRateLimiter };
