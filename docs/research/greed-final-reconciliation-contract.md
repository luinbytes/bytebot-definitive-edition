# Greed final public-source reconciliation contract

Issue: [#64](https://github.com/luinbytes/bytebot-definitive-edition/issues/64)

Parent: [#33](https://github.com/luinbytes/bytebot-definitive-edition/issues/33)

Research frozen: 2026-08-25

This is the final integration gate for the public Greed parity program. It
does not claim access to Greed's source code, private Discord registration,
support server, provider credentials, or undocumented runtime behavior.
"Reconciled" means every public subject is implemented, mapped to a compatible
ByteBot path, or assigned a source-cited terminal evidence, provider, legal,
policy, Discord, or small-VPS boundary.

## Current source snapshot

| Source | Current evidence | Reconciliation rule |
| --- | --- | --- |
| [Live command catalog](https://greed.best/commands) | The page still says it contains every command with its arguments and permissions. Its command payload remains client-rendered and is not published as a stable JSON/OpenAPI registry. The last fully rendered public count snapshot is 945 commands across 17 named categories whose displayed counts total 916. | Preserve the 29-entry `evidence-gap`; never invent names, options, permissions, or a hidden category. |
| [Current docs index](https://greed.best/docs) | The current first-party navigation exposes Getting Started, Premium, Customization, six Security guides, Starboard, VoiceMaster, Levels, Bump Reminder, Reaction Triggers, Command Aliases, Command Permissions, Custom Scripts, Username Tracking, Logging, Tickets, Confessions, Backups, Discovery, Music, Giveaways, Counting, Last.fm, Economy, Fun, Social Lookups & Feeds, Image Editing, Utility, Information, and scripting permissions. | Every named guide family must map to an issue/contract below. |
| [Current Premium guide](https://greed.best/docs/premium) | Highest caps remain user 15/5s, guild 60/10s, logs 15, autoroles 50, reaction roles 500, autopfp 15, analytics three years, AI 200/30/50/50/100 daily, and bio 190. It still names backups, social feeds, Uwulock roulette, giveaway extras, VoiceMaster extras, discovery, and server stats cards as premium-only. | ByteBot applies evidenced maxima without billing, voting, purchase, or entitlement state. Provider and host bounds remain. |
| [`greedbest/i18n`](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f) | Repository HEAD remains `3dadc41852a09567add8a6b2b522d5e2b1a53b2f` (2026-03-29) with 912 English command JSON files in 20 directories. | The pinned file ledger remains the complete public localization snapshot. Localization proves subjects and strings, not runtime registration metadata. |
| [`greedbest/docs`](https://github.com/greedbest/docs/tree/60cf7138d45a74bf0cf3fc749c1dc6c43b00df43) | Repository HEAD remains `60cf7138d45a74bf0cf3fc749c1dc6c43b00df43` (2026-06-11). | A guide proves only the syntax and behavior it publishes; conflicts stay visible. |

## Official guide-family closure

| Public guide family | Delivery evidence | Terminal status |
| --- | --- | --- |
| Getting Started, command permissions, command aliases | #34, #36, `greed-parity.md` | Compatible ByteBot help/RBAC/alias paths; exact prefix/slash registration is a Discord/framework mapping. |
| Premium and Customization | #47, #63, `greed-backup-customization-discovery-contract.md`, `greed-small-vps-caps-contract.md` | Highest caps and customization available without billing; card font/effect values remain an evidence gap. |
| Antinuke, Antiraid, Automod, Moderation, Fake Permissions, Honeypot | #36-#40 and their frozen security/moderation contracts | Implemented and verified; Discord-owned AutoMod substitutes only where the source contract records it. |
| Starboard, Bump Reminder, Reaction Triggers, Username Tracking | #42-#43 and `greed-automation-contract.md` | Implemented and verified. |
| VoiceMaster | #59 and `greed-voice-master-contract.md` | Implemented within Discord's application-command and voice-channel constraints. |
| Levels and Logging | #50 and `greed-levels-analytics-contract.md` | Implemented with real retained rows; unpublished XP algorithms and unavailable historical backfill are explicit ByteBot-owned boundaries. |
| Custom Scripts and scripting permissions | #44 and `greed-rich-content-contract.md` | Implemented as a bounded non-executable script language. |
| Tickets | #45 and `greed-ticket-contract.md` | Implemented and verified. |
| Confessions | #53 and `greed-community-utilities-contract.md` | Implemented on the integration branch; anonymous abuse/audit protections are ByteBot-owned. |
| Backups and Discovery | #47 and `greed-backup-customization-discovery-contract.md` | Backups and opt-in ByteBot discovery implemented; exact Greed discovery command/schema remains an evidence gap. |
| Music | #58 and `greed-music-contract.md` | Self-hosted library playback implemented; unsupported remote search/stream providers are explicit blockers. |
| Giveaways and Counting | #46 and `greed-giveaway-counter-contract.md` | Implemented; unpublished winner algorithms and unnamed counter metrics are not invented. |
| Last.fm | #57 and `greed-lastfm-contract.md` | Implemented on the integration branch; live provider/OAuth proof requires operator credentials. |
| Economy | #48-#49 and the two economy contracts | Implemented; unpublished odds/progression use visibly ByteBot-owned rules. |
| Fun, Roleplay, Snipe | #54 and `greed-snipe-fun-roleplay-contract.md` | Implemented on the integration branch; unsafe targeted sexual/hateful subjects are policy-excluded and provider-absent actions are not fabricated. |
| Social Lookups & Feeds | #60-#61 and their two social contracts | Lawful public lookups and canonical link reposting implemented; credentialed feeds, downloads, and undocumented auto-reposting have provider/evidence blockers. |
| Image Editing and AI media | #55-#56, #62 and their media/image/AI contracts | Bounded local media, effects, OCR, and TTS implemented; proprietary assets/algorithms and generative/provider-backed work retain evidence, credential, or VPS blockers. |
| Utility and Information | #51-#53, #60, #62 and their lookup/personal/community contracts | Every pinned subject is implemented, aliased, or terminally mapped; live provider proof remains distinct from mocks. |

No official guide family is unmapped.

## Integration audit before final delivery

The exact #63 head `51ee856f05aac303a2362eceb17d224f51c1d7d1`
contains #50, #51, #55, #56, #58-#63, but four already researched and
reviewed delivery branches are not ancestors:

| Missing issue | Required branch | Frozen contract | Planned migration slot |
| --- | --- | --- | ---: |
| #52 | `feature/personal-utilities` | `greed-personal-utilities-contract.md` | 0034 |
| #53 | `feature/community-utilities` | `greed-community-utilities-contract.md` | 0035 |
| #54 | `feature/snipe-fun-roleplay` | `greed-snipe-fun-roleplay-contract.md` | 0036 |
| #57 | `feature/lastfm` | `greed-lastfm-contract.md` | 0037 |

Those branches may be merged only after this contract is committed and pushed.
Conflict resolution must preserve both sides, renumber their colliding `0027`
migrations and Drizzle journal entries to 0034-0037, retain all current
resource/cancellation fixes, and add no new public behavior.

## Terminal ledger rules

After those four branches are ancestors and the cumulative gate is green:

- all 17 named live categories may be `complete` only in the qualified ledger
  sense: their evidenced subjects are implemented, compatible aliases, or
  explicit terminal mappings;
- the unnamed live remainder stays `evidence-gap` at 29;
- all pinned registry directories may be `complete` in that qualified sense
  except `developer`, which stays `evidence-gap` because it is absent from the
  public catalog and may be internal-only;
- open PRs prove proposed integration, not merged `master`, deployment, live
  Discord behavior, provider credentials, or a successfully built container;
- mocked tests cannot be reported as live provider proof.

## Verification and review gate

Final delivery requires every issue branch #35-#63 to be an ancestor of the
exact final head; migration/schema and command/help checks; the complete Jest
suite with one worker and a bounded heap; `git diff --check`; production
dependency audit; Compose resolution; independent spec and security reviews;
and an open PR to `master`. Docker build/runtime, live Discord, and live
credentialed provider checks must remain explicit if host pressure or missing
operator credentials prevents them.
