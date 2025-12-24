# ByteBot - Claude Agent Knowledge Base

**IMPORTANT: This file contains critical architectural knowledge about ByteBot. You MUST update this file whenever you make significant changes to the codebase. Add updates under the "Recent Changes" section with dates, and update relevant sections as needed.**

---

## Project Overview

ByteBot is a modular, production-ready Discord bot built with Discord.js v14, featuring:
- **Neon Purple Branding** (#8A2BE2) enforced via centralized embeds utility
- **Slash Commands** with automatic registration and categorization
- **Role-Based Access Control (RBAC)** with database-backed permission overrides
- **BytePods** - Ephemeral "join-to-create" voice channels with rich interactive controls
- **SQLite + Drizzle ORM** for persistence
- **Comprehensive Security Pipeline** with multi-layer validation
- **War Thunder Integration** for player stats via ThunderInsights API

**Tech Stack:**
- discord.js v14.25.1
- drizzle-orm v0.45.1 + better-sqlite3
- axios for HTTP requests
- chalk for colored logging
- glob for dynamic file loading
- Jest for testing

---

## Architecture Map

### Entry Point (src/index.js)
**Lines 1-42** - Bootstrap sequence:
1. Create Discord Client with intents: Guilds, GuildMessages, MessageContent, GuildVoiceStates
2. Initialize `client.commands` and `client.cooldowns` Collections
3. Set up global error handlers (unhandledRejection, uncaughtException)
4. Run database migrations
5. Load event and command handlers
6. Login to Discord

### Database Layer (src/database/)

**schema.js** - 16 tables:
```javascript
guilds: {
  id, prefix, logChannel, welcomeChannel, joinedAt,
  voiceHubChannelId, voiceHubCategoryId  // BytePod configuration
}

users: {
  id, guildId, commandsRun, lastSeen,
  wtNickname  // War Thunder account binding
}

moderationLogs: {
  id, guildId, targetId, executorId, action, reason, timestamp
  // Actions: BAN, KICK, CLEAR, WARN
}

commandPermissions: {
  id, guildId, commandName, roleId
  // RBAC overrides - if exists, user MUST have one of these roles
}

bytepods: {
  channelId (PK), guildId, ownerId, originalOwnerId, ownerLeftAt, reclaimRequestPending, createdAt
  // Tracks active ephemeral voice channels
  // originalOwnerId: Who created the pod (for reclaim eligibility)
  // ownerLeftAt: Timestamp when owner left (null if present)
  // reclaimRequestPending: Prevents duplicate reclaim prompts
}

bytepodAutoWhitelist: {
  id, userId, targetUserId, guildId
  // User presets for auto-allowing specific users
}

bytepodUserSettings: {
  userId (PK), autoLock (boolean)
  // Per-user BytePod preferences
}

bytepodActiveSessions: {
  id, podId, userId, guildId, startTime (ms)
  // Tracks active voice sessions for restart resilience
}

bytepodVoiceStats: {
  id, userId, guildId, totalSeconds, sessionCount
  // Aggregate voice activity stats per user per guild
}

bytepodTemplates: {
  id, userId, name, userLimit, autoLock, whitelistUserIds (JSON)
  // Saved BytePod configuration templates
}

birthdays: {
  id, userId, guildId, month (1-12), day (1-31), createdAt
  // Per-user, per-guild birthday storage (privacy-focused, no year)
  // Composite unique constraint on (userId, guildId)
  // Indexes: (guildId, month, day) for daily checks, (userId, guildId) for lookups
}

birthdayConfig: {
  guildId (PK), channelId, roleId, enabled, lastCheck
  // Per-guild birthday celebration configuration
}

bookmarks: {
  id, userId, guildId, channelId, messageId, content, authorId, attachmentUrls, savedAt, messageDeleted
  // Personal message bookmarks with content caching
  // Indexes: (userId, savedAt) for pagination, (userId, content) for search
  // 100 bookmark limit per user enforced in bookmarkUtil
}

autoResponses: {
  id, guildId, trigger, response, channelId, creatorId, enabled, cooldown, matchType, requireRoleId, useCount, createdAt, lastUsed
  // Keyword-based automated responses
  // matchType: exact, contains, wildcard, regex (regex dev-only)
  // channelId: null = guild-wide
  // requireRoleId: null = any user
  // Indexes: (guildId, enabled), (guildId, channelId)
  // 50 response limit per guild, 5-min cache, in-memory cooldowns
}

suggestionConfig: {
  guildId (PK), channelId, reviewRoleId, enabled, allowAnonymous
  // Per-guild suggestion system configuration
  // reviewRoleId: null = Admin only
}

suggestions: {
  id, guildId, userId, content, messageId, channelId, status, upvotes, downvotes, reviewedBy, reviewedAt, reviewReason, createdAt, anonymous
  // Community suggestions/feedback system
  // status: pending, approved, denied, implemented
  // Votes cached from message reactions
  // Indexes: (guildId, status), (userId, guildId), (guildId, upvotes)
}
```

**index.js** - Database initialization:
- Initializes better-sqlite3 connection to `sqlite.db`
- Wraps with Drizzle ORM for type-safe queries
- `runMigrations()` applies schema changes:
  1. First runs `validateAndFixSchema()` to check/add missing tables/columns
  2. Then runs Drizzle migrations (won't crash if schema already fixed)
- **Auto-Schema Validation:** `expectedSchema` object defines all tables/columns - kept in sync with schema.js

### Handlers (src/handlers/)

**commandHandler.js** (lines 7-48):
1. Globs `src/commands/**/*.js`
2. Validates each command has `data` and `execute`
3. Extracts category from folder name (e.g., "utility" from `src/commands/utility/ping.js`)
4. Stores in `client.commands` Collection
5. Registers slash commands to Discord (currently guild-specific, line 40)

**eventHandler.js** (lines 6-23):
1. Globs `src/events/**/*.js`
2. Binds events to client using `client.once()` or `client.on()` based on `event.once` property

---

## Critical Systems

### 1. Command Security Pipeline (src/events/interactionCreate.js)

**Execution order (lines 49-174):**
```
1. DM Validation (lines 61-69)
   → Checks data.dm_permission !== false

2. Bot Permission Check (lines 72-85)
   → Verifies bot has SendMessages + EmbedLinks in channel

3. Developer-Only Gate (lines 88-93)
   → If command.devOnly, user ID must be in config.developers

4. RBAC Permission System (lines 96-106)
   → Calls checkUserPermissions() from utils/permissions.js
   → DB overrides take precedence over code permissions

5. Cooldown System (lines 109-129)
   → Per-command, per-user rate limiting (default 3s)

6. Database Tracking (lines 134-149)
   → Increments commandsRun, updates lastSeen

7. Auto-Defer (lines 154-157)
   → If command.longRunning = true, calls interaction.deferReply()

8. Execute (lines 160-173)
   → Wrapped in try/catch with automatic error embeds
```

**Key Insight:** This pipeline is the ONLY entry point for slash commands. All security must happen here.

### 2. BytePod System (src/events/voiceStateUpdate.js)

**What are BytePods?**
Ephemeral voice channels that auto-create when a user joins a designated "hub" channel, then auto-delete when empty.

**Join Hub Flow (lines 29-112):**
```
User joins hub channel
  → Fetch guildData.voiceHubChannelId from DB
    → checkBotPermissions() - ManageChannels, MoveMembers, Connect
      → If missing: Kick user, DM user + guild owner with error
    → Fetch user's autoLock setting
      → Create voice channel: "{username}'s Pod"
        → Permission overwrites:
          - @everyone: ViewChannel=true, Connect=depends on autoLock
          - Owner: Connect + ManageChannels + MoveMembers
        → Apply auto-whitelist presets from bytepodAutoWhitelist table
          → Move user to new channel
            → Insert to bytepods table
              → Send control panel message (bytepodControls.getControlPanel)
```

**Leave Pod Flow (lines 114-136):**
```
User leaves channel
  → Check if channel is in bytepods table
    → If channel.members.size === 0:
      → Delete channel
      → Delete from bytepods table
      → Handle edge case: If channel already deleted (error 10003), cleanup DB
    → If OWNER leaves but others remain:
      → Set ownerLeftAt timestamp
      → Schedule 5-minute timeout
      → After timeout: Transfer ownership to first remaining member
```

**Ownership Transfer System:**
```
Owner leaves (others remain):
  → pendingOwnershipTransfers Map tracks timeout
  → After 5 min: Pick first member as new owner
    → Update DB ownerId
    → Update channel permissions
    → Rename channel
    → Notify in channel

Owner returns DURING grace period:
  → Cancel timeout
  → Clear ownerLeftAt
  → Notify in channel

Original owner returns AFTER transfer:
  → Prompt: "Request ownership back?"
  → If yes: Send Accept/Deny buttons to current owner
  → Accept: Transfer back, update perms
  → Deny: Notify, no changes
```

**Control Panel Interactions (src/commands/utility/bytepod.js:174-393):**
- **Ownership Verification (lines 184-192):** User must be owner OR have EXPLICIT ManageChannels allow overwrite on the channel (not just server-wide Admin)
- **Interactive Components:**
  - Toggle Lock/Unlock
  - Whitelist menu (batch add/remove via UserSelectMenu)
  - Co-Owner menu (only owner can add)
  - Rename modal
  - Limit modal (0-99)
  - Kick menu
- **Panel Updates (lines 198-209):** After each action, panel message ID is embedded in customId to know which panel to update

**CRITICAL:** Co-owner check is STRICT (line 188) - requires explicit permission overwrite, not global perms. This prevents server mods from bypassing the delegation system.

### 3. RBAC Permission System (src/utils/permissions.js)

**checkUserPermissions() flow (lines 15-49):**
```javascript
1. Query commandPermissions table for (guildId, commandName)
2. If overrides exist:
   - Check if user has ANY of the allowed roles
   - OR user has Administrator permission
   - If neither: Return { allowed: false, error: embed }
3. If no overrides exist:
   - Check command.permissions array (code-defined)
4. Return { allowed: true }
```

**Managing Overrides:**
- `/perm add [command] [role]` - Whitelist role
- `/perm remove [command] [role]` - Remove role
- `/perm reset [command]` - Clear all overrides, revert to code perms
- `/perm list` - View all overrides

**Key Insight:** Once DB overrides exist for a command, code-defined permissions are IGNORED.

---

## Command Categories

### Administration (src/commands/administration/)
- **config.js** - Manage log channels, view server config (Admin only)
- **perm.js** - RBAC management with autocomplete (Admin only)
- **autorespond.js** - Keyword-based automated responses (~450 lines)
  - `/autorespond add <trigger> <response>` - Create response with match types
  - `/autorespond remove <id>` - Delete response (autocomplete enabled)
  - `/autorespond list` - View all responses (paginated, max 25)
  - `/autorespond toggle <id>` - Enable/disable response
  - `/autorespond edit <id> <new_response>` - Update response text
  - Match types: exact, contains, wildcard, regex (dev-only)
  - Variables: {user} {server} {channel} {username}
  - Optional: channel restriction, role requirement, custom cooldown
  - Requires ManageGuild permission
- **suggestion.js** - Community suggestion management system (~650 lines)
  - `/suggestion setup <channel> [review_role] [allow_anonymous]` - Configure system (Admin only)
  - `/suggestion approve <id> [reason]` - Approve a suggestion
  - `/suggestion deny <id> [reason]` - Deny a suggestion
  - `/suggestion implement <id> [note]` - Mark as implemented
  - `/suggestion view <id>` - View detailed suggestion info
  - `/suggestion list [status] [limit]` - List suggestions by status
  - `/suggestion leaderboard [limit]` - Top suggestions by votes
  - Auto-updates message embeds on status changes
  - DM notifications to suggesters on review
  - Review permission: Admin or custom review role

### Developer (src/commands/developer/)
- **guilds.js** - List all guilds bot is in (devOnly: true)
- **manageguilds.js** - List and leave guilds via select menu (devOnly: true)

### Fun (src/commands/fun/)
- **8ball.js** - Magic 8-ball (20 responses)
- **coinflip.js** - Heads or tails
- **joke.js** - Fetches from official-joke-api.appspot.com
- **roll.js** - Dice roller (2-100 sides)

### Games (src/commands/games/)
- **warthunder.js** - War Thunder stats integration
  - `/warthunder bind [nickname]` - Link Discord to WT account
  - `/warthunder stats [nickname]` - Show player stats
  - Uses wtService.js to query ThunderInsights API
  - Aggregates across all modes (arcade, historical, simulation)
  - Calculates K/D, win rate

### Moderation (src/commands/moderation/)
- **audit.js** - Comprehensive moderation log viewer
  - `/audit user @target [action] [limit]` - View target's moderation history
  - `/audit recent [limit]` - View recent actions across all users
  - `/audit by @moderator [limit]` - View actions by specific moderator
- **ban.js** - Ban member + log to DB
- **kick.js** - Kick member + log to DB
- **clear.js** - Bulk delete messages (1-100)
- **warn.js** - Issue warning + DM user + log to DB
- **unwarn.js** - Remove warning by ID
- **warnings.js** - View moderation history (last 10)
- **lock.js** - Deny SendMessages for @everyone
- **unlock.js** - Restore SendMessages for @everyone

### Utility (src/commands/utility/)
- **help.js** - Command browser with category grouping
- **ping.js** - Roundtrip latency + WS heartbeat
- **serverinfo.js** - Guild stats
- **userinfo.js** - User info with roles (top 20)
- **stats.js** - Server statistics dashboard
  - `/stats server` - Comprehensive server analytics (members, channels, bot activity)
- **suggest.js** - Submit community suggestions (~140 lines)
  - `/suggest <idea> [anonymous]` - Submit suggestion to configured channel
  - Auto-adds 👍/👎 reactions for voting
  - Optional anonymous submissions (if enabled by admin)
  - 60-second cooldown to prevent spam
- **birthday.js** - Birthday tracking system (~450 lines)
  - `/birthday set <MM-DD>` - Register birthday (privacy-focused, no year)
  - `/birthday remove` - Delete your birthday
  - `/birthday view [@user]` - Check a user's birthday
  - `/birthday upcoming [days]` - View upcoming birthdays (default 30 days)
  - `/birthday setup <channel>` - Admin: Configure announcement channel
  - `/birthday role [role]` - Admin: Set 24-hour birthday role
- **bookmark.js** - Message bookmarks management (~420 lines)
  - `/bookmark list [page]` - View your bookmarks (10 per page)
  - `/bookmark search <query>` - Search bookmarks by content
  - `/bookmark view <id>` - Detailed view with jump link
  - `/bookmark delete <id>` - Delete a specific bookmark
  - `/bookmark clear` - Delete all bookmarks with confirmation
  - `handleInteraction()` - Handles clear confirmation buttons
- **bytepod.js** - BytePod management (~600 lines)
  - `/bytepod setup` - Configure hub (Admin)
  - `/bytepod panel` - Resend control panel
  - `/bytepod preset add/remove/list` - Auto-whitelist presets
  - `/bytepod preset autolock` - Toggle auto-lock
  - `/bytepod stats [@user]` - View voice activity statistics
  - `/bytepod leaderboard` - Top 10 users by voice time
  - `/bytepod template save/load/list/delete` - Configuration templates
  - `handleInteraction()` - Massive router for all buttons/menus/modals

### Context Menus (src/commands/context-menus/)

**Message Context Menus:**
- **bookmark.js** - Bookmark messages for later reference
  - Right-click message → Apps → "Bookmark Message"
  - Saves message with content cache, attachments, metadata
  - DM-enabled, 3-second cooldown, auto-deferred

**User Context Menus:**
- **avatar.js** - View user avatars with download links
  - Shows server avatar and user avatar (if different)
  - PNG, WebP, and GIF download links for animated avatars
  - DM-enabled, 2-second cooldown
- **userinfo.js** - Comprehensive user information
  - Account creation, server join, roles, nickname
  - Bot activity stats, user badges, bot/system indicators
  - DM-enabled (skips guild fields in DMs), 3-second cooldown, auto-deferred
- **copyid.js** - Quick user ID copy
  - Code block format for easy selection
  - DM-enabled, 1-second cooldown
- **permissions.js** - Channel-specific permission analysis
  - Categorizes: Dangerous (red), Important (yellow), Other (green)
  - Administrator warning, total permission count
  - Guild-only, 3-second cooldown
- **activity.js** - User activity tracking
  - Bot usage, BytePod voice stats, current voice status
  - Last message in channel with jump link
  - Guild-only, 5-second cooldown, auto-deferred
- **modactions.js** - Interactive moderation panel (~350 lines)
  - Buttons: Warn, Kick, Ban, History
  - Modal-based reason input with database logging
  - Role hierarchy validation, permission checks
  - DM notifications to targets, moderation history viewer
  - `handleButton()` - Routes button interactions to modals
  - `handleModal()` - Executes moderation actions (warn/kick/ban)
  - Guild-only, requires ManageMessages, 3-second cooldown

---

## Utility Modules (src/utils/)

### embeds.js
**Purpose:** Enforce neon purple branding (#8A2BE2) across all bot responses.

**Methods:**
- `base(title, description)` - Brand color + timestamp + footer
- `success(title, description)` - Green (#57F287) with ✅
- `error(title, description)` - Red (#ED4245) with ❌
- `warn(title, description)` - Yellow (#FEE75C) with ⚠️
- `brand(title, description)` - Purple with no emoji
- `info(title, description)` - Purple with ℹ️

**RULE:** Never use `new EmbedBuilder()` directly. Always use embeds utility. (Enforced by tests/branding.test.js)

### logger.js
Colored console output with timestamps:
- `info(msg)` - Blue
- `success(msg)` - Green
- `warn(msg)` - Yellow
- `error(msg)` - Red
- `debug(msg)` - Magenta

### permissions.js
- `checkUserPermissions(interaction, command)` - RBAC logic (see Critical Systems section)

### permissionCheck.js
- `checkBotPermissions(guild, triggerMember)` - BytePod permission validator
- Checks: ManageChannels, MoveMembers, Connect
- If missing: DMs user and guild owner

### wtService.js
Singleton class for ThunderInsights API:
- `searchPlayer(nickname)` - Search by name, return first match
- `getPlayerStats(userid)` - Fetch and aggregate stats
  - Aggregates across 3 modes (arcade/historical/simulation)
  - Calculates derived stats: total_kills, kd, winRate

### bookmarkUtil.js
Bookmark database operations and business logic:
- `saveBookmark(userId, message)` - Save message with content cache (4000 char limit)
- `getBookmarks(userId, options)` - Paginated retrieval with search support
- `deleteBookmark(userId, bookmarkId)` - Delete with ownership verification
- `deleteAllBookmarks(userId)` - Clear all user bookmarks
- `markDeleted(messageId)` - Flag bookmarks when source message deleted
- `searchBookmarks(userId, query, options)` - Full-text search with pagination
- Enforces: 100 bookmark limit, duplicate prevention, ownership checks

---

## Components (src/components/)

### bytepodControls.js
- `getControlPanel(channelId, isLocked, userLimit, whitelist, coOwners)` - Generates embed + action rows
- `getRenameModal()` - Text input for channel name
- `getLimitModal()` - Text input for user limit (0-99)

**Control Panel Layout:**
```
Row 1: [Lock/Unlock] [Whitelist] [Co-Owner]
Row 2: [Rename] [Limit] [Kick]
```

---

## Event System (src/events/)

### ready.js (Events.ClientReady, once: true)
- Logs success
- Sets up rotating Rich Presence every 10 seconds:
  - "Doomscrolling (Ranked) 🟣"
  - "Touch Grass (Any%) 🟣"
  - "Existential Dread (Hard Mode) 🟣"

### interactionCreate.js (Events.InteractionCreate)
- Routes autocomplete to `command.autocomplete()`
- Routes BytePod interactions (customId starts with "bytepod_") to `bytepod.handleInteraction()`
- Executes command security pipeline (see Critical Systems)

### voiceStateUpdate.js (Events.VoiceStateUpdate)
- Handles BytePod creation when user joins hub
- Handles BytePod deletion when last user leaves (see Critical Systems)

### guildCreate.js / guildDelete.js
- Auto-register/cleanup guilds table when bot joins/leaves

---

## Development Patterns & Conventions

### Adding a New Command
1. Create file in `src/commands/[category]/commandname.js`
2. Export object with:
   - `data` - SlashCommandBuilder instance
   - `execute` - async function(interaction, client)
   - Optional: `cooldown` (number in seconds)
   - Optional: `devOnly` (boolean)
   - Optional: `longRunning` (boolean) - auto-defers reply
   - Optional: `permissions` - Array of PermissionFlagsBits
   - Optional: `autocomplete` - async function for autocomplete
3. Category is auto-assigned from folder name
4. Command is auto-registered by commandHandler

### Adding a New Event
1. Create file in `src/events/eventname.js`
2. Export object with:
   - `name` - Events constant (e.g., Events.MessageCreate)
   - `execute` - async function(...args, client)
   - Optional: `once` (boolean) - if true, uses client.once()
3. Event is auto-registered by eventHandler

### Database Schema Changes
1. Edit `src/database/schema.js`
2. Run `npm run db:generate` - creates migration files
3. Run `npm run db:push` - applies migrations to sqlite.db
4. Migrations in `./drizzle` folder are auto-applied on bot startup

### Testing
- Run `npm test` to execute Jest suite
- **branding.test.js** - Scans for direct EmbedBuilder usage
- **commands.test.js** - Validates command structure
- **events.test.js** - Validates event structure
- **utils.test.js** - Tests embed utility correctness

### Important Flags & Properties
- **MessageFlags.Ephemeral** - New pattern for ephemeral messages (old `ephemeral: true` deprecated)
- **command.longRunning** - Set to true for API calls or slow operations (auto-defers)
- **command.devOnly** - Restricts to IDs in config.developers
- **data.dm_permission** - Set to false to prevent DM usage

---

## Key Data Flows

### Command Execution
```
User → Slash Command
  → interactionCreate event
    → Security Pipeline (8 steps)
      → command.execute()
        → Reply with branded embed
```

### BytePod Creation
```
User → Join Hub Channel
  → voiceStateUpdate event
    → Permission check
      → Create channel with overwrites
        → Apply auto-whitelist presets
          → Move user + Insert DB
            → Send control panel
```

### BytePod Control
```
User → Click Button/Menu
  → interactionCreate → bytepod.handleInteraction()
    → Validate ownership (strict)
      → Execute action
        → Update permissions
          → Refresh panel
```

### Permission Override
```
Admin → /perm add [command] [role]
  → Insert to commandPermissions table

User → Run command
  → checkUserPermissions()
    → IF DB overrides exist: Check roles
    → ELSE: Check code permissions
```

---

## File Reference Quick Index

**Core:**
- `src/index.js` - Entry point (42 lines)
- `src/handlers/commandHandler.js` - Auto-load commands (48 lines)
- `src/handlers/eventHandler.js` - Auto-load events (23 lines)

**Database:**
- `src/database/schema.js` - 7 tables (57 lines)
- `src/database/index.js` - Drizzle initialization (16 lines)

**Events:**
- `src/events/interactionCreate.js` - Security pipeline + routing (175 lines)
- `src/events/voiceStateUpdate.js` - BytePod lifecycle (138 lines)
- `src/events/ready.js` - Startup + Rich Presence (27 lines)
- `src/events/guildCreate.js` - Auto-register guilds (22 lines)
- `src/events/guildDelete.js` - Auto-cleanup guilds (19 lines)

**Utils:**
- `src/utils/embeds.js` - Branding enforcement (61 lines)
- `src/utils/logger.js` - Colored console (15 lines)
- `src/utils/permissions.js` - RBAC logic (51 lines)
- `src/utils/permissionCheck.js` - BytePod perm validator (66 lines)
- `src/utils/wtService.js` - War Thunder API wrapper (101 lines)

**Components:**
- `src/components/bytepodControls.js` - Control panel builder (94 lines)

**Commands:**
- `src/commands/utility/bytepod.js` - BytePod management (394 lines) ⚠️ MOST COMPLEX
- `src/commands/administration/perm.js` - RBAC management (168 lines)
- `src/commands/utility/help.js` - Command browser (84 lines)

**Tests:**
- `tests/branding.test.js` - Enforce embeds utility usage
- `tests/commands.test.js` - Validate command structure
- `tests/events.test.js` - Validate event structure
- `tests/utils.test.js` - Test embed utility

---

## Common Gotchas & Edge Cases

### BytePod System
- **Co-Owner Check is Strict:** Requires EXPLICIT ManageChannels allow overwrite, not just server Admin (line 188 of bytepod.js)
- **Panel ID Tracking:** CustomIds embed panel message ID for targeted updates (e.g., `bytepod_whitelist_select_${panelId}`)
- **Whitelist Intent Detection:** If any selected user lacks Connect permission, action is "add"; otherwise "remove"
- **Owner Protection:** Owner cannot be kicked, cannot whitelist themselves, filtered from display lists

### Permission System
- **DB Overrides Trump Code:** If commandPermissions rows exist, code-defined permissions are ignored
- **Admin Bypass:** Users with Administrator always pass permission checks (even with DB overrides)

### Error Handling
- **Channel Deletion (error 10003):** BytePod cleanup handles deleted channels gracefully
- **DM Failures:** All user DMs wrapped in try/catch (user may have DMs disabled)
- **Permission Errors:** Bot checks its own permissions before attempting operations

### Cooldowns
- **In-Memory Only:** Cooldowns reset on bot restart
- **Per-User, Per-Command:** Same user can trigger different commands simultaneously

---

## Environment Variables (.env)

Required:
```
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_application_id
GUILD_ID=your_test_guild_id
DATABASE_URL=sqlite.db (optional, defaults to sqlite.db)
```

---

## Configuration (config.json)

```json
{
  "developers": ["208026791749746690"],  // Array of user IDs for devOnly commands
  "brand": {
    "name": "ByteBot",
    "color": "#8A2BE2",  // Neon purple
    "logo": ""
  },
  "colors": {
    "primary": "#8A2BE2",
    "success": "#57F287",
    "error": "#ED4245",
    "warning": "#FEE75C",
    "white": "#FFFFFF"
  }
}
```

---

## Deployment Notes

### Current Setup (Development)
- Slash commands registered to specific guild (line 40 of commandHandler.js)
- Uses `Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)`
- Instant command updates during development

### Production Deployment
- Change line 40 to `Routes.applicationCommands(CLIENT_ID)`
- Removes guild restriction, commands go global
- Updates take ~1 hour to propagate

### Required Intents
```javascript
GatewayIntentBits.Guilds           // Guild events, channels, roles
GatewayIntentBits.GuildMessages    // Message events (for /clear)
GatewayIntentBits.MessageContent   // Message content (for /clear)
GatewayIntentBits.GuildVoiceStates // Voice state updates (for BytePods)
```

### Required Bot Permissions
**Minimum:**
- SendMessages
- EmbedLinks
- UseSlashCommands

**For Moderation:**
- BanMembers
- KickMembers
- ManageMessages
- ManageChannels (for lock/unlock)

**For BytePods:**
- ManageChannels
- MoveMembers
- Connect

---

## Recent Changes

### 2025-12-24 - Community Suggestion System
- **New Feature: Suggestion System** - Community-driven idea tracking and voting
  - Users submit suggestions with `/suggest <idea> [anonymous]`
  - Auto-posts to designated channel with 👍/👎 reactions for voting
  - Admin management via `/suggestion` command with full lifecycle tracking
- **Suggestion Lifecycle:**
  - **Pending** - Initial state after submission
  - **Approved** - Admin approves with optional reason
  - **Denied** - Admin denies with optional reason
  - **Implemented** - Admin marks as completed with optional note
- **Admin Commands:**
  - `/suggestion setup <channel> [review_role] [allow_anonymous]` - Configure system
  - `/suggestion approve/deny/implement <id> [reason]` - Update status
  - `/suggestion view <id>` - View detailed info
  - `/suggestion list [status] [limit]` - Browse suggestions
  - `/suggestion leaderboard [limit]` - Top voted suggestions
- **Features:**
  - Anonymous submissions (optional, admin-configurable)
  - Custom review role (defaults to Admin permission)
  - Auto-updates message embeds when status changes
  - DM notifications to suggesters on review
  - Vote caching from message reactions
  - Jump links to original suggestions
- **Database Tables:**
  - `suggestion_config` - Per-guild configuration
  - `suggestions` - Suggestion tracking with votes and status
  - Indexes: (guildId, status), (userId, guildId), (guildId, upvotes)
- **Files created:**
  - `src/commands/utility/suggest.js` (~140 lines)
  - `src/commands/administration/suggestion.js` (~650 lines)
- **Files modified:**
  - `src/database/schema.js` - Added suggestion tables with indexes
  - `src/database/index.js` - Added expectedSchema entries

### 2025-12-23 - Voice State Change Bug Fix
- **CRITICAL FIX: Spurious Join/Leave Events** - Fixed BytePod triggering join/leave logic on voice state changes
  - Root cause: Discord fires `voiceStateUpdate` events for **any** voice state change, not just channel movement:
    - Starting/stopping screenshare
    - Starting/stopping camera
    - Muting/unmuting
    - Changing streaming status
  - Bug behavior: When user changed voice state (e.g., started screenshare), both `oldState.channelId` and `newState.channelId` were the SAME channel
  - Result: Bot triggered BOTH join and leave logic simultaneously at same timestamp
  - Side effects:
    - "FALSE LEAVE" warnings in logs every 20 minutes (exactly!)
    - Users getting briefly disconnected/reconnected when changing voice state
    - Screenshares cutting out when state changed
    - Duplicate session tracking (join + leave in same event)
- **Fix Applied:**
  - Added `oldState.channelId !== newState.channelId` check to both JOIN and LEAVE triggers
  - Only process joins/leaves when user **actually moved between channels**
  - Voice state changes (mute/camera/screenshare) now properly ignored
- **Files modified:**
  - `src/events/voiceStateUpdate.js` - Lines 264, 359 - Added channel movement validation
- **Testing:**
  - No more false leave warnings
  - Screenshares remain active when users interact with voice controls
  - Session tracking only fires on actual channel movement

### 2025-12-23 - BytePod Panel Update Error Handling
- **CRITICAL FIX: Panel Update Failures** - Fixed BytePod whitelist/co-owner/kick/limit interactions failing with error 10008
  - Root cause: `updatePanel()` function would fetch panel messages successfully but fail to edit them
  - Common scenario: Using `/bytepod panel` creates an ephemeral panel, which becomes invalid after interaction
  - User experience: Success messages ("Whitelisted user") would get replaced with error embeds
- **Fix Applied:**
  - Added `.catch()` handler to `msg.edit()` in `updatePanel()` helper function (line 575)
  - Panel updates are now best-effort - failures are logged at debug level, not propagated as errors
  - Success messages remain visible to users even if panel update fails
- **Handles All Cases:**
  - Ephemeral messages that can't be edited (from `/bytepod panel`)
  - Panel messages deleted by users
  - Any Discord API errors during edit operations
- **Affects All Panel Updates:**
  - Whitelist add/remove (line 705)
  - Co-owner add (line 716)
  - User kick (line 736)
  - User limit changes (line 753)
- **Files modified:**
  - `src/commands/utility/bytepod.js` - Added graceful error handling to updatePanel() at line 575-577
- **Testing:**
  - All 115 tests pass
  - No regressions introduced

### 2025-12-22 - Test Suite Cleanup & Stability
- **Improved Test Reliability** - Fixed all async cleanup issues in Jest test suite
  - Added proper cleanup methods to service classes (StarboardService, ReminderService, AutoResponderService)
  - Implemented `afterEach` hooks to clear all timers/intervals after tests
  - Fixed debouncing test in starboard.test.js to prevent timeout leaks
  - Fixed service instance cleanup in reminder.test.js and autoResponder.test.js
  - Moved `jest.useFakeTimers()` to `beforeEach` for proper isolation
- **Service Cleanup Methods:**
  - `StarboardService.cleanup()` - Clears update queue timeouts
  - `ReminderService.cleanup()` - Clears active timers and long-delay intervals
  - `AutoResponderService.cleanup()` - Clears cooldown cleanup interval
- **Result:**
  - All 126 tests pass cleanly with no warnings
  - No "worker process failed to exit" warnings
  - No "Cannot log after tests are done" errors
  - Jest exits gracefully without `--forceExit`
- **Files modified:**
  - `src/services/starboardService.js` - No changes needed (already had cleanup in tests)
  - `src/services/reminderService.js` - No changes needed (already had cleanup method)
  - `src/services/autoResponderService.js` - Added cleanup() method
  - `tests/starboard.test.js` - Added afterEach cleanup for updateQueue timeouts
  - `tests/reminder.test.js` - Added service instance tracking and cleanup
  - `tests/autoResponder.test.js` - Added service instance tracking and cleanup

### 2025-12-22 - Auto-Responder System
- **New Feature: Keyword-Based Automated Responses** - Reduce support load with automated FAQ responses
  - Admins create responses that trigger on keywords
  - 50 auto-responses per server limit
  - 5-minute guild cache with automatic invalidation
  - In-memory cooldown system prevents spam
- **Match Types:**
  - **Exact** - Message must exactly match trigger
  - **Contains** - Message contains trigger keyword (default)
  - **Wildcard** - Pattern matching with * and ?
  - **Regex** - Full regex support (dev-only for security)
- **Advanced Features:**
  - Channel restrictions (guild-wide or specific channel)
  - Role requirements (only respond to users with role)
  - Configurable cooldowns (5-3600 seconds)
  - Response variables: {user} {server} {channel} {username}
  - Usage analytics (use count, last used timestamp)
- **Commands:**
  - `/autorespond add <trigger> <response>` - Create auto-response
    - Optional: match_type, channel, role, cooldown
    - Validates regex patterns, enforces limits
  - `/autorespond remove <id>` - Delete auto-response (with autocomplete)
  - `/autorespond list` - View all responses (paginated, max 25 shown)
  - `/autorespond toggle <id>` - Enable/disable without deleting
  - `/autorespond edit <id> <new_response>` - Update response text
- **Security:**
  - Regex matching restricted to bot developers (prevents ReDoS attacks)
  - Bot message filtering prevents infinite loops
  - Permission check: Requires ManageGuild
  - First-match-only policy (only one response per message)
- **Performance:**
  - Guild response cache (5 min TTL)
  - Database indexes: (guildId, enabled), (guildId, channelId)
  - Stale cooldown cleanup every 60 seconds
- **Database Table:**
  - `auto_responses` - Trigger patterns, responses, restrictions
  - Columns: id, guildId, trigger, response, channelId, creatorId, enabled, cooldown, matchType, requireRoleId, useCount, createdAt, lastUsed
- **Files created:**
  - `src/services/autoResponderService.js` (~220 lines)
  - `src/events/messageCreate.js` (~22 lines)
  - `src/commands/administration/autorespond.js` (~450 lines)
- **Files modified:**
  - `src/database/schema.js` - Added auto_responses table with indexes
  - `src/database/index.js` - Added expectedSchema entry
  - `src/events/ready.js` - Initialize AutoResponderService on startup

### 2025-12-22 - Birthday Tracker System
- **New Feature: Birthday Tracking** - Privacy-focused birthday celebration system
  - Members can set birthdays (month/day only, no year) with `/birthday set MM-DD`
  - Daily automatic announcements at midnight UTC
  - Upcoming birthdays view with `/birthday upcoming [days]`
  - View any member's birthday with `/birthday view [@user]`
- **Leap Year Handling** - Feb 29 birthdays celebrated on Feb 28 in non-leap years
  - Automatic detection and user notification when setting
  - Service handles edge case seamlessly
- **Birthday Role System** - Optional 24-hour role assignment
  - Admins can configure role with `/birthday role [role]`
  - Automatically assigned at midnight, removed after 24 hours
  - Role hierarchy and permission checks enforced
- **Admin Configuration** - `/birthday setup <channel>` for announcement channel
  - Channel validation with permission checks
  - Auto-disable if channel deleted, notifies guild owner
  - Missed check detection on bot restart
- **Database Tables:**
  - `birthdays` - Per-user, per-guild birthday storage with composite unique constraint
  - `birthday_config` - Per-guild configuration (channel, role, enabled, lastCheck)
  - Indexed for daily queries (guildId, month, day)
- **Startup Resilience:**
  - Checks for missed announcements on bot startup
  - Handles guild member filtering (users who left)
  - Graceful error handling for deleted channels/roles
- **Files created:**
  - `src/services/birthdayService.js` (~350 lines)
  - `src/commands/utility/birthday.js` (~450 lines)
- **Files modified:**
  - `src/database/schema.js` - Added birthday tables with indexes
  - `src/database/index.js` - Added expectedSchema entries
  - `src/events/ready.js` - Initialize BirthdayService on startup

### 2025-12-22 - User Context Menus
- **New Feature: 6 User Context Menu Actions** - Right-click any user for quick actions
  - **View Avatar** - Display user's avatar with download links (PNG, WebP, GIF)
    - Shows both server avatar and user avatar if different
    - Detects animated avatars and provides GIF download
    - DM-enabled
  - **User Info** - Comprehensive user information display
    - Account creation date, server join date, nickname
    - Roles list (top 20), highest role color applied
    - Bot activity stats (commands run, last seen) from database
    - User badges (Discord Staff, Early Supporter, Bug Hunter, etc.)
    - Bot/System account indicators
    - DM-enabled (skips guild-specific fields in DMs)
  - **Copy User ID** - Quick user ID copy in code block format
    - Simple, ephemeral response for easy copying
    - DM-enabled
  - **Check Permissions** - Channel-specific permission analysis
    - Categorizes permissions: Dangerous (red), Important (yellow), Other (green)
    - Administrator warning if user has full permissions
    - Shows total permission count
    - Guild-only (permissions are channel-specific)
  - **Activity History** - User activity tracking across bot features
    - Bot usage stats (commands run, last seen)
    - BytePod voice stats (total time, session count)
    - Current voice channel status (muted/deafened/streaming)
    - Last message in current channel with jump link
    - Guild-only
  - **Moderate User** - Interactive moderation panel with buttons
    - Buttons: Warn, Kick, Ban, History
    - Modal-based reason input for all actions
    - Role hierarchy validation (can't moderate equal/higher roles)
    - Bot permission checks (disables buttons if bot lacks permissions)
    - Self-moderation protection
    - Bot moderation requires Administrator permission
    - Automatic database logging of all actions
    - DM notifications to target users
    - View 10 most recent moderation actions
    - Guild-only, requires ManageMessages permission
- **Security Features:**
  - All context menus use full security pipeline (DM checks, RBAC, cooldowns)
  - Moderate User has additional hierarchy checks and permission validation
  - Modal submissions re-validate hierarchy (user might have left/role changed)
- **Files created:**
  - `src/commands/context-menus/avatar.js` (~70 lines)
  - `src/commands/context-menus/userinfo.js` (~140 lines)
  - `src/commands/context-menus/copyid.js` (~20 lines)
  - `src/commands/context-menus/permissions.js` (~120 lines)
  - `src/commands/context-menus/activity.js` (~130 lines)
  - `src/commands/context-menus/modactions.js` (~350 lines)
- **Files modified:**
  - `src/events/interactionCreate.js` - Added moderation button and modal handlers

### 2025-12-22 - Message Bookmarks & Context Menu System
- **NEW ARCHITECTURE: Context Menus** - First implementation of Discord's context menu system
  - Right-click message → Apps → "Bookmark Message"
  - Full security pipeline: DM permission checks, RBAC, cooldowns, auto-deferral
  - `client.contextMenus` Collection added to client initialization
  - Command handler loads from `src/commands/context-menus/*.js`
  - Interaction handler routes `isMessageContextMenuCommand()` and `isUserContextMenuCommand()`
- **New Feature: Message Bookmarks** - Save and manage messages across servers
  - Context menu "Bookmark Message" saves messages with one click
  - Content cached (4000 char limit), up to 5 attachments stored
  - 100 bookmark limit per user enforced
  - Duplicate prevention (can't bookmark same message twice)
- **Bookmark Commands:**
  - `/bookmark list [page]` - View bookmarks with pagination (10 per page)
  - `/bookmark search <query>` - Search bookmarks by content
  - `/bookmark view <id>` - Detailed view with jump link, attachments, metadata
  - `/bookmark delete <id>` - Remove a single bookmark
  - `/bookmark clear` - Delete all bookmarks with confirmation buttons
- **Smart Features:**
  - Deleted message detection - marks bookmarks when source is deleted
  - Jump links to original messages (if not deleted)
  - Server/channel/author metadata preserved
  - Attachment URL caching for images/files
  - Search highlights query context
  - Bookmark counter shows usage (X/100 bookmarks)
- **Database Table:**
  - `bookmarks` - Per-user bookmark storage with content caching
  - Columns: userId, guildId, channelId, messageId, content, authorId, attachmentUrls, savedAt, messageDeleted
  - Indexes: (userId, savedAt) for pagination, (userId, content) for search
- **Utility Module:**
  - `src/utils/bookmarkUtil.js` - All bookmark database operations
  - Functions: saveBookmark, getBookmarks, deleteBookmark, markDeleted, searchBookmarks
  - Enforces business rules: 100 limit, no duplicates, ownership verification
- **Event Handler:**
  - `src/events/messageDelete.js` - Marks bookmarks as deleted when source message is deleted
  - Graceful failure handling (doesn't crash bot if DB update fails)
- **Files created:**
  - `src/utils/bookmarkUtil.js` (~280 lines)
  - `src/commands/context-menus/bookmark.js` (~70 lines)
  - `src/commands/utility/bookmark.js` (~420 lines)
  - `src/events/messageDelete.js` (~20 lines)
- **Files modified:**
  - `src/database/schema.js` - Added bookmarks table with indexes
  - `src/database/index.js` - Added expectedSchema entry
  - `src/index.js` - Added client.contextMenus Collection
  - `src/handlers/commandHandler.js` - Context menu loading logic
  - `src/events/interactionCreate.js` - Context menu security pipeline and bookmark interaction routing

### 2025-12-20 - BytePod Leaderboard, Server Stats & Startup Cleanup
- **New Feature: /bytepod leaderboard** - Voice activity leaderboard
  - Shows top 10 users by total voice time in BytePods
  - Displays medals (🥇🥈🥉) for top 3, session counts, formatted durations
  - Uses existing `bytepodVoiceStats` table data
- **New Feature: /stats server** - Comprehensive server statistics
  - Members, channels (text/voice/categories), roles, emojis
  - Verification level, boost tier, server creation date
  - Bot activity: commands run, mod actions, active BytePods
  - Top 3 voice users mini-leaderboard
  - Server owner display
- **New Feature: BytePod Startup Cleanup** - Restart resilience
  - On bot startup, validates all BytePods in database
  - Deletes empty channels (no members after restart)
  - Removes orphaned DB records (channel deleted while offline)
  - Logs cleanup stats: `BytePod cleanup: X empty deleted, Y orphaned removed, Z active`
- **Files created:** `src/commands/utility/stats.js`
- **Files modified:** `src/commands/utility/bytepod.js`, `src/events/ready.js`

### 2025-12-20 - Guild Management Command
- **New Feature: /manageguilds** - Bot owner guild management tool
  - Lists all guilds the bot is in with member counts
  - Provides a select menu to choose guilds to leave (up to 25 at once)
  - Shows success/failure results after leaving guilds
  - devOnly command restricted to developers in config.json
- **File created:** `src/commands/developer/manageguilds.js`

### 2025-12-20 - Fix BytePod Ownership Reclaim Edge Cases
- **CRITICAL FIX: Voice Reconnect Bug** - Fixed button interaction causing voice disconnects
  - Root cause: Using `deferUpdate()` then deleting the message confused Discord's state management
  - Fix: Changed to `reply({ ephemeral: true })` and disable button instead of deleting message
  - Result: No more unexpected voice reconnects when clicking "Request Ownership Back"
- **CRITICAL FIX: Duplicate Reclaim Prompts** - Prevented spam of ownership reclaim buttons
  - Added `reclaimRequestPending` boolean to `bytepods` table
  - Only send reclaim prompt if no pending request exists
  - Clear flag when accepted/denied
  - Result: Original owner gets ONE prompt, not infinite prompts on every join
- **New Feature: Automatic originalOwnerId Backfill** - Fixes reclaim for old pods
  - Detects when current owner joins their pod but `originalOwnerId` is null
  - Automatically sets `originalOwnerId` to current `ownerId`
  - Enables reclaim feature for pods created before this system existed
- **Improved Button Handling** - Better UX for reclaim requests
  - Original prompt button is disabled (not deleted) after clicking
  - Ephemeral confirmation message sent to requester
  - Accept/Deny messages properly cleanup pending flags
- **Files modified:** `schema.js`, `database/index.js`, `voiceStateUpdate.js`, `bytepod.js`, `CLAUDE.md`

### 2025-12-20 - BytePod Ownership Transfer System
- **New Feature: Ownership Transfer** - When owner leaves, ownership transfers after 5 minutes
  - `ownerLeftAt` and `originalOwnerId` columns added to `bytepods` table
  - In-memory `pendingOwnershipTransfers` Map tracks scheduled transfers
  - Owner returning during grace period cancels the transfer
  - After timeout: First remaining member becomes new owner
  - Channel renamed, permissions updated, notification sent
- **New Feature: Ownership Reclaim** - Original owner can request ownership back
  - When original owner rejoins after transfer: "Request Ownership Back" button appears
  - Current owner sees Accept/Deny buttons
  - Accept: Ownership transfers back with permission updates
  - Deny: Notification sent, no changes
- **Enhanced Error Logging** - Improved `logger.js` with full stack traces and context
  - `logger.errorContext()` method for detailed debugging
  - Discord API error details (code, status, method, URL) now logged
  - AggregateError breakdowns for `Promise.all` failures
- **Auto-Schema Validation** - Database self-heals on startup
  - `validateAndFixSchema()` checks all tables/columns before Drizzle runs
  - Missing tables created, missing columns added automatically
  - No more migration failures or need to delete database
- **Files modified:** `schema.js`, `voiceStateUpdate.js`, `bytepod.js`, `logger.js`, `interactionCreate.js`, `database/index.js`

### 2025-12-19 - Voice Activity Stats, Templates & Audit Command
- **New Feature: Voice Activity Stats** - Tracks cumulative time spent in BytePods
  - Persistent session tracking via `bytepodActiveSessions` table (survives bot restarts)
  - On startup, validates and finalizes stale sessions from before restart
  - `/bytepod stats [@user]` displays total time, session count, and average session length
- **New Feature: BytePod Templates** - Save and reuse channel configurations
  - `/bytepod template save <name>` - Captures limit, lock state, whitelist
  - `/bytepod template load <name>` - Applies saved configuration
  - `/bytepod template list` - View all saved templates
  - `/bytepod template delete <name>` - Remove a template
- **New Feature: /audit Command** - Comprehensive moderation log viewer
  - `/audit user @target [action] [limit]` - Filter by user and action type
  - `/audit recent [limit]` - View recent actions across guild
  - `/audit by @moderator [limit]` - View actions by specific moderator
- **Database Changes:** Added 3 new tables: `bytepodActiveSessions`, `bytepodVoiceStats`, `bytepodTemplates`
- **Files modified:** `schema.js`, `voiceStateUpdate.js`, `ready.js`, `bytepod.js`
- **Files created:** `audit.js`

### 2025-12-19 - BytePod Interaction Timeout Prevention
- Fixed `DiscordAPIError[10062]: Unknown interaction` across ALL BytePod operations
- Root cause: DB/API operations could exceed Discord's 3-second interaction timeout
- Fix: Added `deferReply()` before all async operations, changed `reply()` to `editReply()`
- **Slash commands fixed:** setup, panel, preset add/remove/list/autolock
- **Modal handlers fixed:** rename_modal, limit_modal
- **Select menu handlers fixed:** coowner_select, kick_select (whitelist_select was already deferred)
- File modified: `src/commands/utility/bytepod.js`

### 2025-01-XX - Initial Documentation
- Created comprehensive claude.md for future agents
- Documented all major systems, flows, and patterns
- Added file reference index and common gotchas

---

## Instructions for Future Claude Agents

**WHEN YOU MAKE CHANGES:**
1. **Update the "Recent Changes" section** with date and summary
2. **Update relevant technical sections** if you modify:
   - Database schema → Update "Database Layer" section
   - Security pipeline → Update "Critical Systems" section
   - Command structure → Update "Command Categories" section
   - Data flows → Update "Key Data Flows" section
3. **Add new patterns** to "Development Patterns & Conventions" if you introduce them
4. **Document gotchas** in "Common Gotchas & Edge Cases" if you discover new ones
5. **Keep file line numbers current** if you heavily modify files

**BEFORE MAKING CHANGES:**
1. Read relevant sections of this document first
2. Understand existing patterns and conventions
3. Follow the established architecture
4. Don't break the security pipeline
5. Maintain branding consistency (always use embeds.js)

**This documentation is your knowledge base. Keep it accurate and comprehensive.**
