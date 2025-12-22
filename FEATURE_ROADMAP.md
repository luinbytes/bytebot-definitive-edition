# ByteBot Feature Roadmap

**Created:** 2025-12-22
**Status:** Planning Phase
**Priority Features:** 6 core everyday-use enhancements

---

## 📋 Table of Contents

1. [Reminder System](#1-reminder-system)
2. [Starboard](#2-starboard)
3. [Birthday Tracker](#3-birthday-tracker)
4. [User Context Menus](#4-user-context-menus)
5. [Message Bookmarks](#5-message-bookmarks)
6. [Auto-Responder](#6-auto-responder)
7. [Implementation Order](#implementation-order)
8. [Database Migration Strategy](#database-migration-strategy)

---

## 1. Reminder System ⏰

### Overview
Allow users to set personal and channel reminders with full persistence across bot restarts. Supports one-time and recurring reminders with natural time parsing.

### Features
- `/remind me <time> <message>` - DM-based personal reminder
- `/remind here <time> <message>` - Channel-based reminder (requires ManageMessages)
- `/remind list` - View all active reminders with pagination
- `/remind cancel <id>` - Cancel specific reminder
- `/remind cancel-all` - Cancel all your reminders
- Natural time parsing: "10m", "2h", "3d", "next friday 3pm", "in 30 minutes"

### Database Schema
```javascript
// src/database/schema.js
reminders: {
  id: integer (PK, auto-increment),
  userId: text (indexed),
  guildId: text (indexed),
  channelId: text (nullable - null for DMs),
  message: text (max 1000 chars),
  triggerAt: integer (timestamp in ms),
  createdAt: integer (timestamp in ms),
  recurring: text (nullable - "daily", "weekly", "monthly"),
  active: integer (boolean - 1 = active, 0 = fired/cancelled)
}

// Indexes needed:
- (userId, active) - for /remind list
- (triggerAt, active) - for scheduler queries
- (guildId, active) - for guild-specific cleanup
```

### Implementation Steps

#### Phase 1: Database & Core Logic
1. **Add schema to `src/database/schema.js`**
   - Define `reminders` table with all fields
   - Add to `expectedSchema` in `database/index.js` for auto-validation

2. **Create reminder scheduler service** - `src/services/reminderService.js`
   ```javascript
   class ReminderService {
     constructor(client) {
       this.client = client;
       this.activeTimers = new Map(); // In-memory timeout tracking
     }

     // Load all pending reminders on startup
     async loadReminders() {
       // Query DB for active reminders where triggerAt > now
       // Schedule each with setTimeout
       // Handle overdue reminders (triggerAt < now)
     }

     // Schedule a new reminder
     async scheduleReminder(reminderData) {
       // Insert to DB
       // Calculate delay (triggerAt - Date.now())
       // If delay > 2147483647 (max setTimeout), use interval checking
       // Store timeout ID in activeTimers Map
     }

     // Fire reminder
     async fireReminder(reminderId) {
       // Fetch from DB
       // Send DM or channel message
       // If recurring: calculate next triggerAt, update DB
       // Else: mark active=0
       // Remove from activeTimers
     }

     // Cancel reminder
     async cancelReminder(reminderId, userId) {
       // Verify ownership
       // Clear timeout from activeTimers
       // Mark active=0 in DB
     }
   }
   ```

3. **Create time parser utility** - `src/utils/timeParser.js`
   ```javascript
   // Parse natural language time inputs
   // "10m" -> 600000ms
   // "2h 30m" -> 9000000ms
   // "next friday" -> calculate timestamp
   // Return { success: boolean, timestamp: number, error: string }
   ```

#### Phase 2: Commands
4. **Create `/remind` command** - `src/commands/utility/remind.js`
   - Subcommands: `me`, `here`, `list`, `cancel`, `cancel-all`
   - Use autocomplete for `cancel` to show user's active reminders
   - Validate time is in future (max 1 year ahead)
   - Channel reminders require ManageMessages permission
   - Set `longRunning: true` for DB operations

5. **Add reminder service to client** - `src/index.js`
   ```javascript
   const ReminderService = require('./services/reminderService');
   client.reminderService = new ReminderService(client);
   await client.reminderService.loadReminders(); // After login
   ```

#### Phase 3: Edge Cases & UX
6. **Handle edge cases:**
   - Max reminders per user (e.g., 25 active reminders)
   - Deleted channels (catch error, DM user instead)
   - Deleted guilds (auto-cancel on guildDelete event)
   - Bot offline during trigger time (fire immediately on startup if <5min overdue)

7. **Branded embeds:**
   - Confirmation: "✅ Reminder set for <t:timestamp:R> (<t:timestamp:F>)"
   - Reminder message: "⏰ **Reminder** • Set <t:created:R>\n\n{message}"
   - List view: Paginated embed with jump links

### Files to Create
- `src/services/reminderService.js` (~200 lines)
- `src/utils/timeParser.js` (~100 lines)
- `src/commands/utility/remind.js` (~300 lines)

### Files to Modify
- `src/database/schema.js` - Add reminders table
- `src/database/index.js` - Add to expectedSchema
- `src/index.js` - Initialize ReminderService
- `src/events/guildDelete.js` - Cancel guild reminders on leave
- `CLAUDE.md` - Document new system

### Technical Considerations
- **setTimeout limits:** Max delay is ~24.8 days. For longer reminders, use interval-based checking.
- **Memory usage:** Store only timeout IDs in memory, not full reminder data.
- **Timezone handling:** Store all times as UTC timestamps, display with Discord's `<t:timestamp>` formatting.
- **Concurrency:** Use DB transactions for recurring reminder updates.

### Complexity: ⭐⭐⭐ (Medium-High)
- Database: Simple
- Logic: Moderate (scheduler, time parsing)
- Edge cases: Many (deleted resources, restarts, long delays)

---

## 2. Starboard ⭐

### Overview
Automatically highlight popular messages in a dedicated channel when they receive enough star reactions (⭐). Tracks leaderboards and prevents abuse.

### Features
- `/starboard setup <channel> [threshold] [emoji]` - Configure starboard (default: 5 stars, ⭐)
- `/starboard disable` - Turn off starboard
- `/starboard stats` - View top starred messages
- `/starboard leaderboard` - Users with most starred messages
- Auto-posts to starboard when threshold reached
- Updates star count if more reactions added
- Prevents self-starring
- Removes from starboard if stars drop below threshold

### Database Schema
```javascript
// src/database/schema.js
starboardConfig: {
  guildId: text (PK),
  channelId: text,
  threshold: integer (default: 5),
  emoji: text (default: "⭐"),
  enabled: integer (boolean)
}

starboardMessages: {
  id: integer (PK, auto-increment),
  guildId: text (indexed),
  originalMessageId: text (unique indexed),
  originalChannelId: text,
  starboardMessageId: text (nullable),
  authorId: text (indexed - for leaderboards),
  starCount: integer,
  content: text (cached for deleted messages),
  imageUrl: text (nullable - first attachment),
  postedAt: integer (timestamp)
}

// Indexes:
- (guildId, starCount DESC) - leaderboard queries
- (authorId, guildId) - user stats
```

### Implementation Steps

#### Phase 1: Database & Event Handling
1. **Add schemas to `src/database/schema.js`**
   - Define both tables
   - Add to expectedSchema

2. **Create starboard service** - `src/services/starboardService.js`
   ```javascript
   class StarboardService {
     // Check if message qualifies for starboard
     async checkMessage(message, reaction) {
       // Fetch config for guild
       // Count valid stars (exclude author self-star)
       // If >= threshold and not yet posted: post to starboard
       // If already posted: update star count
       // If < threshold and posted: remove from starboard
     }

     // Create starboard embed
     createStarboardEmbed(message, starCount) {
       // Show: author, content, image, jump link, star count
       // Format: "⭐ **{count}** | #{channel}"
     }
   }
   ```

3. **Create event handler** - `src/events/messageReactionAdd.js`
   ```javascript
   module.exports = {
     name: Events.MessageReactionAdd,
     async execute(reaction, user, client) {
       // Handle partial reactions (fetch if needed)
       // Check if emoji matches starboard config
       // Call starboardService.checkMessage()
     }
   };
   ```

4. **Create event handler** - `src/events/messageReactionRemove.js`
   - Mirror logic of Add, but handle count decrease
   - Remove from starboard if below threshold

#### Phase 2: Commands
5. **Create `/starboard` command** - `src/commands/administration/starboard.js`
   - Subcommands: `setup`, `disable`, `stats`, `leaderboard`
   - Require Administrator permission
   - Setup validates channel exists and bot has permissions
   - Stats shows top 10 starred messages (pagination)
   - Leaderboard shows top 10 users by total stars received

#### Phase 3: Edge Cases
6. **Handle edge cases:**
   - Original message deleted → Keep cached content in starboard
   - Starboard channel deleted → Disable system, DM guild owner
   - Reaction removed by non-author → Recount stars
   - Mass reaction purge → Recount all stars
   - NSFW messages → Only post to NSFW starboard channels

### Files to Create
- `src/services/starboardService.js` (~150 lines)
- `src/events/messageReactionAdd.js` (~60 lines)
- `src/events/messageReactionRemove.js` (~50 lines)
- `src/commands/administration/starboard.js` (~250 lines)

### Files to Modify
- `src/database/schema.js` - Add 2 tables
- `src/database/index.js` - Add to expectedSchema
- `src/index.js` - Add MessageReaction intents
- `CLAUDE.md` - Document system

### Technical Considerations
- **Partial Reactions:** Old messages may be partial, use `reaction.fetch()` if needed
- **Self-starring:** Always filter out reactions from message author
- **Caching:** Store message content to handle deleted messages
- **Rate limiting:** Star count updates should be debounced (max 1 update per 5 seconds)
- **Intent required:** `GatewayIntentBits.GuildMessageReactions`

### Complexity: ⭐⭐⭐ (Medium-High)
- Database: Simple
- Logic: Moderate (reaction counting, threshold checks)
- Events: New (need to add reaction events)

---

## 3. Birthday Tracker 🎂

### Overview
Track member birthdays and automatically celebrate them in a designated channel. Privacy-focused (no year required).

### Features
- `/birthday set <MM-DD>` - Register birthday (no year for privacy)
- `/birthday remove` - Delete your birthday
- `/birthday view [@user]` - Check someone's birthday (if set)
- `/birthday upcoming [days]` - Next X days (default: 7)
- `/birthday setup <channel>` - Configure announcement channel (Admin)
- `/birthday role <role>` - Auto-assign "Birthday" role for 24h (Admin, optional)
- Daily check at midnight (server time or UTC)
- Auto-posts birthday message with mentions

### Database Schema
```javascript
// src/database/schema.js
birthdays: {
  id: integer (PK, auto-increment),
  userId: text,
  guildId: text,
  month: integer (1-12),
  day: integer (1-31),
  createdAt: integer (timestamp),
  // Composite unique: (userId, guildId)
}

birthdayConfig: {
  guildId: text (PK),
  channelId: text,
  roleId: text (nullable - optional birthday role),
  enabled: integer (boolean),
  lastCheck: integer (timestamp - tracks last midnight check)
}

// Indexes:
- (guildId, month, day) - daily birthday queries
- (userId, guildId) - user lookups
```

### Implementation Steps

#### Phase 1: Database & Scheduler
1. **Add schemas to `src/database/schema.js`**
   - Define both tables
   - Add to expectedSchema

2. **Create birthday service** - `src/services/birthdayService.js`
   ```javascript
   class BirthdayService {
     constructor(client) {
       this.client = client;
       this.checkInterval = null;
     }

     // Start daily midnight checker
     startDailyCheck() {
       // Calculate ms until next midnight UTC
       // Set interval to check every 24 hours
       // On each check: call checkBirthdays()
     }

     // Check all guilds for today's birthdays
     async checkBirthdays() {
       const today = new Date();
       const month = today.getMonth() + 1;
       const day = today.getDate();

       // Query all guilds with enabled=1
       // For each guild: query birthdays matching month/day
       // Post announcement, assign role if configured
       // Update lastCheck timestamp
     }

     // Get upcoming birthdays
     async getUpcoming(guildId, days = 7) {
       // Query next 7 days of birthdays
       // Return sorted list
     }
   }
   ```

3. **Add service to client** - `src/index.js`
   ```javascript
   client.birthdayService = new BirthdayService(client);
   client.birthdayService.startDailyCheck(); // After login
   ```

#### Phase 2: Commands
4. **Create `/birthday` command** - `src/commands/utility/birthday.js`
   - Subcommands: `set`, `remove`, `view`, `upcoming`, `setup`, `role`
   - Validate date format (MM-DD, handle leap years)
   - Setup/role require Administrator permission
   - Set cooldown: 5 seconds (prevent spam)

#### Phase 3: Birthday Announcements
5. **Design birthday embed:**
   ```javascript
   // src/components/birthdayEmbed.js
   function getBirthdayEmbed(users) {
     // Title: "🎂 Happy Birthday! 🎉"
     // Description: List of users with mentions
     // Random birthday message flavor text
     // Purple branded embed
   }
   ```

6. **Role management:**
   - Assign birthday role when announced
   - Remove role after 24 hours (track in memory or DB)
   - Handle role deleted/missing gracefully

#### Phase 4: Edge Cases
7. **Handle edge cases:**
   - Invalid dates (e.g., Feb 30) → Error message
   - Leap year birthdays (Feb 29) → Celebrate on Feb 28 in non-leap years
   - User left guild → Keep birthday data (rejoin case)
   - Channel deleted → Disable system, notify owner
   - Bot offline at midnight → Check on startup if missed

### Files to Create
- `src/services/birthdayService.js` (~200 lines)
- `src/commands/utility/birthday.js` (~300 lines)
- `src/components/birthdayEmbed.js` (~50 lines)

### Files to Modify
- `src/database/schema.js` - Add 2 tables
- `src/database/index.js` - Add to expectedSchema
- `src/index.js` - Initialize BirthdayService
- `CLAUDE.md` - Document system

### Technical Considerations
- **Timezone:** Use UTC midnight to avoid timezone complexity (guilds can set their preference in future)
- **Leap years:** Feb 29 → celebrate on Feb 28 in non-leap years
- **Role assignment:** Track role assignment timestamps to auto-remove after 24h
- **Missed checks:** On startup, check if lastCheck < yesterday midnight → run check
- **Privacy:** Never show age or year, only month/day

### Complexity: ⭐⭐ (Medium)
- Database: Simple
- Logic: Moderate (date handling, scheduling)
- Edge cases: Moderate (deleted channels, leap years)

---

## 4. User Context Menus 👤

### Overview
Right-click context menu actions for users. Provides quick access to user information and utilities without typing commands. Leverages Discord's Application Commands (User context menus).

### Expanded Feature Set
1. **View Avatar** - Show full-resolution avatar with download link
2. **User Info** - Quick whois (join date, roles, account age)
3. **Copy User ID** - Copy to clipboard (useful for developers/mods)
4. **Check Permissions** - Show user's permissions in current channel
5. **Activity History** - Recent activity (last message, voice sessions, commands run)
6. **Moderation Quick Actions** - Warn/kick/ban shortcuts (Admin only)

### Database Schema
No new tables needed! Uses existing:
- `users` table (commandsRun, lastSeen)
- `bytepodVoiceStats` (voice activity)
- `moderationLogs` (mod history)

### Implementation Steps

#### Phase 1: Context Menu Commands
1. **Create user context menu: Avatar** - `src/commands/context-menus/avatar.js`
   ```javascript
   const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');

   module.exports = {
     data: new ContextMenuCommandBuilder()
       .setName('View Avatar')
       .setType(ApplicationCommandType.User),

     async execute(interaction) {
       const user = interaction.targetUser;
       const avatarURL = user.displayAvatarURL({ size: 4096, dynamic: true });

       // Embed with avatar image, download links (PNG, JPG, WebP)
       // Include server avatar if different from user avatar
     }
   };
   ```

2. **Create user context menu: User Info** - `src/commands/context-menus/userinfo.js`
   ```javascript
   // Same structure as avatar.js
   // Show: Account created, joined server, roles, nickname, badges
   // Query users table for commandsRun, lastSeen
   // Show bot/system status
   ```

3. **Create user context menu: Copy ID** - `src/commands/context-menus/copyid.js`
   ```javascript
   // Ephemeral reply with user ID in code block
   // Easy to copy for mobile users
   ```

4. **Create user context menu: Permissions** - `src/commands/context-menus/permissions.js`
   ```javascript
   // Show channel-specific permissions
   // Highlight Administrator, dangerous perms (BanMembers, ManageGuild)
   // Compare to role permissions
   ```

5. **Create user context menu: Activity** - `src/commands/context-menus/activity.js`
   ```javascript
   // Query users table for lastSeen, commandsRun
   // Query bytepodVoiceStats for voice time
   // Show last message in current channel (if accessible)
   // Show current voice channel if connected
   ```

6. **Create user context menu: Mod Actions** - `src/commands/context-menus/modactions.js`
   ```javascript
   // Require ManageMessages or higher
   // Show buttons: Warn, Kick, Ban, View History
   // Each button opens modal for reason input
   // Links to existing moderation command logic
   ```

#### Phase 2: Registration
7. **Update command handler** - `src/handlers/commandHandler.js`
   ```javascript
   // Add globbing for context-menus folder
   // Register USER and MESSAGE context commands separately
   // Store in client.contextMenus Collection
   ```

8. **Update interaction handler** - `src/events/interactionCreate.js`
   ```javascript
   // Add handler for context menu interactions
   if (interaction.isUserContextMenuCommand()) {
     const command = client.contextMenus.get(interaction.commandName);
     // Same security pipeline as slash commands
   }
   ```

#### Phase 3: Message Context Menus
9. **Create message context menu: Bookmark** - `src/commands/context-menus/bookmark.js`
   ```javascript
   // Right-click message → Apps → "Bookmark Message"
   // See Message Bookmarks section below
   ```

10. **Create message context menu: Translate** - `src/commands/context-menus/translate.js`
    ```javascript
    // Optional: Translate message to English using free API
    // Show original + translated in ephemeral embed
    ```

11. **Create message context menu: Report** - `src/commands/context-menus/report.js`
    ```javascript
    // Send message to mod log channel
    // Include reporter, message content, jump link
    // Ephemeral confirmation
    ```

### Files to Create
- `src/commands/context-menus/avatar.js` (~80 lines)
- `src/commands/context-menus/userinfo.js` (~120 lines)
- `src/commands/context-menus/copyid.js` (~30 lines)
- `src/commands/context-menus/permissions.js` (~100 lines)
- `src/commands/context-menus/activity.js` (~120 lines)
- `src/commands/context-menus/modactions.js` (~150 lines)
- `src/commands/context-menus/bookmark.js` (~60 lines) - see Bookmarks section
- `src/commands/context-menus/translate.js` (~80 lines) - OPTIONAL
- `src/commands/context-menus/report.js` (~70 lines) - OPTIONAL

### Files to Modify
- `src/handlers/commandHandler.js` - Add context menu globbing and registration
- `src/events/interactionCreate.js` - Add context menu interaction handler
- `CLAUDE.md` - Document context menus

### Technical Considerations
- **Command type:** Use `ApplicationCommandType.User` or `ApplicationCommandType.Message`
- **Naming:** Context menu names appear in UI, use Title Case (e.g., "View Avatar")
- **Ephemeral:** Most context actions should be ephemeral to reduce clutter
- **Permissions:** Respect same RBAC system as slash commands
- **Registration:** Must register separately from slash commands

### Complexity: ⭐⭐ (Medium)
- Database: None (uses existing)
- Logic: Simple (mostly display data)
- Registration: New pattern (context menus)

---

## 5. Message Bookmarks 🔖

### Overview
Save important messages for later reference. Accessible via both slash command and message context menu. DMs user with saved message content and jump link.

### Features
- Right-click message → Apps → "Bookmark Message"
- `/bookmark save <message_id>` - Bookmark by ID (for mobile users)
- `/bookmark list [page]` - View all bookmarks with pagination
- `/bookmark delete <id>` - Remove bookmark
- `/bookmark clear` - Delete all bookmarks (confirmation required)
- `/bookmark search <query>` - Search bookmarked messages by content
- Auto-cleanup deleted messages (mark as deleted, keep metadata)

### Database Schema
```javascript
// src/database/schema.js
bookmarks: {
  id: integer (PK, auto-increment),
  userId: text (indexed),
  guildId: text,
  channelId: text,
  messageId: text,
  content: text (cached message content),
  authorId: text (original message author),
  attachmentUrls: text (JSON array - image/file URLs),
  savedAt: integer (timestamp),
  messageDeleted: integer (boolean - 1 if original deleted)
}

// Indexes:
- (userId, savedAt DESC) - list/pagination
- (userId, content) - search queries (FTS if needed)
```

### Implementation Steps

#### Phase 1: Database & Core Logic
1. **Add schema to `src/database/schema.js`**
   - Define bookmarks table
   - Add to expectedSchema

2. **Create bookmark utility** - `src/utils/bookmarkUtil.js`
   ```javascript
   class BookmarkUtil {
     // Save bookmark
     async saveBookmark(userId, message) {
       // Check if already bookmarked (unique on messageId + userId)
       // Cache content, author, attachments
       // Insert to DB
       // Return bookmark ID
     }

     // Get user's bookmarks
     async getBookmarks(userId, page = 1, limit = 10) {
       // Query with offset/limit
       // Return paginated results
     }

     // Search bookmarks
     async searchBookmarks(userId, query) {
       // LIKE query on content field
       // Return matching bookmarks
     }

     // Delete bookmark
     async deleteBookmark(bookmarkId, userId) {
       // Verify ownership
       // Delete from DB
     }
   }
   ```

#### Phase 2: Message Context Menu
3. **Create message context menu** - `src/commands/context-menus/bookmark.js`
   ```javascript
   const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');

   module.exports = {
     data: new ContextMenuCommandBuilder()
       .setName('Bookmark Message')
       .setType(ApplicationCommandType.Message),

     async execute(interaction) {
       const message = interaction.targetMessage;

       // Call bookmarkUtil.saveBookmark()
       // DM user with confirmation embed
       // Include message content, author, jump link
       // Ephemeral reply in guild
     }
   };
   ```

#### Phase 3: Slash Commands
4. **Create `/bookmark` command** - `src/commands/utility/bookmark.js`
   - Subcommands: `save`, `list`, `delete`, `clear`, `search`
   - `save` requires message ID (validate format, must be in same guild)
   - `list` uses pagination with buttons (Previous/Next)
   - `delete` uses autocomplete to show user's bookmarks
   - `clear` requires confirmation button
   - `search` shows results with relevance scoring

#### Phase 4: Maintenance
5. **Create cleanup task** - `src/services/bookmarkService.js`
   ```javascript
   class BookmarkService {
     // Periodically check if bookmarked messages still exist
     async cleanupDeletedMessages() {
       // Query bookmarks where messageDeleted = 0
       // For each: try to fetch message
       // If 404: mark messageDeleted = 1
       // Run weekly via interval
     }
   }
   ```

6. **Handle message deletions** - `src/events/messageDelete.js`
   ```javascript
   // Check if message is bookmarked
   // If yes: mark messageDeleted = 1 in DB
   // Keep cached content for user reference
   ```

#### Phase 5: Edge Cases
7. **Handle edge cases:**
   - Bookmarking own messages → Allow (useful for reminders)
   - Bookmarking bot messages → Allow
   - Max bookmarks per user → 100 (configurable)
   - Channel/Guild deleted → Keep bookmark, mark as deleted
   - DM failed → Show ephemeral error, still save bookmark

### Files to Create
- `src/utils/bookmarkUtil.js` (~150 lines)
- `src/services/bookmarkService.js` (~80 lines)
- `src/commands/context-menus/bookmark.js` (~70 lines)
- `src/commands/utility/bookmark.js` (~350 lines)

### Files to Modify
- `src/database/schema.js` - Add bookmarks table
- `src/database/index.js` - Add to expectedSchema
- `src/events/messageDelete.js` - Create or modify to mark deleted bookmarks
- `src/index.js` - Initialize BookmarkService (optional cleanup)
- `CLAUDE.md` - Document system

### Technical Considerations
- **Message caching:** Always cache content/attachments in case message is deleted
- **Attachment URLs:** Discord CDN links may expire, note this in bookmark display
- **DM delivery:** User may have DMs disabled, show error and keep bookmark
- **Pagination:** Use Discord buttons for Previous/Next (store page in customId)
- **Search:** Simple LIKE query for MVP, can upgrade to FTS (Full-Text Search) later
- **Intent required:** `GatewayIntentBits.GuildMessages` (already enabled)

### Complexity: ⭐⭐ (Medium)
- Database: Simple
- Logic: Simple (CRUD operations)
- UX: Moderate (pagination, search)

---

## 6. Auto-Responder 🤖

### Overview
Automated keyword-based responses for common questions. Reduces support load by answering FAQs automatically. Admin-configurable per channel or guild-wide.

### Features
- `/autorespond add <trigger> <response> [channel]` - Add auto-response
- `/autorespond remove <id>` - Delete auto-response
- `/autorespond list` - View all active auto-responses
- `/autorespond toggle <id>` - Enable/disable without deleting
- `/autorespond edit <id> <new_response>` - Update response
- Supports wildcards: `*help*` matches "I need help"
- Supports variables: `{user}` → mention, `{server}` → guild name
- Per-channel or guild-wide responses
- Cooldown system (don't spam same response)
- Case-insensitive matching
- Role restrictions (only respond to certain roles)

### Database Schema
```javascript
// src/database/schema.js
autoResponses: {
  id: integer (PK, auto-increment),
  guildId: text (indexed),
  trigger: text (keyword or wildcard pattern),
  response: text (max 2000 chars),
  channelId: text (nullable - null = guild-wide),
  creatorId: text,
  enabled: integer (boolean),
  cooldown: integer (seconds, default: 60),
  matchType: text ("exact", "contains", "wildcard", "regex"),
  requireRoleId: text (nullable - only respond if user has role),
  useCount: integer (default: 0 - analytics),
  createdAt: integer (timestamp),
  lastUsed: integer (timestamp, nullable)
}

autoResponseCooldowns: {
  // In-memory Map is fine, but DB option for persistence:
  responseId: integer,
  channelId: text,
  lastTriggered: integer (timestamp)
  // Composite PK: (responseId, channelId)
}

// Indexes:
- (guildId, enabled) - active responses lookup
- (guildId, channelId, enabled) - channel-specific
```

### Implementation Steps

#### Phase 1: Database & Message Handler
1. **Add schema to `src/database/schema.js`**
   - Define autoResponses table
   - Add to expectedSchema

2. **Create auto-responder service** - `src/services/autoResponderService.js`
   ```javascript
   class AutoResponderService {
     constructor() {
       this.cooldowns = new Map(); // (responseId + channelId) -> timestamp
     }

     // Check message for triggers
     async checkMessage(message) {
       // Ignore bots
       // Query active responses for guild
       // For each response:
       //   - Check channel restriction
       //   - Check role restriction
       //   - Check cooldown
       //   - Match trigger against message content
       //   - If match: send response, update cooldown
     }

     // Match trigger
     matchesTrigger(content, trigger, matchType) {
       switch (matchType) {
         case 'exact': return content.toLowerCase() === trigger.toLowerCase();
         case 'contains': return content.toLowerCase().includes(trigger.toLowerCase());
         case 'wildcard': // Use minimatch or simple * replacement
         case 'regex': // Use RegExp (careful with user input!)
       }
     }

     // Parse response variables
     parseResponse(response, message) {
       return response
         .replace(/{user}/g, `<@${message.author.id}>`)
         .replace(/{server}/g, message.guild.name)
         .replace(/{channel}/g, `<#${message.channel.id}>`);
     }
   }
   ```

3. **Create/modify message event** - `src/events/messageCreate.js`
   ```javascript
   module.exports = {
     name: Events.MessageCreate,
     async execute(message, client) {
       if (message.author.bot) return;
       if (!message.guild) return; // DMs not supported

       await client.autoResponderService.checkMessage(message);
     }
   };
   ```

#### Phase 2: Commands
4. **Create `/autorespond` command** - `src/commands/administration/autorespond.js`
   - Subcommands: `add`, `remove`, `list`, `toggle`, `edit`
   - Require ManageGuild permission
   - `add` validates trigger length (max 100 chars), response length (max 2000)
   - `list` shows paginated table with ID, trigger, channel, status
   - `remove` uses autocomplete to show active responses
   - `toggle` enables/disables without deleting
   - `edit` updates response text only

5. **Add autocomplete** - In `autorespond.js`
   ```javascript
   async autocomplete(interaction) {
     const focusedOption = interaction.options.getFocused(true);

     if (focusedOption.name === 'id') {
       // Query guild's auto-responses
       // Return array of { name: "trigger", value: id }
     }
   }
   ```

#### Phase 3: Advanced Features
6. **Add match type selector:**
   - `add` command gets `match_type` option: exact/contains/wildcard/regex
   - Default to "contains" for ease of use
   - Regex requires devOnly or special permission (security risk)

7. **Add role restrictions:**
   - Optional `required_role` parameter in `add`
   - Only triggers if message author has role
   - Useful for member-only responses

#### Phase 4: Edge Cases
8. **Handle edge cases:**
   - Multiple triggers match → Use first match only (priority system in future)
   - Response triggers another response → Ignore bot messages
   - Cooldown bypass for admins → Optional setting
   - Max responses per guild → 50 (prevent abuse)
   - Channel deleted → Keep response, show "Any Channel" in list

### Files to Create
- `src/services/autoResponderService.js` (~200 lines)
- `src/events/messageCreate.js` (~40 lines)
- `src/commands/administration/autorespond.js` (~400 lines)

### Files to Modify
- `src/database/schema.js` - Add autoResponses table
- `src/database/index.js` - Add to expectedSchema
- `src/index.js` - Initialize AutoResponderService
- `CLAUDE.md` - Document system

### Technical Considerations
- **Regex safety:** User-provided regex can cause ReDoS attacks. Validate or restrict to admins.
- **Performance:** For guilds with many responses, cache active responses per guild
- **Cooldowns:** Use in-memory Map (faster than DB). Clear on restart (acceptable).
- **Variables:** Support common variables, document in help text
- **Case sensitivity:** Default to case-insensitive for better UX
- **Order of operations:** Check cooldown BEFORE matching (performance)
- **Intent required:** `GatewayIntentBits.GuildMessages` + `MessageContent` (already enabled)

### Complexity: ⭐⭐⭐ (Medium-High)
- Database: Simple
- Logic: Moderate (pattern matching, cooldowns)
- Edge cases: Many (regex safety, multiple matches, spam prevention)

---

## Implementation Order 🚀

### Recommended Priority (Easiest → Hardest)

1. **Birthday Tracker** (⭐⭐ Medium)
   - Simple database, straightforward logic
   - Low edge case complexity
   - High user delight factor
   - Estimated time: 4-6 hours

2. **Message Bookmarks** (⭐⭐ Medium)
   - Simple CRUD operations
   - Introduces context menus (useful pattern)
   - Minimal edge cases
   - Estimated time: 4-6 hours

3. **User Context Menus** (⭐⭐ Medium)
   - No new database tables
   - Reuses existing data
   - Enhances UX significantly
   - Estimated time: 6-8 hours (6 menus)

4. **Auto-Responder** (⭐⭐⭐ Medium-High)
   - Moderate complexity (pattern matching)
   - New event handler (messageCreate)
   - Requires careful security considerations
   - Estimated time: 6-8 hours

5. **Starboard** (⭐⭐⭐ Medium-High)
   - New event handlers (reactions)
   - Requires new intents
   - Moderate edge case complexity
   - Estimated time: 6-8 hours

6. **Reminder System** (⭐⭐⭐ Medium-High)
   - Most complex (scheduler, persistence, time parsing)
   - Many edge cases (long delays, timezones)
   - High utility payoff
   - Estimated time: 8-10 hours

**Total estimated time:** 34-46 hours (1-2 weeks of focused development)

---

## Database Migration Strategy 📊

### Migration Plan
All new tables will be added via the existing auto-schema validation system in `database/index.js`.

#### Step-by-Step Process
1. **For each feature:**
   - Add table definition to `src/database/schema.js`
   - Add table/columns to `expectedSchema` object in `src/database/index.js`
   - Run bot → `validateAndFixSchema()` auto-creates table
   - No manual migration needed!

2. **Schema additions:**
   ```javascript
   // Total new tables: 8
   // Total new columns: ~50

   reminders (9 columns)
   starboardConfig (5 columns)
   starboardMessages (8 columns)
   birthdays (5 columns)
   birthdayConfig (5 columns)
   bookmarks (9 columns)
   autoResponses (13 columns)
   ```

3. **Index creation:**
   - Add indexes in schema definitions
   - Use Drizzle's `index()` helper
   - Auto-applied on table creation

### Backward Compatibility
- No changes to existing tables
- No breaking changes to existing commands
- All new features are additive

---

## Testing Strategy 🧪

### For Each Feature
1. **Unit tests** - `tests/features/{feature}.test.js`
   - Database CRUD operations
   - Time parsing (reminders)
   - Pattern matching (auto-responder)

2. **Integration tests**
   - Command execution
   - Event handling
   - Service interaction

3. **Manual testing checklist**
   - Happy path (normal usage)
   - Edge cases (deleted resources, permissions)
   - Error handling (invalid inputs)
   - Performance (large datasets)

### Test Coverage Goals
- Services: 80%+ coverage
- Commands: 70%+ coverage
- Utils: 90%+ coverage

---

## Documentation Updates 📝

### Files to Update
1. **CLAUDE.md** - For each feature:
   - Add to "Recent Changes" section
   - Update "Command Categories" section
   - Add to "Database Layer" schema list
   - Document new patterns/gotchas

2. **README.md** - User-facing updates:
   - Add features to feature list
   - Update command examples
   - Add setup instructions

3. **Inline JSDoc** - All new files:
   - Document function parameters
   - Add usage examples
   - Note edge cases

---

## Security Considerations 🔒

### Permission Checks
- All admin commands require proper permissions
- Auto-responder regex restricted (ReDoS risk)
- Context menus respect RBAC system
- Bookmark privacy (users can't see others' bookmarks)

### Rate Limiting
- Auto-responder cooldowns (prevent spam)
- Reminder creation limits (25 per user)
- Bookmark limits (100 per user)
- Birthday announcements (once per day per user)

### Data Privacy
- Birthdays: No year stored
- Bookmarks: Private to user
- Reminders: Auto-delete after firing
- Auto-responses: Admin-only creation

---

## Performance Optimizations ⚡

### Caching Strategy
- Auto-responder: Cache active responses per guild
- Reminders: In-memory timeout tracking
- Starboard: Debounce star count updates (5s)
- Birthdays: Check once per day, not on every message

### Database Indexes
- All foreign keys indexed
- Query patterns analyzed and optimized
- Compound indexes for common queries
- EXPLAIN QUERY PLAN for slow queries

### Memory Management
- Reminder timeouts: Store IDs only, not data
- Auto-responder cooldowns: LRU cache (max 1000 entries)
- Starboard: Cache last update time per message
- Bookmarks: Paginated queries (never load all)

---

## Future Enhancements 🔮

### Phase 2 Features (Post-MVP)
1. **Reminder recurring patterns** - "every monday at 9am"
2. **Starboard multi-emoji** - Support custom emojis
3. **Birthday timezone support** - Per-guild timezone
4. **Bookmark folders/tags** - Organize bookmarks
5. **Auto-responder priority** - Order multiple matches
6. **Reminder timezone parsing** - "3pm EST"

### Integration Opportunities
- Reminders → Calendar sync (Google Calendar API)
- Birthdays → Role-based birthday perks
- Starboard → Monthly highlights digest
- Bookmarks → Export to Notion/Markdown
- Auto-responder → AI-powered responses (OpenAI API)

---

## Success Metrics 📈

### Track These Metrics
- **Reminders:** Total created, fired, recurring usage
- **Starboard:** Messages starred, top starred messages
- **Birthdays:** Opt-in rate, announcement engagement
- **Bookmarks:** Total saved, searches performed
- **Auto-responder:** Trigger count, response effectiveness
- **Context menus:** Usage per menu type

### Analytics Dashboard (Future)
- `/stats bot` command showing:
  - Feature usage breakdown
  - Most popular commands
  - User engagement trends
  - Performance metrics

---

## Rollout Plan 🎯

### Development Phases

#### Phase 1: Foundation (Week 1)
- ✅ Planning complete (this document)
- ⬜ Set up testing infrastructure
- ⬜ Implement Birthday Tracker (simplest, high impact)
- ⬜ Implement Message Bookmarks (introduces context menus)
- ⬜ Test thoroughly, gather feedback

#### Phase 2: Core Features (Week 2)
- ⬜ Implement User Context Menus (6 menus)
- ⬜ Implement Auto-Responder
- ⬜ Test integration with existing systems
- ⬜ Update documentation

#### Phase 3: Advanced Features (Week 3)
- ⬜ Implement Starboard (new events/intents)
- ⬜ Implement Reminder System (most complex)
- ⬜ Performance testing
- ⬜ Final documentation updates

#### Phase 4: Production (Week 4)
- ⬜ Code review all changes
- ⬜ Run full test suite
- ⬜ Deploy to production
- ⬜ Monitor for issues
- ⬜ Gather user feedback

---

## Questions & Decisions Needed ❓

### Before Implementation
- [ ] Should auto-responder support regex? (Security vs flexibility)
- [ ] Birthday timezone: UTC only or per-guild setting?
- [ ] Reminder max duration: 1 year? Unlimited?
- [ ] Starboard: Support multiple emojis or single only?
- [ ] Context menus: Which ones are highest priority?
- [ ] Bookmark max limit: 100 or 500 per user?

### Design Decisions
- [ ] Auto-responder UI: Slash command or web dashboard?
- [ ] Reminder notifications: DM, channel, or both?
- [ ] Starboard: Show original message or full content?
- [ ] Birthday privacy: Allow hiding birthday from `/birthday view`?

---

## Notes & References 📚

### Useful Links
- [Discord.js Context Menus](https://discordjs.guide/interactions/context-menus.html)
- [Discord.js Reactions](https://discordjs.guide/popular-topics/reactions.html)
- [Cron Patterns](https://crontab.guru/) - For future recurring reminders
- [Drizzle Indexes](https://orm.drizzle.team/docs/indexes-constraints)

### Code Patterns to Follow
- Always use `embeds.js` for responses (branding)
- Set `longRunning: true` for DB-heavy commands
- Use autocomplete for ID-based deletions
- Defer interactions before async operations
- Handle partial fetches (reactions, messages)

---

**End of Roadmap** • Last Updated: 2025-12-22
