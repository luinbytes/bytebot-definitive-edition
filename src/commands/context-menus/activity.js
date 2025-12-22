const { ContextMenuCommandBuilder, ApplicationCommandType, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const { db } = require('../../database');
const { users, bytepodVoiceStats } = require('../../database/schema');
const { eq, and } = require('drizzle-orm');

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Activity History')
        .setType(ApplicationCommandType.User)
        .setDMPermission(false), // Guild only

    cooldown: 5,
    longRunning: true, // Database queries

    async execute(interaction, client) {
        const user = interaction.targetUser;
        const member = interaction.targetMember;
        const guild = interaction.guild;

        const embed = embeds.info(
            `Activity History for ${user.tag}`,
            null
        );

        embed.setThumbnail(user.displayAvatarURL({ size: 128 }));

        let hasData = false;

        // Bot stats
        try {
            const userData = await db.select()
                .from(users)
                .where(and(
                    eq(users.id, user.id),
                    eq(users.guildId, guild.id)
                ))
                .get();

            if (userData) {
                const lastSeenTimestamp = Math.floor(new Date(userData.lastSeen).getTime() / 1000);
                embed.addFields({
                    name: '📊 Bot Usage',
                    value: `Commands Run: **${userData.commandsRun}**\nLast Seen: <t:${lastSeenTimestamp}:R>`,
                    inline: false
                });
                hasData = true;
            }
        } catch (error) {
            // Skip if DB query fails
        }

        // Voice stats
        try {
            const voiceStats = await db.select()
                .from(bytepodVoiceStats)
                .where(and(
                    eq(bytepodVoiceStats.userId, user.id),
                    eq(bytepodVoiceStats.guildId, guild.id)
                ))
                .get();

            if (voiceStats && voiceStats.totalSeconds > 0) {
                const hours = Math.floor(voiceStats.totalSeconds / 3600);
                const minutes = Math.floor((voiceStats.totalSeconds % 3600) / 60);

                let timeStr = '';
                if (hours > 0) {
                    timeStr = `**${hours}h ${minutes}m**`;
                } else {
                    timeStr = `**${minutes}m**`;
                }

                embed.addFields({
                    name: '🎙️ Voice Activity (BytePods)',
                    value: `Total Time: ${timeStr}\nSessions: **${voiceStats.sessionCount}**`,
                    inline: false
                });
                hasData = true;
            }
        } catch (error) {
            // Skip if DB query fails
        }

        // Current voice channel
        if (member.voice.channel) {
            const status = [];
            if (member.voice.mute) status.push('Muted');
            if (member.voice.deaf) status.push('Deafened');
            if (member.voice.streaming) status.push('Streaming');

            const statusText = status.length > 0 ? ` (${status.join(', ')})` : '';

            embed.addFields({
                name: '🔊 Currently In Voice',
                value: `${member.voice.channel.toString()}${statusText}`,
                inline: false
            });
            hasData = true;
        }

        // Try to get last message in current channel
        try {
            const messages = await interaction.channel.messages.fetch({ limit: 100 });
            const lastMsg = messages.find(m => m.author.id === user.id);

            if (lastMsg) {
                const timestamp = Math.floor(lastMsg.createdTimestamp / 1000);
                const preview = lastMsg.content.length > 50
                    ? lastMsg.content.substring(0, 47) + '...'
                    : lastMsg.content || '*[No text content]*';

                embed.addFields({
                    name: '💬 Last Message (this channel)',
                    value: `<t:${timestamp}:R> • [Jump](${lastMsg.url})\n> ${preview}`,
                    inline: false
                });
                hasData = true;
            }
        } catch (error) {
            // Ignore if can't fetch messages (missing permissions)
        }

        // If no data found
        if (!hasData) {
            embed.setDescription('No activity data available for this user in this server.');
        }

        return interaction.editReply({
            embeds: [embed],
            flags: [MessageFlags.Ephemeral]
        });
    }
};
