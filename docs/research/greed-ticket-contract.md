# Greed ticket compatibility contract

Frozen 2026-08-24 before implementation. Sources are Greed's current hosted [ticket overview](https://greed.best/docs/configuration/tickets), its older first-party [end-to-end ticket guide](https://docs.greed.best/server-configuration/tickets), and the complete English ticket registry pinned at [`greedbest/i18n@3dadc418`](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/server/ticket). Discord's [component](https://docs.discord.com/developers/components/reference), [modal](https://docs.discord.com/developers/components/using-modal-components), [channel](https://docs.discord.com/developers/resources/channel), and [permission](https://docs.discord.com/developers/topics/permissions) contracts define the platform boundary. No live Greed bot was probed.

The current and older Greed docs describe different generations of the feature. Current documentation wins where they conflict; older documentation and the pinned registry fill only details the current page does not contradict. Limits and behaviors found only in unrelated bots are excluded.

## Public evidence matrix

| Surface | Verified Greed behavior |
| --- | --- |
| Panels | Administrators create named button or dropdown panels, add at least one option, and send them to a channel. A guild may have 15 panels. The destination requires Send Messages and Manage Webhooks. Deleted panels are not recoverable. |
| Options and categories | Each option may route tickets to its own category, otherwise the panel category and then the guild root are used. The current docs expose option add/remove, custom forms, auto-close when the opener leaves, support roles, and trainee access. |
| Topics | The pinned registry exposes topic add/remove, category, role, and custom embed configuration with at most 25 topics. The older guide confirms topic descriptions, multiple access roles, topic categories, and fallback to the default support role. Custom topic embeds are available without a ByteBot billing gate. |
| Forms | A panel may have multiple forms and each form may contain at most five fields. The public Greed sources do not establish a server-wide form cap or a complete field-type list. |
| Access | Support roles control visibility and claiming. Current docs also expose trainee access and a member/role opening blacklist; blacklisted users may still be manually added to an existing ticket. If an option has no support roles, only Administrators may interact with it. |
| Lifecycle | Tickets can be claimed, released, closed, reopened, deleted, transcribed, renamed, moved, and have their reason edited. Users can be added to and removed from an existing ticket. Delete produces a transcript before the channel is removed. |
| Profiles, lists, and stats | Claim profiles provide a personalized greeting. Tickets can be listed and ticket/staff history and statistics viewed. No additional profile fields or statistics time grammar are publicly established. |
| Limits and automation | The pinned registry exposes one-open-ticket, one-per-topic, and unlimited policies; inactivity can be disabled or configured from 1 through 168 hours. The older guide confirms an inactivity warning with Close/Delete controls and a staff log event. |
| DMs, logs, ratings, and vouches | DMs can be enabled for closure and deletion; deletion includes the transcript ID. Logs cover create, close, delete, transcript, member leave, and inactivity. The pinned registry adds claim DMs, a one-to-five-star deletion rating, and an optional vouch channel. Delivery failures do not change ticket state. |
| Transcripts | On-demand and deletion transcripts include complete message history, member roles/colors, opener/staff/topic metadata, and a unique transcript ID. The current docs require the transcript to reach the log channel before deletion. |
| Reset | Reset disables ticket panels and removes configuration and topic settings. Public sources do not say that reset deletes already-open ticket channels. |

Publicly evidenced maxima are 15 panels, 25 topics, five fields per form, a 2,000-character opening message, an 80-character button label, and 1–168 hours for inactivity. ByteBot applies no lower paid/free tier and invents no unevidenced panel-option, form, or guild-wide option cap.

## ByteBot command and discovery surface

Tickets are an Administration feature. The canonical registered slash root is `/ticket`, matching the pinned public command name and avoiding another top-level alias. It remains visible to all members because ticket actions use ticket-role authorization while configuration paths perform Administrator checks at execution time. ByteBot's path-aware command RBAC may further restrict a path but cannot grant a missing Discord permission.

Discord allows only a root, optional group, and subcommand, so configuration that would require a fourth token opens an ephemeral component/modal manager. The root stays below Discord's 25-option limit:

| Slash path | Display and behavior |
| --- | --- |
| `/ticket setup`, `support`, `category`, `message`, `button`, `reset` | Configure the default system using the public names. Destructive reset requires confirmation. |
| `/ticket panel create|send|manage|remove|list` | Create and publish up to 15 named button/dropdown panels. The manager owns panel options and their forms. |
| `/ticket topics add|remove|category|role|embed|list` | Configure up to 25 reusable topics and their access/category/presentation. |
| `/ticket settings view|dms|inactivity|limit|logs|rating|vouch` | Show or update the pinned settings. `limit` offers one total, one per topic, or unlimited. |
| `/ticket access blacklist|unblacklist|list` | Manage the opening blacklist. Existing-ticket access uses `add` and `remove` below. |
| `/ticket profile set|view|clear` | Manage only the publicly evidenced claim greeting. |
| `/ticket add`, `remove`, `rename`, `claim`, `unclaim`, `close`, `reopen`, `delete`, `transcript`, `move`, `reason` | Run the ticket lifecycle in the current channel. Destructive delete requires confirmation. |
| `/ticket list`, `/ticket stats` | Show bounded, permission-filtered tickets or aggregate/staff counts. No undocumented time grammar is promised. |

Buttons and select menus carry signed, versioned ByteBot custom IDs and route through the existing central interaction handler. Forms use the modal components supported by the installed discord.js version; unsupported current-platform field types are not emulated. Managers state the five-field limit and reject invalid or stale submissions.

## RBAC and Discord permissions

Setup and configuration paths require the caller's real Discord `Administrator` permission because the current Greed docs assign panel setup to administrators. The existing ByteBot command-access rules may deny or narrow `/ticket` or an exact `/ticket <group> <subcommand>` path. Fake permissions and role allowlists never replace that real permission.

Opening requires the member not be blacklisted, the selected panel/option to be enabled, and the configured open-ticket policy to permit another ticket. Ticket actions re-evaluate current guild membership and roles on every request:

- the opener and manually added members may view and speak while the ticket is open;
- configured support roles may view, claim, release, close, reopen, transcribe, rename, move, edit the reason, add/remove members, and delete;
- trainee roles may view and speak but do not gain destructive actions or claiming unless the option explicitly enables that capability in its manager;
- guild owner and real Administrators retain management access;
- a ticket with no configured support role is Administrator-only for staff actions;
- persisted role IDs and historical snapshots never grant present authority.

The bot checks the affected channel rather than only guild-wide permissions. Channel creation and movement require Manage Channels; overwrites require Manage Roles; panel delivery requires Send Messages and Manage Webhooks; controls and logs require View Channel, Send Messages, Embed Links, and Read Message History as applicable; transcript delivery also requires Attach Files. A missing permission fails before a destructive mutation.

## Persistence, races, and cleanup

Ticket workflow state is relational, so it uses normalized SQLite tables rather than encoding the system as generic automation JSON. Configuration, panel deployments, options/forms, tickets, members, actions, ratings, and transcript metadata are guild-scoped. Open tickets snapshot the selected option/topic/form answers needed to preserve history after configuration changes.

Opening reserves a durable pending ticket in a SQLite transaction before channel creation. A guild/member policy constraint prevents concurrent opens from exceeding the configured limit. Claim, close, reopen, and delete use conditional state transitions so repeated component clicks are idempotent. Startup reconciliation may adopt only an exact ByteBot marker for one pending ticket; ambiguous channels are reported and never deleted.

Deletion first claims the ticket state, generates and persists a transcript, sends it to the configured log channel, and only then deletes the exact recorded channel. If transcript persistence or required log delivery fails, deletion stops. Unknown Discord outcomes remain retryable; only confirmed deletion or Discord's unknown-channel response marks the channel deleted. Manual/external channel deletion records the loss but cannot fabricate missing messages.

Reset disables ByteBot-owned panel components and removes configuration after confirmation. It preserves existing ticket channels, ticket/action history, ratings, and transcripts. Ordinary cleanup never infers ownership from a channel name or category.

DM, rating, and vouch delivery is best-effort after durable state changes. Inactivity deadlines persist and resume after restart; member activity refreshes the deadline, one warning is issued per quiet period, and opener departure uses the ordinary close path when enabled.

## Transcript and content safety

ByteBot stores one refreshable transcript record per ticket and returns it as an attachment, so no external transcript host is required. The transcript contains accessible message history, attachment URLs, escaped display metadata, configured form answers, ticket metadata, and action history. HTML and user-controlled text are escaped, mentions are suppressed in bot responses, and archived transcripts require guild owner/Administrator, current authorized support, or the ticket opener.

## Test seams

Focused tests are written before production code and cover command JSON/category/RBAC, manager and component routing, migrations, concurrent opening limits, conditional claim/close/delete transitions, permission overwrites, form snapshots, inactivity recovery, close-on-leave, transcript escaping/persistence/log-before-delete, DM/rating/vouch adapters, reset preservation, startup reconciliation, and refusal to delete ambiguous or untranscribed channels. Discord API simulation is sufficient; no token, live Greed access, or destructive live-guild test is required.
