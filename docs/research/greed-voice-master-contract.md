# Greed VoiceMaster contract

Issue: [#59](https://github.com/luinbytes/bytebot-definitive-edition/issues/59)

Parent: [#33](https://github.com/luinbytes/bytebot-definitive-edition/issues/33)

Research frozen: 2026-08-24

This is the implementation gate for temporary voice-channel management. It
uses Greed's public VoiceMaster guide pinned at
[`greedbest/docs@60cf7138`](https://github.com/greedbest/docs/tree/60cf7138d45a74bf0cf3fc749c1dc6c43b00df43), the complete English VoiceMaster localization tree pinned at
[`greedbest/i18n@3dadc418`](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/voice/voicemaster), and Discord's current first-party channel, guild, permissions, voice, gateway, and component contracts. No live Greed bot or Discord guild was queried. The live catalog URL was attempted in the shared browser on the freeze date but returned Cloudflare's `Just a moment...` challenge; it is recorded as an evidence gap, not inferred around.

## Source boundary

The pinned English localization files are the authoritative public command
names, descriptions, premium labels, and user-facing error/success strings.
The guide supplies the public workflow and interface semantics. Neither source
publishes the complete Discord application-command option schema, all defaults,
the premium entitlement mechanism, persistence format, or every error branch.
Those omissions are explicitly separated below from ByteBot-owned safety and
compatibility decisions.

| Source | Public evidence | ByteBot consequence |
| --- | --- | --- |
| [VoiceMaster guide](https://raw.githubusercontent.com/greedbest/docs/60cf7138d45a74bf0cf3fc749c1dc6c43b00df43/configuration/voicemaster.mdx) | Joining a designated “Join to Create” voice channel creates a temporary channel; setup creates a category, links the join channel, and posts an interactive interface. | `/voicemaster setup` must create or reconcile those three owned resources and persist exact IDs before enabling the trigger. |
| [VoiceMaster command registry](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/voice/voicemaster) | English contains 33 files: the `voicemaster` root, 27 direct command files including the component translation file, and five `default/*` files. Four descriptions visibly include `(Premium)`: `add`, `category`, `list`, `remove`. | Keep the exact public names and descriptions in the slash command contract below. Preserve premium labels in help/command metadata; ByteBot has no entitlement provider, so premium-marked paths are exposed universally and that policy difference is documented. |
| [Management interface in `index.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/voice/voicemaster/index.json) and guide | Interface title is `VoiceMaster Interface`; description is “Manage your voice channel by using the buttons below.” Buttons are lock, unlock, ghost/hide, reveal, rename, claim, information, increase, decrease, and delete. | Send one component message per configured join channel and one current-channel panel per spawned channel only when configured to do so. Component custom IDs are namespaced and revalidated against persisted ownership. |
| [Discord Channels Resource](https://docs.discord.com/developers/resources/channel) and [Guild Resource](https://docs.discord.com/developers/resources/guild) | Guild channels can be created, modified, permission-overwritten, and deleted through REST; creation/modification/deletion require `MANAGE_CHANNELS`; overwrite edits require `MANAGE_ROLES`; channel create/update/delete produce gateway events. Voice fields include `bitrate`, `user_limit`, `parent_id`, and `rtc_region`. | All Discord mutations check effective bot permissions and handle API failure without claiming success. Cleanup only deletes channel IDs recorded as ByteBot-owned. |
| [Discord Permissions](https://docs.discord.com/developers/topics/permissions) | `VIEW_CHANNEL` includes joining voice; `CONNECT` joins voice; `SPEAK` speaks; `MOVE_MEMBERS` moves members; `MANAGE_CHANNELS` edits channels; `MANAGE_ROLES` edits overwrites/roles. Denying `CONNECT` implicitly denies other voice interaction. | The bot must have `View Channel`, `Manage Channels`, `Manage Roles`, and `Move Members` where the requested action needs them. A caller's role may control their owned channel only through an explicit member overwrite; ByteBot rules never grant Discord permissions. |
| [Discord Voice Resource](https://docs.discord.com/developers/resources/voice) | Voice-region objects expose `id`, `name`, `optimal`, `deprecated`, and `custom`; `rtc_region` accepts a region ID and `null` means automatic. Voice-state objects expose `channel_id`; user voice state changes produce gateway events. | Region options are validated against the guild's current region list; deprecated/unknown regions fail closed; automatic is represented by `null`. Voice state events are the source of creation/empty-channel lifecycle transitions. |
| [Discord Components](https://docs.discord.com/developers/components/reference) | Legacy action rows contain up to five buttons, each interactive button has a unique 1–100-character `custom_id`, and text inputs are modal-only. | Render the ten public actions over at least two action rows; use modal input for rename. Never trust a component ID alone. |
| [Discord Application Commands](https://docs.discord.com/developers/interactions/application-commands) | A chat-input command accepts at most 25 top-level options, and a subcommand group may contain up to 25 subcommands with one supported nesting level. | The registry's 25 direct actions plus its `default` group cannot all be direct Discord options. Keep every evidenced leaf name, but group the four secondary-channel actions under `secondary` so the single `/voicemaster` root is valid. |

## Exact public command inventory

The registry provides names and descriptions, but not a machine-readable
application-command option schema. It exposes 25 direct actions plus the
`default` group, while Discord permits at most 25 top-level options. ByteBot
therefore keeps every public leaf name but groups `add`, `remove`, `list`, and
`category` under `/voicemaster secondary`; this grouping is a documented
platform mapping, not a claim about Greed's live slash layout. The slash option
names and types below are the **minimum safe ByteBot mapping**, selected from
the registry's error strings, public guide examples, and Discord field types.
A row marked “registry gap” must not be described as a verified Greed option
requirement.

### Direct `/voicemaster` subcommands

| Slash path | Registry description / public evidence | Safe option mapping and validation |
| --- | --- | --- |
| `/voicemaster setup` | `Setup the voicemaster interface`; guide creates category, join-to-create channel, and interface. | No options in the public source. Creates/reconciles the server's primary join channel and category. |
| `/voicemaster reset` | `Reset the voicemaster interface`; reset errors distinguish not setup and reset failure. | No options. Disables the interface and removes only owned setup messages/resources; existing temporary channels are cleaned only through the owned cleanup path. |
| `/voicemaster sendinterface` | `Forcefully resend the VoiceMaster interface`. | No options. Sends a fresh interface to the configured destination and records its message ID. |
| `/voicemaster secondary add` | `Add a secondary join-to-create channel (Premium)`. | `channel:<voice channel>` or equivalent creation target is a **registry gap**; ByteBot accepts an existing guild voice channel and records it without claiming ownership. |
| `/voicemaster secondary remove` | `Remove a secondary join-to-create channel (Premium)`. | `channel:<voice channel>` is the minimum unambiguous slash option; remove only its configuration record and never delete an existing user-owned channel. |
| `/voicemaster secondary list` | `List all secondary join-to-create channels (Premium)`. | No options; return a bounded list of configured secondary join channels. |
| `/voicemaster secondary category` | `Set the category for a secondary join-to-create channel (Premium)`. | `channel:<voice channel>` and `category:<category>` identify both resources; both are required in ByteBot. Validate same guild and category capacity. |
| `/voicemaster bitrate` | `Change the bitrate of your current voice channel`. | `bitrate:<integer>`; minimum 8,000 bps. Maximum is Discord's guild-dependent cap, not a Greed-owned constant. |
| `/voicemaster region` | `Change the region of your current voice channel`. | `region:<string>` from current guild voice-region IDs; `auto`/omitted reset is ByteBot-owned because the registry does not publish reset syntax. |
| `/voicemaster status` | `Set the voice status for your current voice channel`. | `status:<string>`; Discord allows up to 500 characters. The registry does not publish whether omission clears it; ByteBot uses empty/`clear` to clear and documents that as owned behavior. |
| `/voicemaster limit` | `Set the user limit for your voice channel`; registry error says not above `99` or below `0`. | `limit:<integer>` in `0..99`; `0` means no limit per Discord. |
| `/voicemaster rename` | `Rename your voice channel`; registry error says name required. | `name:<string>`, trim and validate Discord's 1–100-character channel-name bound. |
| `/voicemaster lock` | `Lock your voice channel`. | No options. Owner-only; deny `CONNECT` to the guild everyone role while preserving explicit permits. |
| `/voicemaster unlock` | `Unlock your voice channel`. | No options. Owner-only; remove the lock deny without erasing member-specific access rules. |
| `/voicemaster hide` | `Hide your voice channel`. | No options. Owner-only; deny `VIEW_CHANNEL` to the everyone role while preserving owner/bot access. |
| `/voicemaster reveal` | `Reveal your hidden voice channel`. | No options. Owner-only; remove the hide deny. |
| `/voicemaster claim` | `Claim an unclaimed voice channel`; errors say caller must be in voice, owner must not still be present, and claim may fail. | No options. Caller must be in the exact owned channel, persisted owner must be absent, and no other member may be the current owner. |
| `/voicemaster information` | `View information about your voice channel`. | No options. Caller must be in an owned VoiceMaster channel; return owner, limit, lock/hide, region, bitrate, and member count without exposing hidden-channel data to outsiders. |
| `/voicemaster delete` | `Delete your voice channel`; errors include not in channel, not owner, database unavailable, failed. | No options. Owner-only, exact owned channel ID, revalidate ownership and deletion result. |
| `/voicemaster drag` | `Drag a user into your voice channel`; errors include required user, target not in channel, and move failure. | `user:<member>` required. Owner-only; target must be in a voice channel and bot must have `MOVE_MEMBERS`. |
| `/voicemaster permit` | `Permit a user to access your voice channel`; user required/not found. | `user:<member>` required. Owner-only; add member `CONNECT` allow. |
| `/voicemaster reject` | `Reject a user from accessing your voice channel`; may kick and revoke access. | `user:<member>` required. Owner-only; deny member `CONNECT`, and disconnect them only if currently in the owned channel. |
| `/voicemaster joinrole` | `Set a role that members get when joining any VoiceMaster channel`. | `role:<role>`; validate manageable, non-managed role and require `MANAGE_ROLES` for the bot. Remove that role when the member leaves every VoiceMaster channel. |
| `/voicemaster template` | `Set the template for voice channel names`; guide syntax is `{owner}'s channel`, reset is `template reset`; registry caps template at 32 characters and marks custom templates premium. | `template:<string>` or the exact slash reset choice is a registry gap. Support a `reset` action and `{owner}` placeholder; cap stored template at 32 characters. |
| `/voicemaster temporary` | `Toggle temporary voice channels that auto-delete when empty`; registry reports enabled/disabled. | `enabled:<boolean>`; scope is guild-wide VoiceMaster configuration. Default enabled after setup is ByteBot-owned because Greed does not publish a default. |
| `/voicemaster buttons` | The file is a component response catalog, not a command description; it names the owner/error/success messages for every interface button. | Treat as the interface component surface, not a separately registered slash command unless the live catalog proves otherwise. This is an evidence gap caused by the localization tree containing a non-description component file. |

### `/voicemaster default` subcommands

The registry has the root description `Configure default settings for new voice
channels` and five child files. Use one Discord subcommand group with the
following paths:

| Slash path | Registry description | Safe option mapping |
| --- | --- | --- |
| `/voicemaster default role` | `Set the default role for new voice channels`. | Optional `role:<role>` to set; omission resets to `@everyone` per the public guide. Reject managed roles. |
| `/voicemaster default name` | `Set the default name template for new voice channels`. | `template:<string>`, 32-character cap, `{owner}` placeholder. |
| `/voicemaster default bitrate` | `Set the default bitrate for new voice channels`. | `bitrate:<integer>`, validate 8,000 through the current guild cap. |
| `/voicemaster default region` | `Set the default region for new voice channels`. | `region:<string>` from current guild regions; `auto`/omitted stores `null`. |
| `/voicemaster default interface` | `Toggle sending interface to new voice channels`. | `enabled:<boolean>`. |

The guide's older `,voicemaster default @Role` syntax confirms the default
visitor role and its reset-to-`@everyone` behavior. It does not prove whether
the current slash command uses required options, a reset keyword, or an
optional field. ByteBot may choose the option shape above, but must label that
choice as framework behavior rather than Greed parity.

## Public interface behavior

Setup creates a category, a primary “Join to Create” standard guild voice
channel, and an interface message. When a member joins a configured join
channel and temporary mode is enabled, ByteBot creates one standard
`GUILD_VOICE` channel, places it under the configured category, applies the
persisted template/default role/bitrate/region/interface settings, records the
creator as owner, and moves the member into it. Creation is considered
successful only after the channel and ownership row are durable; a failed move
or failed persistence cleans the exact newly-created channel.

The interface's public actions are:

| Registry/button label | Effect |
| --- | --- |
| Lock / Unlock | Deny or restore everyone `CONNECT`; explicit permits remain intact. |
| Ghost / Reveal | Deny or restore everyone `VIEW_CHANNEL`; owner and bot keep access. |
| Rename | Open a modal and apply a 1–100-character channel name. |
| Claim | Transfer ownership only after the previous owner has left. |
| Information | Show current owner and channel settings. |
| Increase / Decrease | Adjust the user limit by one, never outside `0..99`. |
| Delete | Delete the exact owned temporary channel. |

The interface message is ordinary public channel content because it is the
server's management surface. Action acknowledgements are ephemeral unless a
public channel notification is necessary to explain ownership transfer or
cleanup. Every component handler rechecks guild, channel type, current voice
membership, owner ID, and persisted state before mutation. Stale/deleted
messages return a recoverable “send interface again” error.

## RBAC and Discord permissions

The guide calls setup/configuration “administrator” behavior and states that
VoiceMaster requires `Manage Channels` and `Move Members`. The registry does
not publish application-command permission metadata. ByteBot therefore uses
the following explicit policy:

1. `/voicemaster setup`, `/voicemaster reset`, `/voicemaster sendinterface`,
   `/voicemaster secondary add|remove|list|category`, `/voicemaster template`,
   `/voicemaster temporary`, `/voicemaster joinrole`, and every
   `/voicemaster default ...` path require the caller's real
   `Administrator` permission. The handler also checks bot-effective
   `ViewChannel`, `ManageChannels`, `ManageRoles`, and `MoveMembers` wherever
   the requested operation needs them.
2. Channel-owner paths (`bitrate`, `region`, `status`, `limit`, `rename`,
   `lock`, `unlock`, `hide`, `reveal`, `claim`, `information`, `delete`,
   `drag`, `permit`, and `reject`) require the caller to be in the exact
   persisted owned channel and to be its current owner. `claim` is the one
   exception: it is allowed to a member in the channel only when the owner is
   absent. Guild owner/Administrator recovery uses setup/reset, not an
   implicit bypass of per-channel ownership.
3. A default visitor role grants no management authority. A permitted member
   gains only the explicit `CONNECT` allow needed to enter a locked channel.
   A join role is an ordinary role and is never treated as an owner role.
4. ByteBot's command allow/deny/fake-permission rules may narrow any path but
   cannot satisfy missing real Discord permissions. All component paths perform
   the same checks; a component ID is not an authorization token.

Discord channel mutation and deletion are irreversible or externally visible.
If the bot lacks the required permission, role hierarchy, channel access, or
member movement authority, the action fails before a state transition. A
`MANAGE_ROLES` check is mandatory before changing member/role overwrites;
`MOVE_MEMBERS` is mandatory before `drag` or forced disconnect. Do not use
`Administrator` as a reason to skip channel-effective permission checks.

## Defaults, limits, and platform constraints

Publicly evidenced values are kept exact:

- default name template: `{owner}'s channel`;
- default visitor role reset: `@everyone`;
- custom template maximum: 32 characters;
- renamed Discord channel name: 1–100 characters;
- voice user limit: 0–99, where 0 means unlimited;
- voice bitrate minimum: 8,000 bits per second;
- Discord voice bitrate maximum: 96 kbps for a normal server, 128 kbps at
  boost level 1, 256 kbps at boost level 2, and 384 kbps at boost level 3 or
  `VIP_REGIONS`; stage channels have a 64 kbps maximum;
- category capacity: Discord documents up to 50 child channels per category;
- channel status: at most 500 characters;
- component custom ID: 1–100 characters; action row: at most five buttons.

Region values are not a static list. Fetch current guild regions, reject
deprecated/unknown IDs, and store `null` for automatic selection. Do not
persist a global guild “region” from the deprecated guild field.

The following are deliberately ByteBot-owned operational bounds, not claims
about Greed: one setup per guild; at most one creation transaction per member
and guild at a time; at most four configured hubs total (the primary plus three
active or pending secondary join channels), matching the current Premium guide; at
most 50 owned temporary channels per configured category because Discord's
category limit is 50; names/templates/status strings bounded before REST;
bounded list responses (25 entries per page); and a short (one-second) empty
channel debounce before cleanup. The last cleanup rechecks ownership, channel
type, and zero members immediately before deletion.

## Persistence, races, restart, and cleanup

Use normalized, guild-scoped SQLite/Drizzle records. At minimum persist:

- one setup/config row with primary and secondary join-channel IDs, category
  IDs, interface message IDs, default/template/role/bitrate/region/interface
  settings, temporary-mode state, and join-role ID;
- one owned-channel row per temporary channel with guild ID, channel ID,
  creator/current owner ID, creation timestamp, and an ownership generation;
- one access row per explicit permit/reject member overwrite when needed for
  deterministic restoration.

Creation reserves a pending row before the first Discord create call, keyed by
`guild_id + source_channel_id + member_id`. Duplicate `VOICE_STATE_UPDATE`
events observe the reservation and do not create a second channel. After
creation, ownership and source IDs are committed before moving the member; if
the move fails, delete only the exact channel and mark the pending row failed.
Unknown REST outcomes remain retryable; never delete by name, category alone,
or a fuzzy template match.

Ownership transfer is a conditional compare-and-set on the current owner and
generation. On owner leave, the row becomes unclaimed only after the leave
event is confirmed; a concurrent owner return cancels the transfer. A claim
must atomically win that state transition before changing overwrites. The
previous owner loses owner-only permissions, and the new owner receives only
the documented management access. Preserve unrelated explicit permits and
the lock/hide state.

An empty temporary channel is eligible for deletion only when it is a
ByteBot-owned `GUILD_VOICE` row, its members cache/API state is empty, and no
creation/claim operation is pending. Cleanup is idempotent: a confirmed
delete or Discord unknown-channel response clears the row; timeout, rate limit,
or unknown failure leaves it retryable and does not fabricate deletion.
Setup reset disables new creation and removes only exact owned interface and
join-channel resources. It must not delete arbitrary user-created channels or
temporary channels whose ownership is ambiguous. Startup reconciliation checks
only exact persisted IDs; stale rows are repaired, missing channels are marked
lost, and unmarked/ambiguous channels are reported but never deleted.

Listen for `VOICE_STATE_UPDATE`, `CHANNEL_CREATE`, `CHANNEL_UPDATE`, and
`CHANNEL_DELETE`. Gateway events can arrive duplicated or out of order, so all
state changes use the persisted generation/conditional transition and all
Discord reads are treated as potentially stale.

## Error and visibility contract

Use the registry's public error classes and equivalent user-facing wording:

- not in a voice channel / not in a VoiceMaster channel;
- not the owner / owner still in the channel;
- required or unknown user; target not in voice; failed move;
- invalid name (1–100 characters); invalid limit (<0 or >99);
- managed role cannot be used as the default role;
- database unavailable; setup already exists; setup/reset failed; deletion or
  channel mutation failed;
- template longer than 32 characters or premium-required when an entitlement
  check exists.

Management command responses are ephemeral and suppress unsolicited mentions.
The interface itself is public in the configured channel. Do not leak a hidden
channel's name, owner, or membership to a caller who cannot view it. Never
report success until both the Discord API mutation and the required durable
state transition have succeeded. If persistence succeeds but Discord fails,
return a recoverable error and leave the row pending/retryable rather than
claiming that the channel was changed.

## Premium and evidence gaps

Greed visibly marks `add`, `category`, `list`, and `remove` as Premium; the
guide marks custom naming templates Premium and the registry includes a
`premiumRequired` template error. ByteBot has no billing/entitlement service,
so these paths are available in the bot and remain labeled Premium in help as
an explicit product-policy difference. Do not create a fake entitlement check.
If billing is added later, map it to a real entitlement record before
enforcing these labels.

The following Greed details remain unverified and must not be presented as
Greed parity:

- live slash option names, required/optional flags, numeric min/max metadata,
  default values, command default permissions, and exact command count;
- whether `buttons.json` is registered as a slash command or only component
  translations;
- whether `add` creates a channel or accepts an existing voice channel, and
  the exact options/limits for `add`, `category`, `remove`, and `list`;
- setup naming/category/channel defaults beyond `{owner}` and
  `@everyone`; whether setup is rerunnable or how an existing interface is
  selected;
- ownership persistence, transfer timing, co-owner semantics, admin bypass,
  permit/reject overwrite precedence, and whether owner return reclaims;
- temporary cleanup delay, restart behavior, logs, audit reasons, and whether
  empty channels are deleted immediately;
- region choices, bitrate defaults, voice status behavior, default interface
  delivery, and the scope of `temporary`, `joinrole`, and default settings;
- premium pricing, server entitlements, and what happens to existing premium
  configuration after an entitlement expires.

The public source is sufficient to implement a coherent, bounded VoiceMaster
feature, but it is not sufficient to claim 100% runtime parity for those
items. This contract makes each missing fact a deliberate ByteBot decision or
an explicit evidence gap before implementation starts.

## Acceptance mapping

| Issue #59 criterion | Contract proof required |
| --- | --- |
| Creation/deletion are race-safe and limited to bot-owned channels | Pending reservation, conditional generation transitions, exact ID ownership marker, empty recheck, startup reconciliation, and refusal to delete ambiguous channels. |
| Owner transfer and permission changes are authorized and recoverable | Owner/claim CAS, effective permission checks, overwrite preservation, role hierarchy checks, retryable unknown REST outcomes, and stale component rejection. |
| Restart reconciliation cleans stale state without deleting ambiguous channels | Exact-ID reconciliation on startup and `CHANNEL_*` events; missing rows marked lost; only confirmed ByteBot-owned channels may be deleted. |

Focused tests may be written only after this document is accepted. They should
cover command JSON/category/path-RBAC, setup idempotence, duplicate voice
events, creation rollback, ownership/claim races, permission overwrite
preservation, bitrate/region/name/limit validation, temporary cleanup,
restart reconciliation, stale components, and refusal to delete ambiguous
channels. No live Greed access or destructive live-guild test is required.
