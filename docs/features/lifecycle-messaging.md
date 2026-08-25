# Lifecycle messaging

ByteBot exposes custom welcome, goodbye, and boost messages under `/server`, plus Discord's native system-message controls:

- `/server welcome|goodbye|boost setup|channel` selects a channel and activates that documented automation path.
- `/server welcome|goodbye channels action:add|remove|list|message channel:<channel> text:<template>` manages up to four independent destinations, including the primary channel. The first added channel becomes primary; channel-specific templates otherwise fall back to the primary template.
- `/server welcome dm action:toggle|enable|disable|message|config|view|settings|show|test|preview|reset|clear text:<template>` configures mention-safe join DMs. Persistent rolling guild windows admit at most 40 successful or in-flight sends per minute and 750 per hour; failed sends release their reservation and are not queued for retry. Every DM includes a recipient-bound Server Info button.
- `message` saves a validated text or Greed-style `$v` embed template and optional 1-30 second auto-delete.
- Supplemental `enable` and `disable` controls can pause/resume delivery; `format`, `variables`, `test`/`preview`, `view`, and `reset` manage the remaining state.
- Boost additionally exposes the pinned `settings` and `remove` names as aliases for `view` and `reset`.
- `/server system channel|welcome|boost|sticker` changes Discord's native system channel and suppression flags.

All mutations require Discord's real Manage Server permission. ByteBot command access rules can narrow access but cannot grant that Discord authority. Thread destinations additionally require View Channel, Embed Links, Send Messages in Threads, and a sendable membership state. Stored templates cannot parse `@everyone` or role mentions; only the lifecycle member's explicit mention is allowed.

Welcome and its optional DM run only after AntiRaid and join-time AutoMod checks. Welcome and goodbye ignore bots; Welcome pauses after 20 accepted human joins in a rolling minute. Both attempt every configured destination independently. Goodbye tolerates the partial member snapshot Discord provides on removal. Boost fires only on the inactive-to-active premium transition, and `view` renders its configured message while `settings` displays configuration. Test messages use the same renderer, sender, and unmodified presentation as those events.

Templates reuse ByteBot's bounded rich-content engine: Greed-style variables, case-insensitive conditionals, `lower(...)`, timestamp suffixes, saved custom scripts, legacy `$v` embeds, and Components V2 are accepted. `{user}` is the username; `{user.mention}` is the explicit mention.

Migrations `0019_lifecycle_messages`, `0039_premium_delivery_caps`, and `0040_lifecycle_source_drift` add guild/type-scoped state, extra destination channels and templates, and durable Join-DM reservations. Startup compatibility repair copies existing `guilds.welcome_*` settings without deleting the legacy values. Welcome and Join DM reset independently. Guild removal purges every destination, reservation, runtime limiter, level/analytics row, and event-log row even when an optional service did not initialize. Auto-delete timers are best-effort and process-local; their documented 30-second maximum keeps that restart window bounded.

`/autopfp add|interval|test|list|remove` is visible under Administration with real Administrator authority. The public guide does not publish or license its six category image pools or identify a lawful provider API, so ByteBot returns a provider-assets blocker and deliberately creates no configuration, scheduler, or webhook.
