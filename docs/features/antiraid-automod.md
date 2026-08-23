# AntiRaid and AutoMod

ByteBot's guild-scoped protection systems implement the current public Greed
[AntiRaid](https://greed.best/docs/moderation/antiraid) and
[AutoMod](https://greed.best/docs/moderation/automod) surfaces without billing,
subscription, vote, SKU, or entitlement checks. Both systems and every module
default off.

## Slash commands

AntiRaid lives under `/server antiraid`:

- `settings`, `toggle`, and global `punishment`
- `module` for massjoin/defaultpfp/newaccounts/massmention/unverifiedbots/username status, threshold, rolling window, punishment, and mass-join lock/punish controls
- `username` add/remove/list/punishment
- `massmention` status/threshold/punishment/timed-lockdown controls
- `unverifiedbots` status and kick/ban controls
- reversible `lockdown`
- user/role `whitelist`
- confirmed `cleanup` by recent member count or join duration

AutoMod lives under `/server automod`:

- `settings`, `toggle`, and `timeout`
- `filter` for spam, caps, emoji, massmention, spoilers, images, invites, links, repetition, walloftext, keywords, musicfiles, nicknames, nsfw, and malicious
- keyword, named-regex, domain-blacklist, allowed-link, and allowed-word lists
- persistent `strikes` toggle/levels/decay/cap/view/reset/settings
- user/role/channel `whitelist`
- ownership-safe Discord native `migration` and `unmigrate`

All configuration requires the caller's real Discord Administrator permission;
ByteBot RBAC may narrow a full slash path but cannot grant Discord authority.
The owner, staff permissions, bots, and configured exemptions bypass local
enforcement. Native migration refuses individual-user exemptions because
Discord rules support only role and channel exemptions.

## Enforcement and recovery

Join and message detectors use bounded per-guild/per-member rolling windows.
Message-create and message-update events are checked before UwU Lock,
autoresponses, or activity tracking. Join enforcement runs before welcome
delivery. Username/default-avatar/account-age/unverified-bot checks use Discord
gateway data; unverified bots are identified by Discord's public Verified Bot
flag.

Actions reuse ByteBot's case-backed Discord permission, hierarchy, protected
target, and moderation logic. Each detector records a durable incident. A
failed punishment is recorded and never cascades to a stronger action. Members
matching several join modules receive the strongest configured action once.
Raid lockdown reuses the existing reversible per-channel state; timed lockdowns are
resumed or released after restart.

Custom regex runs in one lazy Node worker, never on the gateway thread. The
worker receives at most ten 260-character patterns and 2,000 content
characters; a short deadline kills and recreates a stuck worker. Invalid or
timed-out patterns cannot block unrelated gateway work.

Discord migration creates or updates only the exact rule IDs ByteBot records.
It migrates up to 1,000 keywords, 100 allowed terms, 20 exempt roles, and 50
exempt channels. If the NSFW filter is enabled, it also creates a separately
owned Discord sexual-content preset because the public Greed sources do not
publish a local classifier/provider contract. Native action events still apply
configured strikes and punishments. External deletion or startup reconciliation
clears stale ownership, and unmigrate deletes no rule ByteBot did not create.
Local keyword checks remain active for messages Discord delivers, preventing a
native-rule edit from becoming an enforcement bypass.

The exact public-source contract, documented conflicts, explicit ByteBot
defaults, and the NSFW provider boundary are recorded in
[`docs/research/greed-antiraid-automod-contract.md`](../research/greed-antiraid-automod-contract.md).
