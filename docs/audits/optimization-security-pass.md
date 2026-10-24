# Optimization and security pass

Review base `c38e795fa4f94b02e39852f4b1701bdb6091a754`. Delivery is one pull request on `chore/optimize-security-pass`. Preserve existing commands and features. Changes require reproducible evidence and relevant regression checks.

## Tasks

- [x] Inventory command dispatch, security boundaries, runtime hot paths, and existing tests.
- [x] Reproduce and repair message-source reads that bypass caller channel access.
- [x] Reproduce and repair AutoMod regex failure bypasses without punitive strikes.
- [x] Patch dependency advisories and verify the migration compiler.
- [x] Fix the date-dependent baseline fixture.
- [x] Stop startup-owned polling, presence and recovery retries during shutdown.
- [x] Integrate and verify set-based XP boosts and draining analytics retention.
- [x] Bound auto-responder matching and enforce role-action authorization.
- [x] Derive help from registered commands and add full-path lookup and autocomplete.
- [x] Protect private bookmark replies and global tag ownership, including concurrent creation.
- [x] Enforce actor authority for backup, role distribution and moderation inverses.
- [x] Apply current denied-role policy to level rewards and VoiceMaster recovery.
- [x] Run combined tests, independent standards/spec review, and command-inventory comparison.
- [x] Prepare the reviewed PR, evidence and runtime coverage limits.
- [x] Complete the deferred service and component source coverage from the initial scan.
- [x] Make failed compatibility schema repairs stop startup while preserving existing rows.
- [x] Bound confession admission, ticket transcripts/deletion, and starboard work.
- [x] Preserve durable Last Active after retention, following independent spec review.
- [x] Keep Last Active current when achievement awards are disabled or opted out.
- [x] Repair birthday role ownership, streak freezes, and achievement settings/custom awards.
- [x] Reduce repeated outbox accounting and activity-history materialization.
- [x] Reconcile shop supply accounting and bound BytePod preset setup.
- [x] Validate the startup-recovery scalability candidate and retain recovery correctness.
- [x] Close final giveaway recovery ordering and deadline-edit races.
- [x] Reconcile existing PR feedback and complete the combined local audit.

## Verified findings

### Message source access

`/copyembed`, `/embed copy`, and `/pagination` fetched messages using the bot's access alone. Three regression cases demonstrated reads from a channel the caller could not access. They now share a message-reference boundary that checks the linked guild, effective channel permissions, message history access, and private-thread membership before fetching content. Pagination also requires Manage Messages in the target channel.

Readable messages and accessible private threads still work. Malformed references and references to other guilds are rejected before fetching content. Existing tests cover successful reads and denied reads.

### Regex evaluation failures

Configured AutoMod regex rules silently passed messages when evaluation timed out, its bounded queue filled, or worker construction rejected. All three conditions were reproduced. Unchecked messages are now deleted and recorded as `regex:unavailable`, without adding strikes or triggering member punishments. Existing exemptions remain intact.

### Dependency advisories

The baseline npm audit reported 12 affected packages. Compatible dependency updates and a scoped esbuild override removed all reported advisories after a clean install. The override avoids npm's suggested breaking downgrade of drizzle-kit. `drizzle-kit check` and the actual `@esbuild-kit/core-utils` TypeScript transform pass.

The esbuild override follows the [maintainer's security advisory](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99). The dependency audit is a package advisory check, not proof that every advisory was exploitable through ByteBot.

### Analytics work and retention

The integrated analytics change uses one set-based boost query. In the deterministic 80-role workload, executed SQL fell from 95 to 15 statements (including transactions), while the XP award stayed at 90. This measures statement count, not wall-clock speedup. Five combined analytics suites passed 56 tests.

Async retention drained 2,505 expired rows per table in bounded batches while preserving cutoff/newer records and XP balances. Concurrent drains coalesce; cleanup cancels drainage and clears analytics-owned timers. The synchronous batch API remains available.

Startup-owned timers now share a cancellation point invoked before service cleanup. The regression covers periodic work and an in-flight AntiNuke retry finishing after cancellation; it cannot schedule another retry. Five startup recovery tests pass. Existing operations already in flight are not claimed to be aborted.

### Personal content and global ownership

The real public bookmark alias deferred publicly before displaying cached private content. Bookmark metadata now makes the initial acknowledgement ephemeral. Existing alias regressions exercise view, list and search with cached private content.

A Manage Server flag from any guild previously bypassed ownership of global tags. Tag mutations now require the author or configured bot developers; guild staff retain local tag-send controls. Author checks and writes share a transaction, which also fixes a reproduced concurrent creation overwrite. Regression checks cover edit, rename, removal, developer moderation, retained attribution and concurrent creation.

### Responder matching and role delivery

Regex and wildcard responders now run in a dedicated lazy worker with at most 32 pending jobs, 50 ms evaluation time and a one-second admission deadline. Tests reproduced both blocking patterns before isolation. Timeout, overflow, worker failure and cleanup resolve without triggering a response. Existing case and wildcard semantics are preserved; a reservation prevents duplicate replies while asynchronous matching yields. Three integrated responder suites passed 76 tests under Node 22.23.2.

Responder role-action configuration requires Manage Roles and actor hierarchy validation. Automated responder, level reward and VoiceMaster grants/recovery use the shared current-policy role helper. Rejected grants retain their error/retry state rather than claiming success. Level reward reconciliation now makes one role-add call per role, trading the old batch call for the existing policy boundary; no claim of a speedup in that path.

The same configuring-actor guard covers changes that widen access to an existing role-granting responder, including restriction edits and the retained legacy enable/edit adapter. Disabling, deleting and removing role actions remain available. Vanity reward removal preserves its enabled state and remains possible when multiple configured rewards become prohibited by current policy.

### Role authority and recovery

Autorole, vanity and economy-shop role configuration require the caller's actual Manage Roles permission and hierarchy. Delivery validates current denied-role policy. Moderation undo validates every role it would add before claiming the case or changing roles, including historical staff-role restoration by an authorized actor.

Backup restore fetches current caller membership, checks permissions for selected sections, and protects AntiNuke configuration with its trusted-manager boundary. Restored role-grant settings require actor authority over their targets, including disabled settings, saved roles recreated in the same restore, and existing achievement rewards. Destructive deletion of achievement settings also requires that authority because missing settings enable rewards by default. Current and snapshot denied permissions are checked before mutation. Failed role recreation cannot make configuration fall back to an unauthorized old role.

Destructive channel restore applies the SDK's management requirements to the caller before any deletion. These include View Channel and Manage Channels, Connect for voice or stage channels, and timeout restrictions. Owner and Administrator exemptions remain intact, as do ByteBot's own deletion checks.

A confirmed shop delivery settles without a second debit or grant. An unconfirmed pending purchase blocked by changed role policy stays debited and pending for policy resolution and reconciliation. Automatically refunding an uncertain delivery could credit a purchase whose role was already granted.

### Command discovery

Help now derives registered public paths from schemas, supports full-path lookup and autocomplete, and displays nested required/optional options and constraints. Hidden adapters and developer execution schemas remain intact. Bounded pagination rejects malformed/stale cursors. Browse remains public and detailed replies private. Stale reminder, birthday, bookmark, game and help hints now name their public hub paths.

Four integrated help/hub/alias/permissions suites passed 69 tests. A serialized command-schema comparison preserved all 55 registered roots (including context menus) and 831 runnable paths. The only schema differences were the bot description and help's argument description, autocomplete and 100-character input limit. No existing route or option was removed.

### Independent security audit

The standard source scan validated eight findings at the pinned base (seven medium, one low), using bounded inert mocks. Its achieved coverage is partial, not an exhaustive assurance. Integrated fixes cover backup action permissions and trusted AntiNuke configuration, configuring-actor role authority, moderation inverse roles, and current denied-role policy in automated grants. Follow-up review found additional restore-configuration and effective-channel permission paths, now repaired in `80837cf`. No separate clean-repository claim follows from this report.

### Baseline verification

The original suite ran 885 tests. 884 passed. The remaining stats test seeded July 2026 data and used the current clock for a 60-day query. It failed in October because the fixture had aged out. The test now pins its clock to its reporting period.

## Design decisions

Help and autocomplete share one private traversal of the actual command schemas inside the help command. Hidden compatibility adapters remain loaded for execution. No separate feature registry or routing rewrite is needed. This is the selected smaller design after two independent sketches and a third review.

Boundary Discipline puts message authorization before network fetches. Model the Domain keeps command paths derived from schemas and analytics maintenance owned by its service. Prove It Works requires regression evidence and a clean combined check before handoff.

Attack the Premise rejected the assumption that snapshot fields alone describe every restored role grant. A reproduced destructive restore deleted a disabled achievement setting, activating defaults while reward mappings survived. Preflight now includes that deletion's effect on grants.

## Independent review follow-up

Standards review identified three issues: widening access to existing role-granting responders without actor authority, destructive backup deletion without effective channel permissions, and vanity reward cleanup blocked after multiple roles became denied. Spec review identified two issues: rejected AutoMod worker creation escaping the unavailable-evaluation path, and backup settings restoring higher-authority role grants. These are source-backed findings, not style preferences.

The responder, AutoMod and vanity failures were reproduced before their fixes. Their four affected suites pass 108 tests at `275dfe8`. A fresh independent source review of `5cdc2fb..275dfe8` found no remaining issues in those repairs. Both backup bypass regressions also failed before repair, then passed with no mutations on rejection.

Fresh backup Standards and Spec reviews independently found the same two remaining gaps at `80837cf`: achievement defaults activated by deletion, and implicit channel permission denials. Five regressions reproduced those gaps, including timed-out actors. Both repairs are in `23c4732`; 56 backup and presentation tests pass. A fresh closure review found no remaining issues in either repair or the retained authorized paths. A transient model-capacity failure required retrying one earlier review on the same configured model. Reviews use the configured GPT model family; no cross-family independence is claimed.

## Evidence and limits

The initial combined Node 22.23.2 suite passed all 101 suites and 1,060 tests at `23c4732`. The clean dependency audit reported zero advisories. Earlier targeted counts describe intermediate checks and overlap with the combined total. Completion verification is recorded below.

The complete test command is `npm test -- --runInBand --silent` with Node 22.23.2. Dependency and migration-schema checks use `npm audit --json` and `npx drizzle-kit check`. Tests use temporary databases and mocks; none require a bot login.

No live Discord commands, provider credentials, production database, deployment, or running service restart have been used. All behavior claims above refer to local command/service tests. Command registration changes will need deployment before they appear in Discord.

The append-only [decision log](optimization-security-decisions.tsv) records choices and evidence.


## Completion audit

The initial handoff covered the validated findings but left named large services outside the original scan. The completion audit resumed that work. Independent source readers covered the full ticket, giveaway, VoiceMaster, event logging, lifecycle message, starboard, economy, activity streak, level analytics, birthday, reminder, community utility, fun, information lookup, music, moderation, channel moderation, role moderation, moderation setup and moderation template services. A separate reader completed `/mod`, the legacy BytePod command and BytePod controls. Related event/component paths and relevant schema definitions were traced. Source coverage does not establish live behavior or deployed configuration.

### Startup repair and bounded work

Failed compatibility schema repairs now reject startup rather than allowing a bot session without required constraints. Disposable duplicate-row fixtures reproduce both failure paths and retain their original rows. Three affected suites passed 19 tests.

Confession admission occurs before deferral. Each guild permits four active/queued submissions, with 32 globally and one pending submission per author per guild. Busy submissions get private retry guidance. Cleanup and guild purge cancel queued publication; already-started sends retain their slots until settlement. Two worker suites passed 54 tests.

Event-log fan-out reads guild/global outbox totals once inside the admission transaction and updates those totals as rows are inserted. Retention maintenance runs hourly rather than on every event. The 15-destination fixture reduced aggregate statements from 32 to two while retaining all 15 admissions. Tests cover duplicate handling, remaining row capacity, UTF-8 byte capacity, retention and delivery recovery. All 18 tests pass. This is a statement-count result, not an elapsed-time claim; large retained outboxes still require aggregate scans.

BytePod preset admission is atomic and capped at 998 saved users, leaving two channel overwrite entries for the creator and everyone role. This follows the current [Discord overwrite ceiling](https://docs.discord.com/developers/topics/opcodes-and-status-codes). Existing oversized lists remain readable and removable through bounded pages. Pod creation applies at most 998 entries and explicitly reports excess entries; no saved data is discarded. Thirteen BytePod tests cover concurrent admission, guild isolation, large-list rendering and bounded setup work.

### Account and reward correctness

Birthday role removal now relies on durable confirmed grants with expiry and membership identity. Shared roles, preexisting memberships, uncertain grants and members who rejoined are not treated as bot-owned assignments. Failed confirmed removals retry. Untracked legacy assignments are preserved because ownership cannot be reconstructed safely. Upcoming birthday output paginates dates and large same-day groups within embed limits.

Streak freezes now cover each missed day once across both recovery sweeps. Actual active-day totals remain separate from the coverage date. Repeated/concurrent sweeps and overlapping activity are tested. Existing incorrectly consumed historical charges are not reconstructed. Achievement DMs honor the configured notification preference; guild-local custom achievements can be manually awarded and removed, while foreign/disabled IDs reject. SQL totals return one aggregate result instead of materializing all retained daily rows. They still scan retained history; no latency speedup is claimed.

Shop reservations declare supply burns and proven reversals declare matching mints, consistent with wager/refund accounting. Pending purchases remain debited until their existing delivery policy resolves. Repeated reversal cannot duplicate credit or totals. Startup reconciles older shop ledger entries without rewriting their history. Three economy suites passed 29 tests.

Ticket transcript size accounting now runs while pages are fetched and stores rendered rows within the 8 MiB bound. Overlapping deletion calls coalesce. Parent review rejected a proposed permanent delivery-journal gate because staff had no recovery command. Interrupted deletions now close safely without replaying network side effects; an explicit authorized retry saves fresh history. This preserves retries after missing log permissions and uncertain sends, with clear duplicate-log guidance. All 29 ticket tests pass.

Starboard schedules at most 500 tracked messages with four updates running and one timer. Same-message events during an update schedule a later recount instead of a concurrent post. At capacity, new message IDs are rejected until another reaction retries them; admitted entries still coalesce. Paged raw reaction reads count beyond 100 users without growing SDK user caches. Failed reads preserve saved counts and posts. Cleanup cancels pending work and waits for already-started updates. The combined starboard/ticket check passed 50 tests across three suites.

Preset lookup now uses an owner/guild index. The query-plan regression changed from a table scan to the named index; fresh and partial legacy database fixtures pass. No elapsed-time claim follows. Two affected suites passed 20 tests.

The first completion Standards review found no supported issues at `217e2fb`. Spec review found one retained-feature regression: deriving Last Active solely from retained logs loses the display after pruning. Commit `9fc295c` preserves the durable actual activity date and stores freeze coverage separately. Migration `0043` preserves legacy dates and constraints. Regression checks cover pruned logs, freezes, concurrent updates, and fresh, legacy and missing-table startup. The worker's five affected suites passed 53 tests. Two redundant comments from earlier completion fixes were removed.

Both lifecycle reviews found no supported issues in `217e2fb...e971395`. That scope included ticket transcript limits, deletion retries and recovery, starboard scheduling and reaction pagination, and the BytePod index. The reviews inspected source and existing tests without running them.

### Startup recovery ordering

Commit `91308c5` starts ticket recovery independently of VoiceMaster and giveaway recovery. A deferred Discord request previously blocked ticket inactivity polling. The repaired regression issues the warning once while the unrelated request remains pending. Giveaway recovery processes expired draws and pending rerolls before future rows, including a backlog of 26 rerolls. It rereads deadlines changed during resource fetches and prevents late schedulers or new winner claims after cleanup.

Giveaway draws still wait for VoiceMaster role recovery. An attempted fully parallel startup excluded an entrant whose persisted role had not yet been restored. Keeping that dependency preserves eligibility. Recovery scans remain serial and a stalled due-work request can still delay later due work. The fix does not claim a general startup throughput bound or measured latency improvement. Four worker suites passed 66 tests.

### Completion verification

The completion fixes through `91308c5` pass all 101 suites and 1,174 tests on Node 22.23.2. Commit `2d9e209` removes one redundant comment without changing behavior. The fresh dependency audit reports zero advisories, and the schema check passes with migration `0043`. The serialized command inventory remains unchanged from the initial repairs, with 55 registered roots and 831 runnable paths.

Final Standards review found that interrupted manual endings also need priority over future giveaways. Spec review confirmed that ordering issue and the deadline-edit race during entrant lookup. It also found that Last Active becomes stale when award eligibility returns early despite accepted activity logs. Both bounded follow-up repairs are complete. These findings show why a passing suite alone does not close source review.

Commit `e6ae288` repairs both giveaway findings. Automatic expiry checks the current deadline inside the winner-claim transaction. Manual end requests sharing an automatic operation retry if that operation skips an extended deadline. Stored winner rounds remain unchanged, and interrupted endings precede future active rows during recovery. Seven new timing cases and the expanded persisted-round case pass. The combined giveaway/startup run passes 34 tests. Fresh Standards and Spec reviews found no remaining issues in this delta. The comment review found no added comments or suppressions.

Parent review rejected advancing streak counters while achievement tracking is disabled. Commit `59d7210` instead updates durable Last Active without consuming freezes or counting an eligible day. Re-enabling on that same day counts eligible activity once. The existing coverage field distinguishes unknown legacy coverage from no known eligible day. Concurrent first activity reuses the winning row rather than swallowing a uniqueness error. The corrected-contract regressions first failed in eight cases, then passed. Four affected worker suites pass 76 tests, including paused/eligible overlap and pruning. Commit `325b608` removes one redundant comment. Its comment review found no added comments or suppressions. Fresh Standards and Spec reviews found no remaining issues in the final activity-date delta.

The final combined run at `325b608` passes **101 suites and 1,201 tests** on Node 22.23.2. The command is `npm test -- --runInBand --silent`. The fresh dependency audit reports zero advisories and the migration check includes `0043`. These results supersede the intermediate 1,060- and 1,174-test totals. All supported findings in the completed source partitions and follow-up reviews have repairs and relevant regression evidence. PR 96 had no unresolved remote review comments at the pre-publication read; that read covered its earlier `7a828c9` head, not the completion commits. New remote checks are separate from this local verification.

## Completion gates

| Requirement | Authoritative evidence | Local result |
| --- | --- | --- |
| Optimize runtime work without changing results | Persisted XP and retention regressions, SQL statement counts, admission limits, lifecycle recovery tests | Passed in the combined suite |
| Audit security and repair findings | Pinned source scan, completed service partitions, authorization regressions, independent closure reviews, zero package advisories | Supported findings closed; coverage limits retained |
| Simplify discovery while retaining features | Serialized schemas retain 55 registered roots and 831 runnable paths; help, hub and adapter tests cover canonical paths and arguments | Passed |
| Include discovered feature gaps | Custom achievement awards, complete reaction counts, bounded full lists, durable reward ownership and activity dates | Passed in the combined suite |
| Keep tasks updated and deliver verified work | This checklist, the decision log, combined test logs and PR 96 | Local work reviewed and verified for publication |

Historical migration files and archives were not all read line by line. Fresh and representative legacy migrations were exercised in disposable SQLite databases. The completed source partitions extend the initial security scan's coverage without establishing exhaustive security assurance or live Discord behavior.
