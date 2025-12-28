/**
 * Seed Seasonal Event Achievements
 *
 * This script seeds seasonal achievements for annual events.
 * Can be run multiple times safely (idempotent).
 *
 * Usage: node scripts/seed-seasonal-events.js
 */

const { db } = require('../src/database');
const { achievementDefinitions } = require('../src/database/schema');
const { eq } = require('drizzle-orm');

/**
 * Seasonal achievement definitions
 * Dates are year-agnostic - they repeat every year
 */
const seasonalAchievements = [
    // Halloween Event (October)
    {
        id: 'seasonal_halloween_2024',
        title: 'Spooky Season',
        description: 'Be active during Halloween month and embrace the spooky vibes!',
        emoji: '🎃',
        category: 'seasonal',
        rarity: 'epic',
        points: 100,
        criteria: JSON.stringify({ type: 'seasonal', activeDays: 7 }),
        grantRole: true,
        seasonal: true,
        seasonalEvent: 'Halloween',
        startDate: '2024-10-01',
        endDate: '2024-10-31',
        createdAt: new Date()
    },
    {
        id: 'seasonal_halloween_master',
        title: 'Halloween Legend',
        description: 'Be active every day during Halloween month. True dedication to the spooky season!',
        emoji: '👻',
        category: 'seasonal',
        rarity: 'legendary',
        points: 250,
        criteria: JSON.stringify({ type: 'seasonal', activeDays: 31 }),
        grantRole: true,
        seasonal: true,
        seasonalEvent: 'Halloween',
        startDate: '2024-10-01',
        endDate: '2024-10-31',
        createdAt: new Date()
    },

    // Winter Holidays (December)
    {
        id: 'seasonal_winter_wonderland',
        title: 'Winter Wonderland',
        description: 'Spread holiday cheer by staying active throughout December!',
        emoji: '❄️',
        category: 'seasonal',
        rarity: 'epic',
        points: 100,
        criteria: JSON.stringify({ type: 'seasonal', activeDays: 10 }),
        grantRole: true,
        seasonal: true,
        seasonalEvent: 'Winter Holidays',
        startDate: '2024-12-01',
        endDate: '2024-12-31',
        createdAt: new Date()
    },
    {
        id: 'seasonal_santa_helper',
        title: 'Santa\'s Helper',
        description: 'Join 10 voice channels during December - spreading joy everywhere!',
        emoji: '🎅',
        category: 'seasonal',
        rarity: 'rare',
        points: 75,
        criteria: JSON.stringify({ type: 'seasonal', channelJoins: 10 }),
        grantRole: true,
        seasonal: true,
        seasonalEvent: 'Winter Holidays',
        startDate: '2024-12-01',
        endDate: '2024-12-31',
        createdAt: new Date()
    },
    {
        id: 'seasonal_gift_giver',
        title: 'Gift Giver',
        description: 'Send 100 messages during the holiday season to spread cheer!',
        emoji: '🎁',
        category: 'seasonal',
        rarity: 'uncommon',
        points: 50,
        criteria: JSON.stringify({ type: 'seasonal', messages: 100 }),
        grantRole: false,
        seasonal: true,
        seasonalEvent: 'Winter Holidays',
        startDate: '2024-12-01',
        endDate: '2024-12-31',
        createdAt: new Date()
    },

    // New Year's Event (Year-spanning: Dec 26 - Jan 5)
    {
        id: 'seasonal_new_year',
        title: 'New Year, New Me',
        description: 'Ring in the new year by being active during the new year celebration!',
        emoji: '🎊',
        category: 'seasonal',
        rarity: 'epic',
        points: 100,
        criteria: JSON.stringify({ type: 'seasonal', activeDays: 5 }),
        grantRole: true,
        seasonal: true,
        seasonalEvent: 'New Year',
        startDate: '2024-12-26',
        endDate: '2025-01-05',
        createdAt: new Date()
    },
    {
        id: 'seasonal_countdown_champion',
        title: 'Countdown Champion',
        description: 'Be active every single day of the new year celebration period!',
        emoji: '🎆',
        category: 'seasonal',
        rarity: 'legendary',
        points: 200,
        criteria: JSON.stringify({ type: 'seasonal', activeDays: 11 }),
        grantRole: true,
        seasonal: true,
        seasonalEvent: 'New Year',
        startDate: '2024-12-26',
        endDate: '2025-01-05',
        createdAt: new Date()
    },

    // Valentine's Day (February 1-14)
    {
        id: 'seasonal_valentine',
        title: 'Spreading Love',
        description: 'Share the love by being active during Valentine\'s season!',
        emoji: '💝',
        category: 'seasonal',
        rarity: 'rare',
        points: 75,
        criteria: JSON.stringify({ type: 'seasonal', activeDays: 7 }),
        grantRole: true,
        seasonal: true,
        seasonalEvent: 'Valentine\'s Day',
        startDate: '2024-02-01',
        endDate: '2024-02-14',
        createdAt: new Date()
    },
    {
        id: 'seasonal_cupid',
        title: 'Cupid\'s Favorite',
        description: 'Use 25 reactions during Valentine\'s season to spread love!',
        emoji: '💘',
        category: 'seasonal',
        rarity: 'uncommon',
        points: 50,
        criteria: JSON.stringify({ type: 'seasonal', reactions: 25 }),
        grantRole: false,
        seasonal: true,
        seasonalEvent: 'Valentine\'s Day',
        startDate: '2024-02-01',
        endDate: '2024-02-14',
        createdAt: new Date()
    },

    // Spring Event (March 20 - April 20)
    {
        id: 'seasonal_spring_bloom',
        title: 'Spring Has Sprung',
        description: 'Welcome spring by staying active as nature awakens!',
        emoji: '🌸',
        category: 'seasonal',
        rarity: 'rare',
        points: 75,
        criteria: JSON.stringify({ type: 'seasonal', activeDays: 15 }),
        grantRole: true,
        seasonal: true,
        seasonalEvent: 'Spring',
        startDate: '2024-03-20',
        endDate: '2024-04-20',
        createdAt: new Date()
    },
    {
        id: 'seasonal_april_showers',
        title: 'April Showers',
        description: 'Be active throughout April to bring May flowers!',
        emoji: '🌧️',
        category: 'seasonal',
        rarity: 'uncommon',
        points: 50,
        criteria: JSON.stringify({ type: 'seasonal', activeDays: 10 }),
        grantRole: false,
        seasonal: true,
        seasonalEvent: 'Spring',
        startDate: '2024-03-20',
        endDate: '2024-04-20',
        createdAt: new Date()
    },

    // Summer Event (June 1 - August 31)
    {
        id: 'seasonal_summer_vibes',
        title: 'Summer Vibes',
        description: 'Enjoy the summer by staying active throughout the sunny season!',
        emoji: '☀️',
        category: 'seasonal',
        rarity: 'epic',
        points: 150,
        criteria: JSON.stringify({ type: 'seasonal', activeDays: 30 }),
        grantRole: true,
        seasonal: true,
        seasonalEvent: 'Summer',
        startDate: '2024-06-01',
        endDate: '2024-08-31',
        createdAt: new Date()
    },
    {
        id: 'seasonal_beach_bum',
        title: 'Beach Bum',
        description: 'Spend 50 hours in voice during summer - chillin\' with the crew!',
        emoji: '🏖️',
        category: 'seasonal',
        rarity: 'rare',
        points: 100,
        criteria: JSON.stringify({ type: 'seasonal', voiceHours: 50 }),
        grantRole: true,
        seasonal: true,
        seasonalEvent: 'Summer',
        startDate: '2024-06-01',
        endDate: '2024-08-31',
        createdAt: new Date()
    },
    {
        id: 'seasonal_endless_summer',
        title: 'Endless Summer',
        description: 'Be active every single day of summer. Ultimate dedication!',
        emoji: '🌊',
        category: 'seasonal',
        rarity: 'mythic',
        points: 500,
        criteria: JSON.stringify({ type: 'seasonal', activeDays: 92 }),
        grantRole: true,
        seasonal: true,
        seasonalEvent: 'Summer',
        startDate: '2024-06-01',
        endDate: '2024-08-31',
        createdAt: new Date()
    },

    // Fall Event (September 1 - November 30)
    {
        id: 'seasonal_autumn_leaves',
        title: 'Autumn Leaves',
        description: 'Watch the leaves fall while staying active throughout autumn!',
        emoji: '🍂',
        category: 'seasonal',
        rarity: 'rare',
        points: 75,
        criteria: JSON.stringify({ type: 'seasonal', activeDays: 20 }),
        grantRole: true,
        seasonal: true,
        seasonalEvent: 'Fall',
        startDate: '2024-09-01',
        endDate: '2024-11-30',
        createdAt: new Date()
    },
    {
        id: 'seasonal_harvest_helper',
        title: 'Harvest Helper',
        description: 'Send 500 messages during the harvest season!',
        emoji: '🎃',
        category: 'seasonal',
        rarity: 'uncommon',
        points: 60,
        criteria: JSON.stringify({ type: 'seasonal', messages: 500 }),
        grantRole: false,
        seasonal: true,
        seasonalEvent: 'Fall',
        startDate: '2024-09-01',
        endDate: '2024-11-30',
        createdAt: new Date()
    }
];

/**
 * Main seeding function
 */
async function seedSeasonalEvents() {
    console.log('🎃 Starting seasonal event achievement seeding...\n');

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const achievement of seasonalAchievements) {
        try {
            // Check if achievement already exists
            const existing = await db.select()
                .from(achievementDefinitions)
                .where(eq(achievementDefinitions.id, achievement.id))
                .get();

            if (existing) {
                // Update existing achievement
                await db.update(achievementDefinitions)
                    .set({
                        title: achievement.title,
                        description: achievement.description,
                        emoji: achievement.emoji,
                        category: achievement.category,
                        rarity: achievement.rarity,
                        points: achievement.points,
                        criteria: achievement.criteria,
                        grantRole: achievement.grantRole,
                        seasonal: achievement.seasonal,
                        seasonalEvent: achievement.seasonalEvent,
                        startDate: achievement.startDate,
                        endDate: achievement.endDate
                    })
                    .where(eq(achievementDefinitions.id, achievement.id));

                console.log(`✅ Updated: ${achievement.emoji} ${achievement.title} (${achievement.seasonalEvent})`);
                updated++;
            } else {
                // Insert new achievement
                await db.insert(achievementDefinitions).values(achievement);
                console.log(`➕ Inserted: ${achievement.emoji} ${achievement.title} (${achievement.seasonalEvent})`);
                inserted++;
            }

        } catch (error) {
            console.error(`❌ Error processing ${achievement.id}:`, error.message);
            skipped++;
        }
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 Seeding Summary:');
    console.log('='.repeat(50));
    console.log(`➕ Inserted: ${inserted}`);
    console.log(`✅ Updated: ${updated}`);
    console.log(`❌ Skipped: ${skipped}`);
    console.log(`📦 Total: ${seasonalAchievements.length}`);
    console.log('='.repeat(50));
    console.log('\n🎉 Seasonal event seeding complete!\n');

    console.log('📅 Seasonal Events Configured:');
    console.log('  🎃 Halloween: Oct 1-31');
    console.log('  ❄️ Winter Holidays: Dec 1-31');
    console.log('  🎊 New Year: Dec 26 - Jan 5');
    console.log('  💝 Valentine\'s Day: Feb 1-14');
    console.log('  🌸 Spring: Mar 20 - Apr 20');
    console.log('  ☀️ Summer: Jun 1 - Aug 31');
    console.log('  🍂 Fall: Sep 1 - Nov 30');
    console.log('');
}

// Run the seeding
seedSeasonalEvents()
    .then(() => {
        console.log('✨ Script completed successfully!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('💥 Fatal error:', error);
        process.exit(1);
    });
