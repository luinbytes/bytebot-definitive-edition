# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Commands

```bash
npm install              # Install dependencies
npm start                # Start the bot (uses .env)
npm run dev              # Run Jest suite, then start bot
npm run dev:alt          # Same as dev, but loads .env.dev via --dev flag
npm test                 # Run Jest suite only
npm run db:generate      # Generate Drizzle migration file from schema.js
npm run db:push          # Push schema directly to sqlite.db (dev shortcut)

# Run a single test file
npx jest tests/commands.test.js
npx jest -t "name of test"
```

**CLI deploy flags** (pass after `--` to `npm start`):
- `--deploy` — force re-deploy commands to `GUILD_ID` (instant)
- `--deploy-all` — deploy to every guild the bot is in (instant)
- `--deploy-global` — deploy globally (~1hr propagation)
- `--dev` — load `.env.dev` instead of `.env`

**Environment (`.env`):** `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `DATABASE_URL` (optional, defaults to `sqlite.db`), `AUTO_DEPLOY` (optional: `none`/`guild`/`global` — controls automatic re-deploy on command hash change; useful for hosts without custom startup flags).

---

## Architecture

Discord.js v14 bot with neon-purple branding (`#8A2BE2`), slash commands, RBAC, ephemeral voice channels ("BytePods"), SQLite + Drizzle ORM, and an activity/achievement system.

### Entry point (`src/index.js`)

Client boots with intents `Guilds, GuildMembers, GuildMessages, MessageContent, GuildVoiceStates, GuildMessageReactions`. Order: run DB migrations → load events → load commands → login. Graceful shutdown on SIGINT/SIGTERM cleans up all services attached to `client.*Service` fields.

### Handler auto-loading

- `src/handlers/commandHandler.js` — globs `src/commands/**/*.js`, validates `data` + `execute` exports, **derives `category` from the parent folder name**, stores in `client.commands` Collection, registers with Discord.
- `src/handlers/eventHandler.js` — globs `src/events/**/*.js`, binds via `client.once` or `client.on` based on `event.once`.

Adding a new command or event is just dropping a file in the right folder — no registration step.

### Command module shape

```js
module.exports = {
    data: new SlashCommandBuilder()...,   // required
    async execute(interaction, client) {}, // required
    permissions: [PermissionFlagsBits.X],  // optional — enforced at runtime
    cooldown: 5,                           // optional — seconds, default 3
    devOnly: false,                        // optional — gate to config.developers
    longRunning: false,                    // optional — auto-defers reply
    async autocomplete(interaction) {},    // optional
    async handleInteraction(interaction) {}// optional — button/modal routing
};
```

### The interaction security pipeline (`src/events/interactionCreate.js`)

**This is the ONLY entry point for slash commands.** All security happens here. Ordering matters.

1. **Duplicate guard** — 1-minute rolling set prevents double-processing the same interaction ID.
2. **Component routing** — buttons/selects/modals with `customId` prefixes (`bytepod_`, `bookmark_`, `help_page_`, etc.) are routed to the owning command's `handleInteraction()` and return early.
3. **DM validation** — reject if `data.dm_permission === false`.
4. **Bot permission check** — bot must hold `SendMessages` + `EmbedLinks` in the channel.
5. **Dev-only gate** — checked before RBAC so DB overrides can't bypass `devOnly`.
6. **RBAC** (`src/utils/permissions.js::checkUserPermissions`):
   - Query `commandPermissions` for `(guildId, commandName)`.
   - **If DB overrides exist → user needs ANY whitelisted role OR Administrator. Code-defined `permissions` are IGNORED.**
   - Otherwise → enforce the command's `permissions` array.
7. **Cooldown** — per-command, per-user, in-memory (`client.cooldowns`), resets on restart.
8. **DB tracking** — increment `users.commandsRun`, update `lastSeen`.
9. **Auto-defer** — if `command.longRunning`, `deferReply()` before executing.
10. **Execute** — wrapped in try/catch; errors routed through `errorHandlerUtil.handleCommandError` with unique 8-char tracking IDs.

### ⚠️ CRITICAL permission gotcha

`.setDefaultMemberPermissions()` on the builder is **Discord UI-only** — it hides the command from users in the UI but provides **zero runtime enforcement**. `checkUserPermissions()` defaults to `allowed: true` when `command.permissions` is undefined.

**Every moderation/admin command MUST export both:**
```js
data: new SlashCommandBuilder()...setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
permissions: [PermissionFlagsBits.ModerateMembers],  // ← runtime enforcement
```

Missing the `permissions` array on a moderation command = unauthenticated moderation actions. This has bitten the codebase before.

### Database (`src/database/`)

- `schema.js` — 28 Drizzle table definitions. Source of truth.
- `index.js` — `better-sqlite3` + Drizzle wrapper with `WAL` mode, `foreign_keys=ON`, 5s busy timeout.
- `runMigrations()` calls `validateAndFixSchema()` **first** (auto-heals missing columns by diffing against `expectedSchema`), then runs Drizzle's `migrate()`.
- **`expectedSchema` in `database/index.js` must be kept in sync with `schema.js` by hand.** If you add a column to `schema.js` without updating `expectedSchema`, the auto-healer won't create it on existing databases and migrations will fail. Every column in `expectedSchema` is passed through `isValidSQLIdentifier`/`isValidSQLType` before being interpolated into `ALTER TABLE`, so do NOT bypass these validators.

**Schema change workflow:**
1. Edit `schema.js`
2. Mirror the change in `expectedSchema` in `database/index.js`
3. `npm run db:generate` (creates migration file in `drizzle/`)
4. Start the bot — migrations apply automatically

### BytePods — ephemeral voice channels (`src/events/voiceStateUpdate.js`, `src/commands/utility/bytepod.js`)

Users join a configured "hub" channel → bot creates a personal voice channel → deletes it when empty. The non-obvious pieces:

**Creation flow:** Join hub → `checkBotPermissions(ManageChannels, MoveMembers, Connect)` → fetch `bytepodUserSettings` to pick name style (`username` = `"{name}'s Pod"`, `random` = `podNameGenerator.js` output like "Wobbly Narwhal Pod") → create channel with overwrites (`@everyone`: Connect=!autoLock, owner: Connect+ManageChannels+MoveMembers) → apply auto-whitelist → move user → insert into `bytepods` → initialize `podStatsTracker` → send control panel.

**Session summary — the non-obvious bit** (`src/utils/bytepodSummaryUtil.js`):
- `podStatsTracker` is an **in-memory `Map`** keyed by pod ID, holding `{ peakUsers, currentUsers, visitors, userDurations }`.
- When a user leaves, their session duration is **accumulated into `podStatsTracker.userDurations`** before the DB row in `bytepodActiveSessions` is deleted.
- **Why:** sessions are deleted from the DB on leave. Reading durations from the DB at pod-close time would only find the last leaver's row. A prior bug showed exactly this symptom (summary only showed one user's time) — do NOT "simplify" by reading durations from the DB.

**Ownership transfer:** Owner leaves but others remain → set `ownerLeftAt`, start 5-min timeout in `pendingOwnershipTransfers` Map → if owner returns, cancel → otherwise transfer perms to first member, rename channel, notify. If the original owner comes back **after** transfer, a "Request Ownership Back" button appears with accept/deny; `reclaimRequestPending` flag on `bytepods` prevents duplicate prompts. Accept/deny handlers use `reply()` not `deferUpdate()` to avoid a voice disconnect bug.

#### Ownership reclaim — non-obvious fixes

- **Duplicate Reclaim Prompts:** The `reclaimRequestPending` column on the `bytepods table` is set when the original owner rejoins after a transfer and a "Request Ownership Back" prompt is posted. Prevents duplicate reclaim prompts if they rejoin again before resolving the first one. Cleared on transfer completion or explicit decline.
- **Voice Reconnect Bug:** Accept/deny handlers MUST use `reply()`, never `deferUpdate()`. Using `deferUpdate` on these buttons causes Discord to forcibly reconnect the user to voice, interrupting their session. This is a Discord client quirk, not a bug in our code — just don't touch it.
- **originalOwnerId Backfill:** `originalOwnerId` was added after the `bytepods` table existed in prod, so old pods have it as `NULL`. The voice-state handler backfills it the first time the current owner rejoins their own pod (Case 3 in `voiceStateUpdate.js`). Without this backfill, reclaim is silently disabled for old pods.

**Co-owner check is STRICT** (`bytepod.js`): ownership actions require the user to be the owner OR have an **explicit member-level `ManageChannels` allow overwrite on the channel**. Server Administrators and role-level perms do NOT pass this check. This is intentional — it prevents server mods from hijacking arbitrary pods. When editing BytePod code, do not "fix" this by falling back to `member.permissions.has(ManageChannels)`.

### Activity & achievements (`src/services/activityStreakService.js`)

Tracks 8 daily metrics per user (messages, voice minutes, commands, pods created, channel joins, reactions, active hours, streak) in `activityLogs`. `AchievementManager` class auto-seeds 98 achievement definitions on first run (82 core + 16 seasonal) into `achievementDefinitions`. Categories: streak, dedication, social, voice, explorer, special, combo, meta, seasonal. Rarities: common → uncommon → rare → epic → legendary → mythic.

On every activity event, `checkAllAchievements()` runs cumulative/combo/meta checks — achievements fire **instantly** the moment a threshold is crossed, not on daily rollover. Streak/total-day achievements only check on day change. Seasonal achievements validate dates on award to prevent backdating.

Auto-backfill: `processMissedAchievements()` runs on every startup, awarding anything earned while the bot was offline. Achievement cache is 1-hour — invalidate after creating custom achievements via `/achievement create`.

Guild-level kill switch: `guilds.achievementsEnabled`. When false, automatic awards are skipped but `/achievement award` (manual) still works.

### Services (`src/services/`)

Long-lived singletons attached to `client` in `ready.js`: `activityStreakService`, `birthdayService`, `autoResponderService`, `reminderService`, `starboardService`. Each exposes a `cleanup()` method called during graceful shutdown. When adding a new service with timers/intervals, wire up `cleanup()` and add it to the shutdown block in `index.js`.

---

## Conventions

**Embeds:** Always use `src/utils/embeds.js` (`embeds.success/error/warn/brand/info/base`). **Never** construct `EmbedBuilder` directly — the branding test (`tests/branding.test.js`) fails the build if you do.

**Logging:** Always use `src/utils/logger.js` (`info/success/warn/error/debug/errorContext`). **Never** use `console.log`.

**Ephemeral replies:** Use `flags: [MessageFlags.Ephemeral]`, not the deprecated `ephemeral: true`. User-facing info commands should respect `ephemeralHelper.shouldBeEphemeral(userId, commandDefault, paramOverride)` — the three-tier logic: explicit parameter > user preference (`users.ephemeralPreference`) > command default.

**Error handling:** Use `errorHandlerUtil.handleCommandError(error, interaction, actionDescription)` — it handles deferred/replied state, generates tracking IDs, and detects known Discord API error codes (10003 channel deleted, 10008 unknown message, 50013 missing perms, etc.).

**Moderation actions:** Use `moderationUtil.executeModerationAction()` for the log+DM flow and `moderationUtil.validateHierarchy(executor, target)` for role-hierarchy checks. **`target.bannable`/`kickable` only check whether the bot outranks the target — they do NOT check the executor**, so `validateHierarchy` is required on every moderation handler to prevent privilege escalation.

**Database patterns:** Prefer helpers in `src/utils/dbUtil.js` (`upsert`, `insertIfNotExists`, `deleteIfOwner`, `getCount`, `getPaginatedResults`, `getOne`, `getMany`). `getCount` uses SQL `COUNT(*)` and is 10–100× faster than fetch-all-and-length for large tables.

**Pagination:** Use `paginationUtil.js` (`sendPaginatedMessage`, `paginateArray`) — handles collectors, timeouts, and user validation automatically.

**Input validation:** Any dynamic SQL or Discord snowflake parsing must go through `validationUtil.js` (`isValidSQLIdentifier`, `isValidSQLType`, `isValidSnowflake`).

---

## Config (`config.json` / `config.local.json`)

`config.local.json` overrides `config.json` if present (loaded via `src/utils/config.js`). Shape:

```json
{
  "developers": ["discord-user-id"],
  "brand": { "name": "ByteBot", "color": "#8A2BE2" },
  "colors": { "primary": "#8A2BE2", "success": "#57F287", "error": "#ED4245", "warning": "#FEE75C" }
}
```

Developer-only commands (`devOnly: true`) check against `config.developers`.

---

## Testing

Jest-based. Key suites:
- `tests/branding.test.js` — enforces no raw `EmbedBuilder` usage
- `tests/commands.test.js` — validates every command exports `data` + `execute`
- `tests/events.test.js` — validates every event exports `name` + `execute`
- `tests/utils.test.js` — unit tests for utility functions

`npm run dev` runs the suite before starting the bot; a test failure blocks startup.

---

## Deployment notes

- **Never mix guild and global deployments** — Discord will show duplicate commands. Use `/unregister scope:Global` to clear globals if duplicates appear.
- `AUTO_DEPLOY=none` is the recommended production setting: deploys once on first run (so `/deploy` exists), then you trigger updates manually via `/deploy scope:Global`.
- `/deploy` and `/unregister` are developer-only (`devOnly: true`) with 10s cooldowns.

---

## Gotchas

| Area | Issue |
|---|---|
| Permissions | `.setDefaultMemberPermissions()` is UI-only. Must ALSO export `permissions: [...]` for runtime enforcement. |
| Schema | Adding a column to `schema.js` requires mirroring it in `expectedSchema` (`database/index.js`) or auto-healing fails. |
| BytePods | Co-owner check requires **explicit member-level** `ManageChannels` overwrite. Server Admin does NOT pass. |
| BytePods | Per-user durations must be accumulated in `podStatsTracker.userDurations` — the DB session row is deleted on leave. |
| BytePods | Ownership accept/deny handlers must use `reply()`, not `deferUpdate()` (voice disconnect bug). |
| Moderation | `target.bannable`/`kickable` only checks the bot's hierarchy. Always call `validateHierarchy(executor, target)`. |
| RBAC | Once DB overrides exist for a command, code-defined `permissions` are completely ignored. |
| RBAC | Administrator always bypasses RBAC (but not `devOnly`). |
| Cooldowns | In-memory only, reset on every restart. |
| Achievements | Cache is 1-hour — invalidate after creating a custom achievement. |
| Achievements | Seasonal achievements are validated on award, not on earn — prevents backdating. |
| Discord API | Always wrap DMs in try/catch (users may have DMs disabled; fails with 50007). |
| Discord API | Error code 10003 = channel deleted; handle gracefully in BytePod code paths. |
