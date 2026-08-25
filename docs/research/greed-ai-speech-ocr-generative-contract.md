# Greed AI, speech, OCR, and generative-media contract

Issue: [#62](https://github.com/luinbytes/bytebot-definitive-edition/issues/62)

Parent: [#33](https://github.com/luinbytes/bytebot-definitive-edition/issues/33)

Research frozen: 2026-08-25

This is the public-source parity and implementation-boundary contract for
Greed's AI questions, image generation/editing, OCR, text-to-speech (TTS), and
audio transcription (STT). It is research only: no ByteBot code or tests were
changed or run while producing this document.

## Executive decision

Greed's current public product pages claim an AI assistant that can ask
questions, generate and edit images, run OCR, and turn text into speech. Its
current premium page names five metered features and gives exact free and
premium daily caps:

| Greed feature | Free | User Premium | Current public evidence |
| --- | ---: | ---: | --- |
| `ask` — questions | 15/day | 200/day | Premium page |
| `imagine` — image generation | unavailable | 30/day | Premium page |
| `tts` — text to speech | 5/day | 50/day | Premium page |
| `transcribe` — audio to text | 5/day | 50/day | Premium page |
| `ocr` — read text from an image | 10/day | 100/day | Premium page |

The page says these `,ai` counters reset at midnight UTC and that `imagine` is
the only AI feature unavailable on the free tier. The homepage separately
claims image editing and more than 100 image filters/effects, but it does not
publish the corresponding command names, options, model, or permission
contract. Sources: [Greed Premium](https://greed.best/docs/premium),
[Greed homepage](https://greed.best/), and [Greed commands](https://greed.best/commands).

The pinned first-party English i18n snapshot at commit
[`3dadc418`](https://github.com/greedbest/i18n/commit/3dadc41852a09567add8a6b2b522d5e2b1a53b2f)
(2026-03-29) provides more precise evidence for only some of those surfaces:

- `utility/ask.json` names `ask`, says “Ask Greed AI a question”, exposes
  “Thinking...” and “Conversation history cleared!”, and says the missing
  dependency is `OPENROUTER_API_KEY`.
- `information/ocr.json` names `ocr`, says “Extract text from an image.”, and
  identifies the result source as OCR.space.
- `fun/image.json` is **Google image search**, not generative image creation.
- No `imagine`, `tts`, or `transcribe` command file exists under the pinned
  English command tree. This absence is a snapshot evidence gap, not proof that
  the current Greed deployment lacks the features listed on its current premium
  page.

Therefore the lawful, maintainable ByteBot subset for the current lightweight
deployment is deliberately small:

1. Local OCR with Tesseract.
2. Local TTS with eSpeak NG, whose upstream documents stdin input, WAV output,
   a few-megabyte footprint, and GPL-3+-or-later licensing.
3. No registered Q&A, STT, image-generation, or semantic-image-edit command
   until the operator supplies a credentialed provider or a separately
   provisioned and measured worker. These are terminal blockers for this slice,
   not silent fallbacks to arbitrary public endpoints.

This is not a license to send Discord content to an arbitrary free model or to
copy Greed's provider credentials. Each model, voice pack, and provider route
must be allowlisted with its license and data policy recorded before enabling
the adapter.

## Evidence boundary and exact Greed strings

### Current website claims

| Surface | Exact public evidence | What remains unknown |
| --- | --- | --- |
| Product overview | “Ask questions, generate and edit images, run OCR, and turn text into speech.” | Command names for editing, model/provider, input forms, outputs, RBAC, and errors |
| AI quotas | `ask`, `imagine`, `tts`, `transcribe`, and `ocr` with the caps in the table above; counters reset at midnight UTC | Whether server premium changes these user counters; request cost for attachments, failures, or retries |
| AI billing | User Premium “unlocks AI”; `imagine` is premium-only; the other four are available to everyone at lower caps | Exact entitlement API, grace period, refund behavior in the bot, and whether voting affects AI counters |
| Image editing | “over 100 image manipulation commands”; member mention, reply, attachment, URL, and own-avatar defaults; three-second interaction timeout; GIF/static-PNG notes | The individual command list, exact slash/prefix surfaces, per-command format, dimensions, and permissions |
| Catalog | The commands page says it contains arguments and permissions and has a client-rendered search/filter UI | The public HTML does not expose a stable command registry; per-command options/RBAC cannot be reconstructed from the page alone |

Image-editing source: [Greed Image Editing](https://greed.best/docs/miscellaneous/image-editing).
The public page is useful for the shared source forms, but its “over 100” claim
is not a stable list of AI generative commands. Do not turn it into one guessed
`/edit` API.

### Pinned i18n registry

The i18n README says English is the complete base locale and that command files
contain translated names, descriptions, and messages. It does not contain
Discord application-command option definitions or permission declarations.

| Pinned file | Exact strings | Parity consequence |
| --- | --- | --- |
| [`utility/ask.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/utility/ask.json) | `name`: `ask`; `description`: `Ask Greed AI a question`; `loading`: `Thinking...`; `cleared`: `Conversation history cleared!`; `notConfigured`: `OpenRouter API is not configured. Set OPENROUTER_API_KEY.`; `noQuestion`: `Please provide a question to ask!`; `invalidInput`: `Invalid input provided.`; `apiError`: `Failed to get response from AI. Please try again later.` | `ask` is confirmed in the snapshot; OpenRouter is the confirmed Greed dependency; a conversation-history clear state exists, but this file does not prove a `clear` option or persistence scope |
| [`information/ocr.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/information/ocr.json) | `name`: `ocr`; `description`: `Extract text from an image.`; `title`: `Extracted Text`; `embed.source`: `Source: OCR.space`; `noImage`: `Please attach an image to extract text from.`; `invalidImage`: `The attached file is not a valid image.`; `noText`: `No text could be extracted from the image.`; `failedToFetch`: `Failed to extract text from image.` | `ocr` is confirmed and attachment-oriented; OCR.space is the named provider; no language/engine option is proven |
| [`fun/image.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/fun/image.json) | `name`: `image`; `description`: `Search for images on Google`; `notAllowed`, `noResults`, `noSafeImages`, `error`; page title/footer placeholders | This is search, not `imagine`; do not use it as evidence for image generation |
| Pinned tree search | No `imagine`, `tts`, or `transcribe` path below `locales/en/commands` | Current premium-page claims win for capability inventory, while exact options and localized runtime strings remain unverified |

The pinned command files establish messages, not option types, aliases,
permission checks, channel scope, history retention, provider routing, output
limits, or premium enforcement. The exact `OPENROUTER_API_KEY` string is the
strongest provider evidence available for Greed's `ask` implementation.

## ByteBot command and category contract

This table is a ByteBot-owned choice where Greed does not publish a complete
registration payload. The current slice registers one `/ai` root with only
`ocr` and `tts`; unusable subcommands are not registered and therefore cannot
promise a provider that is not configured. Future names are recorded for the
parity gate only.

| User surface | Current status | Future prefix compatibility (proposed) | Future slash display | Help category | Input contract | Public Greed evidence vs ByteBot choice |
| --- | --- | --- | --- | --- | --- |
| Questions | Deferred; do not register | Proposed `,ask <question>` | Future `/ai ask question:<string>` | Utility | Required plain text; cap at 2,000 characters; optional reply context only if explicitly enabled | Name/provider/empty-question text are evidenced; exact prefix syntax, slash grouping, length, and reply context are ByteBot-owned |
| Image generation | Deferred; do not register | Proposed `,imagine <prompt>` | Future `/ai imagine prompt:<string>` | Utility | Required prompt; cap at 2,000 characters; output one bounded image | Name, premium-only status, and daily caps are evidenced; exact prefix syntax, prompt option, image count, size, and output format are not |
| Image editing | Deferred; do not register | No exact prefix command is publicly proven | Future only after a first-party command row is recovered | Utility | Shared media resolver; instruction and output bounds are ByteBot-owned | Homepage capability and generic image-editing input forms are evidenced; `edit` name and option schema are not |
| OCR | Implement now | Future `,ocr` alias only when the prefix dispatcher is enabled | `/ai ocr image:<attachment>` | Information | Exactly one image attachment; use shared image format/size checks | Attachment requirement, result title/source, and errors are evidenced; exact prefix syntax and language/engine options are not |
| TTS | Implement now | Future `,tts <text>` alias only when the prefix dispatcher is enabled | `/ai tts text:<string>` | Utility | Required text; cap at 2,000 characters; fixed eSpeak NG voice until a voice option is proven | Name, capability, and caps are evidenced; exact prefix syntax, voice/options/output attachment behavior are ByteBot-owned |
| Transcription | Deferred; do not register | Proposed `,transcribe` with an attached audio file | Future `/ai transcribe audio:<attachment>` | Information | Exactly one audio attachment; duration and format checked before processing | Name, capability, and caps are evidenced; exact prefix syntax, accepted Discord source forms, and language/options are not |

The existing help renderer has `Utility` and `Information` categories but no
`AI` category. Keep the two registered commands discoverable under those
existing categories and add an “AI tools” field to the Utility/Information help
pages. Do not add a separate root command for every provider or model. The
existing path-aware ByteBot RBAC system should address `ai ocr` and `ai tts`;
future paths such as `ai ask` and `ai transcribe` remain unregistered until
their blockers clear.

The `/ai edit` row is intentionally gated. A capability marketing claim is not
enough to freeze a public command name. If the live Greed catalog later exposes
an exact command and options, add that evidence to this contract before
registering a compatibility alias.

### Slash registration and dashboard

- Discord `CHAT_INPUT` commands have a 100-command global limit; subcommands
  and subcommand groups are the correct way to expose a family. Source:
  [Discord Application Commands](https://docs.discord.com/developers/interactions/application-commands).
- `/ai` is one registered command with only `ocr` and `tts` in this slice. This
  does not claim that Greed uses this exact slash grouping; it is ByteBot's
  stable display choice while the other providers are blocked.
- Prefix compatibility is useful because Greed's docs use comma as the default
  prefix and the premium page calls the family `,ai` commands. Keep `,ask`,
  `,imagine`, `,ocr`, `,tts`, and `,transcribe` as aliases only if the prefix
  dispatcher supports aliases without creating duplicate slash registrations.
- A dashboard, if added, should show only provider readiness, local model
  allowlist/license records, per-user/per-guild usage counters, and command
  access rules. It must never display provider secrets or raw prompts/media.
- No dashboard command is proven by the public Greed AI sources. A ByteBot
  dashboard is therefore an administration surface, not a parity claim.

## RBAC and Discord permission contract

Greed's public command page advertises permissions, but the client-rendered
rows were not a stable source for these AI commands. The pinned AI i18n files
contain no permission keys. Greed's public fake-permissions reference includes
`send_tts_messages`, `attach_files`, `embed_links`, `send_messages`,
`view_channel`, and `read_message_history`, but that list does not prove which
AI command checks which key. Source: [Greed Permissions](https://greed.best/docs/resources/permissions).

ByteBot must therefore use these explicit rules:

The future rows below document the policy to apply if a blocker clears; only
`/ai ocr` and `/ai tts` are registered in this slice.

| Action | Invoking member | Bot in target channel | ByteBot policy |
| --- | --- | --- | --- |
| Future `/ai ask` / `/ai transcribe` (deferred), plus `/ai ocr` | No extra member permission for read-only use; path-aware allow/deny/disable applies | `ViewChannel`, `SendMessages`, `ReadMessageHistory`; `AttachFiles` for attachment inputs/outputs; `EmbedLinks` for embeds | A missing bot permission fails before provider work |
| `/ai tts` | No extra member permission; do not infer native Discord TTS from the `send_tts_messages` label | `ViewChannel`, `SendMessages`, `AttachFiles` for generated audio | Generated audio is an attachment; require native `SendTTSMessages` only if a future implementation actually sends a Discord TTS message |
| Future `/ai imagine` / semantic edit (deferred) | No extra member permission for invocation; path-aware policy may narrow it | `ViewChannel`, `SendMessages`, `AttachFiles`, `EmbedLinks` as applicable | Provider safety refusal and output bounds are independent of RBAC |
| Provider/model configuration | Real Discord `ManageGuild` for server-scoped settings; bot operator/environment for secrets | Not applicable | Fake permissions do not grant access to secrets, provider billing, or Discord API permissions |
| Usage/cost policy | Per-user and per-guild quotas are ByteBot-owned | Not applicable | Count accepted provider jobs once, not each retry; failures do not silently grant unlimited retries |

Discord's own permission checks precede ByteBot path rules. The existing
ByteBot access-control contract says administrators bypass ByteBot allow/deny
rules but still pass Discord's native checks; fake permissions cannot replace a
real permission required by the API. Source: [`docs/features/command-access-controls.md`](../features/command-access-controls.md).

For slash interactions, require the same path-aware check as prefix commands.
Do not hide an AI command from the slash picker merely because a provider is
not configured; show a clear, ephemeral configuration error instead. A server
administrator may disable a path or restrict it to a role/member through the
existing `/server permissions` surface.

## Provider and model feasibility

### Provider matrix

| Capability | Greed-named provider evidence | Immediate local option | Hosted option and credential boundary | License/privacy/resource blocker |
| --- | --- | --- | --- | --- |
| Q&A | Pinned `ask.json` says OpenRouter and requires `OPENROUTER_API_KEY` | None in the current 1 GiB slice | OpenRouter's API uses bearer API keys; its free-model quota is documented as 50 requests/day without at least $10 in credits and 1,000/day after that; model/provider policies vary | Terminal blocker: a hosted key, pinned model/provider policy, and privacy/budget approval are missing. No local model is assumed or downloaded on this host |
| OCR | Pinned `ocr.json` says OCR.space | Tesseract engine is Apache-2.0 and runs locally; language data must be audited separately | OCR.space free API requires a key, is 500 requests/day per IP, lists 25,000 requests/month and 1 MB free file limit; it says it does not store documents | Tesseract is the immediate lawful path. OCR.space is optional provider parity, not a keyless fallback; output will not be byte-for-byte Greed parity |
| STT | Current premium page names `transcribe`; no pinned provider string | None in the current 1 GiB slice; whisper.cpp remains research evidence only | OpenAI `/audio/transcriptions` requires an API key and supports named audio formats and JSON/text/SRT/VTT-family output formats | Terminal blocker: upstream whisper.cpp model files range from about 75 MiB (tiny) to 2.9 GiB (large-v3), and its memory figures make a production local worker unsafe without a separate measured resource envelope. Consent policy is also required |
| TTS | Current premium page names `tts`; homepage says turn text into speech; no pinned provider string | eSpeak NG command-line runtime: stdin input, WAV output, a few-megabyte program/data footprint, GPL-3+-or-later | OpenAI speech endpoint requires an API key; current reference says input max 4,096 characters and supports mp3/opus/aac/flac/wav/pcm | Immediate path, subject to GPL notice/source obligations when redistributed and separate voice/data licensing. Output is intentionally a lightweight synthetic voice, not Greed-quality parity; no voice cloning |
| Image generation | Current premium page names `imagine` and makes it premium-only; homepage claims generation | None in the current 1 GiB slice; FLUX.1-schnell is blocker evidence only | OpenAI image APIs support generation/editing, mask input, bounded sizes and output formats, but require an API key and provider policy review | Terminal blocker: FLUX.1-schnell documents 12B parameters and needs a separate GPU-capable worker in practice. Model license does not grant rights to all prompt/input images |
| Generative image editing | Homepage claim only; no exact current command or pinned file | None in the current 1 GiB slice | OpenAI image edit endpoint is a credentialed option; exact input mask/output contract must be pinned to the selected model version | Terminal blocker: no public Greed command schema and no bounded local semantic-edit worker; do not promise local parity |

Primary sources: [Tesseract](https://github.com/tesseract-ocr/tesseract),
[eSpeak NG README and license](https://github.com/espeak-ng/espeak-ng),
[OpenAI Whisper model card](https://github.com/openai/whisper/blob/main/model-card.md),
[whisper.cpp model sizes](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md),
[FLUX.1-schnell](https://huggingface.co/black-forest-labs/FLUX.1-schnell/blob/main/README.md).

### OpenRouter boundary for `ask`

OpenRouter's official docs say API keys are bearer tokens, its API is an
OpenAI-compatible interface, and model/provider data policies vary. OpenRouter
says it does not store prompts/responses unless logging or product-improvement
opt-ins are enabled, but it retains request metadata and routes content to the
selected model provider. Its ZDR setting only routes to endpoints whose policy
is explicitly marked zero-retention; unknown provider policy is treated
conservatively. Sources: [API keys](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys),
[data collection](https://openrouter.ai/docs/guides/privacy/data-collection),
[ZDR](https://openrouter.ai/docs/guides/features/zdr),
[provider logging](https://openrouter.ai/docs/guides/privacy/provider-logging), and
[rate-limit FAQ](https://openrouter.ai/docs/faq).

ByteBot must not silently choose an arbitrary OpenRouter model. The adapter
configuration must pin a model ID and provider policy, reject routes that do not
meet the operator's configured retention policy, and keep the key in the
process environment/secret store. The `ask` handler must not forward Discord
usernames, avatars, guild names, or channel history unless the command's
explicit context contract permits it.

### OCR.space boundary

The official OCR.space API page documents the free key requirement, 500
requests/day per IP, 25,000 requests/month, 1 MB free file limit, supported
image/PDF inputs, and an on-premise product. The FAQ says documents are not
stored and that the free service may be used commercially, subject to its
current terms and lack of uptime guarantees. Sources: [OCR API](https://ocr.space/ocrapi)
and [OCR FAQ](https://ocr.space/faq).

The pinned Greed string `Source: OCR.space` is a provenance label, not a reason
to expose OCR.space's API key or to send arbitrary Discord URLs directly to the
provider. ByteBot should download and validate the attachment locally through
the existing media foundation, then send only bounded bytes to the configured
adapter.

### OpenAI boundary for hosted media

The official OpenAI references document:

- `/audio/transcriptions` accepted formats, model choices, response formats,
  language hints, and optional timestamps;
- `/audio/speech` input max 4,096 characters, supported voices, speed range,
  and audio formats; and
- image generation/editing with bounded size, quality, output format, and mask
  parameters.

Sources: [Create transcription](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create),
[Create speech](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create),
[image generation guide](https://developers.openai.com/api/docs/guides/image-generation),
and [image API reference](https://developers.openai.com/api/reference/resources/images).

The OpenAI quickstart requires an API key. OpenAI says API business/API
inputs and outputs are not used for training by default, while the API data
controls document abuse-monitoring logs and provider retention controls. This
is not equivalent to local processing; the operator must accept the applicable
OpenAI service agreement and privacy terms. Sources: [OpenAI quickstart](https://platform.openai.com/docs/quickstart/make-your-first-api-request),
[data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint),
and [data-use policy](https://openai.com/policies/how-your-data-is-used-to-improve-model-performance/).

## Shared media, output, and privacy bounds

The existing [media foundation contract](greed-media-foundation-contract.md)
sets ByteBot's shared input trust boundary. AI adapters must reuse it rather
than downloading Discord URLs independently:

- image input default: 8 MiB, 4,096 × 4,096, 16 megapixels;
- timed-media input default: 10 minutes;
- public-URL resolution only through the validated credential-free HTTP(S)
  downloader where a command explicitly exposes a URL;
- one in-process media worker by default, at most four retained jobs, and a
  30-second processor deadline; and
- fresh temporary directories with cleanup in `finally`.

Additional AI policy:

| Boundary | ByteBot rule |
| --- | --- |
| Text input | 2,000 characters for Discord-visible commands; reject before provider call |
| Text output | Send up to Discord's 2,000-character content limit; attach a bounded `.txt` transcript when the provider returns more |
| OCR output | Preview within an embed/message; attach full text only after enforcing the output byte bound |
| Audio output | Encode one supported format and enforce a configured output-byte ceiling before upload; reject instead of silently truncating audio |
| Image output | Validate signature, dimensions, and bytes again after provider return; reject unexpected content type or an output above the configured upload ceiling |
| Provider payload | Do not include raw Discord identity or unrelated channel history by default; use a hashed safety/request identifier only where the provider requires one |
| Persistence | Do not persist raw prompts, attachments, transcripts, generated audio, or generated images after delivery; retain only usage/error metadata needed for operations |
| User notice | The help/command response must identify when content leaves the host and name the configured provider; local adapters must be distinguishable from hosted adapters |
| Consent | STT must be user-initiated and must not be exposed as background surveillance. The Whisper model card specifically cautions against transcribing recordings without consent |
| Safety | Provider refusals, moderation errors, and unsupported content fail closed; do not retry a refusal as a different provider automatically |

These output bounds are ByteBot-owned safety and Discord-transport policy. They
are not claims about Greed's hidden limits.

## Jobs and restart behavior

Greed's published daily counters are product evidence, not ByteBot limits.
The immediate local tools have no billing, vote, purchase, entitlement, or
daily quota and persist no job state. They use the existing one-slot media
queue, acknowledge slash interactions before processing, and make no automatic
retry. A restart interrupts the request; the member may invoke it again. No AI
polling loop exists.

Conversation history is a separate opt-in feature:
the pinned `ask.json` proves a “Conversation history cleared!” response but not
the command, scope, TTL, or storage. Default ByteBot behavior should be
stateless per request. If history is later added, expose `/ai ask clear`, scope
it to `(guild, channel, user)`, enforce a TTL and row/byte cap, and delete it on
request.

## Lawful implementation plan and blockers

### Implementable without third-party credentials

| Feature | Local path | Conditions |
| --- | --- | --- |
| OCR | Tesseract Apache-2.0 engine | Package engine and language data under their own licenses; accept that provider output will differ from OCR.space; enforce image bounds |
| TTS | eSpeak NG command-line runtime | Feed bounded text through stdin, write WAV to a fresh temporary path, enforce output bytes, preserve GPL-3+ notices/source obligations when redistributed, and audit voice/data files |

This is the complete immediate subset for the current 1 GiB deployment profile.
Whisper/STT, OpenRouter/Q&A, image generation, and semantic image editing are
terminal blockers until a credentialed provider or separately provisioned worker
has an approved resource, privacy, and licensing contract.

### Credentialed or externally hosted

| Feature | Candidate | Required gate |
| --- | --- | --- |
| Greed-style Q&A | OpenRouter | `OPENROUTER_API_KEY`, pinned model/provider policy, usage budget, retention choice, and operator acceptance of routed-provider terms |
| Greed-named OCR | OCR.space | API key, 1 MB/free-tier and quota accounting, provider disclosure, and a fallback/local mode |
| High-quality STT/TTS/image generation/editing | OpenAI or another provider with a current first-party API | API key, billing/rate-limit budget, current terms/privacy review, content safety handling, and input/output cap mapping |
| Local generative images | FLUX/diffusion worker | Separate GPU/memory budget, model and inference-license audit, sandboxed worker, queue/backpressure, and a provider/model safety policy |

No keyless scraping of ChatGPT, Google Images, OCR providers, Discord CDN
pages, or social websites is an acceptable fallback. A public endpoint or a
free model is not automatically licensed for bot redistribution or unlimited
commercial use.

## Recorded implementation decisions and production gates

These decisions let issue #62 implementation proceed without inventing a
provider contract. Production enablement still waits for the packaging and
health evidence in [issue #63](https://github.com/luinbytes/bytebot-definitive-edition/issues/63).

- The immediate mode is **local-only Tesseract OCR plus eSpeak NG TTS**. Q&A,
  STT, `imagine`, and semantic image editing remain explicitly deferred until
  a credentialed provider or separately provisioned worker is approved.
- No raw prompt, attachment, transcript, generated image, or generated audio
  is retained after delivery. Only bounded usage, idempotency, and operational
  error metadata may persist.
- OCR/TTS media processing uses the existing one-slot queue; no second
  worker or unbounded backlog is introduced.
- Enforced bounds are 8 MiB input images, 2,000-character text, 64 KiB OCR
  output, 8 MiB WAV output, and 30 seconds per executable invocation. Each
  helper's stdout and stderr are capped at 64 KiB; exceeding either cap
  terminates the invocation and fails the request.
- The exact Tesseract and eSpeak NG executable versions, checksums/package
  provenance, invocation arguments, and a local health check are recorded and
  verified in [issue #63](https://github.com/luinbytes/bytebot-definitive-edition/issues/63) before production enablement. Executables and model/
  voice data are never selected from user input.
- The current Greed catalog and premium page remain the source-parity evidence
  for future `ask`, `imagine`, `tts`, `transcribe`, and `ocr` arguments,
  permissions, and caps. If the catalog remains client-rendered, unknown
  fields stay unknown rather than becoming guessed options.
- Slash registration, prefix aliases, help category, path-aware RBAC, output
  safety, and restart/idempotency behavior are verified against the existing
  command registry and media foundation before the implementation PR is
  considered ready.

## Source index

### Greed

- [Greed homepage](https://greed.best/)
- [Greed Premium](https://greed.best/docs/premium)
- [Greed Image Editing](https://greed.best/docs/miscellaneous/image-editing)
- [Greed command catalog](https://greed.best/commands)
- [Greed fake permissions](https://greed.best/docs/resources/permissions)
- [Greed i18n pinned commit](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f)
- [Pinned i18n README](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/README.md)
- [Pinned `ask.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/utility/ask.json)
- [Pinned `ocr.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/information/ocr.json)
- [Pinned `image.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/fun/image.json)

### Providers and local runtimes

- [OpenRouter API keys](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys)
- [OpenRouter FAQ/rate limits](https://openrouter.ai/docs/faq)
- [OpenRouter data collection](https://openrouter.ai/docs/guides/privacy/data-collection)
- [OpenRouter ZDR](https://openrouter.ai/docs/guides/features/zdr)
- [OCR.space API](https://ocr.space/ocrapi)
- [OCR.space FAQ](https://ocr.space/faq)
- [OpenAI quickstart/authentication](https://platform.openai.com/docs/quickstart/make-your-first-api-request)
- [OpenAI transcription reference](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create)
- [OpenAI speech reference](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)
- [OpenAI image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
- [OpenAI image reference](https://developers.openai.com/api/reference/resources/images)
- [OpenAI API data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)
- [Tesseract Apache-2.0 engine](https://github.com/tesseract-ocr/tesseract)
- [eSpeak NG compact CLI, WAV output, and GPL-3+ license](https://github.com/espeak-ng/espeak-ng)
- [Whisper model card](https://github.com/openai/whisper/blob/main/model-card.md)
- [Whisper MIT license](https://github.com/openai/whisper/blob/main/LICENSE)
- [whisper.cpp model sizes](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md)
- [FLUX.1-schnell Apache-2.0 model card](https://huggingface.co/black-forest-labs/FLUX.1-schnell/blob/main/README.md)

### Platform constraints

- [Discord Application Commands](https://docs.discord.com/developers/interactions/application-commands)
- [Discord permissions](https://docs.discord.com/developers/topics/permissions)
- [Discord message resource](https://docs.discord.com/developers/resources/message)
- [ByteBot media foundation](greed-media-foundation-contract.md)
- [ByteBot command access controls](../features/command-access-controls.md)
