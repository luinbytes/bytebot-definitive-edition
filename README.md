# ByteBot 🤖

A highly modular, scalable, and future-proof Discord bot boilerplate built with Discord.js v14.

## 🌟 Core Features

-   **Modular Handler System**: Automatically loads commands and events from their respective directories.
-   **Slash Command Ready**: Built-in support for global and guild-specific slash command registration.
-   **Persistence with Drizzle ORM**: Integrated SQLite database with Drizzle ORM for easy schema management and guild-specific settings.
-   **Robust Logging**: Color-coded, timestamped console logs via a custom utility.
-   **Future-Proofing**: Standardized command objects with built-in support for cooldowns, permissions, and developer-only flags.
-   **Global Error Handling**: Prevents crashes from unhandled rejections or API errors.

## 📂 Project Structure

```text
/src
  /commands        # Slash commands (utility, fun, admin, etc.)
  /events          # Discord event listeners (ready, interactionCreate, etc.)
  /handlers        # Core logic for dynamic resource loading
  /database        # Drizzle schema and initialization
  /utils           # Shared helpers (Logger, etc.)
  index.js         # Bot entry point & client initialization
config.json        # Static global settings
.env               # Secrets (Token, IDs)
```

## 🚀 Getting Started

1.  **Install Dependencies**:
    ```bash
    npm install
    ```
2.  **Configure Environment**:
    Fill in your credentials in the `.env` file:
    - `DISCORD_TOKEN`
    - `CLIENT_ID`
    - `GUILD_ID` (for dev deployment)
3.  **Run the Bot**:
    ```bash
    node src/index.js
    ```

## 🛠️ Adding Content

### Commands
Create a `.js` file in `src/commands/[category]/`. Export an object with `data` (SlashCommandBuilder) and an `execute` function.

### Events
Create a `.js` file in `src/events/`. Export an object with `name` (Discord Event) and an `execute` function.

## 📊 Database
Schema is defined in `src/database/schema.js`. Use `npx drizzle-kit generate` if you modify the schema.
