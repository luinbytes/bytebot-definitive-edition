# Greed Last.fm contract

Issue: [#57](https://github.com/luinbytes/bytebot-definitive-edition/issues/57)

Parent: [#33](https://github.com/luinbytes/bytebot-definitive-edition/issues/33)

Research frozen: 2026-08-24

This is the implementation gate for Greed's public Last.fm family. It was
researched without querying the Greed bot, support server, or a test guild.
No implementation or Discord-suite test was started before this contract was
frozen.

## Sources and limits

| Source | What it proves | Limit |
| --- | --- | --- |
| [Greed Last.fm guide](https://greed.best/docs/miscellaneous/lastfm) | Username and OAuth linking, scrobble-backed views, now playing, collages, charts, crowns, taste comparison, and custom presentation are public features. | It does not publish request limits, storage, cache policy, exact slash option types, or ranking tie-breaks. |
| [Pinned English registry](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/lastfm) | Names, descriptions, choices, success states, and error wording for all 22 public localization files. | Localization is not runtime code and does not prove undocumented option schemas. |
| [Last.fm API terms](https://www.last.fm/api/tos) | Last.fm attribution/linking, HTTP cache compliance, rate-limit compliance, and the 100 MB reasonable-use cache ceiling. | It does not define Greed behavior. |
| [Last.fm web authentication](https://www.last.fm/api/webauth) | Browser authorization returns a one-hour token that can be exchanged for a revocable session using an API key, shared secret, and signed request. | An OAuth callback and operator credentials are required. |
| [user.getRecentTracks](https://www.last.fm/api/show/user.getRecentTracks) | Recent tracks include a `nowplaying` marker; the public maximum is 200 and no user session is required. | It exposes listening data already public on Last.fm. |
| [user.getTopArtists](https://www.last.fm/api/show/user.getTopArtists), [user.getTopAlbums](https://www.last.fm/api/show/user.getTopAlbums), [user.getTopTracks](https://www.last.fm/api/show/user.getTopTracks) | Periods are `overall`, `7day`, `1month`, `3month`, `6month`, and `12month`; pagination is supported without a user session. | Greed's aliases are mapped below. |
| [library.getArtists](https://www.last.fm/api/show/library.getArtists) | A paginated library artist index includes play counts. | The API publishes no maximum page size; ByteBot uses bounded pages. |
| [artist.getInfo](https://www.last.fm/api/show/artist.getInfo) | Artist metadata and per-username play count are available without a user session. | Server/global comparisons require bounded fan-out or a local index. |

The current premium guide publishes no Last.fm-only entitlement. Universal
caps are reconciled by #63; #57 does not add a billing gate.

## Complete registry map

| Pinned file | ByteBot slash path | Delivery |
| --- | --- | --- |
| `index`, `fm`, `nowplaying` | `/lastfm now [member]` | Real provider result; `fm` and `np` are documented compatibility names, not duplicate slash roots. |
| `set`, `login`, `refresh` | `/lastfm account link`, `oauth`, `refresh`; `/lastfm account unlink` | Username link is verified with `user.getInfo`. OAuth is enabled only with the documented callback/key/secret configuration. Link, token, session, and unlink responses are private. |
| `recents` | `/lastfm listening recent [member]`; `/lastfm listening server` | User history and bounded server recents. |
| `topartists`, `topalbums`, `toptracks` | `/lastfm charts artists|albums|tracks` | Real period-aware provider charts. |
| `collage` | `/lastfm charts collage` | A real 2x2-5x5 PNG built from provider artwork; track, artist, and album types; Greed aliases `7d`, `1m`, `3m`, `6m`, `1y`, `lifetime`. |
| `artist` | `/lastfm library artist [name]` | Real artist metadata; omitted name uses the invoking account's current/recent artist. |
| `milestone` | `/lastfm library milestone number` | Exact nth scrobble using total count and bounded recent-track pagination. |
| `update` | `/lastfm library update` | Replaces the caller's durable artist index from bounded `library.getArtists` pages; one update per user at a time. |
| `whoknows`, `mostcrowns` | `/lastfm community whoknows [artist] [scope]`; `/lastfm community crowns` | Rankings use the durable index, guild membership for guild scope, deterministic play-count/name tie-breaks, and visibly report stale/unindexed members. |
| `taste` | `/lastfm community taste member period` | Compares the two users' real top-artist sets and reports overlap; no deprecated or undocumented Last.fm method is used. |
| `embed`, `variables`, `reaction`, `steal` | `/lastfm customize presentation`, `view`, `variables`, `reactions`, `copy` | Safe fixed variables and length-bounded text; no executable embed language. Copy is explicit and copies presentation only. |
| `customcommand` | `/lastfm customize alias` | Stores and displays the user's compatibility alias. Discord cannot dynamically register a per-user application-command name, so it is accepted as display metadata and never presented as a registered slash command. |

All 22 registry files have exactly one row. OAuth-backed scrobbling and track
love/unlove require a Last.fm session; ByteBot stores a session only after a
valid signed callback. Voice-channel scrobbling additionally requires a music
playback source, which is owned by #58 and is not faked in #57.

## Slash and help layout

`/lastfm` is one guild-only member intent hub in a `LastFM` help category:

- direct `/lastfm now`;
- `account`: `link`, `oauth`, `refresh`, `unlink`;
- `listening`: `recent`, `server`;
- `charts`: `artists`, `albums`, `tracks`, `collage`;
- `library`: `artist`, `milestone`, `update`;
- `community`: `whoknows`, `crowns`, `taste`; and
- `customize`: `presentation`, `view`, `variables`, `reactions`, `copy`, `alias`.

This is 7 root options, below Discord's 25-option limit; every group is below
25 subcommands. The root has no administrator default permission. Existing
path-aware ByteBot RBAC applies to every exact nested path. Account mutations
and custom settings are private; listening, charts, artist data, collages,
and community rankings are public by default.

## Provider, privacy, and resource contract

- Use only `https://ws.audioscrobbler.com/2.0/` and the fixed method allowlist
  required above. The key/secret never enter user-controlled URLs or output.
- `LASTFM_API_KEY` enables read-only features. `LASTFM_SHARED_SECRET`,
  `LASTFM_CALLBACK_URL`, and `LASTFM_OAUTH_PORT` additionally enable OAuth.
  Missing configuration produces an explicit unavailable response.
- Requests time out after 10 seconds, accept JSON only, reject Last.fm error
  envelopes and malformed payloads, and stop reading after 2 MiB.
- Successful read responses use an in-process LRU of at most 256 entries.
  Respect `Cache-Control` when present, cap freshness at 60 seconds, never
  cache errors, and expose a refresh path that invalidates that user's keys.
- Store global Discord-user-to-Last.fm links, optional OAuth session keys,
  presentation settings, and the bounded artist index in SQLite. Session keys
  never appear in logs, embeds, or command output. Unlink deletes the account,
  settings, index, and pending OAuth state.
- OAuth state is random, single-use, expires after 10 minutes, is bound to the
  initiating Discord user, and is consumed transactionally. The callback
  displays only success/failure HTML and never trusts a username from query
  input.
- Index at most 20 pages of 250 artists (5,000 artists) per user and replace
  rows transactionally only after the complete bounded fetch succeeds. The
  bound is a ByteBot VPS safety limit and is not claimed as a Greed limit.
- Community provider fan-out is capped at 25 linked guild members per command;
  larger communities use the durable index. #63 may raise only a publicly
  evidenced cap without weakening the provider terms or host safety.
- Collages reuse #55/#56's bounded media resolver and Sharp pipeline, download
  at most 25 public artwork images, render at most 2000x2000 pixels, and stay
  under Discord's attachment limit. A missing cover gets a local placeholder.
- Every public response credits and links Last.fm. Provider images and text are
  treated as untrusted; URLs must be HTTPS Last.fm/CDN URLs and text is length
  bounded before entering Discord embeds.

## Acceptance gate

Implementation may start only after this file is committed. Completion needs
mocked provider, malformed-payload, timeout/size, OAuth-state, private-account,
cache, index, ranking, collage-bound, slash-schema, RBAC, database migration,
help, and full-suite evidence. Live Greed probing is prohibited. Live Last.fm
and Discord proof is an explicit deployment validation item when operator
credentials are not present in the test environment.
