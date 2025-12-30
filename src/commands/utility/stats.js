const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');
const { db } = require('../../database');
const { users, moderationLogs, bytepods, bytepodVoiceStats } = require('../../database/schema');
const { eq, sql, desc } = require('drizzle-orm');
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
                        .setRequired(false)))

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

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
            // Command usage (sum of all commandsRun for this guild)
            const commandStats = await db.select({
                totalCommands: sql`SUM(${users.commandsRun})`,
                uniqueUsers: sql`COUNT(DISTINCT ${users.id})`
            }).from(users).where(eq(users.guildId, guild.id)).get();

            const totalCommands = commandStats?.totalCommands || 0;
            const uniqueUsers = commandStats?.uniqueUsers || 0;

            // Moderation actions count
            const modStats = await db.select({
                totalActions: sql`COUNT(*)`
            }).from(moderationLogs).where(eq(moderationLogs.guildId, guild.id)).get();

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
            const embed = embeds.brand(`📊 ${guild.name} Statistics`, 'Comprehensive server analytics and bot activity.')
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
