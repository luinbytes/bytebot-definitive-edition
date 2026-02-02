const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const { getRarityEmoji } = require('../../utils/achievementUtils');
const logger = require('../../utils/logger');

// Moved imports from the try block
const { db } = require('../../database');
const { activityAchievements } = require('../../database/schema');
const { eq, and, desc, count } = require('drizzle-orm');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('userinfo')
        .setDescription('Displays information about a user.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user to get info about')),

    async execute(interaction) {
        const user = interaction.options.getUser('target') ?? interaction.user;
        const member = await interaction.guild.members.fetch(user.id);

        const roles = member.roles.cache
            .filter(role => role.name !== '@everyone')
            .sort((a, b) => b.position - a.position)
            .map(role => role)
            .slice(0, 20); // Limit to top 20 roles

        const roleDisplay = roles.length > 0 ? roles.join(', ') + (member.roles.cache.size > 21 ? ` (+${member.roles.cache.size - 21} more)` : '') : 'No roles';

        const embed = embeds.brand(`${user.username}'s Info`, null)
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'ID', value: user.id, inline: true },
                { name: 'Tag', value: user.tag, inline: true },
                { name: 'Bot', value: user.bot ? 'Yes' : 'No', inline: true },
                { name: 'Joined Discord', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
                { name: 'Joined Server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
                { name: 'Roles', value: roleDisplay.length > 1024 ? roleDisplay.substring(0, 1021) + '...' : roleDisplay, inline: false }
            );

        // Load user achievements
        let achievementText = 'None yet';
        let achievementCount = 0;
        let totalPoints = 0;

        try {
            const userAchievements = await db.select()
                .from(activityAchievements)
                .where(and(
                    eq(activityAchievements.userId, user.id),
                    eq(activityAchievements.guildId, interaction.guild.id)
                ))
                .orderBy(desc(activityAchievements.earnedAt))
                .limit(6);

            if (userAchievements.length > 0 && interaction.client.activityStreakService) {
                const achievementManager = interaction.client.activityStreakService.achievementManager;
                await achievementManager.loadDefinitions();

                const achievementLines = [];
                for (const achievement of userAchievements) {
                    const def = achievementManager.achievements.get(achievement.achievementId);
                    if (def) {
                        totalPoints += achievement.points;
                        const rarityEmoji = getRarityEmoji(def.rarity);
                        achievementLines.push(`${def.emoji} ${def.title} ${rarityEmoji}`);
                    }
                }

                if (achievementLines.length > 0) {
                    achievementText = achievementLines.join('\n');

                    // Get total count
                    const countResult = await db.select({ value: count() })
                        .from(activityAchievements)
                        .where(and(
                            eq(activityAchievements.userId, user.id),
                            eq(activityAchievements.guildId, interaction.guild.id)
                        ))
                        .get();

                    achievementCount = countResult?.value || userAchievements.length;

                    if (achievementCount > 6) {
                        achievementText += `\n\n*...and ${achievementCount - 6} more*`;
                    }
                }
            }
        } catch (error) {
            logger.error('Failed to load achievements for userinfo:', error);
        }

        // Add achievement field
        embed.addFields({
            name: `🏅 Achievements (${achievementCount}) • ${totalPoints.toLocaleString()} pts`,
            value: achievementText,
            inline: false
        });

        await interaction.reply({
            embeds: [embed],
            flags: [MessageFlags.Ephemeral]
        });
    },
};

