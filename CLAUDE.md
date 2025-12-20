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

**schema.js** - 10 tables:
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
  channelId (PK), guildId, ownerId, createdAt
  // Tracks active ephemeral voice channels
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
  id, odId, guildId, totalSeconds, sessionCount
  // Aggregate voice activity stats per user per guild
}

bytepodTemplates: {
  id, userId, name, userLimit, autoLock, whitelistUserIds (JSON)
  // Saved BytePod configuration templates
}
```

**index.js** - Database initialization:
- Initializes better-sqlite3 connection to `sqlite.db`
- Wraps with Drizzle ORM for type-safe queries
- `runMigrations()` applies schema changes from `./drizzle` folder

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

### Developer (src/commands/developer/)
- **guilds.js** - List all guilds bot is in (devOnly: true)

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
- **bytepod.js** - BytePod management (~560 lines)
  - `/bytepod setup` - Configure hub (Admin)
  - `/bytepod panel` - Resend control panel
  - `/bytepod preset add/remove/list` - Auto-whitelist presets
  - `/bytepod preset autolock` - Toggle auto-lock
  - `/bytepod stats [@user]` - View voice activity statistics
  - `/bytepod template save/load/list/delete` - Configuration templates
  - `handleInteraction()` - Massive router for all buttons/menus/modals

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
- **Files modified:** `schema.js`, `voiceStateUpdate.js`, `bytepod.js`, `logger.js`, `interactionCreate.js`

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
