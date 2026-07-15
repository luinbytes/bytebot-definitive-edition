# Community Foundation

## Problem Statement

ByteBot has a broad set of community features, including achievements, streaks, BytePods, birthdays, reminders, suggestions, starboard, bookmarks, games, and statistics. These features are exposed through separate command hubs and setup paths, which makes them difficult to discover and configure consistently.

Achievement claiming is also a critical foundation for future community features. The current flow performs eligibility checks before awarding records, while the database has a composite uniqueness constraint. The behaviour needs an explicit idempotency guarantee and regression coverage so repeated or concurrent checks cannot duplicate rewards or notifications.

## Solution

Strengthen the achievement claim boundary so awarding is idempotent and observable through the existing activity and achievement service interfaces. Then add a unified community entry point and an administrator setup/status view that make the existing community systems discoverable without removing existing commands.

Achievement chains are deliberately deferred until the reliable claim boundary and unified community surface exist.

## User Stories

1. As a member, I want an achievement to be awarded once when I first meet its criteria, so repeated activity cannot duplicate it.
2. As a member, I want repeated checks to leave my achievement state unchanged, so retries are safe.
3. As a member, I want concurrent activity checks to produce one achievement and one reward notification, so race conditions do not create duplicate rewards.
4. As a member, I want a failed notification or role grant not to erase the achievement record, so earned progress is durable.
5. As an administrator, I want achievement awarding to respect the existing guild enablement and user opt-out settings.
6. As a member, I want one community command that points me to my progress, achievements, streak, BytePod, birthdays, reminders, suggestions, starboard, bookmarks, games, and server activity.
7. As a member, I want the community entry point to use the same terminology as the existing commands and help system.
8. As an administrator, I want one community configuration view that shows which community systems are enabled and which required channels or settings are missing.
9. As an administrator, I want configuration status to be read-only and safe by default, so opening it cannot mutate server state.
10. As an administrator, I want setup status to identify missing permissions or required channel configuration where ByteBot can determine them without destructive actions.
11. As a member, I want existing commands to keep working while the unified community surface is introduced.
12. As a maintainer, I want the new behaviour covered by the existing Discord API simulation test suite, so tests do not require a real Discord token or bot.
13. As a maintainer, I want achievement persistence and community navigation tested at public interaction seams rather than private implementation details.
14. As a member, I want achievement chains to show my progress through ordered milestones, so I know what to do next.
15. As a member, I want an achievement chain step to unlock only once, so chain rewards cannot duplicate.
16. As an administrator, I want chain definitions to use the existing achievement definition system, so chains do not require a separate hardcoded reward system.

## Implementation Decisions

- Keep the existing achievement service as the public seam for automatic and manual awarding.
- Make the award operation safe to repeat. The database uniqueness constraint remains the final duplicate guard, while the service handles duplicate outcomes as an already-earned result rather than a fatal error.
- Preserve the distinction between durable achievement persistence and side effects such as DM notifications and role grants. Persistence must not be rolled back because a side effect fails.
- Preserve guild achievement enablement and user opt-out behaviour.
- Add a member-facing community hub command using the existing command and interaction patterns. It should provide navigation to existing community capabilities rather than duplicate their business logic.
- Add an administrator-facing `/server community view` using existing configuration and permission helpers where possible.
- Read status from current persisted configuration and available Discord state. Do not create channels, roles, scheduled jobs, or other resources as a side effect of viewing status.
- Add achievement chains as ordered definitions layered over the existing achievement definitions and durable activity achievement records. Chain progress must be derived from durable achievement state, not maintained as a second independent unlock ledger unless the existing schema proves that a separate field is required.
- Keep chain progress and unlock display available through the community surface without duplicating achievement award logic.
- Keep legacy commands and existing intent hubs available. This change improves discoverability and setup coherence without a breaking command migration.
- Do not add weekly quests, seasons, team events, or new reward types in this slice. They can consume the reliable achievement and community seams later.
- Use the existing SQLite/Drizzle schema and migration conventions. No new dependency is expected.

## Testing Decisions

- Test the achievement award behaviour through the existing activity/achievement service seam and database-backed test setup.
- Test duplicate award attempts and concurrent or simulated repeated checks to prove one durable achievement record and one notification event.
- Test side-effect failure separately from persistence, proving a failed DM or role operation does not remove the earned record.
- Test the community command through the existing Discord API simulation suite, including the initial response and navigation controls.
- Test the `/server community view` administrator configuration view through the same simulated interaction boundary, including configured and incomplete server states.
- Test achievement chain progress through the public achievement/community display seam, including incomplete, completed, repeated, and missing-definition cases.
- Prefer literal expected outcomes over implementation snapshots. Do not mock private helpers when a public command or service seam is available.
- Run focused tests during implementation and the full repository test suite before opening the pull request.

## Out of Scope

- Weekly quests, seasons, team events, or new points economies.
- Removing or renaming existing commands.
- Automatic community feature setup that creates Discord resources.
- Replacing the existing help or intent hub system wholesale.
- Real Discord API calls, production database migration execution, or live server changes.

## Further Notes

The repository target is the `master` branch. The current repository already has command hubs and a help overview, so the community hub should extend existing navigation rather than introduce a parallel command taxonomy. The first implementation ticket should establish the achievement idempotency contract and tests before the member-facing community surface depends on achievement progress.
