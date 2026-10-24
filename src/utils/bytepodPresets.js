const { sqlite } = require('../database');

const MAX_PRESETS = 998;

function countPresets(userId, guildId) {
    return sqlite.prepare(`SELECT COUNT(*) AS count FROM bytepod_autowhitelist
        WHERE user_id = ? AND guild_id = ?`).get(userId, guildId).count;
}

function listPresets(userId, guildId, limit = MAX_PRESETS, offset = 0) {
    return sqlite.prepare(`SELECT target_user_id AS targetUserId FROM bytepod_autowhitelist
        WHERE user_id = ? AND guild_id = ? ORDER BY id LIMIT ? OFFSET ?`).all(userId, guildId, limit, offset);
}

function addPreset(userId, guildId, targetId) {
    return sqlite.transaction(() => {
        const exists = sqlite.prepare(`SELECT 1 FROM bytepod_autowhitelist
            WHERE user_id = ? AND guild_id = ? AND target_user_id = ?`).get(userId, guildId, targetId);
        if (exists) return 'That user is already in your preset.';
        if (countPresets(userId, guildId) >= MAX_PRESETS) {
            return `Your preset has reached its ${MAX_PRESETS}-user limit. Remove someone with /pod preset remove before adding another user.`;
        }
        sqlite.prepare(`INSERT INTO bytepod_autowhitelist (user_id, guild_id, target_user_id)
            VALUES (?, ?, ?)`).run(userId, guildId, targetId);
        return null;
    }).immediate();
}

module.exports = { MAX_PRESETS, countPresets, listPresets, addPreset };
