# Levels, analytics, and event logging

The public-source contract and source discrepancies are recorded in
[`docs/research/greed-levels-analytics-contract.md`](../research/greed-levels-analytics-contract.md).

## Commands and categories

- Utility: `/levels` provides rank cards, leaderboards, role rewards, setup,
  text/voice configuration, multipliers, exclusions, XP administration,
  level-up messages, live boards, explicit uncertain-board recovery, styling,
  and resets.
- Utility: `/analytics` presents persisted message, reaction, voice, and
  membership activity. `/server stats` is the same handler and data source.
- Administration / Server: `/server logs` configures event destinations for
  messages, members, moderation, server, voice, channels, roles, invites,
  emojis, stickers, integrations, and soundboard events. `/server logs set`
  and `modlog` retain the dedicated moderation-case log behavior. The
  `/server logs recover` path explicitly lists, retries, or abandons uncertain
  sends.

Greed's text aliases are displayed in `/help`; Discord slash commands do not
support aliases. Formerly paid capabilities have no billing, entitlement, or
vote check. Analytics retains at most 1,095 days, event logging accepts at
most 15 distinct destination channels, and rank-card customization is
available to every member.

## Permission and safety model

Member views require only normal response-channel access. Configuration and
XP administration require Manage Server. If reward roles are configured, XP
administration and resets additionally require caller/bot Manage Roles because
they can change those roles. Direct reward mutations also recheck current
caller/bot hierarchy. ByteBot command RBAC may narrow those real Discord
permissions but cannot grant them.

Reset-all and remove-all-log operations use one-time, actor/guild-bound
confirmations that expire after ten minutes. Level-up messages reuse the
bounded rich-content renderer and suppress mentions. Rank-card background
fetches reject private-network targets and enforce HTTPS, image types, input
pixels, and a 5 MiB limit. Log delivery is mention-safe, deduplicated per
event/channel, and stops after three bounded retries. A send whose outcome
cannot be proven is held for administrator recovery instead of riskily resent.

## Persistence

Existing XP is migrated without lowering balances or levels. Text, voice,
and manual adjustments remain separate while `member_levels` stays the
canonical balance used by existing features. Startup records current member
and voice state as a baseline without fabricating offline activity. Live
boards recover after restarts or message deletion within Discord's nonce
window; an older ambiguous creation is held for administrator recovery.
Analytics retention never removes XP balances or level configuration.
