# Repository Guidelines

## Project Structure & Module Organization

ByteBot is a CommonJS Discord.js v14 bot. The entry point is `src/index.js`, with auto-loaded slash commands in `src/commands/<category>/`, Discord events in `src/events/`, loaders in `src/handlers/`, Drizzle/SQLite code in `src/database/`, helpers in `src/utils/`, and services in `src/services/`. Tests live in `tests/**/*.test.js`. Migrations and snapshots live under `drizzle/`. Global branding and developer IDs are in `config.json`; local overrides may use `config.local.json`.

## Build, Test, and Development Commands

- `npm install` installs dependencies from `package-lock.json`.
- `npm test` runs the Jest suite.
- `npx jest tests/commands.test.js` runs one test file; `npx jest -t "pattern"` runs matching tests.
- `npm start` starts the bot from `src/index.js`.
- `npm run dev` runs tests, then starts the bot.
- `npm run dev:alt` runs tests, then starts with `--dev` for `.env.dev`.
- `npm run db:generate` creates Drizzle migrations from `src/database/schema.js`.
- `npm run db:push` pushes schema changes directly to the local SQLite database.

## Coding Style & Naming Conventions

Use 4-space indentation, semicolons, `const`/`let`, and CommonJS `require`/`module.exports`. Command files should export `data` and `execute`; optional fields include `permissions`, `cooldown`, `devOnly`, `longRunning`, `autocomplete`, and `handleInteraction`. Keep command names lowercase slash-command names, and organize new commands by category folder. Use `src/utils/embeds.js` for all embeds, `src/utils/logger.js` for logging, and `flags: [MessageFlags.Ephemeral]` instead of deprecated `ephemeral: true`.

## Testing Guidelines

Jest uses `testEnvironment: 'node'` and matches `tests/**/*.test.js`. Add or update tests when changing command exports, events, permissions, utilities, schema, or Discord interaction flows. Preserve structural tests: commands need `data` and `execute`, events need `name` and `execute`, and branding tests reject raw `EmbedBuilder` usage.

## Database & Configuration Notes

For schema changes, edit `src/database/schema.js`, mirror expected columns in `src/database/index.js`, then run `npm run db:generate`. Keep secrets in `.env` or `.env.dev`: `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, optional `DATABASE_URL`, and optional `AUTO_DEPLOY`.

## Deployment Notes

The live bot may run under Pterodactyl with a fixed startup command that performs `git pull` only when `/home/container/.git` exists, then runs `npm install` and `node /home/container/${JS_FILE}`. If the panel install becomes divergent or reports unrelated Git histories, do not merge on production. Back up `.env`, the SQLite database from `DATABASE_URL`, and `config.local.json` if present, then use the panel reinstall/fresh clone flow.

If startup fails with a `better-sqlite3` `NODE_MODULE_VERSION` mismatch after a Node image change or reinstall, remove `node_modules` or rebuild/reinstall dependencies so the native module compiles for the active Node version.

## Commit & Pull Request Guidelines

History uses Conventional Commits such as `fix: guard BytePod race`, `feat: add BytePod name style preference`, and `docs: update CLAUDE.md`. Keep commits focused and imperative. Pull requests should summarize behavior changes, list tests run, mention schema or deployment impacts, link issues when relevant, and include screenshots or Discord examples for visible UX changes.

## Agent-Specific Instructions

Do not bypass the central interaction pipeline in `src/events/interactionCreate.js`. Moderation/admin commands must export runtime `permissions` in addition to Discord UI defaults. When adding services with timers, expose `cleanup()` and wire it into graceful shutdown.


<claude-mem-context>
# Memory Context

# $CMEM bytebot-definitive-edition 2026-05-05 7:37pm GMT+1

No previous sessions found.
</claude-mem-context>
