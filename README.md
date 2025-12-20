# ByteBot

A highly modular, scalable, and future-proof Discord bot boilerplate built with Discord.js v14.

## Core Features

-   **Categorized Command System**: Commands are automatically grouped by their parent directory name.
-   **Modular Handler System**: Automatically loads commands and events from their respective directories.
-   **Slash Command Ready**: Built-in support for global and guild-specific slash command registration.
-   **Neon Purple Branding**: Sleek theme (`#8A2BE2`) enforced via a centralized `embeds.js` utility.
-   **Persistence with Drizzle ORM**: Integrated SQLite database for guild settings and persistent data.
-   **Dynamic Testing**: Automated structural integrity audits and utility verification via Jest.
-   **Hardened Security**: Built-in cooldowns, permission checks, role-based access control (RBAC), and DM-to-Guild protection.

## Project Structure

```text
/src
  /commands
    /administration # Server config & management
    /moderation     # Ban, kick, clear, warn, etc.
    /utility        # Info, ping, help
    /fun            # Games and jokes
    /games          # Game-specific integrations (e.g. War Thunder)
    /developer      # Restricted owner-only tools
  /events           # Event listeners (ready, interactionCreate, etc.)
  /handlers         # Dynamic resource loading logic
  /database         # Drizzle schema & SQLite initialization
  /utils            # Logger, Embeds, Permissions, wtService
  index.js          # Entry point & client initialization
/tests              # Unit and integration tests
config.json         # Branding global constants
.env                # Secrets (DISCORD_TOKEN, CLIENT_ID, GUILD_ID)
```

## Getting Started

1.  **Install Dependencies**: `npm install`
2.  **Configure Environment**: Populate `.env` with your bot credentials.
3.  **Database Setup**: Run `npm run db:push` to sync the schema to your local `sqlite.db`.
4.  **Run Development Mode**: `npm run dev` (Runs tests + starts bot).

## Development Guidelines

### 1. Adding Commands
Files in `src/commands/[category]/` are automatically categorized based on the folder name.
- **Required Properties**: `data` (SlashCommandBuilder) and `execute`.
- **Optional Metadata**:
    - `cooldown`: Numerical seconds (defaults to 3).
    - `devOnly`: Set to `true` to restrict usage to IDs in `config.json`.
    - `longRunning`: Set to `true` to automatically defer the reply (essential for APIs).
    - `permissions`: Array of `PermissionFlagsBits` required for the user. [Overridable by DB]

### 2. Command Execution Lifecycle
The `interactionCreate` event follows a strict safety pipeline:
1. **DM Validation**: Checks `data.dm_permission` to prevent crashes in private messages.
2. **Bot Permissions**: Verifies `SendMessages` and `EmbedLinks` before attempting any response.
3. **Security**: Validates `devOnly` status.
4. **Permissions System**:
    - **Database Overrides**: Checks `commandPermissions` table. If overrides exist, the user *must* have one of the whitelisted roles (or be Admin). Standard `permissions` are IGNORED.
    - **Default Permissions**: If no overrides exist, enforces the code-defined `permissions` array.
5. **Cooldowns**: Enforces per-user rate limiting.
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
Admins can use the `/perm` command to manage granular permissions:
- `/perm add [command] [role]`: Whitelist a role.
- `/perm remove [command] [role]`: Remove a role.
- `/perm reset [command]`: Revert to default code permissions.
- `/perm list`: View all active overrides.

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
