# Tickets: Community Foundation

Implements `docs/specs/2026-07-12-community-foundation.md` on top of the `master` branch.

Work the frontier: ticket 1 first, then ticket 2 and ticket 4 can proceed, followed by ticket 3 after ticket 2.

## Make achievement awarding idempotent

**What to build:** Achievement awarding is safe to retry and safe under repeated or concurrent activity checks. A member receives one durable achievement record and one reward or notification outcome, while side-effect failures do not erase the earned achievement.

**Blocked by:** None, can start immediately.

- [ ] Repeated award attempts leave one durable achievement record.
- [ ] Simulated concurrent or repeated checks do not duplicate the award.
- [ ] Notifications and role rewards are not duplicated.
- [ ] A failed side effect leaves the earned achievement persisted.
- [ ] Existing guild enablement and user opt-out behaviour remains intact.
- [ ] Tests use the public activity or achievement service seam and the existing Discord simulation patterns where applicable.

## Add achievement chain definitions and progress

**What to build:** Members can see ordered achievement chains and their progress, derived from durable achievement state. Completed steps remain completed and repeated reads or unlock checks do not duplicate state.

**Blocked by:** Make achievement awarding idempotent.

- [ ] Chain definitions use the existing achievement definition vocabulary.
- [ ] Incomplete chains show the next missing step.
- [ ] Completed chains show all steps complete.
- [ ] Repeated progress evaluation is stable and does not create duplicate unlocks.
- [ ] Missing or invalid definitions are handled safely.
- [ ] Tests cover incomplete, complete, repeated, and missing-definition states.

## Add the member community hub

**What to build:** Members have one `/community` entry point that navigates to existing progress, chain, achievement, streak, BytePod, birthday, reminder, suggestion, starboard, bookmark, game, and activity capabilities without removing existing commands.

**Blocked by:** Make achievement awarding idempotent; Add achievement chain definitions and progress.

- [ ] The command is discoverable through the existing help and command hub conventions.
- [ ] The initial response exposes the agreed community destinations.
- [ ] Navigation controls work through the existing Discord API simulation suite.
- [ ] Existing commands remain available.
- [ ] Invalid or unavailable destinations receive a safe user-facing response.
- [ ] Tests cover the initial response and navigation interactions.

## Add the admin community view

**What to build:** Administrators can open `/server community view`, a read-only community configuration view that summarizes enabled features, missing configuration, and detectable permission problems without creating or mutating Discord resources.

**Blocked by:** Make achievement awarding idempotent.

- [ ] Configured and incomplete guild states render distinct status information.
- [ ] Existing persisted settings are represented accurately.
- [ ] Detectable permission gaps are reported without destructive actions.
- [ ] Opening or refreshing the view does not create channels, roles, jobs, or other resources.
- [ ] Tests cover configured and incomplete states through simulated interactions.
