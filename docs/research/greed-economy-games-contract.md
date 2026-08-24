# Greed economy games and progression contract

Issue: [#49](https://github.com/luinbytes/bytebot-definitive-edition/issues/49)

Parent: [#33](https://github.com/luinbytes/bytebot-definitive-edition/issues/33)
and [#48](https://github.com/luinbytes/bytebot-definitive-edition/issues/48)

Research frozen: 2026-08-24

This is the implementation gate for the remaining public Economy family:
games, crime, robbery, leaderboard, gangs, and laboratories. It was researched
from Greed's current public pages and the pinned first-party English
localization registry. No Greed bot, support server, or test guild was queried.
Only this contract is being changed for issue #49 research.

## Source precedence and limits

| Source | What it proves | Limit |
| --- | --- | --- |
| [Current Greed command catalog](https://greed.best/commands) | The catalog claims to expose every command together with arguments and permissions. | The command rows are client-rendered and the public fetch currently exposes only the catalog shell, so exact current arguments and permissions cannot be recovered from this page. |
| [Current Greed Economy guide](https://greed.best/docs/miscellaneous/economy) | Economy overview, daily/work onboarding, global balances, wallet/bank, robbery, the complete current game list, the 10–1,000,000 game-bet range, role shop, and gang feature names. | It does not document crime/rob odds, game algorithms, game-specific options, gang limits, or laboratory behavior. |
| [Pinned official English registry](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy) | Public command names, descriptions, success fields, and error strings at `greedbest/i18n@3dadc41852a09567add8a6b2b522d5e2b1a53b2f` (2026-03-29). | Localization is not a runtime specification. It does not prove slash registration, option types, payout algorithms, random odds, persistence, or entitlement checks. |
| [Current Greed Premium guide](https://greed.best/docs/premium) | User Premium advertises `1.5x economy earnings`. | It does not define which game/progression events count as earnings. #48's already approved ledger rule applies the multiplier once to positive system-funded payouts in this slice. |
| [Discord application-command limits](https://discord.com/developers/docs/interactions/application-commands) | Slash commands may use subcommands and subcommand groups, and a command cannot exceed Discord's published option limits. | Discord does not define Greed's product semantics. |
| [Discord permissions](https://discord.com/developers/docs/topics/permissions) | Real Discord permissions are the authority boundary for member and bot operations. | Greed's command-specific permission rows are not exposed in the current catalog fetch. |

The pinned registry contains 50 Economy JSON files. #48 owns the account,
bank, earnings, job, shop, configuration, and administration files. #49 owns
the following 30 remaining files: 15 direct game/action files, nine `gang/*`
files, and six `lab/*` files. The complete split is recorded in the #48
[core contract](greed-economy-core-contract.md); no registry file is silently
dropped.

## Public surface inventory

Every row below links directly to the pinned first-party JSON file that owns
the wording. Repeated error fields are summarized once in the table and are
not treated as additional undocumented behavior.

### Games

The current Economy guide says that every listed game accepts a bet between
10 and 1,000,000 coins and describes the family as games that can double or
lose coins. The guide lists all twelve games below. The registry confirms each
name and description, and supplies a common service/rate-limit/disabled/
positive-amount/insufficient-balance/database-error envelope for the games.
That evidence does not establish exact odds, payout tables, house edge,
interaction flow, or whether a bet is deducted from wallet only or from a
combined balance.

| Public path | Pinned description and extra evidence | Publicly evidenced values | Direct source |
| --- | --- | --- | --- |
| `coinflip` | Flip a coin and bet on `heads` or `tails`; success and loss responses expose result, chosen side, and amount. | Side choices are exactly `heads` and `tails`; the error text says the amount must be valid and the wallet must cover it. | [`coinflip.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/coinflip.json) |
| `dice` | Roll dice against the bot. | No dice sides, comparison, tie rule, or payout is public. | [`dice.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/dice.json) |
| `gamble` | Gamble money with random multipliers. | Random multipliers are asserted, but their set, probability, and maximum are unknown. | [`gamble.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/gamble.json) |
| `roulette` | Play roulette with `red`, `black`, `green`, `odd`, or `even`. | Bet choices are exactly those five strings. The registry does not publish wheel layout or odds. | [`roulette.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/roulette.json) |
| `highlow` | Guess whether the next card is higher or lower. | Guess choices are semantically `higher`/`lower`; deck, tie, ace, and payout rules are unknown. | [`highlow.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/highlow.json) |
| `slots` | Play the slot machine. | The registry explicitly marks it guild-only; symbols, paylines, and payouts are unknown. | [`slots.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/slots.json) |
| `plinko` | Drop a chip down the Plinko board. | Board shape and multiplier cells are unknown. | [`plinko.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/plinko.json) |
| `bombs` | Play Minesweeper and avoid bombs. | Board dimensions, bomb count, reveal/cash-out actions, and payout are unknown. | [`bombs.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/bombs.json) |
| `ladder` | Climb a ladder for multipliers. | Rung count, failure odds, cash-out actions, and multipliers are unknown. | [`ladder.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/ladder.json) |
| `crash` | Cash out before the multiplier crashes. | A cash-out interaction and a crashing multiplier are implied; seed, crash distribution, and settlement rules are unknown. | [`crash.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/crash.json) |
| `scratch` | Play a scratch-card lottery. | Lottery card layout, reveal interaction, odds, and payout table are unknown. | [`scratch.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/scratch.json) |
| `blackjack` | Play blackjack against the dealer. | Dealer rules, hit/stand/double/split actions, blackjack payout, and tie rule are unknown. | [`blackjack.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/blackjack.json) |

`coinflip` and `slots` explicitly expose a guild-only error. `blackjack`,
`bombs`, `crash`, `dice`, `gamble`, `highlow`, `ladder`, `plinko`, `roulette`,
and `scratch` expose the same economy-enabled and insufficient-balance errors
but no explicit scope text. Because the existing `/economy` root is
guild-only, #49 keeps every game in the invoking guild's selected guild
account and never silently turns a game into a cross-server global action.
That is a ByteBot safety decision, not a claim about an undocumented Greed
scope.

### Crime, robbery, and leaderboard

| Public path | Publicly evidenced behavior | Values/permissions/cooldowns evidenced | Direct source |
| --- | --- | --- | --- |
| `crime` | Attempt a crime; success earns an amount and failure loses an amount. | Guild-only, economy enabled, server and member must each be at least six hours old. A cooldown response includes hours/minutes, but its duration and success/failure odds are unknown. | [`crime.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/crime.json) |
| `rob` | Attempt to rob another user; success transfers an amount from the target and failure loses an amount. | Guild-only; self and bot targets are rejected; the robber needs at least 100 and the target needs at least 500. A cooldown response includes hours/minutes, but its duration, success odds, and amount formula are unknown. | [`rob.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/rob.json) |
| `leaderboard` | View the economy leaderboard. | A guild leaderboard is explicitly guild-only; no default page size, sort tie-break, scope selector, or global leaderboard behavior is public. | [`leaderboard.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/leaderboard.json) |

The current Economy guide independently confirms crime and robbery as earning
methods, wallet/bank safety from robbery, transfers, and leaderboards. It does
not add numeric rules beyond the common game bet range. Source:
[current Economy guide](https://greed.best/docs/miscellaneous/economy).

### Gangs

The current guide says members can join or create a gang and lists overview,
create, join/invite, promote/manage, leave/disband, banner, and ownership
transfer. The pinned registry supplies the exact command subjects and the
following constraints. It does not publish a gang currency, gang bank, fees,
member limit, invite expiry, or Discord permission mapping.

| Public path | Publicly evidenced behavior | Values/permissions evidenced | Direct source |
| --- | --- | --- | --- |
| `gang` | Manage a gang and advertises `create`, `disband`, `info`, `invite`, `leave`, `promote`, `transfer`, `setbanner`. | No option or permission data. | [`gang/index.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/gang/index.json) |
| `gang create` | Create a new gang and return its name. | Name is at most five characters and alphanumeric only; the name must be unique in the server; the actor cannot already be in a gang. | [`gang/create.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/gang/create.json) |
| `gang disband` | Disband the actor's gang. | Owner-only. | [`gang/disband.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/gang/disband.json) |
| `gang info` | Show title, owner, members, and created time. | Actor must be in a gang; a missing named gang is an evidenced error, but whether a name option exists is unknown. | [`gang/info.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/gang/info.json) |
| `gang invite` | Invite a user and offer Accept/Decline actions; accepted users join the gang. | Valid user required; no self-invite; inviter must be owner or admin; invitee cannot already belong to a gang; a maximum member limit exists but its number is not published. | [`gang/invite.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/gang/invite.json) |
| `gang leave` | Leave the current gang. | Owner cannot leave; transfer ownership or disband first. | [`gang/leave.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/gang/leave.json) |
| `gang promote` | Promote a member to admin. | Owner-only; target must be in the same gang; owner cannot be promoted; duplicate promotion fails. | [`gang/promote.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/gang/promote.json) |
| `gang transfer` | Transfer ownership to another gang member. | Owner-only; no self-transfer; target must be in the same gang. | [`gang/transfer.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/gang/transfer.json) |
| `gang setbanner` | Set the gang banner image. | Valid image URL required; owner-only. | [`gang/setbanner.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/gang/setbanner.json) |

The current guide's gang section is the only current hosted documentation for
this family; it confirms the feature grouping but gives no numeric member or
permission defaults beyond the registry's owner/admin response text.

### Laboratories

The pinned registry is the only first-party source found for laboratories.
There is no current hosted laboratory page. The registry proves a passive
income laboratory with one per-user ownership, upgrades, ampoules, collection,
storage, and status fields. It does not publish any numeric cost, level,
storage, earnings, accrual, or upgrade schedule.

| Public path | Publicly evidenced behavior | Values/permissions evidenced | Direct source |
| --- | --- | --- | --- |
| `lab` | Manage a laboratory and advertises `buy`, `status`, `upgrade`, `ampoules`, `collect`. | No option or permission data. | [`lab/index.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/lab/index.json) |
| `lab buy` | Purchase one laboratory for passive income. | Economy must be enabled; duplicate ownership fails; balance must cover an unpublished cost. Initial hourly earnings and ampoule count are shown in a response but have no values in the registry. | [`lab/buy.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/lab/buy.json) |
| `lab status` | Show level, ampoules, earnings/hour, current earnings, storage, and next upgrade cost. | Economy enabled and a lab required; all displayed values are placeholders only. | [`lab/status.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/lab/status.json) |
| `lab upgrade` | Upgrade laboratory storage capacity. | Economy enabled and a lab required; balance must cover an unpublished cost; resulting level/storage values are placeholders. | [`lab/upgrade.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/lab/upgrade.json) |
| `lab ampoules` | Buy ampoules to increase laboratory earnings. | Economy enabled and a lab required; each request is 1–5 ampoules; maximum count, price, and earnings increase are unknown. | [`lab/ampoules.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/lab/ampoules.json) |
| `lab collect` | Collect accrued laboratory earnings. | Economy enabled and a lab required; no-earnings state is explicit; amount and accrual schedule are unknown. | [`lab/collect.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/economy/lab/collect.json) |

## Slash layout: exactly 25 `/economy` root options

The existing #48 builder has 19 root options: 17 direct subcommands plus the
`job` and `shop` subcommand groups. #49 adds exactly six root options and does
not add 30 new top-level commands:

| New root option | Nested paths | Access |
| --- | --- | --- |
| `game` group | `coinflip`, `dice`, `gamble`, `roulette`, `highlow`, `slots`, `plinko`, `bombs`, `ladder`, `crash`, `scratch`, `blackjack` | Member; guild-only; account and economy enabled required |
| `crime` | none | Member; guild-only; account and economy enabled required |
| `rob` | none | Member; guild-only; account and economy enabled required |
| `leaderboard` | none | Member; guild-only; no global cross-guild display |
| `gang` group | `create`, `disband`, `info`, `invite`, `leave`, `promote`, `transfer`, `setbanner` | Member; ownership/admin checks are inside the handler |
| `lab` group | `buy`, `status`, `upgrade`, `ampoules`, `collect` | Member; guild-only; account and economy enabled required |

The resulting root is 19 + 6 = 25, Discord's maximum for one application
command. Each group stays below Discord's nested subcommand limit. The public
root remains discoverable; no root-level `ManageGuild` restriction may hide
member paths. The handler performs path-aware checks, matching #48's real
permission boundary and existing ByteBot RBAC rules.

Exact nested options:

| Slash path | Options | Why these options are safe |
| --- | --- | --- |
| `/economy game coinflip` | `side` required choice `heads`/`tails`; `amount` required integer 10–1,000,000 | Side values are in the registry; amount range is in the current guide. |
| `/economy game dice`, `gamble`, `slots`, `plinko`, `bombs`, `ladder`, `crash`, `scratch`, `blackjack` | `amount` required integer 10–1,000,000 | The public guide requires a bet; no extra undocumented option is added. |
| `/economy game roulette` | `bet` required choice `red`/`black`/`green`/`odd`/`even`; `amount` required integer 10–1,000,000 | Bet values are directly exposed by the registry error. |
| `/economy game highlow` | `guess` required choice `higher`/`lower`; `amount` required integer 10–1,000,000 | Guess semantics are directly exposed by the registry description. |
| `/economy crime` | none | The registry exposes no argument. |
| `/economy rob` | `member` required user | “Rob another user” and self/bot/target checks require a target; no other option is evidenced. |
| `/economy leaderboard` | none | No filter, page, or scope option is evidenced; render a bounded first page with deterministic pagination only if needed. |
| `/economy gang create` | `name` required string, 1–5 alphanumeric characters | Registry requires at most five alphanumeric characters. |
| `/economy gang disband`, `leave` | none; `/economy gang transfer` has required `member` user | Disband/leave have no evidenced option; transfer requires a target member. |
| `/economy gang info` | none | Show the invoking member's gang; a name lookup is not added because its option is unproven. |
| `/economy gang invite`, `promote` | `member` required user | Both registry descriptions operate on a target user. |
| `/economy gang setbanner` | `url` required string, HTTPS image URL | Registry requires a valid image URL; do not fetch or proxy it. |
| `/economy lab buy`, `status`, `upgrade`, `collect` | none | No argument is evidenced. |
| `/economy lab ampoules` | `amount` required integer 1–5 | Exact registry error bound. |

For interactive games, the slash command starts a durable session and the
bot replies with components. Component IDs are not extra slash options and
must be scoped to the session and user. If the product later obtains a
first-party option specification, it may add only options that fit Discord's
published command schema and this contract must be re-frozen first.

## Behavior and evidence-gap policy

### Rules inherited from #48

- Every positive system-funded payout in this slice (a game win, successful
  crime, or laboratory collection) receives the universal 1.5x multiplier
  exactly once, using integer `floor(base * 3 / 2)` arithmetic. This is the
  #48 ledger decision implementing the public `1.5x economy earnings` premium
  claim without a billing gate. A returned stake, transfer, robbery proceeds,
  bank movement, grant, removal, or refund is not a payout and is not
  multiplied.
- All money moves use the existing immediate SQLite transaction and the
  existing immutable `economy_ledger`. No game, gang, or lab gets a parallel
  balance authority.
- Guild account/config isolation and the existing 0–1,000,000,000,000 account
  field bound remain in force. Global mode is an account scope, not a bypass
  for guild-only games, gangs, labs, robbery, or the guild leaderboard.
- Never auto-create an account from a game or progression read. Require an
  opened account and a wallet balance sufficient for the wager/cost.

### Unevidenced mechanics must not be presented as Greed facts

The sources do not expose exact game odds, payouts, board/deck/rung layouts,
crime/rob cooldown durations, crime amounts, robbery percentage, gang member
limit, invite expiry, lab costs, lab levels, lab storage, or lab earnings. The
implementation therefore has two honest choices:

1. Use a plainly documented ByteBot-owned rule table and label help/config
   output as ByteBot behavior; or
2. Leave the specific mechanic unavailable with a clear evidence-gap
   diagnostic until a first-party Greed source publishes it.

It must not silently invent a number and call it 1:1 Greed parity. The
recommended delivery choice for this issue is the first option for ordinary
games, so every public name is usable, with the following minimum envelope:

- one-shot games settle one bet atomically and expose the outcome, gross
  payout, net change, and a stable ledger transaction ID;
- `crash`, `ladder`, `bombs`, and `blackjack` use buttons because their public
  descriptions imply multiple actions; sessions expire safely and never
  accept a component from another user;
- the rule table is deterministic under an injected RNG in tests, uses
  cryptographically secure randomness in production, and caps any payout at
  the existing operation/account/scope bounds;
- a losing bet cannot make wallet or bank negative; no undocumented debt or
  negative balance is introduced; and
- all user-facing output calls the behavior ByteBot-owned where a Greed
  numeric or algorithmic source is absent.

The common game bet bound is the only game numeric rule claimed as Greed
behavior: integer 10–1,000,000 coins, inclusive. The separate operation cap
from #48 still applies to the resulting ledger mutation.

### Crime and robbery decisions

- `/economy crime` is guild-only, requires the existing six-hour guild/member
  age gate, and has one persisted cooldown. The cooldown duration, odds, and
  success/failure amounts are ByteBot-owned until first-party evidence appears.
  A failure burns only an amount available in the wallet and never creates a
  negative balance; a success mints a positive payout through the common 1.5x
  earning path.
- `/economy rob` is guild-only and requires a current non-bot target distinct
  from the actor. Enforce the evidenced minimum amounts as wallet minimums
  (robber wallet at least 100, target wallet at least 500); this wallet-only
  interpretation is ByteBot-owned because the source does not distinguish
  wallet from bank in the error text. Use one persisted cooldown and wallet-
  only settlement because the public guide says deposit protects coins from
  robbery. The amount/odds/cooldown are ByteBot-owned until sourced. Robbery
  transfers target currency and never receives the 1.5x system payout
  multiplier; failed robbery loses only available actor wallet currency.
- Both operations run their eligibility check, cooldown claim, balances, and
  ledger entries in one immediate transaction. A failed attempt still claims
  its cooldown exactly once.

### Gang decisions

- Gangs are guild-local membership records, not currency accounts. A member
  can belong to at most one gang per guild; the owner is also a member.
- Keep the public five-character, alphanumeric name rule and a
  case-insensitive unique index per guild. Until Greed publishes the maximum,
  ByteBot uses a visible 25-member ceiling as a ByteBot-owned bound; it must
  appear in the error/help text and be easy to change.
- `owner`, `admin`, and `member` are application roles. Only the owner may
  disband, promote, transfer ownership, or set the banner. Owner and admins
  may invite, matching the registry error; ordinary members may view and
  leave, except the owner cannot leave.
- Invites are durable pending records with Accept/Decline buttons. The target
  user is the only actor allowed to accept or decline; a single invite may be
  accepted once, and the invite expires after a ByteBot-owned 10-minute TTL.
  Expiry is a safety default, not a Greed claim.
- `setbanner` validates an HTTPS URL with an image extension or Discord CDN
  host, stores only the URL, and never downloads arbitrary content. Missing or
  invalid URLs fail before the row changes.
- Disband, leave, promote, transfer, invite acceptance, and invite decline
  use conditional updates or a transaction so two simultaneous component
  clicks cannot produce two owners, two gang memberships, or two accepts.

### Laboratory decisions

- Laboratories are guild-only, one per `(guild_id, user_id)`, require an
  enabled economy and an opened guild account, and never draw from the bank.
- Store level, ampoule count, accrued amount, last-accrual timestamp, and
  storage capacity. Accrual is calculated from elapsed time under the stored
  configuration; it is capped at storage and is not minted until `collect`.
- `buy`, `upgrade`, and `ampoules` debit wallet and write a ledger purchase
  row atomically. `collect` marks the accrued amount as zero and mints the
  positive payout in the same transaction, applying 1.5x once. Repeated
  collection after commit returns the evidenced no-earnings state.
- Costs, level progression, storage, hourly base earnings, ampoule maximum,
  and ampoule price are all evidence gaps. Use a single visible ByteBot-owned
  table (or a clear unavailable diagnostic), not per-guild hidden values.
- A collection, upgrade, or ampoule purchase retried after timeout must
  return the already-committed result rather than charge twice. Use a durable
  operation ID/unique constraint for this purpose.

### Leaderboard decisions

- `/economy leaderboard` is guild-only and ranks committed guild account
  totals (`wallet + bank`) from the same query authority as #48 balance rank.
- Use a deterministic tie break of descending total, then ascending Discord
  user ID. Render at most 25 rows per page and use user-bound pagination
  components if additional pages are offered.
- Do not expose a global cross-guild leaderboard: the public registry only
  asserts a guild leaderboard, and #48's privacy contract forbids exposing
  another user's global account across guilds. No leaderboard row may cause
  an account to be created.

## Persistence, transactions, and idempotency

Use the existing SQLite/Drizzle migration path and the #48 ledger. The
following minimum tables are required; names are implementation guidance, not
an excuse to add a repository layer or event bus.

### Games

`economy_game_sessions`:

- `id` (opaque UUID primary key), `guild_id`, `scope_type`, `scope_id`,
  `user_id`, `game`, `bet`, `state_json`, `status`, `created_at`,
  `expires_at`, `settled_at`, `settlement_amount`, and `transaction_id`;
- status values `active`, `won`, `lost`, `cashed_out`, `refunded`, `forfeited`;
- a partial unique index permits at most one `active` session per
  `(scope_type, scope_id, user_id)`; and
- `state_json` contains only the minimum persisted game state and a server
  generated nonce. Never persist a user token or secret.

One-shot games can create and settle the row in one transaction. Interactive
games debit the wager and record `game_bet` before sending components, then
settle through a conditional `WHERE status = 'active'` update. Every component
action carries the session ID and nonce; duplicate actions return the terminal
row and never create another ledger entry. An expired or uncertain session is
refunded exactly once by a conditional status transition to `refunded`.

### Gangs

`economy_gangs` stores `(id, guild_id, name, owner_id, banner_url, created_at,
updated_at)`, with a case-insensitive unique `(guild_id, name)` index.
`economy_gang_members` stores `(guild_id, gang_id, user_id, role, joined_at)`
with a unique `(guild_id, user_id)` membership index. `economy_gang_invites`
stores an invite ID,
gang/guild/inviter/invitee IDs, status, nonce, created/expiry/acted timestamps,
and a unique pending invite key. The transaction that accepts an invite checks
expiry, actor, gang capacity, and existing membership before writing both the
membership and terminal invite state.

### Laboratories

`economy_labs` stores one row per `(guild_id, user_id)` with level, ampoules,
stored amount, storage cap, last accrual timestamp, optional paused timestamp,
and update timestamp.
`economy_lab_operations` stores an operation UUID, nullable lab ID, durable
user/guild IDs, kind, input amount, result amount, exact result JSON, and
created time with a unique operation ID.
The operation UUID is the Discord interaction ID, not a newly generated ID.
Discord redelivery of the same interaction therefore returns its committed
row; a later invocation has a new ID and is an intentional new operation.
This gives platform retries a durable answer without an in-memory map or an
undocumented slash option.

All monetary mutations follow the #48 sequence: validate scope, account,
eligibility, limits, and current committed balance inside an immediate
transaction; apply checked deltas; append immutable ledger rows; update the
feature row and cooldown/operation marker; then commit. Discord component or
role/UI delivery happens after the commit and can only transition a durable
state forward.

## RBAC, Discord, and anti-abuse matrix

| Surface | Actor permission | Bot/platform preflight | Anti-abuse boundary |
| --- | --- | --- | --- |
| Games, crime, rob, leaderboard, lab member paths | Current guild member; path-aware ByteBot RBAC may narrow access but cannot elevate it. | Root is guild-only; require View Channel, Send Messages, and Embed Links for a useful response. | 10–1,000,000 game bet; account/wallet checks; one active session; persisted cooldown; one settlement. |
| Gang create/info/leave | Current guild member. | Send response and component permissions. | One gang per member/guild; name uniqueness; conditional membership writes. |
| Gang invite | Gang owner or admin, as explicitly evidenced by the registry. | Send messages/components. | Current non-bot guild member; 25-member ByteBot ceiling until source; one pending invite; target-bound accept/decline. |
| Gang promote/transfer/disband/setbanner | Gang owner; this is directly evidenced for each owner-only path. | For banner, no external fetch; validate URL only. | No self transfer; target same gang; conditional owner/version check. |
| Lab buy/upgrade/ampoules/collect | Current guild member; no Greed Discord permission is public. | Economy enabled and account open; bot can send response. | Wallet-only debit; visible fixed rule table; storage cap; unique operation IDs. |
| Existing #48 job/shop/config administration | Unchanged: real Discord Manage Server checks at mutating paths; ByteBot RBAC only narrows. | Shop role delivery retains #48 Manage Roles/hierarchy checks. | Existing #48 bounds and confirmation rules. |

Do not use a root-level `ManageGuild` declaration because that would hide
public subcommands and violates the #48 discoverability contract. Do not treat
Greed's fake permissions as a ByteBot authority grant; this repository's RBAC
can only add restrictions. Responses suppress accidental mentions.

## Verification and acceptance matrix

This matrix is the future #49 implementation gate. Research intentionally does
not run these tests.

| Area | Acceptance checks |
| --- | --- |
| Source/surface | Every 30 pinned #49 files maps to one handler/help entry; current guide's 12 games, crime, rob, leaderboard, and gang grouping are represented; evidence gaps are labelled ByteBot-owned or unavailable. |
| Slash schema | `/economy` has exactly 25 root options (19 existing + `game`, `crime`, `rob`, `leaderboard`, `gang`, `lab`); all nested groups and options serialize under Discord limits; required choices and 10–1,000,000/1–5 bounds are exact. |
| Help/category | Economy is discoverable under the Economy category; `game` lists all 12 child paths; public versus owner/admin-only gang actions, guild-only scope, and ByteBot-owned mechanics are visible. |
| Game money | Each game rejects amounts outside 10–1,000,000, insufficient wallet, disabled economy, and unavailable accounts; every result has one immutable ledger settlement and positive payouts receive 1.5x once. |
| Game sessions | Active-session uniqueness, actor-bound components, nonce validation, expiry/refund, restart reconciliation, duplicate-click idempotency, and injected-RNG reproducibility are tested for interactive games. |
| Crime/rob | Six-hour age gate, one cooldown claim per attempt, self/bot/target checks, robber 100/target 500 minimums, no negative balances, guild isolation, and payout/transfer ledger classification are covered. |
| Gangs | Name validation/uniqueness, one membership, owner/admin checks, invite accept/decline actor binding and expiry, capacity, transfer/disband races, owner-leave rejection, and banner URL validation are covered. |
| Labs | One-lab uniqueness, enabled/account gate, deterministic accrual, storage cap, 1–5 ampoules, atomic buy/upgrade/collect, 1.5x collection, repeated collect, and operation retry idempotency are covered. |
| Leaderboard | Guild isolation, no global disclosure, account non-creation, descending total/ascending-ID ties, 25-row pagination, and concurrent ledger consistency are covered. |
| Migration | Fresh and upgrade migrations create all feature tables/indexes/checks without dropping #48 data; foreign/membership/partial-unique constraints are exercised. |
| Repository gates | Focused #49 tests, command/schema/migration checks, full suite, parallel standards/spec review, and final security diff scan are fresh before its PR is considered ready. |

## Evidence gaps to carry forward

The following are unresolved Greed-public-source gaps and must remain visible in
the issue/PR rather than being claimed as matched behavior:

1. Current slash-versus-prefix registration and exact argument types for every
   Economy path; the live catalog shell promises this data but does not expose
   its rows in a fetchable response.
2. Per-command Greed Discord permissions for games, crime, rob, leaderboard,
   gangs, and laboratories, beyond the registry's owner/admin checks and the
   current guide's Manage Guild role-shop note.
3. Every game payout table, odds/house edge, RNG algorithm, tie rule, state
   machine, component layout, and maximum payout.
4. Crime success/failure odds, payout/loss ranges, and cooldown duration.
5. Robbery odds, amount formula, cooldown duration, whether only wallet money
   is exposed, and whether a failed loss can exceed wallet (ByteBot forbids
   negative balances).
6. Gang member maximum, invite TTL, admin semantics beyond invite/promote
   wording, name minimum, banner URL policy, and whether gangs have money or
   other progression not present in the pinned registry.
7. Laboratory buy/upgrade/ampoule costs, levels, hourly earnings, storage,
   accrual rounding, maximum ampoules, and passive-income multiplier scope.
8. Leaderboard page size, sort ties, filters, rank scope, and whether Greed
   exposes a global board.

When a new first-party Greed source resolves one of these gaps, update this
file, pin the source/ref, and re-run the contract/review gate before changing
runtime behavior. Until then, ByteBot-owned values must be labelled as such
and never described as Greed's paywalled defaults.

## ByteBot-owned deterministic rules appendix

This appendix closes the implementation choices needed to ship #49. Every
number and mechanic in this section is ByteBot-owned. None is evidence about
Greed and none may be presented as a Greed default. The shared engine is
deliberately small: one wallet-only game debit, one outcome/settlement helper,
one persisted interactive-session state machine, and fixed tables below.

### Shared game accounting

All twelve games use the same accounting contract:

1. Validate a guild account, enabled economy, wallet balance, integer bet
   between 10 and 1,000,000 inclusive, and the actor-bound rate limit.
2. In one immediate transaction, debit the bet and append an immutable
   `game_bet` ledger row. One-shot games immediately append their settlement
   in the same transaction; interactive games commit the debit before sending
   buttons.
3. Tables below give a `base return`, including the returned stake. For a
   base return of `R` coins, `base_profit = max(0, R - bet)`. The inherited
   multiplier is applied only to that positive system-funded profit:
   `funded_profit = floor(base_profit * 3 / 2)` and
   `credit = (R > 0 ? bet + funded_profit : 0)`. Thus a push returns exactly
   the stake and is never multiplied; a loss returns zero; a winning game
   receives the 1.5x allowance once. All arithmetic floors toward zero.
4. Append one `game_settlement` ledger row for a positive credit or a
   `game_loss` terminal row with no credit. `net = credit - bet` is shown to
   the player. The bet row records `supply_delta = -bet` and updates lifetime
   destroyed totals; a positive settlement records `supply_delta = credit`
   and updates lifetime minted totals. A push or refund therefore changes
   lifetime flow totals but has net-zero circulation. No result can make
   wallet or bank negative.

Production outcomes use `crypto.randomInt` (or the existing injected random
source in tests). The command root keeps its existing two-second cooldown.
Interactive sessions have one active session per user/guild, a ten-minute
expiry, and a server-generated nonce. A component must match the session ID,
nonce, guild, and initiating user. The first conditional terminal update wins;
later clicks return that terminal result without another ledger row. On expiry
the engine credits exactly the original bet, marks the session `refunded`, and
does not apply 1.5x. A restart reconciles active sessions whose expiry has
passed before serving a new game command.

### One-shot game table

`return` is the base return multiple before the inherited multiplier. `0x`
means no credit; `1x` is a push. Percentages are exact selection weights.

| Game | Deterministic ByteBot rule | Outcome and base return |
| --- | --- | --- |
| `coinflip` | Draw one equally likely value from `heads`/`tails`; compare with the required `side`. | Match: 50%, `2x`; mismatch: 50%, `0x`. |
| `dice` | Draw player and dealer values independently and uniformly from d6. | Player higher: 15/36, `2x`; tie: 6/36, `1x`; player lower: 15/36, `0x`. |
| `gamble` | Draw an integer 1–100 and use the first inclusive weight bucket. | 1–45: 45%, `0x`; 46–70: 25%, `1x`; 71–90: 20%, `2x`; 91–98: 8%, `3x`; 99–100: 2%, `5x`. |
| `roulette` | Draw one integer 0–36 uniformly. Use the conventional 18 red values, 18 black values, and green 0. | `red`, `black`, `odd`, or `even` win on their matching non-zero set: 18/37, `2x`; `green` wins only on 0: 1/37, `36x`; all other results: `0x`. |
| `highlow` | Draw a first and next rank independently and uniformly from 1–13; compare them with required `higher`/`lower`. | Correct: 78/169, `2x`; equal: 13/169, `1x`; incorrect: 78/169, `0x`. |
| `slots` | Draw three independent symbols uniformly from `cherry`, `lemon`, `bell`, `star`, `seven`. | `seven-seven-seven`: 1/125, `20x`; any other triple: 4/125, `8x`; exactly one matching pair: 60/125, `2x`; otherwise: 60/125, `0x`. |
| `plinko` | Make eight independent fair left/right hops. The number of right hops selects bin 0–8. | Bin probabilities are `1,8,28,56,70,56,28,8,1 / 256`; base-return table by bin is `[0x, 0x, 1x, 2x, 3x, 2x, 1x, 0x, 0x]`. |
| `scratch` | Draw an integer 1–100 and render nine scratch cells whose symbols communicate the selected tier. | 1–60: 60%, `0x`; 61–85: 25%, `1x`; 86–95: 10%, `2x`; 96–99: 4%, `5x`; 100: 1%, `10x`. Reveal is one atomic command result; there is no second charge. |

The game table is the only source of odds or payouts for this implementation.
No configurable per-guild house edge, user luck, premium multiplier, or
client-supplied result is permitted.

### Interactive game state transitions

The four games whose public descriptions imply multiple actions use the same
session row and conditional settlement helper. Every transition below is
atomic and idempotent. An expired session refunds the stake exactly once as
described by the shared contract.

#### `bombs`

- On start, generate a uniform 5x5 board with exactly three bomb cells, debit
  the bet, and reveal no cells. The session stores the board, revealed safe
  cells, and nonce. One string-select menu lists the 25 cells; after a safe
  reveal it lists only unrevealed cells and a separate cash-out button is
  shown. This stays within Discord's component and 25-option limits.
- A safe-cell click adds that cell to `revealed` and leaves the session active.
  After `n` safe cells, the cash-out base return is
  `1 + floor(n / 2)` times the bet, capped at `12x`; cash-out is offered after
  the first safe cell. A bomb click settles `lost` at `0x`. Revealing all 22
  safe cells auto-settles at `12x`.
- A cash-out click settles at the current table return and disables all cell
  and cash-out buttons. Invalid, repeated, expired, or non-owner clicks do not
  alter the session.

#### `ladder`

- On start, set rung 0 of 6 and debit the bet. The player receives `climb`;
  after the first successful rung it also receives `cash out`.
- Each climb uses one uniform draw 1–100 and the following inclusive success
  thresholds: rung 1 `<=80`, rung 2 `<=70`, rung 3 `<=60`, rung 4 `<=50`,
  rung 5 `<=40`, rung 6 `<=30`. A failed climb settles `lost` at `0x`.
- Successful rung cash-out returns `[1x, 2x, 3x, 5x, 8x, 12x]` for rungs
  1–6. Reaching rung 6 auto-settles at `12x`; cash-out disables `climb`.
  Expiry before settlement refunds the stake.

#### `crash`

- On start, draw one crash point from the following weighted table and store
  it as hundredths: `1.10` (20%), `1.25` (20%), `1.50` (20%), `2.00` (15%),
  `3.00` (12%), `5.00` (8%), `10.00` (5%). Current multiplier starts at
  `1.00x`; `cash out` and `advance` are the only actions.
- `advance` moves through `[1.10, 1.25, 1.50, 2.00, 3.00, 5.00, 10.00]`.
  If the next value is at or above the stored crash point, the multiplier
  crashes and the session settles `lost` at `0x`; otherwise current multiplier
  becomes that next value. A `cash out` click settles at current multiplier,
  calculated as `floor(bet * multiplierHundredths / 100)` before the 1.5x
  profit allowance.
- A crash point of 1.10 therefore gives the player no profitable advance but
  still permits the initial 1.00x push if they cash out immediately. Expiry
  refunds the stake, not the current displayed multiplier.

#### `blackjack`

- On start, shuffle a standard 52-card deck with the server RNG, deal two
  cards to the player and two to the dealer, and keep one dealer card hidden.
  Aces count as 1 or 11 to maximize the hand without busting. Only `hit` and
  `stand` are supported; double and split are intentionally absent. An initial
  two-card 21 auto-settles as a win at `2x` and exposes no action buttons.
- `hit` deals one card. A player total over 21 settles `lost` at `0x`; a total
  of exactly 21 keeps `stand` available. `stand` reveals the dealer and draws
  while dealer total is below 17 (dealer stands on soft 17).
- Player total above dealer, or a dealer bust, settles at `2x`; equal totals
  push at `1x`; all other results settle at `0x`. A natural 21 uses the same
  `2x` table as every other win; no undocumented 3:2 bonus is added. Expiry
  refunds the stake and clears the hidden dealer state.

### Crime and robbery table

These are fixed ByteBot-owned values; the existing six-hour age gate and
guild-only scope remain in force.

| Action | Cooldown | Outcome draw | Amount and accounting |
| --- | ---: | --- | --- |
| `crime` | 3,600 seconds from every completed attempt | 1–100: 1–60 succeeds; 61–100 fails. | Success draws base amount uniformly from 100–500 inclusive, then credits `floor(base * 3 / 2)` as a positive system payout. Failure burns `min(wallet, max(1, floor(wallet / 10)))`; a zero wallet loses zero. Failure is not multiplied. |
| `rob` | 7,200 seconds from every completed attempt | 1–100: 1–40 succeeds; 41–100 fails. | Require actor wallet ≥100 and target wallet ≥500. Success transfers `max(100, floor(target.wallet / 4))` from target wallet to actor wallet, never bank, and never multiplies. Failure burns `min(actor.wallet, max(10, floor(actor.wallet / 10)))`; no negative wallet is possible. |

Crime success is a system-funded payout and therefore receives 1.5x exactly
once. Robbery success is a wallet-to-wallet transfer and therefore receives no
multiplier. A failed attempt claims its cooldown even if its available loss is
zero. Robbery never reads or changes bank balances; the public guide's bank
safety behavior is therefore preserved by this explicit ByteBot rule.

### Gang capacity and invites

- A gang has a maximum of 25 members, including its owner. A member cannot
  belong to two gangs in one guild. There is no gang currency, fee, or passive
  payout.
- An invite is valid for 600 seconds. At most one pending invite exists for a
  `(gang, invitee)` pair and a gang may have at most 25 pending invites. The
  invitee alone can accept or decline; an expired, already-acted, non-member,
  bot, or wrong-guild click is rejected without changing membership.
- Acceptance checks capacity and one-gang membership again inside the same
  immediate transaction that marks the invite accepted and inserts the
  member. Decline and expiry only mark the invite terminal. Disband marks all
  pending invites revoked and removes memberships in one transaction.
- Ownership transfer conditionally updates the gang only when the actor is
  still `owner_id`, changes the target member role from `member` or `admin` to
  `owner`, changes the former owner's member role to `admin`, and commits all
  three writes in one immediate transaction. A partial unique owner-role index
  permits exactly one `owner` member per gang; a stale concurrent transfer
  changes zero rows and fails without splitting authority.

### Laboratory rule table

Laboratories use wallet-only purchases and a single fixed progression table.
The table is intentionally small and visible in `/economy lab status`:

| Setting | ByteBot-owned value |
| --- | ---: |
| Purchase price | 10,000 coins |
| Starting level | 1 |
| Maximum level | 10 |
| Starting ampoules | 1 |
| Maximum ampoules | 5 |
| Level-1 storage | 1,000 coins |
| Storage at level `L` | `1,000 * L` coins |
| Base hourly earnings at level `L`, ampoules `A` | `100 * L + 50 * (A - 1)` coins/hour |
| Ampoule price | 2,000 coins each |
| Upgrade from level `L` to `L+1` | `5,000 * (L + 1)` coins |

`lab buy` creates level 1 with one ampoule and 1,000 storage. `lab upgrade`
settles elapsed accrual first, then charges the formula cost and increases
level/storage. `lab ampoules amount` accepts exactly 1–5, rejects a purchase
that would exceed five total, charges `2,000 * amount`, and increases the
hourly formula immediately. Level 10 has no next upgrade; an ampoule purchase
at five is rejected.

On every lab write, projected accrued coins are computed as
`min(storage, storedAmount + floor(hourlyRate * elapsedSeconds / 3,600))`,
where elapsed time is clamped to non-negative and `last_accrual_at` advances to
the current time. Status computes the same projection without mutating it.
Collection sets the projected stored amount to zero and credits
`floor(baseAccrued * 3 / 2)`; this positive collection payout receives the
inherited multiplier once. A collection with zero base accrued coins returns
the evidenced no-earnings state. Lab earnings do not consume the #48
daily/work cap, but account, operation, scope-supply, and wallet bounds still
apply. Buy, upgrade, ampoules, and collect each use a unique operation ID so a
retry cannot charge or credit twice.

Buy, upgrade, and ampoule debits append `lab_buy`, `lab_upgrade`, and
`lab_ampoules` ledger rows respectively with negative wallet and
`supply_delta` values, and update lifetime destroyed totals in the same
transaction. Collection appends `lab_collect` with its positive wallet and
`supply_delta`, and updates lifetime minted totals. Uncollected stored lab
earnings are not circulation and never appear in the ledger.

### Destructive and disabled lifecycle

- A reset preview fingerprints the target account, any active game session,
  and the laboratory row. In the confirmed reset transaction, an active game
  becomes terminal `forfeited` with no refund or additional supply delta, the
  lab is removed, cooldowns are cleared, and the account is burned/deleted
  under #48's existing reset ledger rule. Historical game/lab ledger rows,
  completed sessions, and lab operation result rows remain immutable so a
  redelivered pre-reset Discord interaction returns its prior result without
  recreating state. Gang
  membership is social state and is preserved by an account reset.
- A disable preview fingerprints every active game session and laboratory row.
  The confirmed disable transaction refunds each active wager exactly once,
  marks each session `refunded`, projects every lab to the disable timestamp,
  stores that capped amount, and sets `paused_at` before changing the config to
  disabled. If any refund would exceed the account wallet bound, the entire
  disable fails without mutation so the account can be brought below the bound
  and previewed again.
  Re-enable sets `last_accrual_at` to the re-enable timestamp and clears
  `paused_at`; disabled wall time never accrues. Member game/lab commands and
  components reject while disabled after performing no mutation.
- Destroy only burns the administrator-requested current account amount. It
  does not cancel a game or lab; a later declared settlement may still change
  that account, exactly as a later daily/work action can. Its exact-plan check
  remains the #48 wallet/bank check.

### Required database invariants

- `economy_game_sessions` checks `scope_type = 'guild'`, `scope_id = guild_id`,
  `game` is one of the twelve contracted names, bet is 10–1,000,000, and
  status is one of `active`, `won`, `lost`, `cashed_out`, `refunded`, or
  `forfeited`. A partial unique index allows one active row per
  `(guild_id, user_id)`.
- `economy_gang_members` checks role in `owner|admin|member`, uniquely indexes
  `(guild_id, user_id)`, and has a partial unique `(gang_id)` index for
  `role = 'owner'`. Gang names use a case-insensitive unique `(guild_id, name)`
  index. Invite status is limited to
  `pending|accepted|declined|expired|revoked`; one partial unique pending row
  is allowed per `(guild_id, gang_id, invitee_id)`.
- `economy_labs` checks level 1–10, ampoules 1–5, `storage_cap = level * 1000`,
  and `stored_amount BETWEEN 0 AND storage_cap`. `paused_at` is nullable and
  must be present while the owning guild economy is disabled by service
  transitions. Lab operation kind is limited to
  `buy|upgrade|ampoules|collect`, monetary input/result fields are
  non-negative, exact result JSON is required, and the Discord interaction ID
  is the primary key.
- Foreign keys cascade gang members/invites with a disbanded gang. A lab
  operation's nullable lab reference becomes null when its lab is removed;
  its guild/user/interaction key and result snapshot remain durable for replay.
  Service transactions still re-check all ownership, capacity, balance,
  expiry, and status conditions; constraints are the final guard, not the only
  guard.

### Leaderboard page behavior

`/economy leaderboard` returns the first 25 guild accounts ordered by total
`wallet + bank` descending, then Discord user ID ascending. Bot accounts cannot
be created through ByteBot's command boundaries, so the query does not perform
network lookups or silently discard durable rows. It does not create accounts
and never reads a global scope. If more than 25 rows
exist, show a `next` button; subsequent pages use a server-generated page
token containing guild, requester, offset, and a ten-minute expiry. Only the
requester may use those buttons. `previous` and `next` use offsets of 25,
disable at the ends, and are terminal after expiry. A missing member at render
time remains a row with its stored Discord ID rather than changing rank order.
