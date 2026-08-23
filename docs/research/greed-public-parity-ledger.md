# Greed Public Parity Ledger

This ledger maps every publicly evidenced Greed category to the ByteBot delivery issues created from [spec #33](https://github.com/luinbytes/bytebot-definitive-edition/issues/33). It is a coverage ledger, not a claim about Greed's undocumented runtime behavior.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `tracked` | Public evidence is mapped to delivery issues; implementation has not landed. |
| `partial` | ByteBot already has some of the public family, but the mapped issues still owe parity work. |
| `complete` | The mapped behavior is implemented and freshly verified. |
| `evidence-gap` | The public sources assert a surface but do not identify enough detail to implement it honestly. |
| `blocked` | A real provider, legal, Discord, or VPS constraint prevents delivery and has recorded evidence. |
| `policy-excluded` | The named public subject cannot be implemented within applicable policy or law. |

Only `complete`, `evidence-gap`, `blocked`, and `policy-excluded` are terminal statuses. Terminal entries require a source or verification link.

## Live public catalog coverage

Source: [Greed commands](https://greed.best/commands), researched 2026-08-23. The rendered category counts total 916 while the page advertises 945 commands; the remaining 29 are retained as an evidence gap rather than assigned invented names.

| Live category | Advertised count | ByteBot issues | Status |
| --- | ---: | --- | --- |
| Information | 86 | #51, #52, #60 | `partial` |
| Utility | 80 | #35, #42, #46, #51, #52, #53, #55, #56, #58, #60, #62 | `partial` |
| Moderation | 80 | #36, #37, #38 | `partial` |
| Fun | 55 | #35, #54, #56 | `partial` |
| Economy | 38 | #48, #49 | `tracked` |
| Roleplay | 3 | #54 | `tracked` |
| Security | 82 | #36, #39, #40 | `partial` |
| LastFM | 65 | #57 | `tracked` |
| Logs | 5 | #37, #39, #40, #50 | `partial` |
| Voice | 29 | #58, #59 | `partial` |
| Auto | 45 | #42, #43 | `partial` |
| Server | 164 | #41, #43, #44, #45, #46, #47, #50 | `partial` |
| Settings | 47 | #36, #37, #41, #43, #54, #57, #58 | `partial` |
| Levels | 3 | #50 | `partial` |
| Socials | 31 | #60, #61 | `tracked` |
| Manipulation | 99 | #55, #56, #62 | `tracked` |
| Snipe | 4 | #54 | `tracked` |
| Unidentified remainder | 29 | #64 | `evidence-gap` — the public page does not name its missing bucket |
| **Total** | **945** | #34–#64 | Mixed |

## Pinned official English registry coverage

Source: [`greedbest/i18n` commit `3dadc41852a09567add8a6b2b522d5e2b1a53b2f`](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f), whose README calls English the complete base language. The counts are localization files, not guaranteed registered commands. Every file below a directory inherits that directory's issue mapping until a feature PR records a narrower mapping.

| Registry directory | English JSON files | ByteBot issues | Status |
| --- | ---: | --- | --- |
| `auto` | 55 | #42 | `partial` |
| `boosters` | 3 | #43 | `tracked` |
| `developer` | 4 | #64 | `evidence-gap` — absent from the live public category list and may be internal-only |
| `economy` | 50 | #48, #49 | `tracked` |
| `fun` | 71 | #35, #54, #56 | `partial` |
| `information` | 48 | #51 | `partial` |
| `lastfm` | 22 | #57 | `tracked` |
| `levels` | 8 | #50 | `partial` |
| `logs` | 7 | #37, #39, #40, #50 | `partial` |
| `manipulation` | 3 | #56 | `tracked` |
| `moderation` | 101 | #37, #38 | `partial` |
| `music` | 9 | #58 | `tracked` |
| `roleplay` | 1 | #54 | `tracked` |
| `security` | 102 | #39, #40 | `partial` |
| `server` | 214 | #41, #43, #44, #45, #46, #47, #50 | `partial` |
| `settings` | 42 | #36, #37, #41, #43, #54, #57, #58 | `partial` |
| `snipe` | 5 | #54 | `tracked` |
| `socials` | 11 | #60, #61 | `tracked` |
| `utility` | 123 | #35, #42, #46, #51, #52, #53, #55, #58, #60, #62 | `partial` |
| `voice` | 33 | #59 | `partial` |
| **Total** | **912** | #35–#64 | Mixed |

## Cross-cutting delivery issues

| Issue | Coverage |
| --- | --- |
| #34 | Ledger, help discovery, and path-aware RBAC foundation |
| #63 | Highest public caps and small-VPS packaging |
| #64 | Final reconciliation of all entries and source drift |

## Delivered slices

| Capability | Issue | Ledger impact | Verification |
| --- | --- | --- | --- |
| `uwuify`; `uwulock add/remove/list`; `uwulock protect add/remove/list` | #35 | Advances the live Fun/Utility and pinned `fun`/`utility` rows; each remains `partial` because other mapped issues are still open. | `tests/uwuLock.test.js`, `tests/uwuLockCommands.test.js`, `tests/uwuLockReplay.test.js`, and `tests/databaseMigrations.test.js` |
| Command disable/enable/whitelist, allow/deny/unrestrict, fake permissions, blocked role permissions, and protected moderation targets | #36 | Advances the live Settings/Moderation and pinned `settings`/`moderation` rows; each remains `partial` because other mapped issues are still open. | `tests/accessControlCommands.test.js`, `tests/permissions.test.js`, and `tests/databaseMigrations.test.js` |
| Core member moderation, setup, cases/history, hardban enforcement, invoke templates, staff roles, and warning punishments | #37 | Advances live Moderation/Logs/Settings and pinned `moderation`/`logs`/`settings`; each remains `partial` because #38 and other mapped issues remain open. | `tests/moderationWorkflow.test.js`, `tests/moderationHistory.test.js`, `tests/moderationUtil.test.js`, and `tests/databaseMigrations.test.js` |
| Cleanup, selfpurge, all purge filters, reversible lockdown, slowmode/topic/NSFW, nickname enforcement, and member/bulk/managed role operations | #38 | Completes the moderation command family mapped to #38; live and pinned Moderation remain `partial` until all mapped moderation/security issues close. | `tests/channelRoleModeration.test.js`, `tests/commandHubs.test.js`, `tests/commands.test.js`, and `tests/databaseMigrations.test.js` |
| Global and per-module AntiNuke configuration, 27 destructive audit-action modules, explicit admins/whitelist, rolling thresholds, six punishments, durable incidents, and logs | #39 | Advances live Security/Logs and pinned `security`/`logs`; each remains `partial` until #40 and the other mapped logging issues close. | `tests/antinuke.test.js`, `tests/commandHubs.test.js`, and `tests/databaseMigrations.test.js` |

## Update rule

Each feature PR updates only the rows it materially advances and links fresh verification. A row becomes `complete` only when all its mapped issues are closed or its remaining subfamilies have explicit terminal entries. Numeric subtraction between the live 945 total and the 912-file registry is never used to invent commands.
