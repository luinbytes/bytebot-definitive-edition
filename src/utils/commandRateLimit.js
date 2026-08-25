class CommandRateLimiter {
    constructor(now = Date.now) {
        this.now = now;
        this.users = new Map();
        this.guilds = new Map();
        this.lastSweep = now();
    }

    recent(windows, key, duration, now) {
        return (windows.get(key) || []).filter(timestamp => timestamp > now - duration);
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
        const user = this.recent(this.users, userId, 5000, now);
        const guild = guildId ? this.recent(this.guilds, guildId, 10000, now) : null;
        if (user.length >= 15) return { allowed: false, retryAt: user[0] + 5000 };
        if (guild?.length >= 60) return { allowed: false, retryAt: guild[0] + 10000 };
        user.push(now);
        this.users.set(userId, user);
        if (guild) {
            guild.push(now);
            this.guilds.set(guildId, guild);
        }
        return { allowed: true, retryAt: null };
    }
}

module.exports = { CommandRateLimiter };
