const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const logger = require('../../utils/logger');
const { handleCommandError } = require('../../utils/errorHandlerUtil');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('check-achievements')
        .setDescription('Manually trigger achievement check for users (Developer only)')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('Specific user to check (optional - checks all if omitted)')
                .setRequired(false)),

    devOnly: true,
    cooldown: 10,

    async execute(interaction, client) {
        try {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            if (!client.activityStreakService) {
                return interaction.editReply({
                    embeds: [embeds.error('Service Unavailable', 'Activity streak service is not initialized.')]
                });
            }

            const targetUser = interaction.options.getUser('user');

            if (targetUser) {
                // Check single user
                logger.info(`Manually checking achievements for ${targetUser.tag}...`);

                const { db } = require('../../database');
                const { activityStreaks } = require('../../database/schema');
                const { eq, and } = require('drizzle-orm');

                // Verify user has streak data
                const streakData = await db.select()
                    .from(activityStreaks)
                    .where(and(
                        eq(activityStreaks.userId, targetUser.id),
                        eq(activityStreaks.guildId, interaction.guild.id)
                    ))
                    .get();

                if (!streakData) {
                    return interaction.editReply({
                        embeds: [embeds.warn(
                            'No Activity Data',
                            `${targetUser.username} has no activity data in this server yet.`
                        )]
                    });
                }

                // Check achievements
                await client.activityStreakService.checkAllAchievements(targetUser.id, interaction.guild.id);

                const embed = embeds.success(
                    '✅ Achievement Check Complete',
                    `Checked all achievements for ${targetUser.username}`
                );

                embed.addFields(
                    { name: 'User', value: `<@${targetUser.id}>`, inline: true },
                    { name: 'Current Streak', value: `${streakData.currentStreak} days`, inline: true },
                    { name: 'Total Days', value: `${streakData.totalActiveDays} days`, inline: true }
                );

                embed.setFooter({ text: 'Check /streak view to see awarded achievements' });

                await interaction.editReply({ embeds: [embed] });

                logger.success(`Manual achievement check completed for ${targetUser.tag}`);

            } else {
                // Check all users in guild
                logger.info('Manually checking achievements for ALL users...');

                const { db } = require('../../database');
                const { activityStreaks } = require('../../database/schema');
                const { eq } = require('drizzle-orm');

                const allStreaks = await db.select()
                    .from(activityStreaks)
                    .where(eq(activityStreaks.guildId, interaction.guild.id));

                if (allStreaks.length === 0) {
                    return interaction.editReply({
                        embeds: [embeds.warn('No Activity Data', 'No users have activity data in this server yet.')]
                    });
                }

                let checkedCount = 0;
                let errorCount = 0;

                for (const streak of allStreaks) {
                    try {
                        await client.activityStreakService.checkAllAchievements(streak.userId, streak.guildId);
                        checkedCount++;
                    } catch (error) {
                        errorCount++;
                        logger.debug(`Error checking user ${streak.userId}:`, error.message);
                    }
                }

                const embed = embeds.success(
                    '✅ Mass Achievement Check Complete',
                    `Processed achievement checks for all users in ${interaction.guild.name}`
                );

                embed.addFields(
                    { name: 'Users Checked', value: `${checkedCount}`, inline: true },
                    { name: 'Errors', value: `${errorCount}`, inline: true },
                    { name: 'Total Users', value: `${allStreaks.length}`, inline: true }
                );

                embed.setFooter({ text: 'Users will receive DM notifications for newly awarded achievements' });

                await interaction.editReply({ embeds: [embed] });

                logger.success(`Mass achievement check completed: ${checkedCount} users checked, ${errorCount} errors`);
            }

        } catch (error) {
            await handleCommandError(error, interaction, 'checking achievements');
        }
    }
};
