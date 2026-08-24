# Levels, analytics, and event logging

The public-source contract and source discrepancies are recorded in
[`docs/research/greed-levels-analytics-contract.md`](../research/greed-levels-analytics-contract.md).

## Commands and categories

- Utility: `/levels` provides rank cards, leaderboards, role rewards, setup,
  text/voice configuration, multipliers, exclusions, XP administration,
  level-up messages, live boards, styling, and resets.
- Utility: `/analytics` presents persisted message, reaction, voice, and
  membership activity. `/server stats` is the same handler and data source.
- Administration / Server: `/server logs` configures event destinations for
  messages, members, moderation, server, voice, channels, roles, invites,
  emojis, stickers, integrations, and soundboard events. `/server logs set`
  and `modlog` retain the dedicated moderation-case log behavior.

Greed's text aliases are displayed in `/help`; Discord slash commands do not
support aliases. Formerly paid capabilities have no billing, entitlement, or
vote check. Analytics retains at most 1,095 days, event logging accepts at
most 15 distinct destination channels, and rank-card customization is
available to every member.

## Permission and safety model

Member views require only normal response-channel access. Configuration and
XP administration require Manage Server. Reward mutations additionally
require Manage Roles and current caller/bot hierarchy access. ByteBot command
RBAC may narrow those real Discord permissions but cannot grant them.

Reset-all and remove-all-log operations use one-time, actor/guild-bound
confirmations that expire after ten minutes. Level-up messages reuse the
bounded rich-content renderer and suppress mentions. Rank-card background
fetches reject private-network targets and enforce HTTPS, image types, input
pixels, and a 5 MiB limit. Log delivery is mention-safe, deduplicated per
event/channel, and stops after three bounded retries.

## Persistence

Existing XP is migrated without lowering balances or levels. Text, voice,
and manual adjustments remain separate while `member_levels` stays the
canonical balance used by existing features. Startup records current member
and voice state as a baseline without fabricating offline activity. Live
boards recover after restarts or message deletion, and analytics retention
never removes XP balances or level configuration.
