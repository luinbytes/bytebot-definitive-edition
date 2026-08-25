# Greed highest-cap and small-VPS contract

Issue: [#63](https://github.com/luinbytes/bytebot-definitive-edition/issues/63)

Research frozen: 2026-08-25

This is the implementation gate for ByteBot's cross-cutting cap and production
packaging slice. It uses Greed's current public premium table, the frozen
feature contracts, and the repository's actual runtime. No live Greed bot or
private billing surface was queried.

## Evidence and policy

The strongest current entitlement source is [Greed Premium](https://greed.best/docs/premium).
The public parity baseline and first-party conflicts are retained in
[`greed-parity.md`](greed-parity.md). ByteBot exposes current premium maxima to
everyone without subscription, vote, purchase, SKU, card, crypto, or
entitlement state. Discord permissions, path RBAC, provider terms, and resource
bounds remain mandatory.

| Public surface | Highest current allowance | ByteBot disposition |
| --- | ---: | --- |
| User command throughput | 15 per 5 seconds | One in-memory sliding window for accepted slash commands. Command-specific cooldowns remain separate safety rules. |
| Guild command throughput | 60 per 10 seconds | One in-memory guild window; DMs have no guild bucket. Restart clears short windows. |
| AI `ask` | 200/day | Blocked by #62's provider/privacy contract; no fake command is registered. |
| AI `imagine` | 30/day | Blocked by #62's provider/resource contract; no fake command is registered. |
| AI `tts` | 50/day | Local eSpeak NG is available to everyone. #62 explicitly freezes no billing-derived daily quota for local work. |
| AI `transcribe` | 50/day | Blocked by #62's provider/resource/consent contract; no fake command is registered. |
| AI `ocr` | 100/day | Local Tesseract is available to everyone. #62 explicitly freezes no billing-derived daily quota for local work. |
| Log channels | 15 | Integrate #50's transactional 15-distinct-channel cap. |
| Autoroles | 50 | Enforce per guild across member and bot autoroles without reducing existing entries. |
| Reaction roles | 500 | Already transactionally enforced by `RoleAutomationService`. |
| Autopfp channels | 15 | The public subject remains a #64 evidence/provider reconciliation item; no absent feature is invented here. |
| Analytics retention | 3 years | Integrate #50's 1,095-day retention and query maximum. |
| User extras | highest/current premium behavior | Existing snipe protection, rank styling, purge filters, and 1.5x economy earnings remain available without Greed entitlement checks. |
| VoiceMaster extras | available to all | Remove stale `(Premium)` discovery labels; real Manage Server/channel-owner checks remain. |

Discord boost membership in the booster-role feature is not Greed billing. It
is the subject state that feature manages and remains required. Economy shop
purchases and suggestion votes likewise are product actions, not entitlement
gates.

## Required cumulative head

The packaging branch starts at PR #93 and already contains #55, #58, #61, and
#62. Issues #42 and #43 are merged. Before implementation claims are made it
must also integrate:

- PR #81 / `feature/levels-analytics` for #50; and
- PR #87 / `feature/image-effects` for #56.

Both are reviewed feature branches, not new #63 implementation. Conflicts must
preserve the cumulative package/dependency union and current help/ledger text.

## Helper inventory and lifecycle

| Helper | Idle/start | Bound and failure | Shutdown/health |
| --- | --- | --- | --- |
| Sharp | Loaded in-process only when image/rank paths initialize; cache off, concurrency one | One shared media queue, 16 MP input, 30-second job, bounded output | Queue cleanup; module/load status shown in `/bot stats` |
| Tesseract | No daemon; one child for accepted OCR work | 8 MiB image, 64 KiB output/logs, 30-second queue deadline | Process group terminated on abort/shutdown; version probe shown in `/bot stats` |
| eSpeak NG | No daemon; one child for accepted TTS work | 2,000 input characters, 8 MiB structurally valid WAV, 64 KiB logs | Process group terminated on abort/shutdown; version probe shown in `/bot stats` |
| FFmpeg/FFprobe | Music is disabled until `MUSIC_LIBRARY_PATH` is configured; startup probes are five seconds | One FFmpeg per active guild, 25-track queue, 10-minute/64 MiB track bounds; FFprobe output 64 KiB | Stop/idle/guild removal/shutdown kill processes; readiness shown in `/bot stats` |

Provider HTTP calls remain request-only and retain their existing response byte,
redirect, timeout, and cache limits. This slice adds no daemon, model, provider
credential, retry queue, or billing service.

Executable overrides (`FFMPEG_PATH`, `FFPROBE_PATH`, `TESSERACT_PATH`, and
`ESPEAK_NG_PATH`) are operator-controlled. Health probes use argument arrays,
never a shell, cap output, and time out. A failed optional helper is reported
unavailable without preventing unrelated ByteBot features from starting.

## Production container contract

Docker documents that CPU and memory limits are runtime constraints, not
Dockerfile metadata: [Compose resource limits](https://docs.docker.com/reference/compose-file/deploy/).
The checked-in default deployment therefore sets one CPU, 1 GiB memory, and a
bounded PID count. Node uses a 640 MiB old-space ceiling to leave native/SQLite
headroom; Node documents the flag and the need to leave memory for other uses in
its [v22 CLI reference](https://nodejs.org/download/release/v22.12.0/docs/api/cli.html#--max-old-space-sizesize-in-mib).

The production image:

- starts `npm start`, not Jest;
- installs production dependencies only;
- pins and build-probes Debian FFmpeg, Tesseract, and eSpeak NG packages;
- runs as the bundled unprivileged Node user;
- receives `SIGTERM` and has a bounded stop grace period;
- persists SQLite in a mounted data directory; and
- exposes a side-effect-free event-loop heartbeat health check. Docker defines
  the command timeout/retry semantics in its
  [Dockerfile `HEALTHCHECK` reference](https://docs.docker.com/reference/dockerfile/#healthcheck).

The health check proves the Node event loop is advancing. `/bot stats` owns
helper readiness and process memory; neither surface claims Discord gateway or
provider success without live evidence.

## Verification boundary

After this contract commit, implementation may merge the two required reviewed
branches and begin tests. Required automated proof is:

1. exact user/guild throughput boundaries and bounded in-memory cleanup;
2. transactional 50-autorole enforcement and existing 500-reaction-role proof;
3. 15 log-channel and 1,095-day analytics checks from #50;
4. helper status with timeout/failure cases and no shell execution;
5. heartbeat freshness/staleness and shutdown cleanup;
6. Docker/Compose static production contract; and
7. the full serial repository suite plus production dependency audit.

A real capped container start, Discord login, voice UDP, attachment upload, and
visual image review remain runtime evidence. They must be reported as untested
when host pressure, credentials, or a live guild prevent them.
