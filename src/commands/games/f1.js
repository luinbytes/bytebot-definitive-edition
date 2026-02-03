const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');
const embeds = require('../../utils/embeds');
const logger = require('../../utils/logger');
const { handleCommandError } = require('../../utils/errorHandlerUtil');
const { shouldBeEphemeral } = require('../../utils/ephemeralHelper');

const BASE_URL = 'https://api.openf1.org/v1';
const API_TIMEOUT = 10000;

/**
 * Fetch with retry for rate limiting (429)
 */
async function fetchWithRetry(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await axios.get(url, { timeout: API_TIMEOUT });
            return response;
        } catch (error) {
            if (error.response?.status === 429 && i < retries - 1) {
                const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s exponential backoff
                logger.debug(`Rate limited, waiting ${delay}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
}

/**
 * Get all F1 meetings (races) for the year
 */
async function getAllRaces(year = new Date().getFullYear()) {
    logger.debug(`Fetching all F1 races for year ${year}`);
    const response = await fetchWithRetry(`${BASE_URL}/meetings?year=${year}`);

    const races = response.data.sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
    logger.debug(`Retrieved ${races.length} total races for ${year}`);
    return races;
}

/**
 * Get upcoming or recent F1 meetings (races)
 */
async function getUpcomingRaces() {
    logger.debug('Fetching upcoming F1 races from OpenF1 API');
    const now = new Date();
    const currentYear = now.getFullYear();
    const response = await fetchWithRetry(`${BASE_URL}/meetings?year=${currentYear}`);

    // Sort by date_start and filter for future or recent races
    const races = response.data
        .filter(meeting => new Date(meeting.date_start) >= new Date(now - 7 * 24 * 60 * 60 * 1000)) // Last 7 days or future
        .sort((a, b) => new Date(a.date_start) - new Date(b.date_start))
        .slice(0, 5);

    logger.debug(`Retrieved ${races.length} upcoming races`);
    return races;
}

/**
 * Get driver standings from the most recent race
 */
async function getDriverStandings() {
    logger.debug('Fetching F1 driver standings from OpenF1 API');
    const currentYear = new Date().getFullYear();

    // Get latest sessions
    let sessions = await fetchWithRetry(`${BASE_URL}/sessions?year=${currentYear}&session_name=Race`);

    // If no completed races this year, try previous year
    const hasCompletedRace = sessions.data && sessions.data.some(s => new Date(s.date_end) < new Date());
    if (!hasCompletedRace) {
        logger.debug(`No completed races in ${currentYear}, trying ${currentYear - 1}`);
        sessions = await fetchWithRetry(`${BASE_URL}/sessions?year=${currentYear - 1}&session_name=Race`);
    }

    if (!sessions.data || sessions.data.length === 0) {
        return null;
    }

    // Get the most recent completed race
    const latestRace = sessions.data
        .filter(s => new Date(s.date_end) < new Date())
        .sort((a, b) => new Date(b.date_end) - new Date(a.date_end))[0];

    if (!latestRace) {
        return null;
    }

    // Get championship standings and drivers with sequential calls to avoid rate limiting
    const standingsResp = await fetchWithRetry(`${BASE_URL}/championship_drivers?session_key=${latestRace.session_key}`);

    // Add a small delay before fetching drivers
    await new Promise(resolve => setTimeout(resolve, 500));

    const driversResp = await fetchWithRetry(`${BASE_URL}/drivers?session_key=${latestRace.session_key}`);

    // Create driver number -> name_acronym map
    const driverMap = {};
    driversResp.data.forEach(driver => {
        driverMap[driver.driver_number] = driver.name_acronym;
    });

    // Merge standings with driver names
    const standings = standingsResp.data.map(driver => ({
        ...driver,
        name_acronym: driverMap[driver.driver_number] || `Unknown (#${driver.driver_number})`
    })).sort((a, b) => a.position_current - b.position_current);

    logger.debug(`Retrieved driver standings for ${latestRace.meeting_key}`);
    return standings;
}

/**
 * Format race date to a readable string
 */
function formatDate(dateStr, gmtOffset) {
    const date = new Date(dateStr);
    const options = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' };
    return date.toLocaleDateString('en-US', options);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('f1')
        .setDescription('Formula 1 racing data and standings')
        .addSubcommand(subcommand =>
            subcommand
                .setName('schedule')
                .setDescription('Show upcoming F1 race schedule'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('standings')
                .setDescription('Show current F1 driver championship standings'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('info')
                .setDescription('Get info about a specific race circuit')
                .addStringOption(option =>
                    option.setName('circuit')
                        .setDescription('Circuit name (e.g., Silverstone, Monaco, Spa)')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('year')
                        .setDescription('Year to search (e.g., 2024, 2025, 2026)')
                        .setRequired(false)
                        .setMinValue(2018)
                        .setMaxValue(2030)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('drivers')
                .setDescription('List F1 drivers for the current season')
                .addIntegerOption(option =>
                    option.setName('year')
                        .setDescription('Year to search (e.g., 2024, 2025, 2026)')
                        .setRequired(false)
                        .setMinValue(2018)
                        .setMaxValue(2030))),

    cooldown: 10,

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        const isEphemeral = await shouldBeEphemeral(interaction, {
            commandDefault: false,
        });

        await interaction.deferReply({ flags: isEphemeral ? [MessageFlags.Ephemeral] : [] });

        switch (subcommand) {
            case 'schedule':
                await handleSchedule(interaction);
                break;
            case 'standings':
                await handleStandings(interaction);
                break;
            case 'info':
                await handleInfo(interaction);
                break;
            case 'drivers':
                await handleDrivers(interaction);
                break;
        }
    }
};

async function handleSchedule(interaction) {
    try {
        logger.debug(`Fetching F1 schedule for ${interaction.user.tag}`);
        const races = await getUpcomingRaces();

        if (!races || races.length === 0) {
            return interaction.editReply({
                embeds: [embeds.error('No Races Found', 'Could not find any upcoming or recent F1 races.')]
            });
        }

        const raceFields = races.map(race => ({
            name: `${race.country_name} Grand Prix`,
            value: `📍 ${race.location} (${race.circuit_short_name})\n🏁 ${formatDate(race.date_start, race.gmt_offset)}\n🏟️ ${race.meeting_official_name}`
        }));

        const embed = embeds.brand('F1 Race Schedule', 'Upcoming Formula 1 Grand Prix')
            .addFields(raceFields);

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        await handleCommandError(error, interaction, 'fetching F1 schedule');
    }
}

async function handleStandings(interaction) {
    try {
        logger.debug(`Fetching F1 standings for ${interaction.user.tag}`);
        const standings = await getDriverStandings();

        if (!standings || standings.length === 0) {
            return interaction.editReply({
                embeds: [embeds.error('No Standings', 'Could not find current championship standings.')]
            });
        }

        const positions = standings.map((driver, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
            return `${medal} **${driver.points_current} pts** - ${driver.name_acronym}`;
        });

        const embed = embeds.brand('F1 Driver Championship', 'Current Standings')
            .addFields({ name: 'Driver Standings', value: positions.join('\n') });

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        await handleCommandError(error, interaction, 'fetching F1 standings');
    }
}

async function handleInfo(interaction) {
    try {
        const circuit = interaction.options.getString('circuit');
        const year = interaction.options.getInteger('year') || new Date().getFullYear();
        logger.debug(`Fetching F1 circuit info for ${interaction.user.tag}${circuit ? ` (circuit: ${circuit})` : ''} (year: ${year})`);

        const races = await getAllRaces(year);
        const race = circuit
            ? races.find(r => r.circuit_short_name.toLowerCase().includes(circuit.toLowerCase()) ||
                              r.location.toLowerCase().includes(circuit.toLowerCase()) ||
                              r.country_name.toLowerCase().includes(circuit.toLowerCase()))
            : races[0];

        if (!race) {
            return interaction.editReply({
                embeds: [embeds.error('Circuit Not Found', `Could not find a circuit matching "${circuit || 'any race'}".`)]
            });
        }

        const embed = embeds.brand(`${race.country_name} Grand Prix`, race.meeting_official_name)
            .setThumbnail(race.circuit_image)
            .addFields(
                { name: '📍 Location', value: `${race.location}, ${race.country_name}`, inline: true },
                { name: '🏟️ Circuit', value: race.circuit_short_name, inline: true },
                { name: '🛣️ Type', value: race.circuit_type, inline: true },
                { name: '🏁 Start Date', value: formatDate(race.date_start, race.gmt_offset), inline: true },
                { name: '🏆 End Date', value: formatDate(race.date_end, race.gmt_offset), inline: true },
                { name: '🌐 GMT Offset', value: race.gmt_offset, inline: true }
            );

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        await handleCommandError(error, interaction, 'fetching circuit info');
    }
}

async function handleDrivers(interaction) {
    try {
        let year = interaction.options.getInteger('year') || new Date().getFullYear();
        logger.debug(`Fetching F1 drivers list for ${interaction.user.tag} (year: ${year})`);

        // Try to fetch sessions for the specified year
        let sessions = await fetchWithRetry(`${BASE_URL}/sessions?year=${year}&session_name=Race`);

        // Check if there are any completed races this year
        const hasCompletedRace = sessions.data && sessions.data.some(s => new Date(s.date_end) < new Date());

        // If no completed races and user didn't specify a year, try the previous year
        if (!hasCompletedRace && !interaction.options.getInteger('year')) {
            year -= 1;
            logger.debug(`No completed races in ${year + 1}, trying ${year}`);
            sessions = await fetchWithRetry(`${BASE_URL}/sessions?year=${year}&session_name=Race`);
        }

        if (!sessions.data || sessions.data.length === 0) {
            return interaction.editReply({
                embeds: [embeds.error('No Sessions Found', `Could not find any F1 sessions for ${year}.`)]
            });
        }

        // Get the most recent race session
        const latestRace = sessions.data
            .sort((a, b) => new Date(b.date_end) - new Date(a.date_end))[0];

        // Get drivers from that session
        const drivers = await fetchWithRetry(`${BASE_URL}/drivers?session_key=${latestRace.session_key}`);

        if (!drivers.data || drivers.data.length === 0) {
            return interaction.editReply({
                embeds: [embeds.error('No Drivers Found', 'Could not find any driver data.')]
            });
        }

        // Group drivers by team
        const teams = {};
        drivers.data.forEach(driver => {
            if (!teams[driver.team_name]) {
                teams[driver.team_name] = [];
            }
            teams[driver.team_name].push(driver);
        });

        const teamFields = Object.entries(teams).map(([teamName, teamDrivers]) => {
            const driverList = teamDrivers.map(d => `#${d.driver_number} ${d.name_acronym}`).join(', ');
            return { name: teamName, value: driverList, inline: true };
        });

        const embed = embeds.brand(`F1 Drivers ${year}`, 'Current Season Drivers')
            .addFields(teamFields);

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        await handleCommandError(error, interaction, 'fetching driver list');
    }
}
