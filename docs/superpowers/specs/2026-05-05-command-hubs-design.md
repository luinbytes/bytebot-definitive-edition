# ByteBot Command Hub Redesign

## Status

Accepted direction: Intent Hubs + standardized verbs.

This spec redesigns the slash-command surface so ByteBot feels like one coherent product instead of a set of unrelated modules. It preserves the current feature set while making commands easier to discover, predict, and remember.

## Problem

The current command surface is broad and module-shaped. Users need to remember whether a task lives under `/settings`, `/config`, `/welcome`, `/starboard`, `/achievement`, `/streak`, `/bytepod`, `/bookmark`, or another command. Some commands mix user actions, admin setup, reporting, and maintenance in a single long list. Others use different words for the same intent, such as `view`, `config`, `list`, `leaderboard`, and `top`.

The result is functional but hard to learn. The redesign should keep the same capabilities while giving users a smaller mental map.

## Goals

- Reduce the number of top-level commands users need to understand.
- Group commands by user intent, not source-code module.
- Standardize command verbs across features.
- Keep high-frequency actions short.
- Preserve current functionality during migration.
- Make `/help` teach the new map first.
- Keep permissions, cooldowns, component routing, and existing command behavior intact while moving the entry points.

## Non-Goals

- Removing functionality.
- Rewriting feature internals as part of the command naming pass.
- Changing database schema unless a later implementation step proves it necessary.
- Immediately deleting old commands from Discord.
- Reworking context menus; they can stay as convenience shortcuts.

## Command Grammar

Use this shape:

```text
/<area> <thing> <action>
```

Discord only supports one command, one optional subcommand group, and one subcommand. That means `<thing>` is the subcommand group and `<action>` is the subcommand. Any extra choice, such as DM vs channel reminder, must be an option on the subcommand rather than another command word.

The top-level areas are:

```text
/me
/server
/pod
/mod
/game
/fun
/bot
```

Users should only need to decide whether a task is about them, the server, pods, moderation, games, fun, or the bot itself.

Standard verbs:

```text
view
set
add
remove
list
enable
disable
setup
clear
top
```

Verb rules:

- Use `view` for a single status/config/detail screen.
- Use `list` for multiple records.
- Use `top` for ranked lists.
- Use `set` for changing one simple setting.
- Use `setup` for first-time or multi-field admin configuration.
- Use `remove` for deleting one item.
- Use `clear` for deleting many items.
- Use `enable` and `disable` for binary feature state.
- Avoid synonyms such as `config`, `status`, `leaderboard`, and `delete` when a standard verb applies.

High-frequency actions should stay short:

```text
/pod panel
/me reminder add
/me bookmark search
/mod user warn
/game warthunder stats
/bot help
```

## Hub Structure

### `/me`

Personal user-owned actions and preferences.

```text
/me avatar
/me info
/me settings view
/me settings privacy
/me settings achievements
/me settings pod-summaries
/me reminder add
/me reminder list
/me reminder cancel
/me bookmark list
/me bookmark search
/me bookmark view
/me bookmark remove
/me bookmark clear
/me birthday set
/me birthday remove
/me birthday view
/me streak view
/me achievement browse
/me achievement progress
```

### `/server`

Server information, admin setup, and community systems.

```text
/server info
/server stats
/server config view
/server logs set
/server welcome setup
/server welcome message
/server welcome enable
/server welcome disable
/server welcome format
/server welcome variables
/server welcome test
/server welcome view
/server starboard setup
/server starboard view
/server starboard enable
/server starboard disable
/server starboard top
/server suggestion submit
/server suggestion view
/server suggestion list
/server suggestion top
/server suggestion setup
/server suggestion approve
/server suggestion deny
/server suggestion implement
/server birthday upcoming
/server birthday setup
/server birthday role
/server permissions add
/server permissions remove
/server permissions list
/server permissions reset
/server achievement setup
/server achievement view
/server achievement cleanup
/server achievement roles
/server achievement create
/server achievement award
/server achievement remove
/server achievement enable
/server achievement disable
/server streak top
```

### `/pod`

BytePod actions and BytePod configuration.

```text
/pod panel
/pod stats
/pod top
/pod settings autolock
/pod settings name-style
/pod preset add
/pod preset remove
/pod preset list
/pod template save
/pod template load
/pod template list
/pod template remove
/pod setup
/pod disable
```

### `/mod`

Moderation actions and moderation logs.

```text
/mod user ban
/mod user kick
/mod user warn
/mod user unwarn
/mod user history
/mod logs recent
/mod logs by-moderator
/mod channel clear
/mod channel lock
/mod channel unlock
```

### `/game`

Game integrations.

```text
/game f1 schedule
/game f1 standings
/game f1 circuit
/game f1 drivers
/game warthunder stats
/game warthunder bind
```

### `/fun`

Lightweight fun commands. This command is already close to the target shape.

```text
/fun 8ball
/fun coin
/fun dice
/fun joke
```

### `/bot`

Bot help, health, deployment, and developer operations.

```text
/bot help
/bot ping
/bot stats
/bot deploy
/bot unregister
/bot guild list
/bot guild manage
/bot achievement check
```

## Current Command Mapping

Personal commands:

```text
/avatar                 -> /me avatar
/userinfo               -> /me info
/settings view          -> /me settings view
/settings privacy       -> /me settings privacy
/settings achievements  -> /me settings achievements
/settings summaries     -> /me settings pod-summaries
/reminder me            -> /me reminder add delivery:dm
/reminder here          -> /me reminder add delivery:channel
/reminder list          -> /me reminder list
/reminder cancel        -> /me reminder cancel
/bookmark list          -> /me bookmark list
/bookmark search        -> /me bookmark search
/bookmark view          -> /me bookmark view
/bookmark delete        -> /me bookmark remove
/bookmark clear         -> /me bookmark clear
/birthday set           -> /me birthday set
/birthday remove        -> /me birthday remove
/birthday view          -> /me birthday view
/streak view            -> /me streak view
/streak achievements    -> /me achievement browse
/streak progress        -> /me achievement progress
```

Server and admin commands:

```text
/serverinfo             -> /server info
/stats server           -> /server stats
/config view            -> /server config view
/config logs            -> /server logs set
/welcome setup          -> /server welcome setup
/welcome message        -> /server welcome message
/welcome toggle         -> /server welcome enable or /server welcome disable
/welcome embed          -> /server welcome format
/welcome variables      -> /server welcome variables
/welcome test           -> /server welcome test
/welcome view           -> /server welcome view
/starboard setup        -> /server starboard setup
/starboard config       -> /server starboard view
/starboard enable       -> /server starboard enable
/starboard disable      -> /server starboard disable
/starboard top          -> /server starboard top
/suggestion submit      -> /server suggestion submit
/suggestion view        -> /server suggestion view
/suggestion list        -> /server suggestion list
/suggestion leaderboard -> /server suggestion top
/suggestion setup       -> /server suggestion setup
/suggestion approve     -> /server suggestion approve
/suggestion deny        -> /server suggestion deny
/suggestion implement   -> /server suggestion implement
/birthday upcoming      -> /server birthday upcoming
/birthday setup         -> /server birthday setup
/birthday role          -> /server birthday role
/perm add               -> /server permissions add
/perm remove            -> /server permissions remove
/perm list              -> /server permissions list
/perm reset             -> /server permissions reset
/achievement setup      -> /server achievement setup
/achievement view       -> /server achievement view
/achievement cleanup    -> /server achievement cleanup
/achievement list_roles -> /server achievement roles
/achievement create     -> /server achievement create
/achievement award      -> /server achievement award
/achievement remove     -> /server achievement remove
/achievement enable     -> /server achievement enable
/achievement disable    -> /server achievement disable
/streak leaderboard     -> /server streak top
```

Other hubs:

```text
/bytepod ...            -> /pod ...
/mod ...                -> /mod user/logs ...
/clear                  -> /mod channel clear
/lockchannel lock       -> /mod channel lock
/lockchannel unlock     -> /mod channel unlock
/f1 ...                 -> /game f1 ...
/warthunder ...         -> /game warthunder ...
/fun ...                -> /fun ...
/help                   -> /bot help
/ping                   -> /bot ping
/deploy                 -> /bot deploy
/unregister             -> /bot unregister
/guild ...              -> /bot guild ...
/check-achievements     -> /bot achievement check
```

## Help And Discovery

`/bot help` should teach the new areas first, not implementation categories.

The first help screen should show:

```text
/me      My reminders, bookmarks, birthday, streak, settings
/server  Server setup, suggestions, welcome, achievements, starboard
/pod     BytePod controls, presets, templates, stats
/mod     Moderation actions and logs
/game    F1 and War Thunder tools
/fun     Light commands and games
/bot     Help, ping, stats, developer tools
```

Command detail pages should show examples, not just option lists. For migrated commands, help should mention the old command only as a temporary alias.

## Migration Strategy

Use a staged migration to avoid breaking servers:

1. Add the new hub commands while keeping existing commands available.
2. Update help to feature the new command surface.
3. Add deprecation hints to old commands. Old commands should still execute, but their response should include a short note such as:

```text
This command moved to /pod panel. The old /bytepod panel path still works for now.
```

4. After a stable period, unregister old commands in a planned release.

During migration, the old command modules can call shared handlers used by the new hub commands. The command surface changes should not duplicate business logic.

## Implementation Boundaries

The redesign should introduce routing/adaptor layers before moving internals:

- New hub commands define the Discord slash-command shape.
- Existing feature handlers keep the actual behavior.
- Shared helper functions are extracted only when needed to avoid copy-paste between old and new command paths.
- Tests should cover that the new command paths exist, old paths still load during migration, and permission/runtime gates remain intact.

The current interaction pipeline in `src/events/interactionCreate.js` remains the only slash-command entry point.

## Testing Requirements

Add or update tests for:

- Hub command structural integrity.
- Every current command path mapped to a new hub path.
- Help showing intent hubs instead of code categories.
- Permission arrays on admin/moderation hub commands.
- Old command compatibility during migration.
- Command deployment JSON staying within Discord slash-command limits.

Run:

```bash
npm test
```

For implementation phases that alter command registration, inspect generated command JSON and run a forced guild deployment only in a safe development guild.

## Rollout Risks

- Discord slash commands have nesting and option limits. Some hubs, especially `/server`, may need careful grouping to stay within limits.
- Users may be confused if old and new command names both appear for too long.
- Permission checks must move with command behavior, not just command names.
- Help must be updated early or the new surface will still feel like a maze.

## Implementation Defaults

- Old commands remain visible for one migration release after the new hub commands ship.
- Old commands execute normally during that release and include a short deprecation hint pointing to the new path.
- `/server suggestion submit` stays under `/server` for the first hub release. A later shortcut can be added only if usage shows it is too buried.
- Server stats live at `/server stats`. `/bot stats` is reserved for bot/runtime stats.
- Reminder delivery is an option on `/me reminder add`, not a fourth command token.
- Any command that would exceed Discord's three-token command shape uses an option rather than deeper nesting.
