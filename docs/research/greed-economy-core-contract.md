# Greed economy core compatibility contract

Issue: [#48](https://github.com/luinbytes/bytebot-definitive-edition/issues/48)

Parent: [#33](https://github.com/luinbytes/bytebot-definitive-edition/issues/33)

Research frozen: 2026-08-24

This document is the implementation gate for ByteBot's economy ledger,
accounts, bank, earnings, transfers, jobs, role shop, configuration, and
administration. It uses current first-party Greed pages and the official
English localization repository at both the parity program's pinned commit
and the immediately preceding public commit. No live Greed bot or Discord
guild was queried.

## Source precedence and conflicts

| Source | Evidence used | Resolution |
| --- | --- | --- |
| [Current Greed command catalog](https://greed.best/commands) | Advertises every command with arguments and permissions and currently labels 38 commands as Economy in the parity ledger. | The entries are client-rendered and were Cloudflare-protected during this research. Its public HTML exposes the catalog claim, not the individual rows, so it cannot establish exact options or permissions. |
| [Current Greed economy guide](https://greed.best/docs/miscellaneous/economy) | Global balances, wallet/bank, 500-coin daily once per day, hourly work, bank safety from robbery, transfers, leaderboards, 10–1,000,000 game bets, guild role shops, and Manage Guild for shop add/remove. | Strongest current feature overview and numeric-default evidence. The guide's global-only wording conflicts with the registry's guild/global mode; ByteBot keeps both explicitly separated scopes. |
| [Pinned official English economy registry](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy) | Current public names, descriptions, response fields, errors, age gates, daily cap, multi-server cap, balance modes, jobs, shops, and administration. | This is the exact text baseline for the slice. Localization proves a public subject/path, not current registration, option types, numeric defaults, or runtime algorithms. |
| [Pinned cross-locale registry](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales) and [prior English economy registry](https://github.com/greedbest/i18n/tree/7143484353abf8ab9e3eed253e6e6976ea105e25/locales/en/commands/economy) | `open`, `deposit`, `withdraw`, `economy give`, and `economy take` remain in every non-English locale at the pinned commit, and have exact English copy in the immediately preceding official commit. | This is strong current command-subject evidence with an incomplete English tree. ByteBot supplies these capabilities. Current `transfer` terminology wins over old member-to-member `give`; admin `give/take` map to `grant/remove`. |
| [Current Greed premium guide](https://greed.best/docs/premium) and [premium page](https://greed.best/premium) | User Premium gives 1.5x economy earnings / every economy payout. | ByteBot has no billing or entitlement gate. Every eligible earning uses the documented 1.5x allowance. Transfers, deposits, withdrawals, grants, and removals are not earnings and are never multiplied. |
| [Public parity spec](../specs/2026-08-23-public-greed-parity.md) | Guild isolation, highest public caps, no billing, bounded inputs, auditability, and explicit confirmation for destructive work. | Repository requirements define safe behavior where Greed's public sources are silent. |

The official docs repository contains only the overview linked above. Exact
work payout ranges, transfer minimum, preset values, inflation formula, shop
buy option shape, and most administrator permissions are not recoverable from
current first-party documentation.

## Slice boundary and complete registry partition

The pinned English `economy` directory contains 50 JSON files. This issue owns
the 20 current core files below plus five cross-locale account/admin
files. Issue [#49](https://github.com/luinbytes/bytebot-definitive-edition/issues/49)
owns every remaining chance game, competitive action, gang, laboratory, and
leaderboard file on the same ledger.

| #48 core | #49 games, progression, gangs, and rankings |
| --- | --- |
| `index`, `bal`, `balance`, `circulation`, `config`, `daily`, `destroy`, `disable`, `enable`, `job`, `jobAdd`, `jobRemove`, `mode`, `preset`, `reset`, `shop`, `shopAdd`, `shopRemove`, `transfer`, `work`; cross-locale `open`, `deposit`, `withdraw`, `give`, `take` | `blackjack`, `bombs`, `coinflip`, `crash`, `crime`, `dice`, `gamble`, `highlow`, `ladder`, `leaderboard`, `plinko`, `rob`, `roulette`, `scratch`, `slots`; all nine `gang/*` files; all six `lab/*` files |

`crime` and `rob` belong to #49 because each has a random win/loss path and
can destroy or transfer currency. Laboratories belong there because their
time-based production, upgrades, and collection are a progression game. This
partition accounts for every pinned file without implementing #49 early.

## Public feature and entitlement matrix

| Capability | First-party evidence | Known limits/behavior | ByteBot contract |
| --- | --- | --- | --- |
| Account and balance | Current `bal` checks the current mode and refers accountless users to `open`; current `balance` reports wallet, bank, total, and rank. Cross-locale `open` creates an account. | Guild-only/error state is explicit for `balance`; account creation amount is not. | `/economy open` explicitly creates the selected-scope account. `/economy balance` accepts an optional member and reports wallet, bank, total, and committed-ledger rank. Pinned `bal` is an intentional duplicate alias of this capability; Discord slash commands have no alias field, so help records the mapping instead of registering a redundant child. No balance is silently created by a read. |
| Mode | Current `mode` switches between `guild` and `global`. | No scope lifecycle, default, or admin semantics are public. Historical `withdraw` says it is guild-only. | `/economy mode` shows or selects `guild`/`global`. Guild is the default. Global accounts live in a separate fixed scope; guild configuration and guild accounts never share rows. Bank operations remain guild-only. |
| Bank | Current guide and cross-locale `deposit`/`withdraw` move money between wallet and bank. | Positive amount, sufficient source balance, and rate-limit errors are evidenced. No bank interest or capacity is public. | `/economy deposit` and `/economy withdraw` atomically move an integer amount. `all` is represented by an optional amount plus an explicit `all` boolean, not a magic string. No interest, fees, or capacity are invented. |
| Daily | Current guide and `daily` registry entry. | Guide: 500 coins once per day. Registry: six-hour guild/member age gates, daily earning cap 50,000, and at most 30 servers per day. | One claim per UTC day. Base reward is 500, multiplied once by 1.5 to 750. The committed award is clamped to the remaining 50,000 daily earning allowance. A global per-user/day guard records distinct guilds and rejects the 31st. |
| Work and jobs | Current guide says work once per hour; current `work` selects a job; `job` lists/adds/removes jobs; explicit add requires name, min/max payout, and positive cooldown seconds. | Min payout is positive and below max; duplicate names fail; same six-hour age and 50,000/30-server guards as daily. | `/economy work` uses a configured job or the built-in default. `/economy job list/add/remove` manages guild jobs. Default job: `worker`, base 100–250 inclusive, 3,600-second cooldown. Admin ranges and cooldowns use the bounds below. Earnings receive the 1.5x multiplier and daily guards. |
| Transfer | Current `transfer` moves money to another member. | Self/bot targets fail; positive/minimum/sufficient-balance errors exist, but the minimum value is not public. | `/economy transfer` atomically debits sender wallet and credits target wallet in the same scope. Minimum is 1; target must be a non-bot guild member with an account. No multiplier applies. |
| Shop | Current guide defines a guild-only role shop and Manage Guild for add/remove; current `shop` lists/adds/removes/buys; explicit `shop add` adds a role at a price. | Positive price; no public inventory/use semantics, item cap, or refund policy. | `/economy shop list/add/remove/buy` is a guild role shop. A successful buy atomically debits the wallet and records purchase before assigning the role; duplicate ownership is rejected. If role delivery fails, the reserved purchase is atomically reversed. There is no generic inventory/use system because no current source defines one. |
| Enable/config/preset | Current `enable`, `disable`, `config`, and `preset`; config shows status, currency emoji/name, preset, daily cap, starting balance, inflation, circulation, minted, and destroyed. | Preset names/values and inflation algorithm are absent. | `/economy enable|disable|config|preset`. Config may change currency name/emoji, starting balance, and daily cap within bounds. The one ByteBot-owned `standard` preset resets these fields to the exact defaults below; it does not invent undocumented economy styles. Config labels inflation `not modeled` because no public formula exists and ByteBot does not mutate balances passively. |
| Circulation | Current `circulation` and `config` report circulation, total minted, and total destroyed. | No exact formula is public. | `/economy circulation` reports the sum of committed wallet plus bank balances in the selected scope. Lifetime minted/destroyed decimal totals are updated in the same transaction as immutable ledger rows and handled as `BigInt`, with ledger reconciliation available to detect drift. Transfers/bank moves net to zero. |
| Grant/remove | Cross-locale `economy give/take`; #33/#48 explicitly require grants and removals. | Admin permission is implied by `noPermission`; exact permission and overdraft behavior are absent. | `/economy grant` mints to a guild member wallet; `/economy remove` burns up to the requested amount from wallet then bank and rejects an amount above total balance. Both require Manage Server and an audit reason. |
| Reset/destroy/disable | Current `reset` resets one user's data; current `destroy` destroys a positive amount from circulation; `disable` disables the system. | `destroy` does not identify whose balance is reduced. Confirmation is not public, but repository policy requires it. | `/economy reset`, `/economy destroy`, and `/economy disable` retain the pinned names. Reset previews the exact account rows and clears only that guild member's economy state. Destroy targets a member and burns wallet then bank. Disable preserves data. Each issues a 10-minute, actor/guild/action/plan-bound confirmation code and mutates only when the code is supplied once. |

The current registry's `balance` rank is satisfied from committed guild
account totals. Global rank is calculated only when global mode is selected.
The later #49 leaderboard uses the same query and may add presentation, not a
second source of truth.

## Slash command and help contract

`/economy` is a new top-level intent hub because economy does not fit an
existing ByteBot hub. It is filed under the public source category Economy.
This issue registers:

| Slash path | Options | Access |
| --- | --- | --- |
| `/economy open` | none | Member |
| `/economy balance` | optional `member`, optional `scope` | Member |
| `/economy mode` | optional `scope:guild|global` | Member |
| `/economy deposit`, `/economy withdraw` | optional integer `amount`, optional boolean `all` | Member; guild scope only |
| `/economy daily` | none | Member |
| `/economy work` | optional autocomplete `job` | Member |
| `/economy transfer` | required `member`, integer `amount` | Member |
| `/economy job list` | none | Member |
| `/economy job add` | `name`, integer `minimum`, integer `maximum`, integer `cooldown_seconds` | Manage Server |
| `/economy job remove` | autocomplete `job` | Manage Server |
| `/economy shop list` | none | Member |
| `/economy shop buy` | autocomplete `item` | Member |
| `/economy shop add` | `role`, integer `price` | Manage Server; bot Manage Roles/hierarchy preflight |
| `/economy shop remove` | autocomplete `item` | Manage Server |
| `/economy config` | optional currency/config fields; no fields means view | View: member; mutation: Manage Server |
| `/economy circulation` | optional `scope` | Member |
| `/economy enable` | none | Manage Server |
| `/economy preset` | required `standard` preset choice | Manage Server |
| `/economy grant`, `/economy remove` | member, integer amount, required reason | Manage Server |
| `/economy reset`, `/economy destroy` | member, optional confirmation code; destroy also amount; required reason | Manage Server; exact-plan confirmation |
| `/economy disable` | optional confirmation code, required reason | Manage Server; exact-plan confirmation |

The layout consumes 17 direct subcommands and two groups (`job`, `shop`). #49
adds the direct `crime`, `rob`, and `leaderboard` paths plus `game`, `gang`,
and `lab` groups, bringing the planned hub to exactly Discord's 25-option root
limit without exceeding the one-group/one-subcommand nesting rule. Help must
show member paths separately from Manage Server paths,
must identify global mode as opt-in, and must label the 50,000/30-server
earning guards and 1.5x payout behavior.

`/economy config` cannot have path-level static permission metadata
because viewing is public and mutation is privileged. The handler performs
the real Manage Server check when any mutable option is supplied. The root
command has no default Discord permission restriction, so public subcommands
remain discoverable. Existing path-aware disable/allow/deny rules still apply
to every fully resolved command path.

## Persistence and transaction contract

Use SQLite's existing immediate transactions; no new dependency, queue, event
bus, repository layer, or cached balance service is needed.

Minimum durable state:

- economy configuration keyed by `guild_id`;
- economy scope totals keyed by `(scope_type, scope_id)` with exact
  `minted_text` and `destroyed_text` decimal values, including the fixed global
  scope row;
- user mode keyed by `user_id`;
- accounts keyed by `(scope_type, scope_id, user_id)` with integer wallet and
  bank balances;
- immutable ledger rows with transaction ID, scope, user, wallet/bank deltas,
  resulting balances, kind, actor, counterparty, reason, and timestamp;
- one earned-total row keyed by `(user_id, utc_day)`, one unique earning-guild
  row keyed by `(user_id, utc_day, guild_id)`, and action availability keyed by
  `(user_id, action, scope_type, scope_id, subject_id)` where `subject_id` is a
  job ID or the action itself;
- guild jobs keyed by guild and stable job ID/name;
- guild role-shop items and purchase delivery state.

Every balance mutation runs in one `sqlite.transaction(...).immediate()` and:

1. validates the enabled scope, actor, target, amount, age/cooldown/daily
   guard, and current committed balances inside the transaction;
2. applies checked integer deltas with no negative resulting wallet/bank and
   no value beyond the maximum below;
3. writes the account row and one ledger row per affected account under one
   transaction ID, updating the materialized lifetime decimal totals with
   `BigInt` for mint or burn kinds; and
4. commits guards and shop purchase state in the same transaction.

A transfer or bank move must sum to zero. Minting kinds (`open`, `daily`,
`work`, `grant`) and burning kinds (`remove`, `destroy`) are explicit. Reset
writes compensating burn rows before removing auxiliary state, preserving an
audit trail. Ledger rows are never updated or deleted by user/admin commands.
Role delivery uses a reserved/delivered/reversed purchase state so Discord API
failure cannot silently keep the debit. A pending purchase retry first checks
whether the member already has the role: if so it marks the purchase delivered;
otherwise it retries idempotent assignment and reverses the debit only after
Discord proves the role absent. Startup and the next purchase/list action
reconcile pending deliveries, so a crash between role assignment and the
delivered-state write cannot grant both a role and a refund.

The materialized lifetime totals are not a second authority: a maintenance
reconciliation streams ledger amounts into `BigInt` and repairs only a proven
mismatch. Normal reads avoid SQLite numeric `SUM` and JavaScript `Number` for
these unbounded historical values.

The 50,000 earning cap is one user-wide UTC-day total across `daily` and
`work`, regardless of guild/global balance mode. The 30-server guard is the
set of distinct invoking guilds across the same two earning actions that day.
Job cooldown availability remains separate and is scoped to the selected
account plus job ID.

## Bounds and anti-abuse decisions

| Value | Bound |
| --- | --- |
| Operation amount | Integer 1–1,000,000,000,000. |
| Account wallet/bank balance | Integer 0–1,000,000,000,000 per field. |
| Scope circulation | Maximum 9,000,000,000,000,000. Every mint checks projected scope supply inside the same immediate transaction; current-supply/rank aggregates are rejected unless they are JavaScript-safe. Lifetime mint/burn totals use decimal text and `BigInt`, never JavaScript `Number` or SQLite numeric `SUM`. |
| Starting balance | 0–1,000,000. |
| Daily earning cap | Default and maximum 50,000, the current documented cap. |
| Earning guilds per UTC day | 30, the current documented maximum. |
| Daily reward | Documented base 500; all-user 1.5x payout = 750. |
| Default work job | Base 100–250 inclusive, 3,600-second cooldown; all-user 1.5x multiplier applied after the draw. |
| Custom job payout | Base min 1, max 50,000, min <= max; multiplier is clamped by the daily cap. |
| Custom job cooldown | 60–604,800 seconds. |
| Job name/count | 1–32 safe display characters; unique case-insensitively; maximum 25 jobs per guild. |
| Shop price/items | 1–1,000,000,000,000; maximum 100 role items per guild. |
| Transfer | Minimum 1; maximum current wallet and operation cap. |
| Account age gates | Guild must be six hours old and member must have joined six hours ago for `daily`/`work`. |
| Destructive confirmation | Random code valid for ten minutes, one active preview per actor/guild/action, exact-plan fingerprint, single use. |

The `standard` preset is: enabled economy, currency name `coins`, emoji `🪙`,
starting balance 0, 500 base daily reward, 50,000 daily cap, and the default
`worker` job (base 100–250, 3,600-second cooldown). Applying it does not alter
existing balances, ledger rows, custom jobs, or shop items.

The public sources disclose the 500 daily reward, one-hour work cadence, and
50,000/30-server/six-hour guards. The remaining values are explicit ByteBot
decisions: small, visible, configurable where useful, and sufficient to make
the public workflows operable. They are not described as Greed's values.

The 1.5x multiplier uses integer arithmetic (`floor(base * 3 / 2)`) and is
applied exactly once to positive earned payouts. The daily cap applies after
the multiplier. No premium, vote, purchase, subscription, card, crypto, or
entitlement state exists.

This ledger classification is also binding on #49: every positive
system-funded economy payout (including a game win, successful crime, or lab
collection) receives the same 1.5x multiplier exactly once. Returned stakes,
transfers, robbery proceeds, bank moves, grants, removals, and refunds are not
payouts. The 50,000 daily cap remains specific to `daily` plus `work`, because
only those current registry entries expose that error; #49's declared game
bet/payout bounds apply separately.

## RBAC, Discord, and privacy boundaries

| Operation | ByteBot requirement |
| --- | --- |
| Open, balance, mode, bank, daily, work, transfer, job list, shop list/buy | Guild member; path-aware ByteBot RBAC may restrict but not elevate Discord authority. Targets must be current non-bot members where applicable. |
| Job/shop/config/preset mutation, enable, grant/remove | Real `ManageGuild` (`Manage Server`) on the invoking member. Root-level `permissions` remains empty; checks occur at the exact mutating path. Fake permissions do not satisfy the real Discord permission. |
| Shop add/buy role delivery | Bot has `ManageRoles`; role is not managed, `@everyone`, integration-owned, administrator-bearing, or at/above the bot's highest role. The buyer must be assignable at delivery time. |
| Reset/destroy/disable | Real `ManageGuild`, required reason, and exact single-use confirmation. No ByteBot allow rule bypasses these requirements. |

Guild account/config/job/shop rows are keyed by guild and never queried by
user ID alone. Global mode uses one explicit `global` scope with fixed defaults
and no guild administrator controls. A user's mode preference and global
account are cross-guild by definition, but no guild configuration, role shop,
job, member list, or guild audit data enters that scope. Cross-guild daily
abuse rows retain only user ID, UTC day, and the guild IDs already visible to
the bot; they are not exposed to administrators.

Responses suppress mentions. Reasons are bounded plain text and never treated
as templates. Ledger/audit displays expose records only for the current guild
or the requesting user's selected global account; this slice adds no command
for administrators to browse another guild or global user ledger.

## Unknowns and exclusions

- Exact current Greed slash-versus-prefix registration, aliases, option types,
  per-command Discord permissions, payout/cooldown/random algorithms, transfer
  minimum, preset values, inflation formula, and response visibility remain
  unknown.
- `open`, `deposit`, `withdraw`, `give`, and `take` disappeared from the pinned
  English tree but remain in every pinned non-English locale and the prior
  English commit. They are implemented, but the incomplete English tree and
  exact current registration are recorded rather than hidden.
- Generic shop inventory, consumable items, item use, refunds, interest,
  taxes, loans, passive inflation, trading, and market pricing are excluded;
  no first-party source in scope defines them.
- `crime`, `rob`, games, laboratories, gangs, ladders, and leaderboards are
  excluded from this implementation and fully assigned to #49.
- The registry-only developer `global economy` surface (`mint`, `destroy`,
  `adjust`, `init`, `health`, and statistics reset) is developer-only and
  excluded from ordinary guild administration. It remains mapped to #64's
  developer evidence gap rather than silently widening #48 authority.
- No live Greed bot probing, production Discord deployment, billing system, or
  external currency is part of this slice.

## Verification gate for implementation

After this contract is committed, implementation must leave runnable checks
for:

- generated `/economy` JSON, help discovery, future #49 option headroom, and
  path-aware RBAC with public/admin paths separated;
- fresh and upgrade database migrations, composite scope isolation, indexes,
  ledger immutability, and checked balance constraints;
- atomic open/bank/transfer/earn/grant/remove/reset/destroy behavior including
  rollback under rejected or concurrent mutations;
- six-hour age gates, UTC daily cooldown, 50,000 cap, 30-guild guard, and the
  universal 1.5x earning multiplier;
- job bounds/cooldowns and guild isolation;
- shop hierarchy preflight plus debit reservation, idempotent delivery,
  crash/timeout reconciliation, and reversal only after proven role absence;
- exact-plan confirmation expiry, plan drift, actor/guild binding, and reuse
  rejection; and
- focused economy tests, repository command/schema/migration gates, the full
  suite, two-axis review, and a final security diff scan before the PR merges.
