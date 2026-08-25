const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');
const { db } = require('../../database');
const { activityLogs, moderationCases, bytepods, bytepodVoiceStats, serverDailyMetrics } = require('../../database/schema');
const { and, asc, desc, eq, gte, sql } = require('drizzle-orm');
const embeds = require('../../utils/embeds');
const { shouldBeEphemeral } = require('../../utils/ephemeralHelper');

// Helper to format seconds into human-readable time
function formatDuration(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

    return parts.join(' ');
}

module.exports = {
    register: false,
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View server and bot statistics.')
        .addSubcommand(sub =>
            sub.setName('server')
                .setDescription('View comprehensive server statistics.')
                .addBooleanOption(option =>
                    option
                        .setName('private')
                        .setDescription('Make response visible only to you')
                        .setRequired(false))
                .addIntegerOption(option => option
                    .setName('days')
                    .setDescription('Analytics range in days')
                    .setMinValue(1)
                    .setMaxValue(1095))),

    async execute(interaction) {
        const subcommand = interaction.commandName === 'analytics'
            ? 'server'
            : interaction.options.getSubcommand();

        if (subcommand === 'server') {
            // Manual defer with ephemeral control
            const isEphemeral = await shouldBeEphemeral(interaction, {
                commandDefault: false, // Server stats default to public
                userOverride: interaction.options.getBoolean('private')
            });

            await interaction.deferReply({
                flags: isEphemeral ? [MessageFlags.Ephemeral] : []
            });

            const guild = interaction.guild;
            const days = interaction.options.getInteger('days') || 60;
            if (!Number.isInteger(days) || days < 1 || days > 1095) throw new Error('Analytics range must be between 1 and 1095 days.');
            const metric = interaction.options.getString?.('metric') || 'all';
            if (!['all', 'messages', 'reactions', 'voice', 'membership'].includes(metric)) throw new Error('Unknown analytics metric.');
            const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);

            // --- Gather Discord Data ---
            const totalMembers = guild.memberCount;
            const textChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText).size;
            const voiceChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size;
            const categories = guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory).size;
            const roles = guild.roles.cache.size - 1; // Exclude @everyone
            const emojis = guild.emojis.cache.size;
            const boostLevel = guild.premiumTier;
            const boostCount = guild.premiumSubscriptionCount || 0;

            // Verification levels
            const verificationLevels = ['None', 'Low', 'Medium', 'High', 'Very High'];
            const verificationLevel = verificationLevels[guild.verificationLevel] || 'Unknown';

            // --- Gather Database Stats ---
            // Command usage from per-guild daily activity logs
            const commandStats = await db.select({
                totalCommands: sql`SUM(${activityLogs.commandsRun})`,
                uniqueUsers: sql`COUNT(DISTINCT ${activityLogs.userId})`
            }).from(activityLogs).where(eq(activityLogs.guildId, guild.id)).get();

            const totalCommands = commandStats?.totalCommands || 0;
            const uniqueUsers = commandStats?.uniqueUsers || 0;
            const rangeStats = await db.select({
                messages: sql`COALESCE(SUM(${serverDailyMetrics.messageCount}), 0)`,
                reactions: sql`COALESCE(SUM(${serverDailyMetrics.reactionCount}), 0)`,
                voiceSeconds: sql`COALESCE(SUM(${serverDailyMetrics.voiceSeconds}), 0)`,
                joins: sql`COALESCE(SUM(${serverDailyMetrics.joins}), 0)`,
                leaves: sql`COALESCE(SUM(${serverDailyMetrics.leaves}), 0)`
            }).from(serverDailyMetrics).where(and(
                eq(serverDailyMetrics.guildId, guild.id),
                gte(serverDailyMetrics.activityDate, since)
            )).get();
            const daily = await db.select().from(serverDailyMetrics).where(and(
                eq(serverDailyMetrics.guildId, guild.id), gte(serverDailyMetrics.activityDate, since)
            )).orderBy(asc(serverDailyMetrics.activityDate));
            const commandRange = await db.select({
                commands: sql`COALESCE(SUM(${activityLogs.commandsRun}), 0)`
            }).from(activityLogs).where(and(eq(activityLogs.guildId, guild.id), gte(activityLogs.activityDate, since))).get();
            const activityCoverage = await db.select({ firstDate: sql`MIN(${serverDailyMetrics.activityDate})` })
                .from(serverDailyMetrics).where(eq(serverDailyMetrics.guildId, guild.id)).get();
            const baselineCoverage = await db.select({ baselineAt: sql`MIN(${serverDailyMetrics.baselineAt})` })
                .from(serverDailyMetrics).where(eq(serverDailyMetrics.guildId, guild.id)).get();
            const coverage = !activityCoverage?.firstDate ? ' · no stored activity'
                : activityCoverage.firstDate > since ? ` · stored since ${activityCoverage.firstDate}` : '';
            const latestSnapshot = [...daily].reverse().find(row => row.memberCount != null)?.memberCount;
            const metricValue = row => ({
                messages: row.messageCount,
                reactions: row.reactionCount,
                voice: Math.floor(row.voiceSeconds / 60),
                membership: row.joins - row.leaves,
                all: row.messageCount + row.reactionCount + Math.floor(row.voiceSeconds / 60)
            })[metric];
            const trend = daily.slice(-14).map(row => `${row.activityDate}: ${metricValue(row).toLocaleString()}`).join('\n') || 'No stored activity in this range.';

            // Moderation actions count
            const modStats = await db.select({
                totalActions: sql`COUNT(*)`
            }).from(moderationCases).where(eq(moderationCases.guildId, guild.id)).get();

            const totalModActions = modStats?.totalActions || 0;

            // Active BytePods
            const activePods = await db.select({
                count: sql`COUNT(*)`
            }).from(bytepods).where(eq(bytepods.guildId, guild.id)).get();

            const activePodCount = activePods?.count || 0;

            // Top 3 voice users
            const topVoice = await db.select().from(bytepodVoiceStats)
                .where(eq(bytepodVoiceStats.guildId, guild.id))
                .orderBy(desc(bytepodVoiceStats.totalSeconds))
                .limit(3);

            let topVoiceText = 'No voice activity yet';
            if (topVoice.length > 0) {
                const medals = ['🥇', '🥈', '🥉'];
                const lines = [];
                for (let i = 0; i < topVoice.length; i++) {
                    const stat = topVoice[i];
                    const user = await interaction.client.users.fetch(stat.userId).catch(() => null);
                    const username = user ? user.username : 'Unknown';
                    lines.push(`${medals[i]} ${username} — ${formatDuration(stat.totalSeconds)}`);
                }
                topVoiceText = lines.join('\n');
            }

            // --- Build Embed ---
            const embed = embeds.brand(`📊 ${guild.name} Statistics`, `${days}-day persisted server analytics · ${metric}`)
                .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }))
                .addFields(
                    // Row 1: Members & Channels
                    { name: 'Members', value: `${totalMembers.toLocaleString()}`, inline: true },
                    { name: 'Text Channels', value: `${textChannels}`, inline: true },
                    { name: 'Voice Channels', value: `${voiceChannels}`, inline: true },

                    // Row 2: Structure
                    { name: 'Categories', value: `${categories}`, inline: true },
                    { name: 'Roles', value: `${roles}`, inline: true },
                    { name: 'Emojis', value: `${emojis}`, inline: true },

                    // Row 3: Security & Boost
                    { name: 'Verification Level', value: verificationLevel, inline: true },
                    { name: 'Boost Level', value: `Tier ${boostLevel} (${boostCount} boosts)`, inline: true },
                    { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },

                    // Row 4: Bot Activity
                    { name: 'Commands Run', value: `${totalCommands.toLocaleString()} (${uniqueUsers} users)`, inline: true },
                    { name: 'Mod Actions', value: `${totalModActions}`, inline: true },
                    { name: 'Active BytePods', value: `${activePodCount}`, inline: true },

                    ...(metric === 'all' || metric === 'messages' ? [{ name: 'Messages', value: Number(rangeStats?.messages || 0).toLocaleString(), inline: true }] : []),
                    ...(metric === 'all' || metric === 'reactions' ? [{ name: 'Reactions', value: Number(rangeStats?.reactions || 0).toLocaleString(), inline: true }] : []),
                    ...(metric === 'all' || metric === 'voice' ? [{ name: 'Voice', value: `${Math.floor(Number(rangeStats?.voiceSeconds || 0) / 60).toLocaleString()} minutes`, inline: true }] : []),
                    ...(metric === 'all' || metric === 'membership' ? [{
                        name: 'Membership',
                        value: baselineCoverage?.baselineAt == null
                            ? 'History unavailable before the first reliable baseline.'
                            : `${new Date(Number(baselineCoverage.baselineAt)).toISOString().slice(0, 10) > since ? `History unavailable before ${new Date(Number(baselineCoverage.baselineAt)).toISOString().slice(0, 10)} · ` : ''}${Number(rangeStats.joins).toLocaleString()} joins · ${Number(rangeStats.leaves).toLocaleString()} leaves · ${Number(rangeStats.joins - rangeStats.leaves).toLocaleString()} net · ${Number(latestSnapshot ?? totalMembers).toLocaleString()} latest`,
                        inline: false
                    }] : []),
                    { name: `Last ${days} Days${coverage}`, value: `${Number(commandRange?.commands || 0).toLocaleString()} commands`, inline: false },
                    { name: `Daily ${metric} trend`, value: trend.slice(0, 1024), inline: false },

                    // Row 5: Voice Leaderboard
                    { name: 'Top Voice Users', value: topVoiceText, inline: false }
                );

            // Add server owner
            const owner = await guild.fetchOwner().catch(() => null);
            if (owner) {
                embed.addFields({ name: 'Owner', value: `${owner.user.tag}`, inline: true });
            }

            return interaction.editReply({ embeds: [embed] });
        }
    }
};
