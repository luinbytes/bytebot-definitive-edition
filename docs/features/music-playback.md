# Self-hosted music playback

ByteBot registers one guild-only Music hub:

```text
/music play query:<library query or configured HTTPS alias>
/music queue
/music pause
/music resume
/music skip
/music stop
/music volume [0..200]
/music preset name:<soft|8d|chipmunk|boost|vaporwave|vibrato|piano|metal|flat|karaoke|nightcore>
/music settings dj role:<role>
/music settings autoplay state:<on|off|enable|disable|true|false>
```

`play` and `queue` are member paths. Pause, resume, skip, stop, volume, and
preset require the configured DJ role when one exists; the server owner and
Discord administrators bypass that role gate. Settings always require the real
Discord Manage Server permission. ByteBot's path-aware RBAC can restrict any
path further but cannot grant Discord Connect, Speak, or Manage Server.

## Operator library

Set `MUSIC_LIBRARY_PATH` to a directory containing `music.json` and the audio
files. ByteBot never downloads arbitrary user URLs. A manifest URL is only an
exact lookup alias for its local file.

```json
{
  "tracks": [
    {
      "id": "first-song",
      "title": "First Song",
      "author": "Example Artist",
      "durationSeconds": 180,
      "file": "albums/example/first-song.ogg",
      "url": "https://music.example/first-song",
      "related": ["second-song"]
    },
    {
      "id": "second-song",
      "title": "Second Song",
      "author": "Example Artist",
      "durationSeconds": 160,
      "file": "albums/example/second-song.ogg"
    }
  ],
  "playlists": {
    "example mix": ["first-song", "second-song"]
  }
}
```

Queries match a track ID, title, author, exact HTTPS alias, or playlist name.
Autoplay chooses only a declared `related` track that was not recently played;
without one, playback ends. The manifest is capped at 1 MiB, 500 tracks, and
100 playlists. Tracks are capped at 10 minutes and 64 MiB; playlists, related
lists, and each guild queue are capped at 25 entries. Resolved files must stay
inside the library root and use AAC, FLAC, M4A, MP3, Ogg/Opus, WAV, or WebM.
FFprobe verifies the codec and duration before queue insertion and again before
playback. FFmpeg hard-stops each stream at its declared duration.

## Runtime

Music requires Node 22.12 or newer, `@discordjs/voice`, `opusscript`, Discord
UDP reachability, FFmpeg, and FFprobe. The Docker image installs both. A native
host may set `FFMPEG_PATH` or `FFPROBE_PATH` when either executable uses a
nonstandard name. Startup checks the dependencies and executables within five seconds; a failure leaves music
disabled while the rest of ByteBot starts. One FFmpeg process may run per
active guild. Stop, disconnect, guild removal, and process shutdown destroy the
player, connection, timer, and child process. An idle player disconnects five
minutes after its voice channel empties.

ByteBot deliberately does not ship YouTube/SoundCloud scraping, `yt-dlp`, a
browser downloader, or fabricated search/similarity results. The public-source
mapping and evidence gaps are frozen in
[`greed-music-contract.md`](../research/greed-music-contract.md).
