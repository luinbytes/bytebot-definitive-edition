# Information and lookups

ByteBot maps Greed's public information family into its existing Intent Hubs:

- `/me banner`, `/me server-avatar`, `/me server-banner`, and `/me name history`
- `/server info`, `/server role info`, `/server role members`, `/server permissions view`
- `/server invite bot`, `/server invite info`, `/server asset icon`, and `/server asset banner`
- `/lookup calculate`, `/lookup qr`, `/lookup screenshot`, `/lookup weather`, `/lookup definition`, and `/lookup translate`
- `/lookup github user`, `/lookup github repository`, and `/lookup github email`
- `/game roblox profile`, `/game roblox games`, `/game roblox groups`, and `/game roblox outfits`

`/me avatar`, `/me info`, `/server info`, and `/server stats` continue to reuse their established handlers. Every path remains subject to the root or exact-path rules configured through `/server permissions`.

Discord is authoritative for users, members, roles, guilds, permissions, assets, and invites. Username history contains only former names ByteBot observed through Discord's `userUpdate` event while sharing that server; it never invents older names.

Web lookups reject credentials, non-web schemes, private/link-local destinations, oversized inputs, redirects on ByteBot's provider request, non-JSON/non-image responses, and payloads above their documented bounds. Weather uses Open-Meteo, definitions use Urban Dictionary, and QR images use QuickChart. Translation requires a LibreTranslate-compatible `LIBRETRANSLATE_URL`; screenshots require an HTTPS `SCREENSHOT_API_URL` template containing `{url}`. The screenshot browser is a separate trust boundary: deploy it without access to trusted networks and require it to reject private/link-local targets, redirects, and DNS rebinding independently. Missing or failed providers produce a visible diagnostic.

GitHub lookups use its documented unauthenticated public REST API. User, repository, and public-commit-email searches are capped, cached for one minute, and distinguish missing, inaccessible, rate-limited, and malformed responses. GitHub's keyless REST API does not expose contribution-calendar data, so the profile response says that field is unavailable instead of fabricating it.

Roblox lookups use only the provider's documented cookie-free legacy endpoints. Each path resolves one username, performs a fixed request chain, caches successful provider responses for one minute, and returns at most five games, groups, outfits, badges, or former names. No `.ROBLOSECURITY` cookie, account link, pagination crawl, or third-party scraper is used. Roblox marks legacy APIs as minimally stable, so provider drift produces an explicit diagnostic.

These read-only paths require no Discord member permission by default. Existing `/server permissions` rules may disable or allow their root or exact slash paths. Provider-account actions and feed/reposter mutations are not granted by these commands.

The public-source behavior and evidence gaps are frozen in [`docs/research/greed-information-lookups-contract.md`](../research/greed-information-lookups-contract.md) and [`docs/research/greed-social-game-lookups-contract.md`](../research/greed-social-game-lookups-contract.md). Rolimons, Valorant, Minecraft, Spotify search/audio previews, Reddit, YouTube downloads, X, TikTok, Instagram, Telegram, and bio-provider scraping remain blocked by provider terms, credentials, approval, or absent first-party contracts. Live Discord validation remains a separate, explicitly approved step.
