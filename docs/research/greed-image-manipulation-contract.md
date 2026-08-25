# Greed image-manipulation parity contract

Issue: [#56](https://github.com/luinbytes/bytebot-definitive-edition/issues/56)

Parent: [#33](https://github.com/luinbytes/bytebot-definitive-edition/issues/33)

Research frozen: 2026-08-24

This is the implementation gate for ByteBot's public image-manipulation slice.
It uses Greed's current public image-editing documentation and official English
localization registry pinned at
[`3dadc418`](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands).
The live command catalog was also attempted, but Cloudflare returned a challenge;
no protection was bypassed and no live Greed bot or Discord guild was queried.

## Public contract and ByteBot placement

Greed documents more than 100 commands across avatar filters, text overlays and
templates, and avatar meme reactions. It accepts a member, URL, attachment,
reply, or the caller's avatar, and says most non-GIF effects return a static PNG.
The registry gives exact public names where the documentation groups do not.

ByteBot exposes one public Fun-category intent hub instead of adding more than
100 top-level commands:

| Slash path | Options | Public behavior |
| --- | --- | --- |
| `/image transform resize` | `image`, `user`, or `url`; `width`; optional `height` | Fit inside the requested 1-4096 pixel bounds without enlargement. |
| `/image transform rotate` | source; `angle` from -360 through 360 | Rotate to a static PNG. |
| `/image transform compress` | source; optional quality 1-100 | Return a bounded WebP. |
| `/image transform convert` | source; `png`, `jpeg`, `webp`, or `gif` | Convert the validated image and return the chosen file type. |
| `/image effect apply` | source; named local effect | Apply one implemented effect and return a bounded PNG or WebP. |
| `/image meme caption` | source; top text; optional bottom text | Render escaped, wrapped text in ByteBot-owned caption bands. |
| `/image meme compare` | source; first and second text | Render a ByteBot-owned two-text comparison card. |
| `/image inspect dominant` | source | Return the dominant color as a hex value and swatch. |

Every source-bearing subcommand uses the #55 resolver. Slash commands expose
Discord-native attachment and user options plus a public URL; omitting all three
uses the caller's display avatar. Prefix-only reply syntax is not invented for
slash commands. A later message context command may use the same resolver without
changing this contract.

The global command handler applies existing path-aware RBAC to the exact slash
path, with root `/image` rules as fallback. These member features require no
Discord management permission and never bypass a channel's Attach Files or app
interaction limits.

## Family parity matrix

`implemented` means this issue supplies a local implementation. `blocked` means
the public name is known but the exact provider algorithm or a licensed template
asset is not public. `evidence-gap` means the public source does not identify the
operations needed for an honest 1:1 implementation.

| Public family | Public names/evidence | ByteBot disposition |
| --- | --- | --- |
| Distortions and warps | `distort`: burn, dizzy, endless, infinity, melt, phase, poly, pyramid, shear, shred, slice, stretch | `implemented`: shear and stretch. `blocked`: the other named provider effects have no public algorithm or fixtures. |
| Color and tone | Greed docs name the family; registry names half-invert/halfinvert, LSD, neon, sensitive, stereo | `implemented`: grayscale, invert, sepia, saturate, tint, and half-invert. `blocked`: exact LSD, neon, sensitive, and stereo renderings are unpublished provider behavior. |
| Artistic styles | Registry `render`/`modify`: cartoon, cinema, console, contour, dither, emojify, gameboy, knit, letters, lines, matrix, minecraft, painting, pattern, poly | `implemented`: pixelate, blur, sharpen, and deepfry as ByteBot-owned effects. `blocked`: each named provider style lacks an exact public algorithm or output fixture. |
| Filters and effects | Registry names rotate, compress, bayer, optics, ads, bevel, billboard, cube, flag, soap, tiles, TV, wall | `implemented`: rotate, resize, compress, convert, flip, flop, normalize, threshold, and img-to-GIF. `blocked`: the remaining named provider renderings lack exact public behavior. |
| Themed effects | Greed docs name the family; registry `overlay`: blocks, cow, equations, flush, gallery, globe, ipcam, Kanye, lamp, laundry, layers, logoff, magnify, paparazzi, phase, phone, plank, plates, pyramid, radiate, reflection, ripped, shear | `blocked`: exact composition requires unpublished or unlicensed provider/template assets. ByteBot will not copy Greed assets. |
| Animations | shine, shock, shoot, ripple, roll, fan, fire, hearts, boil, bomb, 3d, earthquake, glitch, heart, magik, patpat, rain, triggered, wasted, spin, wave, wiggle | `blocked`: public sources do not specify frames, timing, assets, or algorithms. Static conversion to GIF is implemented but is not mislabeled as animation parity. |
| Scenes | ace, scrapbook | `blocked`: exact scene assets and composition are not public. |
| Text overlays | Public docs plus `alert`, `captcha`, `facts`, `oogway`, `sadcat`, `supreme` | `implemented`: safe generic caption. `blocked`: named templates require exact unpublished layouts, fonts, or licensed imagery. |
| Comparison and two-text memes | `didyoumean`, `drake`, `pooh` | `implemented`: safe generic compare card. `blocked`: exact named templates require unpublished or licensed assets. |
| Member reactions | `ship`, `quote` | `blocked` here: ship's exact composition is unpublished; quote is owned by #54 and is not duplicated. |
| Gun and threat memes | `gun`, `wanted` | `blocked`: exact named template assets are not public or licensed for ByteBot. |
| Fashion and style | `drip` | `blocked`: exact named template asset is not public or licensed for ByteBot. |
| AlexFlipnote provider | supreme, facts, didyoumean, captcha, calling errors | Mapped to the template blockers above; ByteBot does not proxy an undocumented third-party API. |
| Popcat provider | ship, alert, drake, gun, oogway, pooh, sadcat, wanted, drip errors | Mapped to the template blockers above; ByteBot does not proxy an undocumented third-party API. |
| Jeyy provider | Registry proves a provider family but publishes no operation names; Greed docs group filters generically | `evidence-gap`: exact provider inventory and behavior cannot be derived honestly. Named `animate`, `distort`, `modify`, `overlay`, `render`, and `scene` entries remain mapped individually above. |
| Dominant color | `fun/dominant` and `information/dominant` | `implemented`: one `/image inspect dominant` path accepts the shared sources. |
| Image-to-GIF | `utility/img2gif`, supporting PNG/JPG/WebP/GIF | `implemented`: `/image transform convert format:gif`; the file is attached directly instead of inventing Greed's private CDN. |
| OCR | `information/ocr`, publicly sourced from OCR.space | `implemented` by #62 as bounded local Tesseract OCR through the shared media queue. Exact OCR.space/Greed provider output remains an explicit provider-parity boundary. |

This terminal mapping is intentionally narrower than claiming visual parity from
command names. If Greed publishes algorithms, licensed assets, or deterministic
fixtures later, #64 may replace a blocker with a tested implementation.

## Processor and dependency decision

ByteBot and Node's standard library cannot decode and encode the documented
formats. No installed dependency does so. The `sharp` package is the smallest
single dependency that supplies bounded decoding, resize, rotate, compositing,
color operations, and PNG/JPEG/WebP/GIF output on the repository's Node 22
container. Its official package requires Node 20.9 or newer and normally ships
platform binaries without a separately managed daemon.

The processor is one service behind `MediaService.processImage`; commands do not
invoke native tooling directly. Sharp concurrency is set to one and its cache is
disabled for the 1 vCPU/1 GB profile. Input decoding keeps the #55 16-megapixel
limit. Output is capped at the smaller of Discord's interaction-provided
`attachment_size_limit` and the current default 10 MiB. Rendering retries with
smaller dimensions/quality inside the same queued job and fails rather than
sending an oversized file.

Sources:

- [Greed Image Editing](https://greed.best/docs/miscellaneous/image-editing)
- [Greed Premium limits](https://greed.best/docs/premium)
- [Discord API file uploads](https://docs.discord.com/developers/reference#uploading-files)
- [Discord interaction attachment limit](https://docs.discord.com/developers/interactions/receiving-and-responding#interaction-object)
- [sharp installation and runtime support](https://sharp.pixelplumbing.com/install/)

## Verification boundary

After this contract commit, implementation may begin with local mocked command
tests and deterministic generated image fixtures. Required proof is command JSON,
source selection, RBAC path compatibility, output signatures/dimensions/byte
bounds, queue cleanup/failure behavior, and the full repository suite. Live
Discord registration, permission denial, attachment upload, and visual review
remain explicit manual evidence; no Greed bot comparison is performed.
