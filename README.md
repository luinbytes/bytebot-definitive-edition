# ByteBot

A modular Discord.js v14 bot with public Greed-parity feature coverage, bounded self-hosted helpers, and explicit provider and runtime boundaries.

`dev` is the integration and test branch for the cumulative parity build. `master` remains the stable release line.

## Core Features

-   **Categorized Command System**: Commands are automatically grouped by their parent directory name.
-   **Modular Handler System**: Automatically loads commands and events from their respective directories.
-   **Slash Command Ready**: Built-in support for global and guild-specific slash command registration.
-   **Neon Purple Branding**: Sleek theme (`#8A2BE2`) enforced via a centralized `embeds.js` utility.
-   **Persistence with Drizzle ORM**: Integrated SQLite database for guild settings and persistent data.
-   **Dynamic Testing**: Automated structural integrity audits and utility verification via Jest.
-   **Hardened Security**: Built-in cooldowns, permission checks, role-based access control (RBAC), and DM-to-Guild protection.
-   **Moderation and Protection**: Case-backed moderation, AntiNuke, AntiRaid, AutoMod, honeypot boundaries, protected targets, warning escalation, recovery, and moderation logs.
-   **Community and Lifecycle**: Welcome, goodbye, boost, Join DM, autoresponder, reaction-role, ticket, giveaway, confession, poll, thread, and server-automation workflows.
-   **Economy and Games**: Guild wallets and ledgers, jobs, shops, games, gangs, laboratories, rankings, bounded fun games, snipe, and roleplay actions.
-   **Voice and Social**: VoiceMaster channel management, Last.fm, self-hosted music, lawful GitHub/Roblox lookups, and canonical social-link reposting.
-   **Case-backed Moderation**: Action-specific Discord permissions, protected targets, setup-owned mute/jail roles, warning escalation, hardbans, history, recovery, and invoke templates under `/mod`.
-   **Rich Content Platform**: Saved embeds, Components V2 layouts, custom responses, global tags, durable pagination, managed webhooks, and server theme colors.
-   **Server Portability and Presentation**: Versioned guild backups, per-server ByteBot profiles, opt-in discovery listings, and range-aware server cards under `/server`.
-   **Self-hosted Music**: Bounded operator-owned playback, queues, DJ controls, presets, and curated autoplay under `/music`.
-   **Information and Lookups**: Discord-native profiles, assets, roles, invites, permissions, and observed name history under `/me` and `/server`, plus bounded web, GitHub, and Roblox lookups under `/lookup` and `/game`.
-   **Social Reposting**: Mention-safe canonical Instagram, TikTok, and X/Twitter post links under `/repost`; persistent provider feeds remain visibly blocked until their credential and terms gates are satisfied.
-   **Local AI Media**: Bounded on-demand Tesseract OCR and eSpeak NG synthetic speech under `/ai`; chat, transcription, and generative media remain visibly blocked without an approved provider or separate worker.
-   **Levels and Analytics**: Text/voice levels, rank cards, event logs, and real-row analytics with the public 15-channel and three-year maxima.
-   **Local Image Tools**: One queued Sharp worker for bounded transforms, effects, captions, comparisons, and dominant-color inspection under `/image`.
-   **Small-VPS Runtime**: Production Compose defaults to 1 CPU, 1 GiB, 128 PIDs, a 640 MiB Node heap, lazy native helpers, and event-loop health checks.

## Project Structure

```text
/src
  /commands
    /administration # Server config & management
    /moderation     # Ban, kick, clear, warn, etc.
    /utility        # Info, ping, help
    /fun            # Games, snipe, roleplay, and community utilities
    /economy        # Wallets, jobs, games, gangs, and rankings
    /music          # Self-hosted playback
    /voice          # VoiceMaster channel management
    /lastfm         # Last.fm account and listening tools
    /games          # Public game lookups
    /context-menus  # Context-menu commands
    /developer      # Restricted owner-only tools
  /events           # Event listeners (ready, interactionCreate, etc.)
  /handlers         # Dynamic resource loading logic
  /database         # Drizzle schema & SQLite initialization
  /services         # Feature services and provider boundaries
  /workers          # Bounded background work
  /components       # Buttons, modals, and select-menu handlers
  /utils            # Logger, embeds, permissions, and shared helpers
  index.js          # Entry point & client initialization
/tests              # Unit and integration tests
config.json         # Branding global constants
.env                # Secrets (DISCORD_TOKEN, CLIENT_ID, GUILD_ID)
```

## Validation boundary

The parity build has source, migration, test, dependency, and Compose-configuration evidence. A passing local suite does not prove a live Discord guild, voice UDP session, credentialed provider, Docker runtime, or production deployment. Those checks require the operator's test environment and remain separate from the source-reconciliation claims.

## Getting Started

1.  **Install Dependencies**: `npm install`
2.  **Configure Environment**: Populate `.env` with your bot credentials.
3.  **Database Setup**: Run `npm run db:push` to sync the schema to your local `sqlite.db`.
4.  **Run Development Mode**: `npm run dev` (Runs tests + starts bot).

## Production container

Copy `.env.example` to `.env`, set the required Discord values, then run
`docker compose up --build -d`. The checked-in Compose profile hard-limits the
container to one CPU and 1 GiB and persists SQLite in the `bytebot-data` volume.
`/bot stats` reports cached Sharp, OCR, speech, and music readiness. Music stays
disabled until `MUSIC_LIBRARY_PATH` points to an operator-owned library; all
native helpers otherwise remain process-free while idle.

The container health check proves the Node event loop is advancing. It does not
claim that Discord, voice UDP, or an external lookup provider is reachable.
See [`greed-small-vps-caps-contract.md`](docs/research/greed-small-vps-caps-contract.md)
for the exact cap, helper, and runtime evidence boundary.

## Development Guidelines

### 1. Adding Commands
Files in `src/commands/[category]/` are automatically categorized based on the folder name.
- **Required Properties**: `data` (SlashCommandBuilder) and `execute`.
- **Optional Metadata**:
    - `cooldown`: Numerical seconds (defaults to 3).
    - `devOnly`: Set to `true` to restrict usage to IDs in `config.json`.
    - `longRunning`: Set to `true` to automatically defer the reply (essential for APIs).
    - `permissions`: Real Discord `PermissionFlagsBits` required for the user. Database rules cannot grant them.
    - `virtualPermissions`: ByteBot-only permission labels that real or configured fake permissions can satisfy.

### 2. Command Execution Lifecycle
The `interactionCreate` event follows a strict safety pipeline:
1. **DM Validation**: Checks `data.dm_permission` to prevent crashes in private messages.
2. **Bot Permissions**: Verifies `SendMessages` and `EmbedLinks` before attempting any response.
3. **Security**: Validates `devOnly` status.
4. **Permissions System**:
    - **Discord permissions**: Enforces code-defined `permissions` first; no ByteBot rule can bypass them.
    - **Scoped access**: Applies root or exact-path disable, allow, and deny rules for the guild, channel, role, or member.
    - **Virtual permissions**: Applies fake role permissions only to explicitly declared `virtualPermissions` checks.
    - **Role allowlists**: Applies compatible `commandPermissions` role restrictions after the checks above.
5. **Rate limits and cooldowns**: Applies the public 15-per-5-second user and 60-per-10-second guild windows, then command-specific cooldowns.
6. **Database Logging**: Updates `commandsRun` and `lastSeen` only after all security checks pass.
7. **Execution**: Wraps the command in a try/catch with automatic error reporting.

### 3. Interaction Flags & Ephemerality
**Important**: The `ephemeral: true` property is deprecated. Always use the new Flags system:
```javascript
const { MessageFlags } = require('discord.js');
// ...
await interaction.reply({ content: '...', flags: [MessageFlags.Ephemeral] });
```

### 4. Custom Permissions (RBAC)
Admins use `/server permissions` to manage granular permissions. The group provides legacy role allowlists (`add`, `remove`), scoped rules (`disable`, `enable`, `allow`, `deny`, `unrestrict`), virtual permission labels (`fake`), dangerous role-permission blocks (`denyperm`), protected moderation targets (`protect`), and inspect/reset paths (`list`, `reset`). See [`docs/features/command-access-controls.md`](docs/features/command-access-controls.md).

Moderators use `/mod` for member actions, guild-local cases and history, invoke templates, warning punishments, and owned setup/reset. See [`docs/features/moderation-workflow.md`](docs/features/moderation-workflow.md).

Server owners and administrators use `/server backup`, `/server customize`, `/server discovery`, and `/server stats` for portability and public presentation. See [`docs/features/server-presentation.md`](docs/features/server-presentation.md).

Operators can enable lawful local voice playback with `MUSIC_LIBRARY_PATH`; server managers configure DJ and autoplay policy under `/music settings`. See [`docs/features/music-playback.md`](docs/features/music-playback.md).

Members use `/me`, `/server`, `/lookup`, and `/game roblox` for the public information, utility, and game lookup family. Weather, definitions, QR codes, GitHub, and Roblox use fixed public providers; translation and website screenshots require the optional provider settings documented in [`.env.example`](.env.example). See [`docs/features/information-lookups.md`](docs/features/information-lookups.md).

### 4. Visual Consistency & Branding
Always use the `src/utils/embeds.js` utility for bot responses to maintain the "ByteBot Purple" theme.

### 4. Database Mutations
The project uses **Drizzle ORM**.
- **Modify Schema**: Edit `src/database/schema.js`.
- **Generate Migrations**: `npm run db:generate`.
- **Sync Changes**: `npm run db:push`.

## Help System & Icons
The `/help` command in `src/commands/utility/help.js` uses a `categoryMetadata` object to map folder names to icons and descriptions. When adding a new command category folder, update this mapping to maintain visual polish.

---
*Empowering communities, one command at a time.*
