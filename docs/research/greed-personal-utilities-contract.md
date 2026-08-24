# Greed personal utilities contract

Issue: [#52](https://github.com/luinbytes/bytebot-definitive-edition/issues/52)

Parent: [#33](https://github.com/luinbytes/bytebot-definitive-edition/issues/33)

Research frozen: 2026-08-24

This is the implementation gate for AFK, birthdays, reminders, time zones, and
diary entries. It was researched from Greed's current public pages, privacy
policy, and pinned first-party English localization registry. No Greed bot,
support server, or test guild was queried. Implementation and tests begin only
after this contract is committed.

## Source precedence and limits

| Source | What it proves | Limit |
| --- | --- | --- |
| [Current command catalog](https://greed.best/commands) | Greed advertises a command catalog with arguments and permissions. | The rows are client-rendered and the public fetch currently exposes only the shell, so it cannot prove exact current options or permissions. |
| [Pinned official English registry](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands) | Public names, descriptions, response fields, limits, and errors at `greedbest/i18n@3dadc41852a09567add8a6b2b522d5e2b1a53b2f`. | Localization is not a runtime specification and does not prove registration, persistence scope, permissions, or entitlement enforcement. |
| [AFK guide](https://greed.best/docs/miscs/base-commands/afk) | Optional status, 25-character maximum, automatic clearing on the user's next message, and server-member visibility. | It does not publish storage scope, reply/mention matching, or template syntax. |
| [Birthday guide](https://greed.best/docs/miscs/base-commands/birthday) | View/set/reset, one-time setting, month names/numbers, ordinal days, `M/D`, relative display, UTC handling, and automatic notifications. | It does not publish announcement scheduling tolerances or database scope. |
| [Reminder guide](https://greed.best/docs/miscs/reminder) and [current home page](https://greed.best/) | Add/list/remove; multiple reminders; minute/hour/day/week compound durations; automatic notification; current public copy also advertises snooze. | No public reminder count, duration ceiling, snooze duration, or delivery-channel contract was found. |
| [Premium guide](https://greed.best/docs/premium) | Custom AFK embeds are advertised as User Premium. | This program matches the behavior without a billing gate. |
| [Greed privacy policy](https://r2.greed.best/Privacy%20Policy%20%28PRIVATE%20OWNER%20-%20GREED%20DISCORD.COM%20BOT%29.pdf) | Birthday and time-zone data are voluntary and deletable; AFK stores reason/time and is deleted on the next message. | It does not document diary retention or all internal columns. |
| [Discord application-command limits](https://discord.com/developers/docs/interactions/application-commands) | Slash groups/subcommands and option limits. | Discord does not define Greed product semantics. |

The pinned registry paths in this slice are complete: `information/afk.json`,
`information/timezone.json`, `information/timezone/set.json`,
`utility/birthday/index.json`, `utility/birthday/list.json`,
`utility/birthday/remove.json`, `utility/birthday/set.json`,
`utility/reminder/index.json`, `utility/reminder/list.json`,
`utility/reminder/remove.json`, and `fun/diary.json`. Confessions, polls,
threads, quote/random-choice, and other community utilities remain owned by
[#53](https://github.com/luinbytes/bytebot-definitive-edition/issues/53).

## Public behavior matrix

| Public family | Evidenced behavior | Direct registry source | ByteBot path |
| --- | --- | --- | --- |
| AFK | Set an optional status defaulting to `AFK`; announce the state; report AFK users; welcome the user back; reset a custom AFK response; User Premium may configure a custom response with documented user/mentioner/message/time variables. | [`afk.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/information/afk.json) | `/me afk set [status]`, `/me afk embed script`, `/me afk reset` |
| Time zone | Show the invoking or selected user's zone and current time; set a zone; reject invalid or unresolved input. Public examples include IANA zones, abbreviations, and location names. | [`timezone.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/information/timezone.json), [`timezone/set.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/information/timezone/set.json) | `/me timezone view [user]`, `/me timezone set timezone`, `/me timezone remove` |
| Birthday | View a member's birthday; set month/day once; remove it; list upcoming birthdays. | [`birthday/index.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/utility/birthday/index.json), [`set.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/utility/birthday/set.json), [`remove.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/utility/birthday/remove.json), [`list.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/utility/birthday/list.json) | Existing `/me birthday set|remove|view`; existing `/server birthday upcoming|setup|role` |
| Reminder | Create a reminder from compound time units, list it, remove it by index, and receive an automatic notification. Current public copy additionally advertises snooze. | [`reminder/index.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/utility/reminder/index.json), [`list.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/utility/reminder/list.json), [`remove.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/utility/reminder/remove.json) | Existing `/me reminder add|list|cancel`; add `/me reminder snooze id time` |
| Diary | Create at most one entry for the current day, maximum 2,000 characters; view paginated entries; delete a selected entry. | [`diary.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/fun/diary.json) | `/me diary create content`, `/me diary view [page]`, `/me diary delete id` |

`remove` and `reset` are equivalent public birthday deletion labels across the
registry and hosted guide. ByteBot retains the already shipped `remove` path
instead of adding a duplicate subcommand. Existing reminder `cancel` likewise
retains its clearer ByteBot label while matching Greed's indexed removal.

## Slash, scope, and RBAC contract

All paths remain under the existing discoverable `/me` hub. They require a
guild invocation because the current hub is guild-only, but member-owned rows
are global unless stated otherwise:

| Data | Scope and deletion |
| --- | --- |
| AFK status | One global row per user. Delete it atomically when that user next sends a guild message visible to ByteBot. `/me afk reset` also deletes the saved custom template; it does not merely clear an active status. |
| AFK template and time zone | One global user-settings row. Remove the row when both optional values are empty. Time-zone removal is explicit. |
| Diary | Global and user-owned; one row per user per UTC date; individual deletion by owner; no public retention limit is invented. The one-per-day constraint bounds growth naturally. |
| Birthday | Keep the existing per-guild rows and announcement configuration so existing data remains usable. |
| Reminder | Keep existing global-DM or guild/channel rows and the current 25-active/one-year safety bounds. Those bounds are ByteBot behavior because no Greed value was found; #63 owns final public-cap reconciliation. |

The existing path-aware RBAC applies to the full slash paths. No member-owned
path receives an elevated Discord permission. Real Discord send/view/embed
permissions remain mandatory at execution time. Users may read only their own
diary and reminders. Time-zone and birthday views may target another member,
matching the public view behavior. AFK responses disclose only the voluntary
status and elapsed time.

## Exact implementation behavior

- AFK status is trimmed, defaults to `AFK`, and is limited to 25 characters.
  A user's next normal guild message clears the row before mention reporting
  and gets one welcome-back response. Mentions and replied-user mentions report
  every distinct active AFK target once.
- The custom AFK response uses ByteBot's existing rich-content script parser
  and safe variable renderer. It supports the pinned `{message}`, `{time}`,
  `{user}`, `{user.name}`, `{user.avatar}`, `{mentioner}`,
  `{mentioner.name}`, and `{mentioner.avatar}` variables. The premium behavior
  is available to every user without entitlement checks.
- Time zones are validated with the platform `Intl.DateTimeFormat` database.
  ByteBot also resolves a small, documented alias table for the public example
  forms (UTC/GMT, common North American abbreviations, and common city names).
  It does not call an external geocoder or guess an unknown location.
- Birthday input keeps the existing option but accepts `MM-DD`, `M/D`, full or
  abbreviated English month names plus a day, and ordinal day suffixes. An
  invalid calendar day is rejected. Existing rows and announcements remain
  unchanged.
- Reminder snooze accepts the same duration grammar and one-year ceiling as
  reminder creation. It may update only an active reminder owned by the
  invoking user, resets its trigger from now, and reuses the current scheduler.
- Diary dates use UTC consistently with the public birthday/time wording.
  View returns one entry per requested page with stable entry ID and page
  count. Create, view, and delete replies are ephemeral.
- User-provided content is never allowed to generate Discord mentions. Length,
  ownership, date uniqueness, and IDs are validated at command and database
  boundaries. No newly stored value is logged as message content.

## Evidence gaps and honest ByteBot decisions

The public sources do not establish AFK storage scope or full script grammar,
location geocoding rules, diary scope/retention, reminder count/duration caps,
or exact scheduler cadence. The choices above reuse ByteBot's existing global
member-utility behavior, `Intl`, rich-content parser, reminder scheduler, and
SQLite constraints. They are implementation decisions, not claims about
Greed's undocumented internals.

No billing, external geocoder, background worker, new package, or parallel
personal-utility framework is needed. Existing `/me`, reminder, birthday,
permission, database, and event seams remain authoritative.

## Verification gate

Only mocked/local checks are authorized for this slice:

1. exact `/me` registration JSON and path-aware access checks;
2. in-memory SQLite persistence, uniqueness, ownership, deletion, and migration;
3. AFK message clearing and mention/reply reporting through `messageCreate`;
4. time-zone, birthday, duration, and diary validation boundaries;
5. reminder snooze scheduling and restart-safe persistence; and
6. the complete repository Jest gate plus exact-head security review.

Live Discord validation is intentionally owed after the PR. No Greed runtime,
support server, or live bot is used as a test oracle.
