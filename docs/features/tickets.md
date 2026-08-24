# Ticket workflows

`/ticket` is ByteBot's Administration surface for support panels, topics, forms, access, claims, transcripts, ratings, inactivity, and logs. It matches the public Greed ticket contract without billing or entitlement gates.

Start with `/ticket setup channel:#support`. This creates a default button panel and option. For a custom system, use `/ticket panel create`, then `/ticket panel manage` to add options and forms, configure support/trainee roles, set option categories, assign topics/forms, and enable close-on-leave. Use `/ticket panel send` after at least one option exists. Discord limits one published panel message to 25 options and one modal to five fields; Greed's public 15-panel and 25-topic maxima are enforced.

Panel appearance scripts support message content and embeds. ByteBot owns the panel's buttons or dropdown, so scripts with additional interactive components are rejected instead of silently replacing ticket controls.

Configuration requires the caller's real Discord **Administrator** permission. ByteBot's command rules may further restrict exact `/ticket` paths but cannot grant that platform permission. Ticket actions instead use current support/trainee roles and a per-ticket access snapshot, so later panel/topic cleanup cannot orphan an active case. With no option support role, staff actions are Administrator-only. Trainees can view and speak; claiming is an explicit per-option switch.

The bot needs **Manage Channels** and **Manage Roles** to open tickets. Panel destinations also need **View Channel**, **Send Messages**, **Embed Links**, and **Manage Webhooks**. Configure `/ticket settings logs` before deletion: ByteBot persists the full escaped transcript, sends it to that log, and only then deletes the exact tracked channel. Failed persistence or log delivery leaves the channel intact. `/ticket transcript id:` retrieves an archived transcript for its opener or currently authorized staff.

Opening numbers and member limits are reserved in an immediate SQLite transaction. Lifecycle updates are conditional and idempotent. Pending tickets reconcile only against an exact ByteBot channel marker on startup; ambiguous matches are reported and never deleted. Reset disables owned panels and removes configuration while preserving ticket channels, action history, ratings, and transcripts.

The source matrix, conflicts, limits, and deliberate ByteBot decisions are recorded in [the ticket compatibility contract](../research/greed-ticket-contract.md).
