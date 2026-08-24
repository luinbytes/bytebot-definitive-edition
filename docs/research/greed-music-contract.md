# Greed music playback contract

Issue: [#58](https://github.com/luinbytes/bytebot-definitive-edition/issues/58)

Parent: [#33](https://github.com/luinbytes/bytebot-definitive-edition/issues/33)

Research frozen: 2026-08-24

This is the implementation gate for ByteBot music playback. It uses the
official Greed English localization registry pinned at
[`3dadc418`](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands),
Greed's first-party Music guide, Discord's first-party API documentation, and
the official discord.js voice documentation/package metadata. No live Greed
bot, private endpoint, Discord guild, or commercial media provider was
queried.

## Source boundary

The registry is the command and error-message contract. The public Music guide
adds queues, playlists, DJ roles, autoplay, and the inactivity behavior. The
guide says “various sources” but does not enumerate providers, URL schemes,
playlist syntax, search ranking, similarity algorithms, authentication, or
licensing. Those details must not be invented as Greed parity. The guide also
does not define the numeric limits beyond the published volume range.

| Source | Evidence fixed by the source | ByteBot implication |
| --- | --- | --- |
| [`music/play.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/music/play.json) | `play` accepts a song name or URL; the user must be in a voice channel; it reports searching, now playing, and queued position. | Expose one play action with bounded query/URL input, require the invoking member's voice channel, and report provider results without pretending a result exists. |
| [`music/queue.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/music/queue.json) | Queue view has no-player and empty-queue errors and labels for current track and queued tracks. | Keep current track and FIFO queue per guild. Return distinct no-player versus empty-queue outcomes. |
| [`music/pause.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/music/pause.json) | Pause requires a player, rejects an already paused player, and requires DJ. | Pause is a DJ-gated control and must be idempotence-aware. |
| [`music/resume.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/music/resume.json) | Resume requires a player, rejects a player that is not paused, and requires DJ. | Resume is a DJ-gated control and must reject the wrong player state. |
| [`music/skip.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/music/skip.json) | Skip distinguishes no player from no current track, requires DJ, and reports the next track when one exists. | Skip is a DJ-gated control; advance exactly once and include the next track only when playback actually advances. |
| [`music/stop.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/music/stop.json) | Stop requires a player, requires DJ, clears music, and disconnects. | Stop is a DJ-gated destructive control that clears the guild queue and voice connection. |
| [`music/volume.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/music/volume.json) | Volume can view or set, rejects invalid/negative values, caps at `200`, requires DJ, and reports a percentage. | Expose an optional integer volume; enforce `0..200` both in the slash schema and service. Use the current value when omitted. |
| [`music/filters.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/music/filters.json) | Presets are `soft`, `8d`, `chipmunk`, `boost`, `vaporwave`, `vibrato`, `piano`, `metal`, `flat`, `karaoke`, and `nightcore`; unknown presets and no-player are errors; changing it requires DJ; toggling reports enabled/disabled. | Preserve the exact preset names and one active preset per guild. A preset must be a real bounded audio transform or return a clear unsupported/runtime error; never label an unimplemented transform as enabled. |
| [`music/events.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/music/events.json) and [Music guide](https://github.com/greedbest/docs/blob/main/miscellaneous/music.mdx) | Greed reports disconnect after five minutes of inactivity; the guide says it leaves when no music is playing and the voice channel is empty. | A guild player must schedule a five-minute empty/no-playback cleanup, cancel it when playback or a member returns, and destroy the connection/player on cleanup. |
| [`settings/dj.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/settings/dj.json) and [Music guide](https://github.com/greedbest/docs/blob/main/miscellaneous/music.mdx) | DJ accepts a role, rejects missing/invalid roles, and configuration requires **Manage Server**. | Persist one optional DJ role per guild. Require real Discord `ManageGuild` for configuration; validate the role belongs to the guild. |
| [`settings/autoplay.json`](https://github.com/greedbest/i18n/blob/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/settings/autoplay.json) and [Music guide](https://github.com/greedbest/docs/blob/main/miscellaneous/music.mdx) | Autoplay accepts on/off, enable/disable, true/false; the registry marks it **Premium guilds only**; the guide says it adds similar tracks when the current track ends. | Persist a boolean and accept the documented state aliases. ByteBot has no entitlement/billing system, so the capability is universal in this framework; this is a deliberate product-policy difference from the premium label. The self-hosted provider may only select an explicitly defined next-track policy; it cannot claim “similar” matching without a real similarity-capable provider. |

The guide also states that Greed supports queues, playlists, and DJ roles, and
that the controls are configured through its settings system:
[Music guide](https://github.com/greedbest/docs/blob/main/miscellaneous/music.mdx).
The registry contains no playlist command file or playlist schema, so playlist
input remains a provider contract, not a new ByteBot command claim.

## Slash command surface and categories

ByteBot's command loader derives the help category from the directory under
`src/commands`, and the existing help UI groups loaded commands by that value.
Add one `Music` category command hub at `/music`; do not add nine top-level
commands. This keeps Greed's music family discoverable while preserving the
repository's path-aware RBAC, whose interaction path is the root plus optional
subcommand group and subcommand.

Recommended registered shape:

```text
/music play query:<song name or allowed URL>
/music queue
/music pause
/music resume
/music skip
/music stop
/music volume [volume:0..200]
/music preset name:<soft|8d|chipmunk|boost|vaporwave|vibrato|piano|metal|flat|karaoke|nightcore>
/music settings dj role:<role>
/music settings autoplay state:<on|off|enable|disable|true|false>
```

`preset` follows the registry example `music preset 8d`; the `name` option
carries the exact public names. `/music settings dj` and
`/music settings autoplay` retain the Greed paths under one Discord subcommand
group. `play`, `queue`, and controls are direct `/music` subcommands so the
high-frequency actions remain short.

Discord permits up to 25 options at each command level and one subcommand group
plus one subcommand in a path. See [Application Commands](https://docs.discord.com/developers/interactions/application-commands#application-command-object)
and [Subcommands and Subcommand Groups](https://docs.discord.com/developers/interactions/application-commands#subcommands-and-subcommand-groups).
The proposed shape stays within those limits. Add `Music` help metadata and
the parity map entry when the implementation lands; help must not silently
class this feature as `Utility` or leave the old “planned Music” text behind.

All `/music` paths are guild-only. The root has no blanket `ManageGuild`
requirement because `/music play`, `/music queue`, and current-state viewing
are member actions. `/music settings ...` requires real `ManageGuild` in the
command handler/service. Existing ByteBot scoped access rules and full-path
RBAC still apply after the real Discord permission check; a ByteBot allow rule
cannot grant `Connect`, `Speak`, or `ManageGuild`.

## RBAC and voice-channel checks

The DJ role is an additional music-control gate, not a replacement for Discord
permissions:

1. The actor must be in a guild and, for playback/control actions, in a voice
   channel. Queue viewing may inspect an existing guild player without joining.
2. For `pause`, `resume`, `skip`, `stop`, `volume`, and `preset`, the actor must
   be in the same voice channel as ByteBot and hold the configured DJ role.
   If no DJ role is configured, normal members may use these actions subject to
   the command's existing ByteBot access rules. The guild owner/Administrator
   bypass follows the existing ByteBot policy; a role assigned as DJ does not
   grant Discord API permissions.
3. The bot must be able to view/connect/speak in the target voice channel. Check
   channel-effective permissions, not only guild-level permissions. Discord's
   official permission table defines `VIEW_CHANNEL`, `CONNECT`, and `SPEAK` for
   voice channels; `SPEAK` is not valid in stage channels in the same way as a
   normal voice channel. See [Discord Permissions](https://docs.discord.com/developers/topics/permissions).
4. Failed joins, full channels, disconnected voice state, absent players, and
   provider errors must fail closed with the registry's corresponding error
   category. Do not create a player or persist a queue after the bot cannot
   join.

`ManageGuild` is the client-facing “Manage Server” permission used by the
existing ByteBot command convention. Discord documents that command default
permissions are only a visibility/default gate; the handler still needs the
repository's real permission and path-RBAC checks.

## Lawful provider boundary and unsupported gaps

The smallest provider that satisfies the issue without scraping or credentials
is an operator-owned local library:

- `MUSIC_LIBRARY_PATH` points to a directory controlled by the bot operator.
- A manifest supplies stable track IDs, title, author, duration, and relative
  file path; query search is a bounded case-insensitive title/author/ID match.
- Only files under the resolved library root are playable. Symlink escapes,
  missing files, unsupported codecs, duration mismatches, and post-load
  path/size changes fail closed. FFprobe checks immediately before queue
  insertion and playback; FFmpeg hard-stops output at the declared duration.
- A track may declare one canonical HTTPS URL as an exact lookup alias while
  its playable bytes remain a local file. ByteBot performs no network request
  for that alias. Unknown URLs return `noResults`; no arbitrary remote fetch,
  redirect chain, downloader, search scraper, or user-supplied process argument
  is permitted.
- A self-hosted manifest may model named playlists and explicitly curated
  related-track IDs. Playlists expand into the same bounded queue. Autoplay may
  choose only a declared related track; when none is valid, playback ends
  without claiming a similarity result. These are provider features, not new
  Greed command claims, because no pinned registry file defines their syntax.

These are ByteBot safety/legality bounds, not claims about Greed's hidden
backend. The following Greed behaviors are therefore explicit evidence gaps:

- exact source/provider list, search backend, URL support beyond the public
  phrase “query or URL,” provider authentication and licensing;
- playlist URL/command syntax and playlist expansion behavior;
- autoplay's “similar tracks” algorithm and whether it works across providers;
- filter DSP graphs, stacking rules, seek/restart behavior, and whether `flat`
  means disabling all effects;
- queue ordering, duplicate policy, cross-guild/provider cache behavior, and
  exact playback error/retry policy;
- the premium entitlement mechanism for autoplay.

Do not add a YouTube/SoundCloud scraper, `yt-dlp`, browser automation, or
commercial API credentials as an unrequested interpretation of “various
sources.” A real additional provider needs its own first-party terms/licensing
review, bounded resolver, tests, and a contract update.

## Resource limits owned by ByteBot

Greed publishes the `0..200` volume range and the five-minute inactivity event,
but not resource ceilings. The following ceilings are required by issue #58 and
the one-vCPU/one-GB VPS envelope:

- query: 200 Unicode characters after trimming;
- URL alias: 2,048 characters, HTTPS only, and an exact manifest match;
- manifest: at most 1 MiB, 500 tracks, 100 playlists, and 25 entries per
  playlist/related list; track IDs/titles/authors and playlist names are
  bounded before indexing;
- track duration: at most 600 seconds;
- one local track file: at most 64 MiB;
- queued tracks: at most 25 per guild;
- one active player/voice connection per guild;
- one bounded provider lookup at a time per guild, with a finite timeout;
- one FFmpeg process per guild at a time, with an explicit kill/cleanup path;
- five-minute idle/no-listener cleanup, plus shutdown cleanup for every player.

The limits must be checked before queue insertion and again before opening a
stream. Metadata supplied by a manifest or remote response is untrusted; a
known duration over the limit must be rejected before playback. Queue entries
must contain bounded strings and stable provider IDs, not raw unvalidated
commands or arbitrary executable arguments.

## Runtime and playback requirements

The repository already requests `GuildVoiceStates`, which is required to
observe voice membership. Playback still needs the official standalone
`@discordjs/voice` package. Its current package metadata (`0.19.2`) requires
Node `>=22.12.0`; the repository's runtime/container contract must meet that
minimum before the dependency is added. See the [official package metadata](https://registry.npmjs.org/%40discordjs%2Fvoice/0.19.2)
and [discord.js voice installation guide](https://discordjs.guide/voice).

The official guide documents the following pipeline facts:

- Ogg/WebM Opus can be played without FFmpeg.
- MP3 and other arbitrary media require FFmpeg conversion to Opus.
- Inline volume is opt-in and uses a more expensive processing path.
- An Opus encoder such as `opusscript` or `@discordjs/opus` may be required
  depending on the input/host.
- Audio players expose `pause`, `unpause`, `stop`, `Idle`, and `error` states;
  errors need a listener and idle transitions are the clean place to advance
  the queue. See [Audio Resources](https://discordjs.guide/voice/audio-resources),
  [Audio Player](https://discordjs.guide/voice/audio-player), and the
  [`AudioPlayer` API](https://discordjs.dev/docs/packages/voice/main/AudioPlayer:Class).

Discord voice connections require UDP reachability and the library must observe
connection lifecycle transitions. See [Discord Voice Connections](https://docs.discord.com/developers/topics/voice-connections)
and [voice lifecycle guidance](https://discordjs.guide/voice/life-cycles).

The current `Dockerfile` is `node:22-bookworm-slim` and installs no FFmpeg.
That is a concrete runtime gap for MP3, inline volume, and filter playback.
Implementation must either install and verify a pinned system FFmpeg in the
runtime image, or restrict the provider to Opus-only files and clearly reject
features that need FFmpeg. The latter does not meet the published volume and
filter surface, so it is a blocker rather than a silent fallback.

## Acceptance mapping

| Issue #58 criterion | Contract proof required before implementation is considered complete |
| --- | --- |
| Playback state isolated per guild and cleans up idle connections | State map keyed by guild ID; no shared player/queue; five-minute empty/no-playback timer; voice/player shutdown cleanup. |
| Queries, URLs, duration, and queue growth bounded | Limits above enforced before resolution/insertion/streaming; local-root and allowlisted-HTTPS provider boundary; timeout and process cleanup. |
| No fake or nonfunctional provider | At least the operator-owned local manifest provider must resolve a real file and produce a real `AudioResource`; unsupported external sources must return a clear error. No “now playing” response may be emitted before the stream is accepted. |

The contract intentionally leaves implementation and test changes to the
feature branch. It is frozen before those actions so source gaps remain visible
instead of becoming accidental claims.
