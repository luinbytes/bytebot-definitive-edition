# Achievement System - TODO

## Overview

**Current Progress: 21/33 tasks complete (64%)**

This document tracks the remaining work for ByteBot's achievement system expansion (11→82 achievements).

---

## ✅ Completed (Phases 1-4)

### Phase 1: Database Foundation
- ✅ 4 new tables: `achievementDefinitions`, `achievementRoleConfig`, `achievementRoles`, `customAchievements`
- ✅ Extended `activityLogs` with 7 tracking columns
- ✅ Extended `activityAchievements` with `notified` and `points` columns
- ✅ Added seasonal columns to `achievementDefinitions`
- ✅ Updated `expectedSchema` in `database/index.js`
- ✅ Generated migration with `npm run db:generate`

### Phase 2: Core Logic & Tracking
- ✅ Created `seed-achievements.js` with all 82 core achievements
- ✅ Implemented `AchievementManager` class with 1-hour caching
- ✅ Implemented 6 specialized checking methods (streak, total, cumulative, combo, meta, special)
- ✅ Added 8 new tracking methods to `activityStreakService.js`
- ✅ Integrated tracking in `messageCreate.js` (messages + active hours)
- ✅ Integrated tracking in `voiceStateUpdate.js` (voice + BytePods + channel joins)
- ✅ Integrated tracking in `interactionCreate.js` (commands for both slash + context menus)
- ✅ Enhanced `messageReactionAdd.js` for reaction tracking

### Phase 3: Role Rewards & Admin Tools
- ✅ Implemented dynamic role creation system (`grantAchievementRole`, `getOrCreateAchievementRole`)
- ✅ Implemented orphaned role cleanup with daily scheduler in `ready.js`
- ✅ Created `/achievement` admin command with 4 subcommands (setup/view/cleanup/list_roles)

### Phase 4: User Commands
- ✅ Added `/streak achievements` browser with filters + pagination
- ✅ Added `/streak progress` with visual progress bars
- ✅ Enhanced `/streak leaderboard` with 3 new types (achievement count, points, rarest)
- ✅ Updated `/streak view` to show rarity and points

---

## 🚧 Remaining Work (Phases 3-6)

### Phase 3: Custom Achievements (2 tasks remaining)

#### 1. Multi-Step Modal Achievement Builder
**Status:** Not Started
**Complexity:** High
**Estimated Lines:** ~800

**Implementation Details:**
- **File:** `src/commands/administration/achievement.js` (extend existing)
- **Subcommand:** `/achievement create`

**Flow:**
1. **Step 1 Modal:** Title, Description, Emoji, Points (4 text inputs)
2. **Step 2 Select Menu:** Rarity dropdown (6 options)
3. **Step 2 Buttons:** "Grant Role" or "No Role"
4. **Step 3 Modal:** Type-specific criteria
   - Manual: Skip to confirmation
   - Message: Message count, optional channel filter
   - Voice: Hour count, optional channel filter
   - Event: Custom event trigger

**Builder Cache:**
```javascript
const achievementBuilderCache = new Map(); // userId_guildId -> builder state
// Auto-expire after 5 minutes
```

**Modal Routing in `interactionCreate.js`:**
```javascript
// Add after line 177 (after moderation modals)
if (interaction.isModalSubmit() && interaction.customId.startsWith('achievement_create_')) {
    const achievement = client.commands.get('achievement');
    if (achievement && achievement.handleModal) {
        await achievement.handleModal(interaction, client);
    }
    return;
}

// Add button handler for rarity/role selection
if (interaction.isButton() && interaction.customId.startsWith('achievement_')) {
    // Handle grant_role, no_role buttons
}

if (interaction.isStringSelectMenu() && interaction.customId.startsWith('achievement_')) {
    // Handle rarity selection
}
```

**Database Insert:**
```javascript
await db.insert(customAchievements).values({
    guildId: interaction.guild.id,
    achievementId: `custom_${interaction.guild.id}_${Date.now()}`,
    title, description, emoji, category: 'custom',
    rarity, checkType, criteria: JSON.stringify(criteriaObj),
    grantRole, points,
    createdBy: interaction.user.id,
    enabled: true
});
```

**Testing:**
- Create manual achievement → test awarding
- Create message milestone → test auto-award
- Test cache expiration (wait 5 min)
- Test invalid inputs (empty fields, bad points)

---

#### 2. `/achievement award` Command with Autocomplete
**Status:** Not Started
**Complexity:** Medium
**Estimated Lines:** ~150

**Implementation Details:**
- **File:** `src/commands/administration/achievement.js` (extend existing)
- **Subcommand:** `/achievement award <user> <achievement>`

**Autocomplete Logic:**
```javascript
async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);

    if (focusedOption.name === 'achievement') {
        const { db } = require('../../database');
        const { customAchievements } = require('../../database/schema');
        const { eq, and } = require('drizzle-orm');

        // Load manual custom achievements for this guild
        const achievements = await db.select()
            .from(customAchievements)
            .where(and(
                eq(customAchievements.guildId, interaction.guild.id),
                eq(customAchievements.enabled, true),
                eq(customAchievements.checkType, 'manual')
            ));

        const filtered = achievements
            .filter(a =>
                a.title.toLowerCase().includes(focusedOption.value.toLowerCase()) ||
                a.description.toLowerCase().includes(focusedOption.value.toLowerCase())
            )
            .slice(0, 25); // Discord limit

        await interaction.respond(
            filtered.map(a => ({
                name: `${a.emoji} ${a.title} - ${a.description}`,
                value: a.achievementId
            }))
        );
    }
}
```

**Award Logic:**
```javascript
async function handleAward(interaction) {
    const user = interaction.options.getUser('user');
    const achievementId = interaction.options.getString('achievement');

    // 1. Load custom achievement
    // 2. Check if already earned
    // 3. Insert into activityAchievements
    // 4. Send DM notification
    // 5. Grant role if configured
}
```

**Testing:**
- Test autocomplete with multiple custom achievements
- Test awarding to user (check DB + DM + role)
- Test duplicate prevention
- Test with disabled achievement

---

### Phase 4: UI Integration (1 task remaining)

#### Achievement Showcase in `/userinfo` Context Menu
**Status:** Not Started
**Complexity:** Low
**Estimated Lines:** ~80

**Implementation Details:**
- **File:** `src/commands/context-menus/userinfo.js`
- **Location:** After "Bot Activity" section (around line 96)

**Code to Add:**
```javascript
// Load user achievements
let achievementText = 'None yet';
let achievementCount = 0;
let totalPoints = 0;

try {
    const { db } = require('../../database');
    const { activityAchievements } = require('../../database/schema');
    const { eq, and, desc } = require('drizzle-orm');

    const userAchievements = await db.select()
        .from(activityAchievements)
        .where(and(
            eq(activityAchievements.userId, user.id),
            eq(activityAchievements.guildId, interaction.guild.id)
        ))
        .orderBy(desc(activityAchievements.earnedAt))
        .limit(6);

    if (userAchievements.length > 0) {
        const achievementManager = interaction.client.activityStreakService.achievementManager;
        await achievementManager.loadDefinitions();

        achievementText = userAchievements
            .map(a => {
                const def = achievementManager.achievements.get(a.achievementId);
                if (!def) return null;

                totalPoints += a.points;
                const rarityEmoji = getRarityEmoji(def.rarity); // Import from streak.js or utils
                return `${def.emoji} ${def.title} ${rarityEmoji}`;
            })
            .filter(Boolean)
            .join('\n');

        // Get total count
        const allCount = await db.select({ count: count() })
            .from(activityAchievements)
            .where(and(
                eq(activityAchievements.userId, user.id),
                eq(activityAchievements.guildId, interaction.guild.id)
            ))
            .get();

        achievementCount = allCount.count;

        if (userAchievements.length < achievementCount) {
            achievementText += `\n\n*...and ${achievementCount - userAchievements.length} more*`;
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
```

**Helper Function Needed:**
```javascript
function getRarityEmoji(rarity) {
    return {
        common: '⚪', uncommon: '🟢', rare: '🔵',
        epic: '🟣', legendary: '🟠', mythic: '🔴'
    }[rarity] || '⚪';
}
```

**Testing:**
- View user with 0 achievements
- View user with 6 achievements
- View user with 50+ achievements (test truncation)

---

### Phase 5: Advanced Features (4 tasks remaining)

#### 1. Create `achievementUtils.js` Helper Functions
**Status:** Not Started
**Complexity:** Low
**Estimated Lines:** ~150

**Implementation Details:**
- **File:** `src/utils/achievementUtils.js` (NEW)

**Functions to Implement:**
```javascript
/**
 * Get rarity emoji indicator
 */
function getRarityEmoji(rarity) {
    return {
        common: '⚪', uncommon: '🟢', rare: '🔵',
        epic: '🟣', legendary: '🟠', mythic: '🔴'
    }[rarity] || '⚪';
}

/**
 * Get category badge emoji
 */
function getCategoryBadge(category) {
    return {
        streak: '🔥', total: '📅', message: '💬',
        voice: '🎤', command: '⚙️', special: '⭐',
        social: '👥', combo: '🎯', meta: '🏆', custom: '✨'
    }[category] || '📌';
}

/**
 * Get achievement tier based on count
 */
function getTierBadge(achievementCount) {
    if (achievementCount >= 75) return '💎 Diamond Collector';
    if (achievementCount >= 50) return '🏆 Platinum Hunter';
    if (achievementCount >= 25) return '🥇 Gold Seeker';
    if (achievementCount >= 10) return '🥈 Silver Achiever';
    return '🥉 Bronze Starter';
}

/**
 * Load achievement definitions with caching
 */
async function loadAchievementDefinitions() {
    // Returns Map of id -> achievement definition
}

/**
 * Format relative time for achievement earn dates
 */
function formatRelativeTime(date) {
    const now = Date.now();
    const diff = now - new Date(date).getTime();

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days !== 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    return 'Just now';
}

module.exports = {
    getRarityEmoji,
    getCategoryBadge,
    getTierBadge,
    loadAchievementDefinitions,
    formatRelativeTime
};
```

**Usage:**
- Refactor `streak.js` to use these utilities
- Use in `userinfo.js` achievement showcase
- Use in custom achievement builder

---

#### 2. Seasonal Achievement Checking Logic
**Status:** Not Started
**Complexity:** Medium
**Estimated Lines:** ~300

**Implementation Details:**
- **File:** `src/services/activityStreakService.js` (extend)

**Add Method:**
```javascript
async checkSeasonalAchievements(userId, guildId, activityData) {
    const now = new Date();

    // Get all active seasonal achievements
    const { lte, gte } = require('drizzle-orm');
    const seasonalAchievements = await db.select()
        .from(achievementDefinitions)
        .where(and(
            eq(achievementDefinitions.seasonal, true),
            lte(achievementDefinitions.startDate, now),
            gte(achievementDefinitions.endDate, now)
        ));

    for (const achievement of seasonalAchievements) {
        if (await this.hasAchievement(userId, guildId, achievement.id)) continue;

        const criteria = JSON.parse(achievement.criteria);
        let meetsRequirements = false;

        if (criteria.activeDate) {
            // Must be active on specific date
            const today = now.toISOString().split('T')[0];
            if (today === criteria.activeDate && activityData.messagesToday >= (criteria.minActivity || 1)) {
                meetsRequirements = true;
            }
        } else if (criteria.dateRange) {
            // Must meet requirements during date range
            const rangeActivity = await this.getActivityInDateRange(userId, guildId,
                new Date(criteria.dateRange.start),
                new Date(criteria.dateRange.end)
            );

            if (criteria.minMessages && rangeActivity.messages >= criteria.minMessages) {
                meetsRequirements = true;
            }
            // Check other criteria...
        } else if (criteria.specificDate === 'GUILD_CREATED_ANNIVERSARY') {
            // Guild anniversary logic
            const guild = await this.client.guilds.fetch(guildId);
            const createdDate = guild.createdAt;

            if (createdDate.getMonth() === now.getMonth() &&
                createdDate.getDate() === now.getDate() &&
                activityData.messagesToday >= 1) {
                meetsRequirements = true;
            }
        }

        if (meetsRequirements) {
            await this.awardAchievement(userId, guildId, achievement.id);
        }
    }
}

async getActivityInDateRange(userId, guildId, startDate, endDate) {
    const logs = await db.select()
        .from(activityLogs)
        .where(and(
            eq(activityLogs.userId, userId),
            eq(activityLogs.guildId, guildId),
            gte(activityLogs.activityDate, startDate),
            lte(activityLogs.activityDate, endDate)
        ));

    return {
        messages: logs.reduce((sum, log) => sum + log.messageCount, 0),
        voiceMinutes: logs.reduce((sum, log) => sum + log.voiceMinutes, 0),
        commands: logs.reduce((sum, log) => sum + log.commandsRun, 0)
    };
}
```

**Integration:**
- Call from `checkAndAwardAchievements()` after regular checks
- Add to daily check in `activityStreakService.startDailyCheck()`

---

#### 3. Create `seed-seasonal-events.js`
**Status:** Not Started
**Complexity:** Low
**Estimated Lines:** ~200

**Implementation Details:**
- **File:** `drizzle/seed-seasonal-events.js` (NEW)

**Content:**
```javascript
const { db } = require('../src/database');
const { achievementDefinitions } = require('../src/database/schema');

async function seedSeasonalAchievements(year) {
    const events = [
        {
            id: `valentine_${year}`,
            title: 'Love is in the Air',
            description: 'Spread love during Valentine\'s Day',
            emoji: '💝',
            category: 'special',
            rarity: 'uncommon',
            checkType: 'time-based',
            criteria: JSON.stringify({
                activeDate: `${year}-02-14`,
                minActivity: 10
            }),
            grantRole: false,
            points: 50,
            startDate: new Date(`${year}-02-01`),
            endDate: new Date(`${year}-02-15`),
            seasonal: true,
            seasonalEvent: 'valentine'
        },
        {
            id: `halloween_${year}`,
            title: 'Spooky Season',
            description: 'Get spooky during Halloween',
            emoji: '🎃',
            category: 'special',
            rarity: 'rare',
            checkType: 'time-based',
            criteria: JSON.stringify({
                activeDate: `${year}-10-31`,
                minActivity: 10
            }),
            grantRole: true,
            points: 100,
            startDate: new Date(`${year}-10-01`),
            endDate: new Date(`${year}-11-01`),
            seasonal: true,
            seasonalEvent: 'halloween'
        },
        {
            id: `christmas_${year}`,
            title: 'Holiday Spirit',
            description: 'Celebrate the holidays',
            emoji: '🎄',
            category: 'special',
            rarity: 'epic',
            checkType: 'time-based',
            criteria: JSON.stringify({
                dateRange: {
                    start: `${year}-12-20`,
                    end: `${year}-12-26`
                },
                minMessages: 50
            }),
            grantRole: true,
            points: 250,
            startDate: new Date(`${year}-12-01`),
            endDate: new Date(`${year}-12-31`),
            seasonal: true,
            seasonalEvent: 'christmas'
        },
        {
            id: `new_year_${year + 1}`,
            title: 'New Year Celebration',
            description: 'Ring in the new year',
            emoji: '🎆',
            category: 'special',
            rarity: 'rare',
            checkType: 'time-based',
            criteria: JSON.stringify({
                dateRange: {
                    start: `${year}-12-31T22:00:00Z`,
                    end: `${year + 1}-01-01T04:00:00Z`
                },
                minVoiceMinutes: 30
            }),
            grantRole: true,
            points: 150,
            startDate: new Date(`${year}-12-31`),
            endDate: new Date(`${year + 1}-01-02`),
            seasonal: true,
            seasonalEvent: 'new_year'
        }
    ];

    for (const event of events) {
        // Check if already exists
        const existing = await db.select()
            .from(achievementDefinitions)
            .where(eq(achievementDefinitions.id, event.id))
            .get();

        if (!existing) {
            await db.insert(achievementDefinitions).values(event);
            console.log(`✓ Seeded ${event.title}`);
        } else {
            console.log(`- ${event.title} already exists`);
        }
    }
}

// Run for current year
const currentYear = new Date().getFullYear();
seedSeasonalAchievements(currentYear)
    .then(() => {
        console.log('✓ Seasonal achievement seeding complete');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Seasonal seeding failed:', error);
        process.exit(1);
    });
```

**Usage:**
```bash
node drizzle/seed-seasonal-events.js
```

**Schedule:** Run annually on January 1st

---

#### 4. Create `backfill-achievements.js`
**Status:** Not Started
**Complexity:** Medium
**Estimated Lines:** ~250

**Implementation Details:**
- **File:** `scripts/backfill-achievements.js` (NEW)

**Purpose:** Award achievements retroactively based on existing streak data

**Logic:**
```javascript
const { db } = require('../src/database');
const { activityStreaks, activityAchievements, achievementDefinitions } = require('../src/database/schema');
const { eq, and } = require('drizzle-orm');
const logger = require('../src/utils/logger');

async function backfillAchievements() {
    console.log('Starting achievement backfill...');

    // Load all achievement definitions
    const allDefs = await db.select().from(achievementDefinitions);
    const defMap = new Map(allDefs.map(d => [d.id, d]));

    // Get all users with streak data
    const allStreaks = await db.select().from(activityStreaks);

    let totalAwarded = 0;

    for (const streak of allStreaks) {
        const earnedIds = new Set();

        // Check streak achievements
        const streakMilestones = [3, 5, 7, 10, 14, 21, 30, 45, 60, 90, 120, 150, 180, 270, 365, 500, 730, 1000];
        for (const milestone of streakMilestones) {
            if (streak.longestStreak >= milestone) {
                earnedIds.add(`streak_${milestone}`);
            }
        }

        // Check total days achievements
        const totalMilestones = [30, 50, 100, 150, 250, 365, 500, 750, 1000, 1500];
        for (const milestone of totalMilestones) {
            if (streak.totalActiveDays >= milestone) {
                earnedIds.add(`total_${milestone}`);
            }
        }

        // Bulk insert (skip if already exists)
        for (const achievementId of earnedIds) {
            const def = defMap.get(achievementId);
            if (!def) continue;

            // Check if already earned
            const existing = await db.select()
                .from(activityAchievements)
                .where(and(
                    eq(activityAchievements.userId, streak.userId),
                    eq(activityAchievements.guildId, streak.guildId),
                    eq(activityAchievements.achievementId, achievementId)
                ))
                .get();

            if (!existing) {
                await db.insert(activityAchievements).values({
                    userId: streak.userId,
                    guildId: streak.guildId,
                    achievementId,
                    points: def.points,
                    notified: false, // Don't DM for backfill
                    earnedAt: new Date()
                });

                totalAwarded++;
            }
        }
    }

    console.log(`✓ Backfill complete: ${totalAwarded} achievements awarded`);
}

backfillAchievements()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Backfill failed:', error);
        process.exit(1);
    });
```

**Usage:**
```bash
node scripts/backfill-achievements.js
```

**Run Once:** After initial deployment to award existing users their earned achievements

---

### Phase 6: Testing & Documentation (5 tasks remaining)

#### 1. Test Core Achievement Awarding
**Status:** Not Started
**Complexity:** Medium

**Test Plan:**
- [ ] Manually trigger each achievement category
  - [ ] Streak: Test 3, 7, 30, 365-day milestones
  - [ ] Total: Test 30, 100, 365 total days
  - [ ] Message: Send 100, 500, 1k messages
  - [ ] Voice: Join voice for 10, 50, 100 hours
  - [ ] Command: Run 50, 250, 500 commands
  - [ ] Special: Test perfect_day, night_owl, first_message
  - [ ] Social: Create BytePod, use bookmarks, submit suggestions
  - [ ] Combo: Test balanced_user (1k msg + 100hrs voice + 500 cmd)
  - [ ] Meta: Earn 10, 25, 50 achievements
- [ ] Verify DM notifications sent
- [ ] Check database insertion (points, earnedAt)
- [ ] Verify duplicate prevention

**Test Script Idea:**
```javascript
// scripts/test-achievements.js
// Simulate activity to trigger achievements
```

---

#### 2. Test Role Reward System
**Status:** Not Started
**Complexity:** Medium

**Test Plan:**
- [ ] Earn role-granting achievement (e.g., streak_120)
- [ ] Verify role created with correct:
  - [ ] Name (prefix + title)
  - [ ] Color (rarity-based or brand)
  - [ ] Non-mentionable, non-hoisted
- [ ] Verify role assigned to user
- [ ] Test with bot lacking ManageRoles permission
- [ ] Test role hierarchy issue (bot role below achievement role)
- [ ] Test orphaned cleanup:
  - [ ] Manually delete role from Discord → check DB cleanup
  - [ ] Remove all members from role → check auto-deletion

---

#### 3. Test Custom Achievement Builder
**Status:** Not Started (Depends on implementation)
**Complexity:** High

**Test Plan:**
- [ ] Create manual achievement → test awarding
- [ ] Create message milestone → verify auto-award
- [ ] Create voice milestone → verify auto-award
- [ ] Test all 3 steps of modal flow
- [ ] Test cache expiration (wait 5 min, try to continue)
- [ ] Test validation (empty fields, invalid points)
- [ ] Test autocomplete in `/achievement award`
- [ ] Award custom achievement to user
- [ ] Verify role creation for custom achievement

---

#### 4. Test All Commands
**Status:** Not Started
**Complexity:** Low

**Test Plan:**

**`/streak` commands:**
- [ ] `/streak view` - Self and other user
- [ ] `/streak view` - User with 0 achievements
- [ ] `/streak view` - User with 50+ achievements (test truncation)
- [ ] `/streak leaderboard current` - Top 10
- [ ] `/streak leaderboard longest` - Top 10
- [ ] `/streak leaderboard achievements` - Achievement count
- [ ] `/streak leaderboard points` - Total points
- [ ] `/streak leaderboard rare` - Rarest achievements
- [ ] `/streak achievements` - All filters (category, rarity, earned status)
- [ ] `/streak achievements` - Pagination (prev/next buttons)
- [ ] `/streak progress` - Self and other user

**`/achievement` commands:**
- [ ] `/achievement setup` - All options
- [ ] `/achievement view` - Before and after setup
- [ ] `/achievement cleanup` - Manual trigger
- [ ] `/achievement list_roles` - With 0 roles, with 10+ roles
- [ ] `/achievement create` - (after implementation)
- [ ] `/achievement award` - (after implementation)

---

#### 5. Update CLAUDE.md Documentation
**Status:** Not Started
**Complexity:** Low
**Estimated Lines:** ~350

**Sections to Add:**

```markdown
### Achievement System (2025-12-28)

**Overview:**
- 82 core achievements across 9 categories
- Dynamic role rewards with rarity-based colors
- Automatic activity tracking (messages, voice, commands, reactions)
- Custom achievement builder for server-specific goals

**Database Tables (4 new, 2 extended):**
- `achievement_definitions` - Core + seasonal achievements (82+)
- `achievement_role_config` - Per-guild role reward settings
- `achievement_roles` - Tracks created Discord roles
- `custom_achievements` - Server-created achievements
- `activity_achievements` - User achievement records (extended with points, notified)
- `activity_logs` - Daily tracking (extended with 7 new columns)

**Achievement Categories:**
1. **Streak (18):** 3, 5, 7, 10, 14, 21, 30, 45, 60, 90, 120, 150, 180, 270, 365, 500, 730, 1000 days
2. **Total Days (10):** 30, 50, 100, 150, 250, 365, 500, 750, 1000, 1500 days
3. **Messages (10):** 100, 500, 1k, 5k, 10k, 25k, 50k, 100k + perfect_day, night_owl
4. **Voice (10):** 10hrs, 50, 100, 250, 500, 1k, 2.5k, 5k + marathon, early_bird
5. **Commands (8):** 50, 250, 500, 1k, 2.5k, 5k, 10k + explorer
6. **Special (12):** first_message, first_voice, perfect_week, comeback_kid, etc.
7. **Social (8):** BytePod creator/host/master, bookmark collector, media archivist
8. **Combo (6):** balanced_user, super_active, ultimate_member, etc.
9. **Meta (5):** Achievement count milestones (10, 25, 50, 75, 82)

**Rarity System:**
- Common (⚪), Uncommon (🟢), Rare (🔵), Epic (🟣), Legendary (🟠), Mythic (🔴)
- 39/82 achievements grant Discord roles with rarity-based colors
- Points: Common (3-10), Uncommon (10-25), Rare (25-50), Epic (50-100), Legendary (100-250), Mythic (250-500)

**Commands:**

`/streak` (4 subcommands):
- `view [user]` - View streak, achievements, points (shows rarity + role indicator)
- `leaderboard [type]` - 5 types: current, longest, achievements, points, rare
- `achievements [category] [rarity] [filter]` - Browse all 82 with pagination
- `progress [user]` - Visual progress bars toward next milestones

`/achievement` (6 subcommands, Administrator only):
- `setup` - Configure role rewards (enabled, prefix, colors, cleanup, notifications)
- `view` - Show current configuration
- `cleanup` - Manually trigger orphaned role cleanup
- `list_roles` - View all achievement roles with member counts
- `create` - Custom achievement builder (3-step modals)
- `award <user> <achievement>` - Manually award custom achievement

**Service Architecture:**

**AchievementManager Class:**
- 1-hour caching of definitions
- Category/rarity filtering
- Supports core + custom + seasonal achievements

**Checking Methods (6 types):**
1. `checkStreakAchievements()` - Exact milestone matching
2. `checkTotalDaysAchievements()` - Threshold checks
3. `checkCumulativeAchievements()` - Message/voice/command counts
4. `checkComboAchievements()` - Multiple criteria (AND logic)
5. `checkMetaAchievements()` - Achievement count milestones
6. `checkSeasonalAchievements()` - Time-limited events

**Tracking Methods (8):**
- `recordActivity()` - Generic activity recorder
- `recordReaction()` - Reaction tracking
- `recordChannelJoin()` - Voice channel joins
- `recordBytepodCreation()` - BytePod milestones
- `recordCommandUsage()` - Unique command tracking (JSON array)
- `recordActiveHour()` - Time-of-day tracking (JSON array 0-23)
- `startVoiceSession()` / `endVoiceSession()` - Marathon detection

**Role Reward System:**
- `grantAchievementRole()` - Dynamic role creation + assignment
- `getOrCreateAchievementRole()` - On-demand creation with rarity colors
- `cleanupOrphanedRoles()` - Auto-cleanup (startup + daily)
- Role naming: `{prefix} {achievementTitle}` (e.g., "🏆 Year Warrior")

**Integration Points:**
- `messageCreate.js` - Message + active hour tracking
- `voiceStateUpdate.js` - Voice + BytePod + channel join tracking
- `interactionCreate.js` - Command tracking (slash + context menus)
- `messageReactionAdd.js` - Reaction tracking
- `ready.js` - Daily checks + orphaned role cleanup scheduler

**Files Modified:**
- Core: `activityStreakService.js` (+1200 lines), `schema.js` (+250), `index.js` (+150)
- Commands: `streak.js` (+450 lines), `achievement.js` (NEW, 283 lines)
- Events: `messageCreate.js` (+15), `voiceStateUpdate.js` (+40), `interactionCreate.js` (+25), `messageReactionAdd.js` (+15), `ready.js` (+15)
- Seeds: `seed-achievements.js` (NEW, 1000+ lines)

**Gotchas:**
- `expectedSchema` must be updated when adding columns (auto-migration dependency)
- Role hierarchy: Bot's highest role must be above achievement roles
- DM notifications wrapped in try/catch (users may have DMs disabled)
- Seasonal achievements require annual seeding (`seed-seasonal-events.js`)
- Backfill script should run once after deployment (`backfill-achievements.js`)
- Custom achievements limited to manual award (no auto-checking yet)

**Performance:**
- Achievement definitions cached 1 hour
- Milestone checks batched (exact streak matches, threshold checks)
- Orphaned cleanup runs daily (not per-achievement)
- Database indexes: achievementId, (userId, guildId), guildId

**Testing:**
- See TODO.md Phase 6 for comprehensive test plan
- Run `npm test` for unit tests (TODO: write tests)
- Manual testing required for role creation + DM notifications
```

**Add to Recent Changes:**
```markdown
### 2025-12-28 - Achievement System Expansion
- **EXPANSION:** 11 → 82 achievements across 9 categories
- **NEW:** Dynamic role rewards with rarity-based colors (39 role-granting achievements)
- **NEW:** 4 database tables (achievement_definitions, achievement_role_config, achievement_roles, custom_achievements)
- **NEW:** Extended activity_logs with 7 tracking columns (reactions, channels, BytePods, unique commands, active hours, timestamps)
- **NEW:** AchievementManager class with 1-hour caching
- **NEW:** 6 specialized checking methods (streak, total, cumulative, combo, meta, seasonal)
- **NEW:** 8 tracking methods integrated into 4 Discord events
- **NEW:** Role reward system with automatic cleanup (daily + startup)
- **NEW:** `/streak achievements` browser with filters + pagination
- **NEW:** `/streak progress` with visual progress bars
- **NEW:** Enhanced `/streak leaderboard` with 3 new types (achievement count, points, rarest)
- **NEW:** `/achievement` admin command (setup/view/cleanup/list_roles/create/award)
- **FILES:** activityStreakService.js, schema.js, index.js, streak.js, achievement.js, seed-achievements.js, 6 event handlers
```

---

## Notes

**Priority Order:**
1. Achievement showcase in /userinfo (quick win, completes Phase 4)
2. achievementUtils.js (refactoring, improves code quality)
3. Custom achievement builder + award command (highest complexity, most user value)
4. Seasonal achievements + seeding (nice-to-have, annual maintenance)
5. Testing + documentation (critical before production)

**Estimated Total Time Remaining:** 6-8 hours
- Phase 3 remaining: 3-4 hours
- Phase 4 remaining: 30 min
- Phase 5: 2-3 hours
- Phase 6: 1-2 hours

**Before Deployment:**
1. Run `npm run db:generate` to create migrations
2. Run `node drizzle/seed-achievements.js` to populate core achievements
3. Run `node scripts/backfill-achievements.js` to award existing users
4. Test manually with `/streak view` and `/achievement setup`
5. Update CLAUDE.md
6. Write tests for critical paths

---

## Quick Start Guide (For Future You)

**To resume work:**

1. **Check current progress:**
   ```bash
   git status
   node -e "console.log(require('./src/database/schema.js'))"
   ```

2. **Test what's working:**
   ```bash
   npm start
   # In Discord:
   /streak view
   /streak achievements
   /achievement view
   ```

3. **Pick a task from above and implement**

4. **Update this TODO.md as you complete tasks**

5. **When Phase 6 complete, delete this file**

---

**Last Updated:** 2025-12-28
**Completed By:** Claude Sonnet 4.5
**Original Plan:** `C:\Users\Lu\.claude\plans\delegated-beaming-bumblebee.md`
