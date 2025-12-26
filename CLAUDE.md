# ByteBot - Claude Agent Knowledge Base

**IMPORTANT: Update this file when making significant changes. Add to "Recent Changes" with dates.**

---

## Project Overview

Discord bot (Discord.js v14) with neon purple branding (#8A2BE2), slash commands, RBAC, BytePods (ephemeral voice channels), SQLite+Drizzle, and War Thunder integration.

**Stack:** discord.js v14.25.1, drizzle-orm v0.45.1, better-sqlite3, axios, chalk, glob, Jest

---

## Architecture

### Entry Point (src/index.js, lines 1-42)
1. Create Client (Intents: Guilds, GuildMessages, MessageContent, GuildVoiceStates)
2. Init `client.commands` and `client.cooldowns` Collections
3. Global error handlers (unhandledRejection, uncaughtException)
4. Run DB migrations → Load handlers → Login

### Database (src/database/)

**schema.js - 19 tables:**
| Table | Key Fields | Notes |
|-------|------------|-------|
| guilds | id, prefix, logChannel, welcomeChannel, voiceHubChannelId, voiceHubCategoryId | BytePod config |
| users | id, guildId, commandsRun, lastSeen, wtNickname | WT account binding |
| moderationLogs | id, guildId, targetId, executorId, action, reason, timestamp | Actions: BAN/KICK/CLEAR/WARN |
| commandPermissions | id, guildId, commandName, roleId | RBAC overrides |
| bytepods | channelId(PK), guildId, ownerId, originalOwnerId, ownerLeftAt, reclaimRequestPending, createdAt | Ephemeral VC tracking |
| bytepodAutoWhitelist | id, userId, targetUserId, guildId | Auto-allow presets |
| bytepodUserSettings | userId(PK), autoLock | Per-user prefs |
| bytepodActiveSessions | id, podId, userId, guildId, startTime | Restart resilience |
| bytepodVoiceStats | id, userId, guildId, totalSeconds, sessionCount | Aggregate stats |
| bytepodTemplates | id, userId, name, userLimit, autoLock, whitelistUserIds(JSON) | Saved configs |
| birthdays | id, userId, guildId, month, day, createdAt | No year (privacy), unique(userId,guildId) |
| birthdayConfig | guildId(PK), channelId, roleId, enabled, lastCheck | Guild celebration config |
| bookmarks | id, userId, guildId, channelId, messageId, content, authorId, attachmentUrls, savedAt, messageDeleted | 100 limit, 4000 char |
| autoResponses | id, guildId, trigger, response, channelId, creatorId, enabled, cooldown, matchType, requireRoleId, useCount, createdAt, lastUsed | 50/guild, 5-min cache |
| suggestionConfig | guildId(PK), channelId, reviewRoleId, enabled, allowAnonymous | Review role null=Admin only |
| suggestions | id, guildId, userId, content, messageId, channelId, status, upvotes, downvotes, reviewedBy, reviewedAt, reviewReason, createdAt, anonymous | Status: pending/approved/denied/implemented |
| activityStreaks | id, userId, guildId, currentStreak, longestStreak, lastActivityDate, totalActiveDays, freezesAvailable, lastFreezeReset | unique(userId,guildId), monthly freeze reset |
| activityAchievements | id, userId, guildId, achievementId, earnedAt | unique(userId,guildId,achievementId), streak milestones |
| activityLogs | id, userId, guildId, activityDate, messageCount, voiceMinutes, commandsRun, updatedAt | unique(userId,guildId,activityDate), daily activity tracking |

**index.js:** better-sqlite3 → Drizzle wrapper. `runMigrations()` runs `validateAndFixSchema()` first (auto-heals), then Drizzle migrations.

### Handlers (src/handlers/)
- **commandHandler.js (7-48):** Globs `src/commands/**/*.js`, validates data+execute, extracts category from folder, stores in `client.commands`, registers to Discord
- **eventHandler.js (6-23):** Globs `src/events/**/*.js`, binds via `client.once()` or `client.on()` based on `event.once`

---

## Critical Systems

### 1. Command Security Pipeline (src/events/interactionCreate.js:49-174)
```
1. DM Validation (61-69) → data.dm_permission !== false
2. Bot Permission Check (72-85) → SendMessages + EmbedLinks
3. Developer-Only Gate (88-93) → command.devOnly checks config.developers
4. RBAC (96-106) → checkUserPermissions(), DB overrides > code perms
5. Cooldown (109-129) → Per-command/user, default 3s
6. DB Tracking (134-149) → Increment commandsRun, update lastSeen
7. Auto-Defer (154-157) → If command.longRunning, deferReply()
8. Execute (160-173) → try/catch with error embeds
```
**Key:** This is the ONLY slash command entry point. All security happens here.

### 2. BytePod System (src/events/voiceStateUpdate.js)

**Join Hub (29-112):**
```
Join hub → Fetch voiceHubChannelId → checkBotPermissions(ManageChannels,MoveMembers,Connect)
  → If missing: Kick user, DM user+owner
  → Fetch autoLock setting → Create "{username}'s Pod"
    → Overwrites: @everyone(View=true,Connect=autoLock), Owner(Connect+ManageChannels+MoveMembers)
    → Apply auto-whitelist → Move user → Insert DB → Send control panel
```

**Leave Pod (114-136):**
```
Leave → Check bytepods table
  → members.size === 0: Delete channel + DB (handle error 10003)
  → OWNER leaves (others remain): Set ownerLeftAt → 5-min timeout → Transfer to first member
```

**Ownership Transfer:**
- Owner leaves: `pendingOwnershipTransfers` Map tracks timeout
- After 5 min: New owner gets perms, channel renamed, notification sent
- Owner returns during grace: Cancel timeout, clear ownerLeftAt
- Original owner returns after transfer: "Request Ownership Back" button → Accept/Deny flow

**Control Panel (src/commands/utility/bytepod.js:174-393):**
- Ownership check (184-192): Must be owner OR have EXPLICIT ManageChannels allow overwrite (not server Admin)
- Components: Lock/Unlock, Whitelist(batch), Co-Owner(owner only), Rename modal, Limit modal(0-99), Kick
- Panel updates (198-209): customId embeds panel message ID for targeted updates

**CRITICAL:** Co-owner check is STRICT - requires explicit channel permission overwrite, prevents server mod bypass.

### 3. RBAC Permission System (src/utils/permissions.js:15-49)
```javascript
checkUserPermissions():
1. Query commandPermissions for (guildId, commandName)
2. If overrides exist: User needs ANY allowed role OR Administrator
3. If no overrides: Check command.permissions array
4. Return { allowed: true/false, error? }
```
- `/perm add/remove [cmd] [role]` - Manage overrides
- `/perm reset [cmd]` - Clear overrides, revert to code
- `/perm list` - View all overrides

**Key:** Once DB overrides exist, code-defined permissions are IGNORED.

---

## Commands

### Administration (src/commands/administration/)
| Command | Description |
|---------|-------------|
| config.js | Manage log channels, view config (Admin) |
| perm.js | RBAC management with autocomplete (Admin) |
| autorespond.js (~450 lines) | `/autorespond add/remove/list/toggle/edit` - Keyword responses. Match types: exact/contains/wildcard/regex(dev-only). Variables: {user}{server}{channel}{username}. Requires ManageGuild |
| suggestion.js (~650 lines) | `/suggestion setup/approve/deny/implement/view/list/leaderboard` - Community suggestions. DM notifications, auto-embed updates |

### Developer (src/commands/developer/) - All devOnly
| Command | Description |
|---------|-------------|
| guilds.js | List all guilds |
| manageguilds.js | List/leave guilds via select menu |
| deploy.js | `/deploy <scope>` - Force command sync. Guild(instant) or Global(1hr). Detects duplicates. 10s cooldown |
| clear.js | `/clear <scope>` - Clear command registrations (Global/Guild/Both). Fixes duplicates. 10s cooldown |

### Fun (src/commands/fun/)
8ball.js (20 responses), coinflip.js, joke.js (official-joke-api), roll.js (2-100 sides)

### Games (src/commands/games/)
| Command | Description |
|---------|-------------|
| warthunder.js | `/warthunder bind/stats` - ThunderInsights API, aggregates all modes, calculates K/D+winRate |

### Moderation (src/commands/moderation/)
| Command | Description |
|---------|-------------|
| audit.js | `/audit user/recent/by` - Moderation log viewer with filters |
| ban.js, kick.js | Ban/kick + log to DB |
| clear.js | Bulk delete 1-100 messages |
| warn.js, unwarn.js, warnings.js | Warning system with DM + DB logging |
| lock.js, unlock.js | Deny/restore SendMessages for @everyone |

### Utility (src/commands/utility/)
| Command | Description |
|---------|-------------|
| help.js | Command browser with categories |
| ping.js | Roundtrip + WS heartbeat |
| serverinfo.js, userinfo.js | Guild/user stats |
| stats.js | `/stats server` - Members, channels, bot activity, top voice users |
| suggest.js (~140 lines) | `/suggest <idea> [anonymous]` - Submit to configured channel, 👍/👎 reactions, 60s cooldown |
| birthday.js (~450 lines) | `/birthday set/remove/view/upcoming/setup/role` - Privacy-focused (no year), leap year handling, 24hr role |
| bookmark.js (~420 lines) | `/bookmark list/search/view/delete/clear` - Pagination, jump links, attachment caching |
| bytepod.js (~600 lines) | `/bytepod setup/panel/preset/stats/leaderboard/template` - Full pod management, `handleInteraction()` routes all components |
| streak.js (~240 lines) | `/streak view/leaderboard` - View streaks, achievements, leaderboard. Auto-tracks messages/voice/commands, 11 achievements, monthly freeze |

### Context Menus (src/commands/context-menus/)

**Message:** bookmark.js - Right-click → "Bookmark Message", DM-enabled, 3s cooldown

**User:**
| Menu | Description |
|------|-------------|
| avatar.js | Server+user avatar, PNG/WebP/GIF links, DM-enabled |
| userinfo.js | Full user info, badges, bot stats, DM-enabled |
| copyid.js | Code block format, DM-enabled |
| permissions.js | Channel perms categorized (Dangerous/Important/Other), Guild-only |
| activity.js | Bot usage, voice stats, current voice status, Guild-only |
| modactions.js (~350 lines) | Warn/Kick/Ban/History buttons, modal input, hierarchy validation, DM notifications, Guild-only |

---

## Utilities (src/utils/)

| Module | Purpose |
|--------|---------|
| embeds.js | Branding (#8A2BE2). Methods: base, success, error, warn, brand, info. **NEVER use EmbedBuilder directly** |
| logger.js | Colored console: info(blue), success(green), warn(yellow), error(red), debug(magenta) |
| permissions.js | `checkUserPermissions()` - RBAC logic |
| permissionCheck.js | `checkBotPermissions()` - BytePod validator (ManageChannels,MoveMembers,Connect) |
| wtService.js | Singleton for ThunderInsights: `searchPlayer()`, `getPlayerStats()` |
| bookmarkUtil.js | `saveBookmark/getBookmarks/deleteBookmark/deleteAllBookmarks/markDeleted/searchBookmarks` - 100 limit, duplicate prevention |
| commandDeployer.js | `loadCommands/deployCommands/getCachedHash` - Registration utility |

## Components (src/components/)
| Component | Purpose |
|-----------|---------|
| bytepodControls.js | `getControlPanel()`, `getRenameModal()`, `getLimitModal()`. Layout: Row1[Lock,Whitelist,Co-Owner] Row2[Rename,Limit,Kick] |

---

## Events (src/events/)

| Event | Purpose |
|-------|---------|
| ready.js | Once. Init services (Birthday, Auto-Responder, Starboard, Reminder, Activity Streak), BytePod cleanup, Rich Presence rotation |
| interactionCreate.js | Routes autocomplete, BytePod interactions, executes security pipeline, tracks command activity for streaks |
| voiceStateUpdate.js | BytePod create/delete lifecycle, tracks voice activity for streaks |
| guildCreate.js / guildDelete.js | Auto-register/cleanup guilds table |
| messageCreate.js | Auto-responder triggers, tracks message activity for streaks |
| messageDelete.js | Mark bookmarks as deleted |
| messageReactionAdd/Remove.js | Suggestion vote counting (pending status only) |

---

## Development Patterns

### Adding Commands
1. Create `src/commands/[category]/name.js`
2. Export: `data` (SlashCommandBuilder), `execute` (async), optional: `cooldown`, `devOnly`, `longRunning`, `permissions`, `autocomplete`
3. Category auto-assigned from folder, auto-registered

### Adding Events
1. Create `src/events/name.js`
2. Export: `name` (Events constant), `execute` (async), optional: `once`
3. Auto-registered

### Database Changes
1. Edit `src/database/schema.js`
2. `npm run db:generate` → `npm run db:push`
3. Migrations auto-applied on startup

### Testing
`npm test` - branding.test.js (no direct EmbedBuilder), commands.test.js, events.test.js, utils.test.js

### Important Flags
- `MessageFlags.Ephemeral` - New ephemeral pattern
- `command.longRunning` - Auto-defers for API calls
- `command.devOnly` - Restricts to config.developers
- `data.dm_permission = false` - Prevent DM usage

---

## Data Flows

```
Command: User → Slash → interactionCreate → Security(8 steps) → execute() → branded embed
BytePod Create: Join Hub → voiceStateUpdate → perm check → create channel → apply whitelist → move user → insert DB → control panel
BytePod Control: Click → interactionCreate → handleInteraction() → validate ownership → execute → update perms → refresh panel
RBAC: /perm add → insert DB | User runs cmd → checkUserPermissions() → DB overrides? check roles : check code perms
```

---

## File Reference

**Core:** index.js(42), commandHandler.js(48), eventHandler.js(23)
**Database:** schema.js(319), index.js(273)
**Events:** interactionCreate.js(375), voiceStateUpdate.js(500+), ready.js(200), guildCreate.js(22), guildDelete.js(19), messageCreate.js(39)
**Utils:** embeds.js(61), logger.js(15), permissions.js(51), permissionCheck.js(66), wtService.js(101)
**Services:** activityStreakService.js(595), birthdayService.js(353), autoResponderService.js, starboardService.js, reminderService.js
**Components:** bytepodControls.js(94)
**Commands:** bytepod.js(394)⚠️COMPLEX, perm.js(168), help.js(84), streak.js(240)

---

## Gotchas

| Area | Issue |
|------|-------|
| BytePod | Co-owner requires EXPLICIT ManageChannels overwrite, not server Admin |
| BytePod | CustomIds embed panel message ID for targeted updates |
| BytePod | Whitelist intent: If any user lacks Connect, action="add"; else "remove" |
| BytePod | Owner can't be kicked, can't whitelist self, filtered from lists |
| RBAC | DB overrides exist → code permissions IGNORED |
| RBAC | Administrator always bypasses |
| Errors | 10003 = channel deleted, handle gracefully |
| Errors | Wrap all DMs in try/catch |
| Cooldowns | In-memory only, reset on restart |

---

## Config

**.env:** `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `DATABASE_URL` (optional, defaults sqlite.db)

**config.json:**
```json
{
  "developers": ["208026791749746690"],
  "brand": { "name": "ByteBot", "color": "#8A2BE2", "logo": "" },
  "colors": { "primary": "#8A2BE2", "success": "#57F287", "error": "#ED4245", "warning": "#FEE75C", "white": "#FFFFFF" }
}
```

---

## Deployment

**CLI:**
- `npm start -- --deploy` - Force to GUILD_ID
- `npm start -- --deploy-all` - All guilds (instant)
- `npm start -- --deploy-global` - Global (1hr propagation)

**In-Bot:** `/deploy scope:Guild|Global` (owner only)

**Intents:** Guilds, GuildMessages, MessageContent, GuildVoiceStates

**Permissions:** Min(SendMessages,EmbedLinks,UseSlashCommands), Mod(BanMembers,KickMembers,ManageMessages,ManageChannels), BytePods(ManageChannels,MoveMembers,Connect)

---

## Recent Changes

### 2025-12-25 - Activity Streak Tracking
- **NEW:** Daily engagement tracking system with streaks, achievements, and leaderboards
- **Features:** Auto-tracks messages/voice/commands, 11 achievements (3-365 day milestones), monthly streak freeze (save 1 missed day/month)
- **Commands:** `/streak view [@user]`, `/streak leaderboard [current|longest]`
- **Tables:** activityStreaks (current/longest/total days, freeze system), activityAchievements (milestone rewards), activityLogs (daily activity breakdown)
- **Service:** activityStreakService.js - Daily midnight checks, auto-break/freeze logic, achievement DM notifications
- **Tracking:** messageCreate.js (messages), interactionCreate.js (commands), voiceStateUpdate.js (voice minutes)
- **Files:** `activityStreakService.js`, `streak.js`, `schema.js`, `index.js`, `ready.js`, `messageCreate.js`, `interactionCreate.js`, `voiceStateUpdate.js`
- **NEW:** `/clear <scope>` command to remove duplicate command registrations
- **ENHANCEMENT:** `/deploy` now detects and prevents duplicate registrations
- **NEW:** `checkExistingRegistrations()` utility in `commandDeployer.js`
- **FEATURE:** Auto-detection warns users when both global and guild commands exist
- **FIX:** Prevents creating duplicates by blocking deployment when duplicates detected
- **FILES:** `clear.js`, `commandDeployer.js`, `deploy.js`
- **DOCS:** Added `DUPLICATE_COMMANDS_FIX.md` comprehensive fix guide

### 2025-12-24 - War Thunder Command Timeout Fix
- **FIX:** `/warthunder` exceeding 3s timeout. Added `longRunning: true`, removed manual deferrals. Both subcommands use `editReply()`.
- **Files:** `src/commands/games/warthunder.js`

### 2025-12-24 - Suggestion System UX
- **FIX:** Redundant emojis in DM/admin embeds
- **ENHANCEMENT:** Ephemeral admin responses (manual deferReply)
- **FIX:** Vote counting locked after review (status check in reaction events)
- **Files:** `suggestion.js`, `messageReactionAdd.js`, `messageReactionRemove.js`

### 2025-12-24 - Manual Command Deployment
- **NEW:** `/deploy <scope>` command, `--deploy`/`--deploy-all`/`--deploy-global` CLI flags
- **NEW:** `commandDeployer.js` utility with hash caching
- **Files:** `commandDeployer.js`, `deploy.js`, `commandHandler.js`

### 2025-12-24 - Suggestion System
- **NEW:** `/suggest <idea> [anonymous]` user command, `/suggestion` admin management
- **Features:** Lifecycle (pending→approved/denied/implemented), voting, DM notifications, leaderboard
- **Tables:** suggestion_config, suggestions
- **Files:** `suggest.js`, `suggestion.js`, `schema.js`, `index.js`

### 2025-12-23 - Voice State Bug Fix
- **FIX:** Spurious join/leave on mute/camera/screenshare. Added `oldState.channelId !== newState.channelId` check.
- **Files:** `voiceStateUpdate.js` lines 264, 359

### 2025-12-23 - Panel Update Error Handling
- **FIX:** Error 10008 on panel updates. Added `.catch()` to `msg.edit()` in `updatePanel()` (line 575). Best-effort updates.
- **Files:** `bytepod.js`

### 2025-12-22 - Test Suite Cleanup
- **FIX:** Async cleanup issues. Added cleanup methods to services, proper `afterEach` hooks.
- **Files:** `autoResponderService.js`, `starboard.test.js`, `reminder.test.js`, `autoResponder.test.js`

### 2025-12-22 - Auto-Responder System
- **NEW:** Keyword-based responses. Match types: exact/contains/wildcard/regex(dev-only). 50/guild limit, 5-min cache.
- **Commands:** `/autorespond add/remove/list/toggle/edit`
- **Files:** `autoResponderService.js`, `messageCreate.js`, `autorespond.js`, `schema.js`

### 2025-12-22 - Birthday Tracker
- **NEW:** Privacy-focused (no year), daily announcements, 24hr role, leap year handling.
- **Commands:** `/birthday set/remove/view/upcoming/setup/role`
- **Files:** `birthdayService.js`, `birthday.js`, `schema.js`, `ready.js`

### 2025-12-22 - User Context Menus
- **NEW:** 6 menus - Avatar, User Info, Copy ID, Permissions, Activity, Moderate User
- **Moderate User:** Warn/Kick/Ban/History buttons, modal input, hierarchy validation
- **Files:** `avatar.js`, `userinfo.js`, `copyid.js`, `permissions.js`, `activity.js`, `modactions.js`, `interactionCreate.js`

### 2025-12-22 - Message Bookmarks & Context Menus
- **NEW ARCH:** Context menu system with full security pipeline
- **NEW:** Bookmark messages (100 limit, 4000 char, duplicate prevention)
- **Commands:** `/bookmark list/search/view/delete/clear`
- **Files:** `bookmarkUtil.js`, context-menus/`bookmark.js`, `bookmark.js`, `messageDelete.js`, `schema.js`, `index.js`, `commandHandler.js`, `interactionCreate.js`

### 2025-12-20 - Leaderboard, Stats, Cleanup
- **NEW:** `/bytepod leaderboard`, `/stats server`, startup cleanup (empty/orphaned pods)
- **Files:** `stats.js`, `bytepod.js`, `ready.js`

### 2025-12-20 - Guild Management
- **NEW:** `/manageguilds` - List/leave guilds via select menu (devOnly)
- **Files:** `manageguilds.js`

### 2025-12-20 - Ownership Reclaim Fixes
- **FIX:** Voice reconnect on button click (changed to ephemeral reply)
- **FIX:** Duplicate reclaim prompts (added `reclaimRequestPending` flag)
- **NEW:** Auto-backfill `originalOwnerId` for old pods
- **Files:** `schema.js`, `index.js`, `voiceStateUpdate.js`, `bytepod.js`

### 2025-12-20 - Ownership Transfer System
- **NEW:** 5-min grace period, ownership transfer, reclaim flow
- **NEW:** `logger.errorContext()` for detailed debugging
- **NEW:** Auto-schema validation (`validateAndFixSchema()`)
- **Files:** `schema.js`, `voiceStateUpdate.js`, `bytepod.js`, `logger.js`, `interactionCreate.js`, `index.js`

### 2025-12-19 - Voice Stats, Templates, Audit
- **NEW:** Voice activity tracking (persistent sessions), `/bytepod stats/template`, `/audit user/recent/by`
- **Tables:** bytepodActiveSessions, bytepodVoiceStats, bytepodTemplates
- **Files:** `schema.js`, `voiceStateUpdate.js`, `ready.js`, `bytepod.js`, `audit.js`

### 2025-12-19 - Timeout Prevention
- **FIX:** `DiscordAPIError[10062]` across all BytePod ops. Added `deferReply()` before async, changed to `editReply()`.
- **Files:** `bytepod.js`

### 2025-01-XX - Initial Documentation
- Created CLAUDE.md with architecture, flows, patterns, gotchas

---

## Agent Instructions

**WHEN CHANGING:**
1. Update "Recent Changes" with date
2. Update technical sections if modifying: DB schema, security pipeline, commands, data flows
3. Add new patterns to conventions
4. Document new gotchas
5. Keep line numbers current

**BEFORE CHANGING:**
1. Read relevant sections first
2. Follow established patterns
3. Don't break security pipeline
4. Use embeds.js (never raw EmbedBuilder)

**This is your knowledge base. Keep it accurate.**
