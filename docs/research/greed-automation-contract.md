# Greed automation compatibility contract

Frozen 2026-08-23 before implementation. The primary contract is Greed's public English command registry at commit `3dadc41852a09567add8a6b2b522d5e2b1a53b2f`; current hosted documentation is retained where it adds flags or newer aliases. No live Greed bot was probed.

| Surface | Commands and behavior ByteBot must retain |
| --- | --- |
| Autoresponder | `add`, `update`, `remove`, `list`, `clear`, `reset`; channel/role allowlists; trigger-driven role add/remove; `strict`, `reply`, `self_destruct` (6-60s), `delete`, and mention policy. Existing ByteBot `manage`/`browse`, match modes, cooldown, and 50-item legacy limit remain compatible. Hosted responder docs advertise 500 Premium entries while the public Premium overview advertises 1,000; the paywall-free compatibility path uses the higher public cap and records the conflict. |
| Autoreact | `add`, `remove`, `list`, `clear`; channel/role restrictions; keyword/event triggers; up to 15 unique usable reactions. |
| Autorole | `add`, `remove`, `list`, `clear`; separate bot autoroles. Roles must be assignable and below the bot. |
| Timer | `add <channel> <interval> <message>`, `remove`, `list`, `view`; one timer per channel; restart-safe recurring delivery. |
| Bump reminder | `enable`, `disable`, `reminder`, `thankyou`, `leaderboard`, `test reminder|thankyou`, `view reminder|thankyou`; recognize a successful DISBOARD bump, thank immediately, remind once after two hours, and persist contributor counts. |
| Sticky message | `add <channel> <message>`, `remove`, `list`, `view`; one per channel, repost after activity with a three-second delay, deduplicated across restarts. |
| Revive | `setup`, `enable`, `disable`, `message`, `test`, `view`; configurable interval because public sources expose no authoritative default. |
| Tracking | `add`, `remove`, `list`, `lookup`; `notify add|remove|list`; username channel/unset; vanity set/unset; preserve `dropped` lookup alias. Availability windows are configuration, not invented constants (hosted docs and registry disagree). |
| Counter | Pinned `enable <channel>`/`disable <channel>` implement sequential counting with validation and reset. The conflicting metric-channel surface retains `add <metric> <kind>`, `options`, and `remove <channel>` for voice, text, category, announcement, and stage channels; ByteBot also exposes `list` and `update` so those records meet the repository lifecycle contract. |
| Vanity | Registry `set`, `message`, `channel`, `strict`, `view`, `role add|remove|list`; hosted `setup`, `role`, `removerole`, `rewards`, `settings`; exact/case-sensitive strict mode and safe role hierarchy. No external Prox dependency is required for ByteBot's native role rewards. |
| Join notification | `pingonjoin enable <channel>`, `disable`, `info`, `message`, plus `poj` compatibility in help; optional threshold and safe member variables. |

Guild automation mutations require Discord `ManageGuild` in addition to ByteBot's path-aware RBAC. Personal tracking lookups and opt-in notification rows remain member-accessible and are keyed to the invoking user; they cannot mutate another member's notification. Every automation is inspectable, editable where it has content, disableable, and removable/resettable. Scheduled claims are persisted, bounded, restart-safe, and leased with Discord message nonces so one due item cannot double-send. Bot-authored messages never recursively trigger automation. Outbound mentions default to none and must be explicitly enabled by configuration.

No public primary source establishes a premium gate for these workflows. ByteBot therefore ships the full published feature surface without artificial paywalls. Conflicting aliases are compatibility aliases rather than a reason to omit either surface.
