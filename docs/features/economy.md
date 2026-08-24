# Economy

ByteBot's economy uses one auditable ledger for guild and opt-in global
accounts. Guild mode is the default. A guild administrator enables the system
with `/economy enable`; members then create an account with `/economy open`.

## Member commands

- `/economy balance [member] [scope]` shows wallet, bank, total, and rank.
- `/economy mode [scope]` views or selects `guild`/`global` mode.
- `/economy deposit` and `/economy withdraw` move a positive amount or `all`
  between wallet and bank in guild mode.
- `/economy daily` pays the documented 500 base reward with the universally
  enabled 1.5x allowance: 750 once per UTC day.
- `/economy work [job]` pays 1.5x the selected job's base result.
- `/economy transfer` atomically moves wallet currency to another non-bot
  member in the same selected scope.
- `/economy job list` and `/economy shop list|buy` expose guild jobs and the
  guild's role shop.
- `/economy game` contains coinflip, dice, gamble, roulette, highlow, slots,
  plinko, bombs, ladder, crash, scratch, and blackjack. Bets use the public
  10–1,000,000 bound; odds and payout tables are visibly ByteBot-owned.
- `/economy crime` and `/economy rob` use persisted one-hour/two-hour
  cooldowns. Robbery touches wallets only, so banked currency stays safe.
- `/economy leaderboard` shows committed guild totals in deterministic order.
- `/economy gang` provides create, info, invite, promote, transfer, banner,
  leave, and disband workflows with durable user-bound invites.
- `/economy lab` provides one wallet-funded passive-income laboratory per
  guild account with fixed, visible ByteBot-owned costs and progression.

Daily and work earnings share a user-wide 50,000-per-UTC-day ceiling, a
30-guild-per-day guard, and the public six-hour server/member age gate. The
built-in `worker` job pays a 100–250 base amount once per hour. Deposits,
withdrawals, transfers, returned stakes, shop reversals, and administrator
adjustments are not earnings and are never multiplied.

Global mode always uses the fixed `coins` currency, 50,000 daily cap, zero
starting balance, and built-in `worker` job. Guild configuration and custom
jobs cannot alter that cross-guild scope, and members can view only their own
global balance.

## Administration and RBAC

The `/economy` root remains public so member commands stay discoverable.
Mutating `/economy config`, `enable`, `preset`, `grant`, `remove`, `reset`,
`destroy`, `disable`, `job add|remove`, and `shop add|remove` paths check the
invoker's real Discord Manage Server permission inside the handler. ByteBot
RBAC can narrow these paths but cannot substitute a fake permission for the
real Discord permission.

Role-shop delivery also requires ByteBot's Manage Roles permission and a role
below ByteBot without Administrator or integration management. A purchase is
debited and marked pending before delivery. Successful delivery becomes
durable; a proven failure writes a compensating credit. Uncertain Discord
timeouts remain pending and are reconciled on startup rather than guessing.

`reset`, `destroy`, and `disable` first return a random confirmation code bound
to the actor, guild, action, reason, target, amount, and current account plan.
The code expires after ten minutes, is single-use, and fails if the plan
changes. Reset and destroy write immutable burn entries; disabling preserves
all data. Disable refunds active game wagers and pauses laboratory accrual;
reset forfeits the target's active game and removes its lab while preserving
immutable ledger and operation-replay records.

## Ledger model

Every balance change runs in an immediate SQLite transaction. Accounts are
keyed by scope and user; guild configuration, jobs, and shop items are keyed by
guild. Paired transfers and bank moves net to zero. Mint/burn entries update
scope totals as decimal `BigInt` values in the same transaction. Current
circulation and ranks remain under a JavaScript-safe per-scope supply ceiling;
lifetime totals are never read through a lossy numeric `SUM`.

Game wagers and lab purchases are declared burns; returns, refunds, and lab
collections are declared mints. Robbery is a paired zero-supply transfer.
Interactive games and gang invites use durable, actor-bound component state,
and startup refunds only expired active wagers once. `bal` is recorded as the
prefix-style alias of `/economy balance`; Discord has no slash alias field.
