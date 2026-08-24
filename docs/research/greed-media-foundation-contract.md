# Greed media-input and processing foundation contract

Issue: [#55](https://github.com/luinbytes/bytebot-definitive-edition/issues/55)

Parent: [#33](https://github.com/luinbytes/bytebot-definitive-edition/issues/33)

Research frozen: 2026-08-24

This is the implementation gate for ByteBot's shared media-input seam. It uses
the official Greed English localization registry pinned at
[`3dadc418`](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands),
Discord's current API documentation, and the existing ByteBot trust boundary.
No live Greed bot or Discord guild was queried.

## Evidence and limits

| Source | Public evidence | ByteBot contract |
| --- | --- | --- |
| Greed `utility/img2gif` | Image input may be an attachment, an image in a replied-to message, or a message context command. Supported formats are PNG, JPG, WebP, and GIF. | One resolver accepts explicit attachments, replied/context messages, and the invoking user's avatar. Slash commands may additionally supply a member or public URL when their command contract exposes those typed options. |
| Greed `utility/sticker add` | A sticker may come from a URL, attachment, or replied-to message; PNG and GIF are named. | The shared resolver returns the source without pretending every consumer accepts every image format. Each command supplies its allowed formats. |
| Greed `utility/emoji add` | An emoji may come from an emoji, URL, or attachment; PNG/JPG/GIF are named. | Custom-emoji parsing remains command-specific. Remote image retrieval uses the shared bounded downloader. |
| Greed `utility/webhook avatar` and `server/customize` | Image URL or attachment; maximum 8 MB. Customize names PNG/JPG/GIF/WebP. | Eight MiB is the default input ceiling. Consumers can only lower it. Content headers are hints; the downloaded bytes must match an allowed signature. |
| [Discord Application Commands](https://docs.discord.com/developers/interactions/application-commands) | Attachment is a native option type and resolved attachment object. User and message commands provide their target without arguments. | Prefer Discord objects over parsing mentions or message links. No additional top-level command is introduced by this foundation. |
| [Discord Message Resource](https://docs.discord.com/developers/resources/message) | Attachments expose URL, content type, byte size, image/video dimensions, and voice-message duration. Message content and attachments require the Message Content intent for gateway events. | Validate available size, dimensions, and duration before downloading. Fetch a referenced message only through Discord's API and existing permission boundary; never scrape Discord pages. |
| [Discord API Reference](https://docs.discord.com/developers/reference#signed-attachment-cdn-urls) | Attachment CDN URLs are signed and refreshed in fetched message payloads. | Use the current attachment URL from the Discord object. Treat it as untrusted remote input despite its host. |

The registry proves public input forms and format names, not input precedence,
image dimensions, media duration, download timeout, or worker count. Those are
ByteBot safety policy, fixed here rather than guessed as Greed behavior.

## Shared input contract

Commands pass only the sources they expose. The resolver selects the first
available source in this order:

1. explicit slash attachment;
2. explicit member avatar;
3. replied-to or message-context attachment, then sticker, then embed image;
4. explicit public HTTP(S) URL; and
5. the invoking user's display avatar.

An explicit but invalid source fails instead of silently falling through. This
keeps user mistakes visible and prevents an unexpected avatar from being
processed. Reply resolution is supplied by the caller as a Discord message;
the media layer does not acquire channel permissions or fetch arbitrary IDs.

## Trust boundary

- Default maximum input: 8 MiB. A consumer may set a smaller limit, never a
  larger one through user input.
- Default image bounds: 4096 by 4096 and 16 megapixels. Width and height from a
  Discord attachment are checked before download and verified from the file
  header afterward.
- Default timed-media duration: 10 minutes. A known attachment duration above
  the limit is rejected before download. A consumer that cannot determine an
  audio/video duration must not pass it to a processor requiring that bound.
- Supported image signatures: PNG, JPEG, GIF87a/GIF89a, and WebP. Declared MIME,
  allowed format, and detected bytes must agree.
- Remote sources must be credential-free HTTP(S), resolve only to public IP
  addresses, stay pinned to a validated address for the request, complete in 10
  seconds, return a 2xx response, and must not redirect.
- Both declared `Content-Length` and streamed bytes are bounded. Partial and
  oversized bodies are cancelled or destroyed.
- Processing runs through one in-process FIFO slot by default. A configured
  value may lower the slot count to disable processing but cannot exceed one in
  the 1 vCPU/1 GB deployment profile.
- Temporary processing uses a fresh operating-system temp directory and removes
  it in `finally`. Callers receive the validated buffer and metadata; commands
  never pass an untrusted path or filename to a processor.
- This foundation starts no process, container, daemon, model, or helper. A
  later feature may invoke a packaged lightweight executable only inside the
  queue and temporary workspace, with its own timeout and output bounds.

## Repository placement

The existing `ServerPresentationService.image` implementation already contains
the DNS/IP checks, pinned native request, timeout, MIME check, and streamed
eight-MiB bound. Issue #55 promotes that logic into the shared media service and
keeps server customization as a caller. This is the smallest root seam and
avoids two security implementations drifting apart.

The foundation has no slash command, help entry, database state, or RBAC rule.
Feature issues #56, #58, and #62 own their user-facing command placement and
must use normal path-aware command authorization in addition to this media
trust boundary.

## Evidence gaps

- Greed does not publicly specify source precedence, download redirects,
  dimensions, duration ceilings, timeouts, concurrency, or sandbox mechanics.
- The registry does not prove that arbitrary URL input exists for every image
  manipulation command. ByteBot commands expose URLs only where their own
  frozen contract documents them.
- No public source establishes safe video/audio decoding within this VPS
  envelope. This foundation validates metadata but does not claim a decoder.
