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
| Information | 86 | #51, #52, #60, #62 | `partial` |
| Utility | 80 | #35, #42, #43, #46, #51, #52, #53, #55, #56, #58, #60, #62 | `partial` |
| Moderation | 80 | #36, #37, #38 | `partial` |
| Fun | 55 | #35, #52, #53, #54, #56 | `partial` |
| Economy | 38 | #48, #49 | `partial` — core accounts, ledger, earnings, banking, jobs, shops, configuration, and administration are implemented; #49 owns games, gangs, laboratories, crime/robbery, and rankings |
| Roleplay | 3 | #54 | `partial` — implementation is locally verified; live Discord proof remains outstanding |
| Security | 82 | #36, #39, #40 | `complete` — all mapped public protection surfaces are implemented |
| LastFM | 65 | #57 | `tracked` |
| Logs | 5 | #37, #39, #40, #50 | `complete` — moderation, protection, and configurable event-log delivery are implemented with the public 15-channel maximum |
| Voice | 29 | #58, #59 | `partial` |
| Auto | 45 | #42, #43 | `complete` — all mapped public automation and self-service role surfaces are implemented |
| Server | 164 | #41, #43, #44, #45, #46, #47, #50 | `partial` |
| Settings | 47 | #36, #37, #41, #43, #54, #57, #58 | `partial` |
| Levels | 3 | #50 | `complete` — text/voice levels, rewards, rank cards, and bounded analytics are implemented |
| Socials | 31 | #60, #61 | `complete` — lawful keyless lookups and canonical link reposting are implemented; credentialed feeds, downloads, and undocumented auto-reposter behavior have terminal provider/evidence blockers |
| Manipulation | 99 | #55, #56, #62 | `complete` — shared bounded inputs, local transforms/effects/templates, OCR, and TTS are implemented; exact provider assets/algorithms and generative surfaces have terminal evidence/provider/resource blockers |
| Snipe | 4 | #54 | `partial` — implementation is locally verified; live Discord proof remains outstanding |
| Unidentified remainder | 29 | #64 | `evidence-gap` — the public page does not name its missing bucket |
| **Total** | **945** | #34–#64 | Mixed |

## Pinned official English registry coverage

Source: [`greedbest/i18n` commit `3dadc41852a09567add8a6b2b522d5e2b1a53b2f`](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f), whose README calls English the complete base language. The counts are localization files, not guaranteed registered commands. Every file below a directory inherits that directory's issue mapping until a feature PR records a narrower mapping.

| Registry directory | English JSON files | ByteBot issues | Status |
| --- | ---: | --- | --- |
| `auto` | 55 | #42 | `complete` — responders, reactions, member roles, tracking, vanity, and join notification families are reconciled |
| `boosters` | 3 | #43 | `complete` — current/lost booster views and the full custom booster-role lifecycle are reconciled |
| `developer` | 4 | #64 | `evidence-gap` — absent from the live public category list and may be internal-only |
| `economy` | 50 | #48, #49 | `complete` — accounts, banking, earnings, games, crime/robbery, gangs, laboratories, rankings, shops, and administration are reconciled; unpublished algorithms remain visibly ByteBot-owned |
| `fun` | 71 | #35, #52, #53, #54, #56 | `partial` |
| `information` | 48 | #51, #52, #62 | `partial` |
| `lastfm` | 22 | #57 | `tracked` |
| `levels` | 8 | #50 | `complete` — every pinned levels subject is implemented or mapped to an explicit alias/evidence decision |
| `logs` | 7 | #37, #39, #40, #50 | `complete` — every pinned logging subject is implemented or mapped to the shared event-log surface |
| `manipulation` | 3 | #56 | `complete` — AlexFlipnote, Jeyy, and Popcat provider families are reconciled to local implementations, explicit blockers, or evidence gaps without proxying undocumented APIs |
| `moderation` | 101 | #37, #38 | `partial` |
| `music` | 9 | #58 | `tracked` |
| `roleplay` | 1 | #54 | `partial` — all 43 pinned action subjects are mapped; live Discord proof remains outstanding |
| `security` | 102 | #39, #40 | `complete` — all pinned public security families are reconciled |
| `server` | 214 | #41, #43, #44, #45, #46, #47, #50 | `partial` |
| `settings` | 42 | #36, #37, #41, #43, #54, #57, #58 | `partial` |
| `snipe` | 5 | #54 | `partial` — all five files are locally verified with bounded retention; live Discord proof remains outstanding |
| `socials` | 11 | #60, #61 | `complete` — implemented public lookups/link reposting plus source-cited provider, licensing, and command-shape blockers reconcile the registry surface |
| `utility` | 123 | #35, #42, #43, #46, #51, #52, #53, #55, #58, #60, #62 | `partial` |
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
| AntiRaid join/account/avatar/username/bot/mention protection, reversible lockdown and cleanup, 15 AutoMod filters, keywords/domains/allowlists, isolated regex, strikes, exemptions, punishments, and owned Discord migration | #40 | Completes live and pinned Security. Logs remains `partial` until #50; current public sources expose no local NSFW classifier contract, so Discord's owned sexual-content preset is the recorded provider boundary. | `tests/securityAutomation.test.js`, `tests/commandHubs.test.js`, and `tests/databaseMigrations.test.js` |
| Welcome, goodbye, boost, and Discord-native system messages; validated variables and embed scripts; tests, formats, auto-delete, exact public aliases, and legacy welcome migration | #41 | Advances live Server/Settings and pinned `server`/`settings`; both remain `partial` because other mapped issues are still open. | `tests/lifecycleMessaging.test.js`, `tests/lifecycleEvents.test.js`, `tests/commandHubs.test.js`, and `tests/databaseMigrations.test.js` |
| Autoresponders, autoreactions, member/bot autoroles, timers, bump reminders, sticky/revive messages, username/vanity tracking, counters, vanity rewards, and join notifications | #42 | Completes pinned `auto` and advances live Auto/Utility plus pinned `utility`; those broader rows remain `partial` where other mapped issues remain. | `tests/automationPlatform.test.js`, `tests/autoResponder.test.js`, `tests/events.test.js`, and `tests/databaseMigrations.test.js` |
| Reaction roles, persistent role buttons, temporary roles, current/lost booster views, and custom booster roles with edits, filters, sharing, synchronization, and loss cleanup | #43 | Completes live Auto and pinned `boosters`; advances live Server/Settings/Utility and pinned `server`/`settings`/`utility`. | `tests/roleAutomation.test.js`, `tests/automationPlatform.test.js`, and `tests/events.test.js` |
| Embed and Components V2 scripts, custom responses, global tags, durable pagination, managed webhooks, published embed discovery/copying, and server embed colors | #44 | Advances live Server/Utility and pinned `server`/`settings`/`utility`; those broader rows remain `partial` while their other mapped issues are open. | `tests/richContent.test.js`, `tests/richContentPersistence.test.js`, `tests/richContentCommands.test.js`, and `tests/events.test.js` |
| Ticket panels/options/forms, topics, access roles/blacklists, claims, lifecycle controls, transcripts, opening limits, inactivity, DMs, logs, ratings/vouches, profiles, lists, and statistics | #45 | Advances live Server/Logs/Settings and pinned `server`/`logs`/`settings`; those broader rows remain `partial` while their other mapped issues are open. | `tests/ticketPlatform.test.js`, `tests/events.test.js`, `tests/lifecycleEvents.test.js`, `tests/databaseMigrations.test.js`, and `tests/schema.test.js` |
| Giveaways with eligibility, weighted entries, templates, edits, DMs, auditable restart-safe winner rounds and rerolls; metric counters for members, bots, online, and voice | #46 | Advances live Server/Utility and pinned `server`/`utility`; both remain `partial` while their other mapped issues are open. | `tests/giveawayPlatform.test.js`, `tests/automationPlatform.test.js`, `tests/events.test.js`, `tests/databaseMigrations.test.js`, and `tests/schema.test.js` |
| Versioned guild backups with previewed merge/destructive restore, per-server bot profiles and presets, opt-in ByteBot discovery, hourly bumps, and 1–1095 day real-row server cards | #47 | Advances live Server/Information and pinned `server`/`information`; exact Greed discovery/card commands and font/effect values remain an explicit evidence gap. | `tests/guildBackupService.test.js`, `tests/serverPresentation.test.js`, `tests/statsCommand.test.js`, `tests/commandHubs.test.js`, `tests/databaseMigrations.test.js`, and `tests/schema.test.js` |
| Guild/global accounts, wallet/bank, exact ledger and circulation, 1.5x daily/work earnings, anti-abuse guards, jobs, role shops, configuration, grants/removals, and confirmed reset/destroy/disable | #48 | Advances live and pinned Economy to `partial`; #49 owns every remaining game, lab, gang, crime/robbery, ladder, and leaderboard surface. | `tests/economyService.test.js`, `tests/economyCommand.test.js`, `tests/helpParity.test.js`, `tests/databaseMigrations.test.js`, and `tests/schema.test.js` |
| Twelve wager games with durable interactive sessions, crime/robbery, race-safe gangs, passive-income laboratories, and committed guild rankings | #49 | Completes all 50 pinned Economy files. Public names, bounds, and errors match first-party evidence; unpublished odds/progression use the frozen ByteBot-owned rules contract. | `tests/economyProgression.test.js`, `tests/economyCommand.test.js`, `tests/helpParity.test.js`, `tests/interactionAcknowledgement.test.js`, `tests/databaseMigrations.test.js`, and `tests/schema.test.js` |
| Discord profiles/assets, roles, permissions, invites, observed name history, remote server facts, bounded calculation/QR/weather/definition/translation, and configured website screenshots | #51 | Advances live Information/Utility and pinned `information`/`utility`; those broader rows remain `partial` because #52, #53, #55, #58, #60, and #62 still own mapped families. | `tests/informationLookupService.test.js`, `tests/informationLookupCommands.test.js`, `tests/commandHubs.test.js`, and `tests/helpParity.test.js` |
| Public GitHub profiles/repository search/commit-email search and public Roblox profiles/presence/games/groups/outfits; credentialed or contract-prohibited social providers retained as explicit blockers | #60 | Advances live Information/Utility/Socials and pinned `information`/`socials`/`utility`; Socials remains `partial` because #61 owns feeds and reposters. GitHub contributions and providers without a lawful keyless contract remain visibly blocked. | `tests/informationLookupService.test.js`, `tests/informationLookupCommands.test.js`, `tests/commandHubs.test.js`, and `docs/research/greed-social-game-lookups-contract.md` |
| Canonical Instagram, TikTok, and X/Twitter link reposting with no scrape/download path; all eight persistent feed providers and the undocumented auto-reposter behavior retained as source-cited terminal blockers | #61 | Completes live and pinned Socials together with #60. No dormant scheduler, token storage, billing gate, or invented crawler is shipped while the provider and evidence gates remain closed. | `tests/socialRepost.test.js`, `tests/helpParity.test.js`, and `docs/research/greed-social-feeds-contract.md` |
| Local Tesseract OCR and eSpeak NG text-to-speech through one bounded media queue; OpenRouter Q&A, STT, image generation, and semantic editing retained as source-cited credential/resource blockers | #62 | Advances live Information/Utility/Manipulation and pinned `information`/`utility`; Greed's billing caps are evidence only and ByteBot adds no entitlement or daily quota. | `tests/aiMedia.test.js`, `tests/mediaService.test.js`, `tests/helpParity.test.js`, and `docs/research/greed-ai-speech-ocr-generative-contract.md` |
| Attachment/member/reply/URL/avatar resolution; pinned public-only downloads; image signatures and dimensions; a single fail-closed processor queue; `/image` resize, rotate, compress, conversion, 16 local effects, caption/compare layouts, and dominant color | #55, #56 | Completes pinned `manipulation` and advances live Manipulation/Fun/Utility. Named provider effects and templates without public algorithms or licensed assets have terminal blocker/evidence-gap mappings; OCR remains owned by #62. | `tests/mediaService.test.js`, `tests/imageManipulation.test.js`, `tests/helpParity.test.js`, and `tests/commands.test.js` |
| Text/voice levels, rewards, rank-card styling, 15-channel event logging, and 1,095-day real-row analytics | #50 | Completes live/pinned Levels and Logs; advances Server/Settings. Unknown XP algorithms and unavailable historical data remain explicit ByteBot-owned/evidence boundaries. | `tests/levelAnalyticsService.test.js`, `tests/eventLoggingService.test.js`, `tests/levelsAnalyticsCommands.test.js`, and `docs/research/greed-levels-analytics-contract.md` |
| Universal highest public command/autorole/reaction/log/retention allowances; cached native-helper diagnostics; lazy helpers; and a production 1 CPU/1 GiB Compose profile with event-loop health | #63 | Applies cross-cutting premium maxima without billing, voting, purchase, or entitlement state and packages the cumulative #50/#55/#56/#58/#61/#62 runtime. | `tests/smallVpsPackaging.test.js`, `tests/automationPlatform.test.js`, `tests/roleAutomation.test.js`, `tests/eventLoggingService.test.js`, and `docs/research/greed-small-vps-caps-contract.md` |
| AFK statuses and custom responses, global time zones, private diary entries, reminder snooze, and expanded birthday input | #52 | Advances live Information/Fun/Utility and pinned `information`/`fun`/`utility`; the broader rows remain `partial` while their other mapped issues are open. Premium custom AFK responses are available without billing. | `tests/personalUtilities.test.js`, `tests/personalAfk.test.js`, `tests/reminder.test.js`, `tests/richContent.test.js`, `tests/commandHubs.test.js`, and `tests/databaseMigrations.test.js` |
| Anonymous confessions with categories, moderation, replies, reactions, reports, and cooldowns; durable polls; exact-target thread/pin/image-only controls; quote images; choose and random-member utilities | #53 | Advances live Fun/Utility and pinned `fun`/`utility`; those rows remain `partial` while their other mapped issues are open. | `tests/communityUtilities.test.js`, `tests/communityInteractionRouting.test.js`, `tests/commandHubs.test.js`, `tests/databaseMigrations.test.js`, and `tests/schema.test.js` |
| Bounded deleted/edit/reaction snipes and universal self-protection; 40 attributed roleplay actions with three terminal exclusions; RPS, tic-tac-toe, BlackTea, flags, WYR, IQ/color/roast, blunt, and vape subjects | #54 | Advances live and pinned Snipe/Roleplay pending live Discord proof; advances Fun and Settings while image/media subjects remain owned by #56. The slur leaderboard and targeted protected-character/adult meters are terminal policy exclusions. | `tests/funParity.test.js`, `tests/funParityCommands.test.js`, `tests/funGames.test.js`, `tests/funEventRouting.test.js`, `tests/helpParity.test.js`, `tests/databaseMigrations.test.js`, and `tests/schema.test.js` |

## Update rule

Each feature PR updates only the rows it materially advances and links fresh verification. A row becomes `complete` only when all its mapped issues are closed or its remaining subfamilies have explicit terminal entries. Numeric subtraction between the live 945 total and the 912-file registry is never used to invent commands.
