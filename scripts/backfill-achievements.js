/**
 * Backfill Achievements Script
 *
 * This script retroactively awards achievements to users based on their
 * historical activity data. Useful when adding new achievements or
 * enabling the achievement system on an existing bot.
 *
 * Usage: node scripts/backfill-achievements.js [guildId] [--dry-run]
 *
 * Examples:
 *   node scripts/backfill-achievements.js                    # Backfill all guilds
 *   node scripts/backfill-achievements.js 123456789          # Specific guild
 *   node scripts/backfill-achievements.js --dry-run          # Test mode (no DB changes)
 *   node scripts/backfill-achievements.js 123456789 --dry-run
 */

const { db } = require('../src/database');
const {
    activityStreaks,
    activityLogs,
    activityAchievements,
    guilds
} = require('../src/database/schema');
const { eq, and, sql, sum } = require('drizzle-orm');

// Parse command line arguments
const args = process.argv.slice(2);
const targetGuildId = args.find(arg => !arg.startsWith('--'));
const dryRun = args.includes('--dry-run');

// Achievement checking logic (simplified versions of service methods)
const MILESTONE_DEFINITIONS = {
    streak: [3, 5, 7, 10, 14, 21, 30, 45, 60, 90, 120, 150, 180, 270, 365, 500, 730, 1000],
    totalDays: [30, 50, 100, 150, 250, 365, 500, 750, 1000, 1500],
    messages: [100, 500, 1000, 5000, 10000, 25000, 50000, 100000],
    voiceHours: [10, 50, 100, 250, 500, 1000, 2500, 5000],
    commands: [50, 250, 500, 1000, 2500, 5000, 10000],
    bytepods: [1, 50, 200]
};

/**
 * Get achievement points by ID
 */
function getAchievementPoints(achievementId) {
    // This is a simplified mapping - in production, query the DB
    if (achievementId.startsWith('streak_')) {
        const value = parseInt(achievementId.split('_')[1]);
        if (value >= 365) return 500;
        if (value >= 90) return 250;
        if (value >= 30) return 100;
        if (value >= 7) return 50;
        return 25;
    }
    if (achievementId.startsWith('total_')) {
        const value = parseInt(achievementId.split('_')[1]);
        if (value >= 1000) return 750;
        if (value >= 365) return 500;
        if (value >= 100) return 250;
        return 100;
    }
    if (achievementId.startsWith('message_')) {
        const value = parseInt(achievementId.split('_')[1]);
        if (value >= 50000) return 500;
        if (value >= 10000) return 250;
        if (value >= 1000) return 100;
        return 50;
    }
    if (achievementId.startsWith('voice_')) {
        const value = parseInt(achievementId.split('_')[1].replace('hrs', ''));
        if (value >= 1000) return 750;
        if (value >= 250) return 500;
        if (value >= 50) return 100;
        return 50;
    }
    if (achievementId.startsWith('command_')) {
        const value = parseInt(achievementId.split('_')[1]);
        if (value >= 5000) return 500;
        if (value >= 1000) return 250;
        return 100;
    }

    // Special achievements
    const specialPoints = {
        'special_first_streak': 10,
        'special_freeze_master': 100,
        'special_comeback_king': 150,
        'special_night_owl': 75,
        'special_early_bird': 75,
        'special_weekend_warrior': 100,
        'special_perfect_week': 200,
        'combo_social_butterfly': 200,
        'combo_voice_chatter': 250,
        'combo_super_active': 300,
        'combo_triple_threat': 400,
        'meta_collector': 100,
        'meta_achievement_hunter': 250,
        'meta_completionist': 1000,
        'social_bytepod_creator': 50,
        'social_bytepod_host': 200,
        'social_bytepod_master': 500
    };

    return specialPoints[achievementId] || 50;
}

/**
 * Check which achievements a user should have based on their stats
 */
async function calculateEarnedAchievements(userId, guildId) {
    const toAward = [];

    try {
        // Get streak data
        const streakData = await db.select()
            .from(activityStreaks)
            .where(and(
                eq(activityStreaks.userId, userId),
                eq(activityStreaks.guildId, guildId)
            ))
            .get();

        if (!streakData) {
            return toAward; // No activity data
        }

        // Get cumulative totals
        const totals = await db.select({
            totalMessages: sum(activityLogs.messageCount),
            totalVoiceMinutes: sum(activityLogs.voiceMinutes),
            totalCommands: sum(activityLogs.commandsRun),
            totalBytepods: sum(activityLogs.bytepodsCreated),
            totalChannelJoins: sum(activityLogs.channelJoins),
            totalReactions: sum(activityLogs.reactionsAdded),
            totalActiveHours: sum(activityLogs.activeHours)
        }).from(activityLogs)
            .where(and(
                eq(activityLogs.userId, userId),
                eq(activityLogs.guildId, guildId)
            ))
            .get();

        // Default to 0 if no data
        const totalMessages = totals?.totalMessages || 0;
        const totalVoiceMinutes = totals?.totalVoiceMinutes || 0;
        const totalCommands = totals?.totalCommands || 0;
        const totalBytepods = totals?.totalBytepods || 0;
        const totalChannelJoins = totals?.totalChannelJoins || 0;
        const totalReactions = totals?.totalReactions || 0;
        const totalActiveHours = totals?.totalActiveHours || 0;

        // 1. Streak Achievements (based on longest streak, not current)
        for (const milestone of MILESTONE_DEFINITIONS.streak) {
            if (streakData.longestStreak >= milestone) {
                toAward.push(`streak_${milestone}`);
            }
        }

        // 2. Total Days Achievements
        for (const milestone of MILESTONE_DEFINITIONS.totalDays) {
            if (streakData.totalActiveDays >= milestone) {
                toAward.push(`total_${milestone}`);
            }
        }

        // 3. Message Achievements
        for (const milestone of MILESTONE_DEFINITIONS.messages) {
            if (totalMessages >= milestone) {
                toAward.push(`message_${milestone}`);
            }
        }

        // 4. Voice Achievements
        const voiceHours = Math.floor(totalVoiceMinutes / 60);
        for (const milestone of MILESTONE_DEFINITIONS.voiceHours) {
            if (voiceHours >= milestone) {
                toAward.push(`voice_${milestone}hrs`);
            }
        }

        // 5. Command Achievements
        for (const milestone of MILESTONE_DEFINITIONS.commands) {
            if (totalCommands >= milestone) {
                toAward.push(`command_${milestone}`);
            }
        }

        // 6. BytePod Achievements
        if (totalBytepods >= 1) toAward.push('social_bytepod_creator');
        if (totalBytepods >= 50) toAward.push('social_bytepod_host');
        if (totalBytepods >= 200) toAward.push('social_bytepod_master');

        // 7. Special Achievements
        if (streakData.currentStreak >= 1 || streakData.longestStreak >= 1) {
            toAward.push('special_first_streak');
        }

        // 8. Combo Achievements
        if (totalMessages >= 1000 && totalChannelJoins >= 25) {
            toAward.push('combo_social_butterfly');
        }
        if (voiceHours >= 100 && totalMessages >= 500) {
            toAward.push('combo_voice_chatter');
        }
        if (streakData.longestStreak >= 30 && totalMessages >= 1000 && voiceHours >= 50) {
            toAward.push('combo_super_active');
        }
        if (totalMessages >= 5000 && voiceHours >= 100 && totalCommands >= 250) {
            toAward.push('combo_triple_threat');
        }

        // 9. Meta Achievements (will calculate after awarding)
        // These need to be checked separately based on achievement count

    } catch (error) {
        console.error(`Error calculating achievements for user ${userId}:`, error);
    }

    return toAward;
}

/**
 * Award achievements to a user (or simulate if dry run)
 */
async function awardAchievements(userId, guildId, achievementIds) {
    const awarded = [];
    const skipped = [];

    for (const achievementId of achievementIds) {
        try {
            // Check if already earned
            const existing = await db.select()
                .from(activityAchievements)
                .where(and(
                    eq(activityAchievements.userId, userId),
                    eq(activityAchievements.guildId, guildId),
                    eq(activityAchievements.achievementId, achievementId)
                ))
                .get();

            if (existing) {
                skipped.push(achievementId);
                continue;
            }

            if (!dryRun) {
                // Actually insert the achievement
                await db.insert(activityAchievements).values({
                    userId,
                    guildId,
                    achievementId,
                    points: getAchievementPoints(achievementId),
                    notified: false,
                    earnedAt: new Date()
                });
            }

            awarded.push(achievementId);

        } catch (error) {
            console.error(`Error awarding ${achievementId}:`, error.message);
        }
    }

    return { awarded, skipped };
}

/**
 * Backfill achievements for a single guild
 */
async function backfillGuild(guildId) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Processing Guild: ${guildId}`);
    console.log('='.repeat(60));

    try {
        // Get all users with activity in this guild
        const users = await db.select({
            userId: activityStreaks.userId
        })
            .from(activityStreaks)
            .where(eq(activityStreaks.guildId, guildId))
            .groupBy(activityStreaks.userId);

        console.log(`Found ${users.length} users with activity data\n`);

        let totalAwarded = 0;
        let totalSkipped = 0;
        let usersProcessed = 0;

        for (const { userId } of users) {
            const earnedAchievements = await calculateEarnedAchievements(userId, guildId);

            if (earnedAchievements.length === 0) {
                continue;
            }

            const { awarded, skipped } = await awardAchievements(userId, guildId, earnedAchievements);

            if (awarded.length > 0) {
                console.log(`  ✅ User ${userId}: ${awarded.length} achievements ${dryRun ? '(would be) ' : ''}awarded, ${skipped.length} already earned`);
                totalAwarded += awarded.length;
                totalSkipped += skipped.length;
                usersProcessed++;
            }
        }

        console.log(`\n📊 Guild Summary:`);
        console.log(`  Users Processed: ${usersProcessed}`);
        console.log(`  ${dryRun ? 'Would Award' : 'Awarded'}: ${totalAwarded}`);
        console.log(`  Already Earned: ${totalSkipped}`);

    } catch (error) {
        console.error(`Error processing guild ${guildId}:`, error);
    }
}

/**
 * Main backfill function
 */
async function backfill() {
    console.log('\n🏆 ACHIEVEMENT BACKFILL SCRIPT');
    console.log('='.repeat(60));

    if (dryRun) {
        console.log('⚠️  DRY RUN MODE - No changes will be made to the database');
    } else {
        console.log('⚡ LIVE MODE - Achievements will be awarded');
    }

    console.log('='.repeat(60));

    try {
        if (targetGuildId) {
            // Single guild
            console.log(`\nTarget: Single guild (${targetGuildId})`);
            await backfillGuild(targetGuildId);
        } else {
            // All guilds
            console.log('\nTarget: All guilds');

            const allGuilds = await db.select({ id: guilds.id }).from(guilds);
            console.log(`Found ${allGuilds.length} guilds in database\n`);

            for (const guild of allGuilds) {
                await backfillGuild(guild.id);
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log('✨ Backfill Complete!');
        console.log('='.repeat(60));

        if (dryRun) {
            console.log('\n💡 Tip: Run without --dry-run to actually award achievements');
        } else {
            console.log('\n✅ Achievements have been awarded to users');
            console.log('💌 Note: Users will NOT receive DM notifications for backfilled achievements');
            console.log('   (notified field is set to false)');
        }

    } catch (error) {
        console.error('\n💥 Fatal error during backfill:', error);
        throw error;
    }
}

// Run the backfill
backfill()
    .then(() => {
        console.log('\n✨ Script completed successfully!\n');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n💥 Script failed:', error);
        process.exit(1);
    });
