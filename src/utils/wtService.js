const axios = require('axios');
const logger = require('./logger');

const BASE_URL = 'https://api.thunderinsights.dk/v1';
const API_TIMEOUT = 10000; // 10 seconds - prevent hanging on slow/unresponsive API

/**
 * Service to interact with the ThunderInsights API.
 */
class WTService {
    /**
     * Search for a player by their nickname.
     * @param {string} nickname The player's exact or partial nickname.
     * @returns {Promise<Object|null>} The first user found or null.
     */
    async searchPlayer(nickname) {
        try {
            const response = await axios.get(`${BASE_URL}/users/direct/search/`, {
                params: { nick: nickname, limit: 2 },
                timeout: API_TIMEOUT,
                validateStatus: (status) => status < 500 // Retry on 5xx errors
            });

            if (response.data && response.data.length > 0) {
                return response.data[0];
            }
            return null;
        } catch (error) {
            const detail = error.response?.data?.detail;
            const detailMsg = detail ? ` - ${JSON.stringify(detail)}` : '';
            logger.error(`Error searching player "${nickname}": ${error.message}${detailMsg}`);
            throw error;
        }
    }

    /**
     * Get comprehensive statistics for a player using the direct endpoint.
     * @param {number} userid The ID of the player.
     * @returns {Promise<Object>} Aggregated player statistics.
     */
    async getPlayerStats(userid) {
        try {
            const response = await axios.get(`${BASE_URL}/users/direct/${userid}`, {
                timeout: API_TIMEOUT,
                validateStatus: (status) => status < 500 // Retry on 5xx errors
            });
            const data = response.data;

            if (!data) return null;

            // Aggregation object
            const stats = {
                nick: data.nick,
                clan_tag: data.clan_tag,
                experience: data.exp || 0,
                level: data.rank || 0,
                icon_name: data.icon_name || 'cardicon_default',
                totals: {
                    ground_kills: 0,
                    air_kills: 0,
                    naval_kills: 0,
                    deaths: 0,
                    victories: 0,
                    spawns: 0,
                }
            };

            // Aggregate userstat data
            if (data.userstat) {
                const modes = ['arcade', 'historical', 'simulation'];
                modes.forEach(mode => {
                    const modeData = data.userstat[mode];
                    if (modeData && modeData.total) {
                        Object.values(modeData.total).forEach(unit => {
                            stats.totals.ground_kills += unit.ground_kills || 0;
                            stats.totals.air_kills += unit.air_kills || 0;
                            stats.totals.naval_kills += unit.naval_kills || 0;
                            stats.totals.deaths += unit.deaths || 0;
                            stats.totals.victories += unit.victories || 0;
                            stats.totals.spawns += unit.flyouts || unit.was_in_session || 0;
                        });
                    }
                });
            }

            // Calculate derived stats
            const totalKills = stats.totals.ground_kills + stats.totals.air_kills + stats.totals.naval_kills;
            stats.totals.total_kills = totalKills;

            stats.kd = stats.totals.deaths > 0
                ? (totalKills / stats.totals.deaths).toFixed(2)
                : totalKills.toFixed(2);

            stats.winRate = stats.totals.spawns > 0
                ? ((stats.totals.victories / stats.totals.spawns) * 100).toFixed(1)
                : '0.0';

            return stats;
        } catch (error) {
            logger.error(`Error fetching direct stats for userid ${userid}: ${error.message}`);
            throw error;
        }
    }
}

module.exports = new WTService();
