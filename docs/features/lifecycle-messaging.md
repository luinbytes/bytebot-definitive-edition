# Lifecycle messaging

ByteBot exposes custom welcome, goodbye, and boost messages under `/server`, plus Discord's native system-message controls:

- `/server welcome|goodbye|boost setup|channel` selects a channel and activates that documented automation path.
- `message` saves a validated text or Greed-style `$v` embed template and optional 1-30 second auto-delete.
- Supplemental `enable` and `disable` controls can pause/resume delivery; `format`, `variables`, `test`, `view`, and `reset` manage the remaining state.
- Boost additionally exposes the pinned `settings` and `remove` names as aliases for `view` and `reset`.
- `/server system channel|welcome|boost|sticker` changes Discord's native system channel and suppression flags.

All mutations require Discord's real Manage Server permission. ByteBot command access rules can narrow access but cannot grant that Discord authority. Stored templates cannot parse `@everyone` or role mentions; only the lifecycle member's explicit mention is allowed.

Welcome runs only after AntiRaid and join-time AutoMod checks. Goodbye tolerates the partial member snapshot Discord provides on removal. Boost fires only on the inactive-to-active premium transition. Test messages use the same renderer and sender as those events.

Migration `0019_lifecycle_messages` adds guild/type-scoped state. Startup compatibility repair copies existing `guilds.welcome_*` settings without deleting the legacy values. Auto-delete timers are best-effort and process-local; their documented 30-second maximum keeps that restart window bounded.
