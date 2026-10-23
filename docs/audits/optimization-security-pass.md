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

The final combined Node 22.23.2 suite passed all 101 suites and 1,060 tests at `23c4732`. The clean dependency audit reports zero advisories. Earlier targeted counts describe intermediate checks and overlap with the combined total.

The complete test command is `npm test -- --runInBand --silent` with Node 22.23.2. Dependency and migration-schema checks use `npm audit --json` and `npx drizzle-kit check`. Tests use temporary databases and mocks; none require a bot login.

No live Discord commands, provider credentials, production database, deployment, or running service restart have been used. All behavior claims above refer to local command/service tests. Command registration changes will need deployment before they appear in Discord.

The append-only [decision log](optimization-security-decisions.tsv) records choices and evidence.
