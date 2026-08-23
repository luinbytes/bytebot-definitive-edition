# Public Greed Parity

## Problem Statement

ByteBot has a coherent but much smaller Discord feature surface than Greed. The owner wants every feature evidenced by Greed's public catalog, official documentation, and pinned official English localization registry available inside ByteBot, including behavior Greed markets as premium, without adding billing gates. The first visible gap is UwU Lock: administrators need to target members whose messages should be deleted and replayed by the app under the member's visible name and avatar after deterministic uwuification.

The public sources are incomplete and disagree: the live catalog advertises 945 commands across 17 rendered categories whose counts total 916, while the pinned official English registry contains 912 localization files under 20 directories. Public-source parity therefore means covering every evidenced feature and recording source discrepancies; it does not mean claiming undocumented live Greed behavior.

## Solution

Build public-source parity as a linked series of small, independently verified pull requests into `master`. Preserve ByteBot's accepted intent hubs and extend them only for feature families that do not fit `/me`, `/server`, `/pod`, `/mod`, `/game`, `/fun`, or `/bot`. Use Discord-compatible grouped slash commands, path-aware RBAC, SQLite persistence, and observable service seams. Include the highest publicly documented Greed caps and formerly paid behavior without billing or entitlement checks.

Use keyless official APIs where practical. Package lightweight self-hosted helpers with the bot when a provider-free implementation fits a 1 vCPU / 1 GB deployment. A feature requiring unavailable credentials or infrastructure beyond that envelope remains an explicit delivery blocker rather than receiving a fake response.

UwU Lock is the first vertical slice. `/fun uwuify` transforms supplied text. `/fun uwulock add`, `remove`, and `list` manage targeted members; `/fun uwulock protect` uses an action option for add, remove, or list because Discord cannot represent a fourth command token. Successful replays are webhook-authored app messages using the original member's visible name and avatar. The system must never delete the original unless replay delivery succeeds, and must compensate by deleting the replay if original deletion fails.

## User Stories

1. As a server administrator, I want to add a member to UwU Lock, so that their later messages are automatically uwuified.
2. As a server administrator, I want to remove a member from UwU Lock, so that their messages stop being replaced.
3. As a server administrator, I want to list valid UwU Lock targets, so that I can audit the active rule.
4. As a server administrator, I want to protect a member from UwU Lock, so that other administrators cannot target them accidentally.
5. As a server administrator, I want to remove or list UwU-protected members, so that exemptions stay maintainable.
6. As a member, I want to uwuify text on demand, so that I can use the transformation without targeting anyone.
7. As an UwU Lock target, I want my replayed message to retain my visible name and avatar while remaining marked by Discord as an app message, so that authorship is not falsely represented.
8. As a member, I want URLs, code, mentions, and custom emoji syntax preserved, so that uwuification does not corrupt functional content or trigger new pings.
9. As a server owner, I want unsupported message payloads left untouched, so that the feature cannot lose content.
10. As a maintainer, I want webhook loops prevented, so that replayed messages are never replayed again.
11. As a maintainer, I want successful replay before original deletion and compensating cleanup on failure, so that message replacement is loss-safe.
12. As a server administrator, I want clear permission preflights for message deletion and webhook creation, so that partial configuration fails safely.
13. As a server administrator, I want UwU Lock actions restricted by default to Manage Server and overridable through ByteBot RBAC, so that access follows existing policy.
14. As a server administrator, I want command permissions to address a full command path, so that an open `/fun` hub can contain restricted UwU Lock operations.
15. As a server administrator, I want root-command permission overrides to remain compatible, so that existing RBAC rows do not silently change meaning.
16. As a member, I want ByteBot's existing intent hubs and command paths to keep working, so that parity does not break current workflows.
17. As a member, I want new features discoverable through the help system by intent and source category, so that hundreds of commands remain navigable.
18. As a maintainer, I want generated slash-command JSON kept within Discord's command, option, name, description, and nesting limits, so that deployment remains valid.
19. As a maintainer, I want every public Greed registry path mapped to a ByteBot capability, duplicate alias, explicit evidence gap, or delivery blocker, so that parity is auditable.
20. As a maintainer, I want the pinned public-source commit and live catalog counts recorded, so that later drift can be reconciled instead of guessed.
21. As a server administrator, I want moderation setup, jail, mute, warn, ban, kick, timeout, softban, hardban, unban, cleanup, purge, lockdown, slowmode, nickname, topic, role, and history capabilities, so that Greed's documented moderation family is covered.
22. As a server administrator, I want configurable moderation messages, variables, cases, logs, staff roles, protected targets, and warning punishments, so that moderation behavior is operable rather than a command shell.
23. As a server owner, I want antinuke modules for destructive guild actions with administrators, allowlists, thresholds, windows, punishments, incidents, and logs, so that compromised staff actions can be constrained.
24. As a server owner, I want antiraid modules for join rates, account age, default avatars, usernames, mass mentions, bots, lockdown, allowlists, and punishments, so that raids can be mitigated.
25. As a server administrator, I want automod filters for spam, caps, emoji, mass mentions, spoilers, images, invites, links, repetition, wall text, keywords, regex, strikes, exemptions, thresholds, and actions, so that content policy can be enforced.
26. As a server owner, I want ByteBot's virtual command permissions to remain separate from real Discord permissions, so that no bot rule can grant Discord authority.
27. As a server administrator, I want command disable, enable, allow, deny, per-channel, per-role, per-member exception, blocked-role-permission, and protected-target rules, so that command access matches the public Greed controls.
28. As a server administrator, I want welcome, goodbye, boost, and system messages with templates, variables, tests, channels, formats, and optional deletion, so that lifecycle messaging is configurable.
29. As a server administrator, I want autoresponders, autoreactions, autoroles, timers, bump reminders, sticky messages, revive prompts, tracking, counters, vanity tracking, and join notifications, so that routine community automation is covered.
30. As a server administrator, I want reaction roles, button roles, temporary roles, booster roles, role filters, sharing, and role synchronization, so that self-service roles match the public feature family.
31. As a server administrator, I want configurable starboards, pagination, embeds, Components V2-style layouts, variables, tags, and webhooks, so that rich server content can be built without external tooling.
32. As a server administrator, I want ticket panels, topics, claims, transcripts, ratings, inactivity rules, support roles, limits, and logs, so that support workflows are complete.
33. As a server administrator, I want giveaways with eligibility rules, winner controls, templates, edits, rerolls, direct messages, and blocklists, so that public giveaway behavior is covered.
34. As a server administrator, I want guild backups for publicly documented configuration and bot-owned state, so that accidental changes can be recovered safely.
35. As a server administrator, I want server customization settings that ByteBot can legally control, so that the former Customize feature family is available without a purchase gate.
36. As a server administrator, I want server discovery and server statistics cards where public evidence defines them, so that former server-premium features are included.
37. As a member, I want balance, work, daily rewards, transfers, deposits, withdrawals, jobs, shops, gangs, leaderboards, and economy configuration, so that the public economy family is usable end to end.
38. As a member, I want documented economy games such as coin flip, dice, blackjack, roulette, slots, crash, plinko, scratch, high-low, bombs, and gambling, so that winnings and losses use one consistent ledger.
39. As a server owner, I want economy enable, disable, reset, presets, circulation, grants, removals, and anti-abuse bounds, so that virtual currency remains administrable.
40. As a member, I want text and voice levels, rank views, leaderboards, roles, awards, multipliers, ignored channels, live progress, and resets, so that community progression matches the public levels family.
41. As a maintainer, I want analytics for messages, reactions, voice, and membership retained for up to the highest public three-year cap where storage permits, so that former premium analytics behavior is included.
42. As a member, I want personal profiles, avatars, banners, user/server information, roles, permissions, invites, names, time zones, weather, definitions, screenshots, QR codes, calculations, and translation, so that the public information and utility families are covered.
43. As a member, I want AFK, birthday, reminder, confession, diary, poll, quote, random choice, and other documented social utilities, so that common community interactions are available.
44. As a member, I want deleted-message, edited-message, and reaction snipes plus clearing and protection controls, so that the public snipe family is covered with bounded retention.
45. As a member, I want roleplay interactions such as hug, kiss, pat, slap, tickle, and the public registry's other actions, so that lightweight social responses are covered.
46. As a member, I want 8-ball, coin, dice, ship, meters, games, memes, and public fun commands, so that the fun family extends rather than duplicates ByteBot's current handlers.
47. As a member, I want image input accepted from mentions, replies, attachments, URLs, or my avatar, so that manipulation commands share one predictable contract.
48. As a member, I want the publicly evidenced image filters, effects, meme templates, OCR, resize, rotate, compress, render, and format conversion behavior, so that media utilities are locally available where the VPS can support them.
49. As a maintainer, I want image and media processing sandboxed with strict size, duration, type, URL, timeout, and concurrency limits, so that untrusted inputs cannot exhaust the VPS.
50. As a member, I want Last.fm linking, now playing, recent tracks, artists, albums, tracks, collages, crowns, milestones, comparisons, and leaderboards, so that the public Last.fm family is covered.
51. As a member, I want music play, pause, resume, skip, stop, queue, and volume controls where a keyless and VPS-safe playback path is legal and supported, so that voice playback is useful rather than decorative.
52. As a server administrator, I want temporary voice-channel setup, defaults, templates, interfaces, permissions, visibility, limits, regions, bitrates, claims, and cleanup, so that VoiceMaster-style behavior is covered.
53. As a member, I want keyless lookups for public GitHub, Roblox, Rolimons, Valorant, Fortnite, Minecraft, Spotify, Reddit, YouTube, and other evidenced platforms where their public terms permit it, so that social and game information is accessible.
54. As a server administrator, I want social feeds and reposting where a keyless or self-hosted implementation is lawful and reliable, so that former premium feeds are available without billing.
55. As a member, I want AI questions, OCR, transcription, text-to-speech, image generation, and image editing only when a real keyless or self-hosted provider fits the deployment envelope, so that ByteBot never fabricates AI results.
56. As a maintainer, I want unavailable provider capabilities reported as blockers with actionable diagnostics, so that missing infrastructure is not disguised as success.
57. As a maintainer, I want external calls implemented with installed platform features, bounded timeouts, response validation, and caching before new dependencies are considered, so that the bot stays small.
58. As an operator, I want optional self-hosted helpers packaged with the bot and disabled unless configured, so that one deployment can run on 1 vCPU and 1 GB without idle heavy services.
59. As an operator, I want one bounded worker per heavy media family and no bundled large local models, so that the bot leaves memory headroom.
60. As a member, I want formerly premium user limits set to the highest publicly documented allowance, so that features are included without billing gates.
61. As a server owner, I want formerly premium server caps set to the highest publicly documented allowance, so that configured features are not artificially restricted.
62. As a maintainer, I want no premium purchase, entitlement, voting, card, crypto, or Discord monetization code, so that ByteBot does not reproduce Greed's billing system.
63. As a maintainer, I want user input at every trust boundary validated and mentions suppressed by default, so that rich commands cannot be weaponized.
64. As a server owner, I want destructive commands to require confirmation or use Discord audit reasons where appropriate, so that mistakes are recoverable or attributable.
65. As a maintainer, I want public registry subjects retained only where implementation remains lawful and Discord-compliant, so that parity never overrides platform or legal constraints.
66. As a maintainer, I want each feature slice to reuse existing handlers, schema, embeds, logging, cooldowns, and error handling before adding new machinery, so that the refactor stays narrow.
67. As a maintainer, I want each linked PR to update its public-parity mapping and close its own ticket only after fresh verification, so that progress is evidence-based.
68. As a maintainer, I want each linked PR reviewed against repository standards and its ticket, so that spec coverage and code quality remain separate checks.
69. As the owner, I want the final reconciliation PR to prove every public registry family is implemented, aliased, blocked with evidence, or explicitly excluded by policy, so that the program has a defensible endpoint.
70. As the owner, I want every linked PR to target `master` and remain independently reviewable, so that this large rebuild does not become one unmergeable branch.

## Implementation Decisions

- The Public Parity Contract is the live public catalog's total/category claims, the current official docs, and official English i18n pinned at commit `3dadc41852a09567add8a6b2b522d5e2b1a53b2f`. Source disagreements stay visible.
- No live Greed bot/server probing is required. Missing option types, algorithms, aliases, permissions, and edge behavior use explicit ByteBot decisions and are not described as Greed facts.
- Existing ByteBot intent hubs remain canonical. Missing broad areas may add a small number of new intent hubs; Greed's categories are help/discovery metadata rather than a replacement command grammar.
- Discord paths that would need more than a group and subcommand use typed options for the extra choice.
- Current commands and handlers are reused. New routing is added only where a public capability has no existing seam.
- RBAC becomes path-aware while retaining root-command fallback and administrator bypass. Real Discord permissions remain mandatory even when ByteBot grants a command role override.
- Persistent guild/member state remains in SQLite through Drizzle migrations with guild-scoped uniqueness and indexes for message-event lookups.
- Former premium behavior is enabled for everyone at the highest current publicly documented caps. Billing, purchases, voting, and entitlements are not built.
- External integrations prefer keyless official APIs and Node's installed platform features. New dependencies require a demonstrated gap.
- Self-hosted helpers must be packaged with the bot, optional, bounded, and viable within 1 vCPU / 1 GB. Large local generative models are not viable in that envelope.
- Provider-backed commands must return real validated results or a clear unavailable diagnostic; they never return fixtures as production data.
- The linked PR series is organized as vertical, user-visible feature slices. Each slice includes commands, behavior, persistence, permissions, help, and tests where those layers apply.
- Public registry coverage is maintained as a reconciliation ledger keyed by public source category/family, not by inferred subtraction between 945 and 912.
- UwU Lock uses one mutually exclusive guild/member state: targeted or protected. Guild owners, ByteBot itself, bots, and webhooks cannot be targeted.
- UwU Lock ignores DMs and replayed/webhook messages. Unsupported payloads remain untouched.
- UwU transformation is deterministic, preserves functional tokens, and does not add random faces or text that could exceed Discord's message limit.
- Replayed messages suppress allowed mentions. A replay must be sent successfully before the original is deleted; failed original deletion triggers best-effort replay deletion.
- A channel webhook is found or created lazily after permission preflight. Webhook credentials are not written to logs or documentation.
- The original attachment payload is preserved only when it can be replayed within Discord and VPS bounds; otherwise the original message remains.
- Public registry subjects are implemented only within Discord policy and applicable law. A ticket stops rather than weakening those constraints silently.
- Existing `master` is the target branch. Each linked PR is based on current `master`, reviewed, verified, and reconciled before merge; the final PR audits the entire ledger.

## Testing Decisions

- Tests assert observable behavior at the highest existing seams: generated registration JSON, public command execution, `messageCreate`/other Discord events, persisted rows, RBAC outcomes, and provider request/response contracts.
- The existing Discord API simulation style is prior art. Tests do not require a real Discord token, deployment, or live Greed access.
- UwU Lock tests cover command shape, Manage Server defaults, path overrides, protected/target state transitions, transformation preservation, loop prevention, send-before-delete, compensating deletion, unsupported payloads, mention suppression, and permission failures.
- Schema tests cover fresh migration and upgrade paths. Message-event lookup tests cover guild isolation and indexed target resolution.
- Registration tests fail if any hub exceeds Discord limits or if a path is missing from help/discovery metadata.
- Provider tests stub the public HTTP boundary and validate timeouts, invalid payloads, size limits, cache behavior, and unavailable diagnostics; they do not snapshot private helpers.
- Security and moderation tests use the public command/event boundary and prove real Discord permission checks are not bypassed by ByteBot RBAC.
- Each ticket runs focused tests during development and every applicable repository gate before its PR. The full repository suite begins only after this public parity spec and ticket ledger are complete.
- Completion claims require fresh output from the applicable focused tests, full repository suite, command JSON inspection, migration checks, and review audit. Runtime/deployment claims require separate evidence and are not inferred from unit tests.

## Out of Scope

- Claiming exact behavior for undocumented live Greed internals.
- Querying or operating the live Greed bot in a Discord guild.
- Reproducing Greed's branding, copyrighted visual assets, source code, dashboard, hosting business, or billing system.
- Registering 945 separate top-level slash commands.
- Asking the owner to paste API keys or bot tokens.
- Shipping fake provider results, unbounded scrapers, large bundled AI models, or services that cannot fit the agreed VPS envelope.
- Deploying ByteBot, changing production Discord configuration, or provisioning secrets without separate evidence and authorization.

## Further Notes

- Research and source limitations are recorded in `docs/research/greed-parity.md`.
- The existing command-hub design remains authoritative and is extended by ADR-0002.
- The 945 live count and 912 pinned registry files are separate artifacts. A delivery ledger must never pretend their numeric difference identifies specific missing commands.
- UwU Lock visually resembles the supplied screenshot, but Discord will continue to show the app/webhook badge and `webhook_id`; the replay is never represented as authored by the member.
