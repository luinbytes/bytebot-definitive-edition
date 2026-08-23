# Greed AntiRaid and AutoMod public contract

Researched 2026-08-23 for issue #40. This is a public-source compatibility
contract, not a claim about Greed's private implementation.

## Sources and precedence

1. Current [AntiRaid guide](https://greed.best/docs/moderation/antiraid) and
   [AutoMod guide](https://greed.best/docs/moderation/automod).
2. Greed's official English i18n registry pinned at commit
   [`3dadc41852a09567add8a6b2b522d5e2b1a53b2f`](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/security).
3. Discord's official [Auto Moderation](https://docs.discord.com/developers/resources/auto-moderation),
   [permissions](https://docs.discord.com/developers/topics/permissions), and
   [user](https://docs.discord.com/developers/resources/user) references for
   platform behavior and limits.

The current guides win when the pinned registry disagrees. Missing option
types, algorithms, defaults, and upper bounds are recorded as ByteBot decisions
instead of being attributed to Greed.

## AntiRaid surface

The current guide documents a global toggle, mass-join, default-avatar,
new-account, mass-mention, unverified-bot, and username modules, manual
lockdown, and a user/role whitelist. The pinned registry additionally confirms
global and per-module punishments, thresholds, mass-join channel locking and
member punishment, username add/remove/list/action, whitelist add/remove/list,
and two cleanup actions: ban the most recent 1-1000 members or ban/kick members
who joined within a duration.

ByteBot exposes these under the existing Administration hub:

| Slash path | Operation |
| --- | --- |
| `/server antiraid settings` | Show global/module state and active lockdown. |
| `/server antiraid toggle` | Enable or disable the system. |
| `/server antiraid punishment` | Set the global `ban`, `kick`, `timeout`, or `jail` fallback. |
| `/server antiraid module` | View/toggle a module, set its threshold/punishment, or set mass-join lock/punish switches. |
| `/server antiraid username` | Add/remove/list literal case-insensitive username patterns and set `kick`/`ban`. |
| `/server antiraid massmention` | View/toggle, set threshold/action, and configure automatic lockdown duration. |
| `/server antiraid unverifiedbots` | View/toggle and set `kick`/`ban`. |
| `/server antiraid lockdown` | Enter or leave the existing reversible all-channel lockdown. |
| `/server antiraid whitelist` | Add/remove/list exempt users and roles. |
| `/server antiraid cleanup` | Confirmed recent-count or joined-within ban/kick cleanup. |

Greed says Administrator can configure AntiRaid; the owner and whitelist are
exempt. ByteBot therefore requires real Discord Administrator for every
configuration and cleanup mutation. Path-aware ByteBot RBAC may narrow this
access but cannot grant Discord authority. The owner, bots, administrators,
and explicit user/role whitelist entries are enforcement-exempt. The i18n
registry's `cannotWhitelistSelf` text is not treated as a security boundary;
administrators are already exempt.

Discord exposes `VERIFIED_BOT` as public user flag `1 << 16`; ByteBot uses that
flag for the unverified-bot module. Default-avatar means the Discord user has no
avatar hash. Username patterns are literal substrings because neither current
guide nor registry documents regex/glob semantics.

The sources do not publish join windows, defaults, or most upper bounds.
ByteBot uses bounded, configurable rolling windows (60 seconds by default,
1-3600 seconds), thresholds of 1-1000, and account-age thresholds of 1-365
days. All systems and modules default off. The global punishment defaults to
`kick`. Mass-join punishment applies only to the bounded current join window;
the optional lock uses ByteBot's durable reversible lockdown state.

## AutoMod surface

The current guide documents explicit global and per-filter enablement. Its
filter list is spam, caps, emoji, mass mention, spoilers, images, invites,
links, repetition, wall of text, keywords, music files, nicknames, NSFW
content, and malicious links. It also documents keyword and domain lists,
link allowlisting, role/member exemptions, settings, timeout duration,
per-filter thresholds/actions, Discord keyword migration, named regex
add/remove/list/test, and strikes toggle/set/decay/cap/view/reset/settings.

The documented actions are `delete`, `timeout`, `warn`, `kick`, `ban`, `jail`,
`strip`, and `stripstaff`. The pinned modular registry narrows per-filter UI
actions to delete/timeout/warn/kick/ban/jail, while the current guide's global
punishment list includes all eight; ByteBot makes all eight available without
an entitlement check.

ByteBot exposes these under `/server automod`:

| Slash path | Operation |
| --- | --- |
| `/server automod settings` | Show global/filter/timeout/migration state. |
| `/server automod toggle` | Enable or disable the system. |
| `/server automod timeout` | Set the timeout duration. |
| `/server automod filter` | View/toggle a named filter and set threshold, secondary threshold, or action. |
| `/server automod keywords` | Add/remove/list/confirmed-clear keywords. |
| `/server automod regex` | Add/remove/list/test named patterns. |
| `/server automod blacklist` | Add/remove/list/confirmed-clear domains. |
| `/server automod allowlinks` | Add/remove/list domains exempt from link checks. |
| `/server automod strikes` | Toggle/set/decay/cap/view/reset/settings. |
| `/server automod whitelist` | Add/remove/list exempt users and roles. |
| `/server automod migration` | Create/update or remove ByteBot's exact Discord keyword rule. |

Configuration requires real Discord Administrator. Enforcement exempts the
owner, bots, members with Administrator/Manage Messages/Moderate Members, and
explicit users/roles. Every list is guild-scoped and bounded when displayed.
All systems and filters default off. Default action is `delete`; timeout is five
minutes. Keyword matching is case-insensitive whole-word/phrase matching, with
explicit allowlisted words taking precedence. Domain comparison parses URLs
and compares normalized hostnames, including subdomains.

Filter thresholds use the smallest observable unit named by the guide:

- spam: messages in a 10-second rolling window;
- caps: uppercase percentage after at least 10 letters;
- emoji, mass mention, spoilers, and images: count per message;
- repetition: normalized exact repeats in a 30-second window (the registry
  mentions similarity but publishes no algorithm);
- wall of text: character count plus a separately configurable newline count;
- music files: audio MIME types or common audio filename extensions;
- nicknames: configured keywords on member join/update;
- links and invites: parsed URL/invite presence;
- malicious: configured blacklisted domains;
- NSFW: Discord's native sexual-content preset when migrated; ByteBot does not
  invent an unsafe local image classifier.

The NSFW limitation is an explicit platform/source boundary: no public Greed
classifier or provider contract is documented. Local message enforcement skips
that filter; `/server automod migration` is the supported enforcement path.
This is not described as full private-runtime equivalence.

The pinned registry provides these bounds: keyword length at most 32 characters,
strike levels 1-10, decay 1-720 hours, and cap 1-100. ByteBot caps stored lists
at Discord's relevant native limits: 1000 keywords, 10 regex patterns of at
most 260 characters, 100 allowed terms, 20 exempt roles, and 50 exempt
channels. ByteBot additionally caps other displayed/stored rule lists at 1000.

## Resource and failure safety

Message/join windows retain only the configured interval and have a hard key
and event ceiling. Input is capped at Discord's 2,000-character message limit.
Custom JavaScript regex never executes on the gateway thread: a single lazy
Node worker evaluates the guild's bounded pattern batch, is killed on a short
deadline, and is recreated after timeout. Invalid or timed-out patterns fail
closed for that rule without blocking unrelated gateway work.

Actions reuse ByteBot's case-backed moderation and hierarchy checks. Message
deletion requires the bot's real Manage Messages permission; kick, ban,
timeout, jail, strip, and staff-strip retain their existing Discord permission
preflights. Configuration changes are recorded as moderation cases. A failure
does not cascade into a stronger punishment. When one join matches multiple
modules, ByteBot applies the strongest configured punishment once and records
the complete matched-module set, avoiding contradictory repeat actions.

Discord native keyword migration is ownership-safe: ByteBot stores the exact
rule ID it creates, updates only that rule, and deletes only that rule on
unmigrate. Discord requires Manage Guild, permits 1000 keywords and 10 Rust
regex patterns per keyword rule, and blocks matched messages before the bot
receives them. ByteBot retains local keyword enforcement as a bounded fallback
for messages Discord delivers, so disabling or editing the native rule cannot
silently bypass the configured filter.

## Premium parity

The current guides and pinned strings label AntiRaid, username/mass-mention
protection, regex, strikes, blacklist, repetition, wall-of-text, malicious,
NSFW, and images as premium in various combinations. Issue #40 requires the
former paid surface without billing checks, so ByteBot applies no entitlement,
subscription, vote, SKU, or premium-role gate to any command or detector above.
