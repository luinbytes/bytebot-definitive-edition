# ByteBot

A highly modular, scalable, and future-proof Discord bot boilerplate built with Discord.js v14.

## Core Features

-   **Modular Handler System**: Automatically loads commands and events from their respective directories.
-   **Slash Command Ready**: Built-in support for global and guild-specific slash command registration.
-   **Neon Purple Branding**: sleek theme (`#8A2BE2`) enforced via a centralized embed utility.
-   **Persistence with Drizzle ORM**: Integrated SQLite database for guild settings and persistent data.
-   **Dynamic Testing**: Automated structural integrity audits and utility verification via Jest.
-   **Hardened Security**: Built-in cooldowns, permission checks, and DM-to-Guild protection.
-   **Global Error Handling**: Prevents crashes from unhandled rejections or API errors.

## Project Structure

```text
/src
  /commands        # Slash commands (with cooldown/permission support)
  /events          # Discord event listeners (ready, interactionCreate, etc.)
  /handlers        # Core logic for dynamic resource loading
  /database        # Drizzle schema and initialization
  /utils           # Shared helpers (Logger, Embeds, etc.)
  index.js         # Bot entry point & client initialization
/tests             # Automated structural and utility tests
config.json        # Brand theme and static globals
.env               # Secrets (Token, IDs)
```

## Getting Started

1.  **Install Dependencies**:
    ```bash
    npm install
    ```
2.  **Configure Environment**:
    Fill in your credentials in the `.env` file:
    - `DISCORD_TOKEN`
    - `CLIENT_ID`
    - `GUILD_ID` (for dev deployment)
3.  **Run Tests**:
    ```bash
    npm test
    ```
4.  **Start the Bot**:
    ```bash
    node src/index.js
    ```

## Adding Content

### Commands
Create a `.js` file in `src/commands/[category]/`. Export an object with:
- `data`: SlashCommandBuilder
- `execute`: Async function
- `cooldown`: (Optional) Seconds
- `permissions`: (Optional) Array of permission bits
- `devOnly`: (Optional) Boolean

### Events
Create a `.js` file in `src/events/`. Export an object with `name` and an `execute` function.

## Database
Schema is defined in `src/database/schema.js`. Use `npx drizzle-kit generate` if you modify the schema.
