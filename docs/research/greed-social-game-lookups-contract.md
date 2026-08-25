# Greed social and game lookup contract

Issue: [#60](https://github.com/luinbytes/bytebot-definitive-edition/issues/60)

Parent: [#33](https://github.com/luinbytes/bytebot-definitive-edition/issues/33)

Research frozen: 2026-08-24

This is the implementation gate for public, one-off social and game lookups.
It uses Greed's current [Social Lookups & Feeds guide](https://greed.best/docs/miscellaneous/socials), the official English localization registry pinned at [`greedbest/i18n@3dadc418`](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f), and first-party provider documentation. No private Greed source, live Greed bot, or Discord guild was queried.

The guide explicitly separates one-off profile lookups from persistent feed
notifications. Issue #60 owns the former. Feed polling, reposting, custom
feed messages, role pings, and feed persistence belong to [#61](https://github.com/luinbytes/bytebot-definitive-edition/issues/61), even when the same provider appears in both slices.

## Source boundary

The pinned registry is the exact public baseline for names, descriptions, usage
examples, and user-facing message strings where a file exists. The current
guide is the stronger source for platform capability claims, prefix-only
surface notes, lookup-versus-feed separation, and public limits. Neither source
publishes a complete machine-readable slash option schema for the profile
lookups. Where a command's options are only implied by an error or usage string,
the mapping below says so explicitly; no undocumented option is treated as
Greed parity.

| Source | Evidence | Consequence |
| --- | --- | --- |
| [Social Lookups & Feeds](https://greed.best/docs/miscellaneous/socials) | Profile lookups are one-off commands; listed profiles/games include Roblox, Rolimons, Valorant, Minecraft, Spotify, GitHub, X, Instagram, League of Legends, bio profiles, and Fortnite. Feed providers and their polling intervals are described separately. | Do not persist a lookup as a feed. Implement only a provider contract that is documented and lawful for this bot. |
| [Greed English registry](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands) | English is Greed's public base locale. Relevant files are `information/github.json`, `socials/bio.json`, `instagram.json`, `pinterest.json`, `reddit.json`, `reposters.json`, `roblox.json`, `telegram.json`, `tiktok.json`, `twitter.json`, `valorant.json`, `youtube.json`, and `utility/fortnite.json`. | Preserve the exact public strings where the feature is implemented; keep premium labels out of ByteBot's entitlement policy because ByteBot has no billing system. |
| [Greed command catalog](https://greed.best/commands) | The catalog advertises arguments and permissions but is client-rendered and was not a stable machine-readable source during this freeze. | Do not infer missing option types or RBAC metadata from a rendered card. |
| [Greed homepage](https://greed.best/) | Marketing names Spotify, X, TikTok, GitHub, Roblox, Rolimons, Valorant, Fortnite, Minecraft, Reddit, YouTube, and more. | Marketing confirms product area only; it does not establish a command path, option, response, or provider implementation. |

## Exact Greed registry inventory

These are the exact names and strings in the pinned English registry. A row
marked “registry gap” is not a verified Greed slash option.

### Lookup commands in the registry

| Public path / surface | Registry evidence and options | Public messages / fields |
| --- | --- | --- |
| `/github` | [`information/github.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/information/github.json): description `View information about a GitHub user.`; the required `username` is implied by `invalidUsername`, `notFound`, and the provider's user path. Repository lookup, public-commit email lookup, and exact/partial repository matching are documented by the guide but have no separate pinned registry file or exact option schema. | Errors: `Please provide a valid GitHub username.`, `GitHub user **{{username}}** not found.`, `Failed to fetch GitHub data. Please try again later.` Fields: `Bio`, `Stats`, `Contributions ({{year}})`, `Account Created`, `Website`, `Followers`, `Following`, `Public Repos`, `Public Gists`. |
| `/roblox` | [`socials/roblox.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/socials/roblox.json): `Look up a user on Roblox`; usage `roblox (username)`; required `username`. The current guide additionally claims profile/presence, games/groups, cosmetics, and exact or partial name matching, but publishes no subcommand schema. | Errors: `No Roblox user found with that name`; `Failed to fetch Roblox user information\n-# Please try again later`; `Please provide a Roblox username\n-# Use: roblox (username)`; `This Roblox user is not in any groups`; `Roblox account linking via Discord is not available right now for {{user}}`. Fields: `Followers`, `Following`, `Friends`, `Presence ({{status}})`, `Location`, `Last Online`, `Badges ({{count}})`, `Name History`, `Unable to fetch name history`, `{{username}}'s Groups`. |
| `/valorant` | [`socials/valorant.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/socials/valorant.json): `Look up a player on Valorant`; usage `valorant (Name#Tag)`; required Riot ID with exactly one `#` separating name/tag. | Errors: `No Valorant player found with that username`; `Failed to fetch Valorant player information\n-# Please try again later`; `Please provide a Valorant username\n-# Use: valorant (Name#Tag)`; `Invalid username format\n-# Use: valorant (Name#Tag)`. Fields: `Account`, `Competitive`, `Peak Rank`, `Last Updated`. |
| `/reddit user` | [`socials/reddit.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/socials/reddit.json): root description `Get Reddit user, subreddit, or post`; usage `reddit (user\|subreddit\|post) (name or url)`; exact child usage `reddit user (username)`. Required `username`. | Errors include premium marker `This command requires **premium**\n-# Subscribe to unlock Reddit lookups`, `Please provide a Reddit username\n-# Use: reddit user (username)`, `User not found\n-# The user may not exist or their account is suspended`, and `Failed to fetch user profile\n-# Please try again later`. |
| `/reddit subreddit` | Same registry file; exact child usage `reddit subreddit (name)`. Required subreddit name. | `Please provide a subreddit name\n-# Use: reddit subreddit (name)`, `Subreddit not found\n-# The subreddit may not exist or has been banned`, `Subreddit is private or quarantined\n-# You don't have access to this subreddit`, and `Failed to fetch subreddit\n-# Please try again later`. |
| `/reddit post` | Same registry file; exact child usage `reddit post (url)`. Required Reddit post URL. | `Please provide a Reddit post URL\n-# Use: reddit post (url)`, `Post not found\n-# The post may have been deleted or removed`, `Post is private or removed\n-# You don't have access to this post`, and `Failed to fetch post\n-# Please try again later`. |
| `/pinterest` (prefix-only) | [`socials/pinterest.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/socials/pinterest.json): usage `pinterest (url)` and example `pinterest https://pinterest.com/pin/123456789`; required pin or board URL. The guide explicitly says Pinterest feed commands are prefix-only because Greed has reached Discord's slash cap; no separate lookup slash registration is evidenced. | Errors: `Please provide a Pinterest pin or board URL`; `Pin not found\nThe pin may have been deleted or is private`; `Board not found\nThe board may have been deleted or is private`; `Content not found\nThe pin or board may have been deleted or is private`; `Failed to fetch content\nPlease try again later`; `This command requires **Premium**\nGet access to Pinterest and other social commands`. |
| `/youtube` | [`socials/youtube.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/socials/youtube.json): description is `Download a YouTube video`; usage `youtube (url)`; required video URL or ID. This is a download command, not a profile lookup. YouTube feeds are separately documented as `,youtube add (channel_name) (channel)` and `,youtube live (channel_name)` under #61. | Errors: `Invalid YouTube URL\n-# Please provide a valid video URL or ID`; `Failed to fetch YouTube content\n-# Please try again later`; `Video not found or unavailable`; `Failed to download video\n-# The video may be restricted or unavailable`; `Please provide a YouTube URL\n-# Use: youtube (url)`; `Video file is too large to upload\n-# Maximum size is 100MB`; `Video is too long\n-# Maximum duration is {{max}} minutes`. |
| `/twitter user` / `/twitter tweet` | [`socials/twitter.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/socials/twitter.json) names a user lookup and a tweet lookup through errors: `twitter user (username)` and `twitter tweet (url)`. Current Greed docs call the platform X and describe one-off profile/post lookups; exact current slash nesting is a registry gap. | User errors: `User not found\n-# The user may not exist or the account is suspended`; `Failed to fetch user profile\n-# Please try again later`; `Please provide a Twitter username\n-# Use: twitter user (username)`. Tweet errors: `Invalid tweet URL or ID\n-# Please provide a valid tweet URL or ID`; `Tweet not found\n-# The tweet may have been deleted or is private`; `Failed to fetch tweet\n-# Please try again later`; `Please provide a tweet URL or ID\n-# Use: twitter tweet (url)`. |
| `/tiktok user` / `/tiktok (url)` | [`socials/tiktok.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/socials/tiktok.json) implies `tiktok (url)` and `tiktok user (username)` through `missingUrl`, `missingUsername`, and their usage text. Feed setup is separate (`tiktok add (username) (channel)`) and belongs to #61. | Errors: invalid URL, fetch failure, no data, user fetch failure, user not found, missing URL, missing username, and `{{url}}\n-# The file size exceeds Discord's upload limit for this server`. Exact field/option schema is not published. |
| `/instagram` | [`socials/instagram.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/socials/instagram.json) contains profile/post errors (`User not found. The user may not exist or the account is private.`, `Post not found. The post may not exist or has been deleted.`, `Rate limited by Instagram. Please try again later.`, `Failed to fetch Instagram data. Please try again later.`) and separately contains only feed setup placeholders. The guide says Instagram lookup needs no permissions, but does not publish syntax. Treat exact options as a registry gap and do not use private scraping. | Lookup errors above. Feed placeholder messages (`Instagram repost setup command scaffolded...`, remove/list/variables/message/messageView) are #61 evidence, not an implemented lookup contract. |
| `/telegram` | [`socials/telegram.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/socials/telegram.json) is an avatar-history response catalog, not a usage schema. The title is `Avatar history — @{{username}}`, and its description is `[@{{username}}](https://t.me/{{username}}) has **{{count}}** profile photo(s).` The exact command path/options are a registry gap. | Errors: invalid username (5–32 letters/numbers/underscores), user not found, public channel not found, no profile photos, and avatar download failure. |
| `/bio guns` / `/bio haunt` | [`socials/bio.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/socials/bio.json): root `Look up bio profiles from guns.lol`; `bio guns (query) [username\|alias\|uid]`, `bio haunt (query) [username\|uid]`; query must be one word, optional lookup kind is username/alias/uid. `haunt leaderboard` has no arguments. | Exact errors: missing query, single-word validation, numeric UID validation, user not found, fetch failure, and `*No leaderboard data available*` / leaderboard fetch failure. Provider terms/API contract was not evidenced in first-party documentation during this freeze; implementation remains blocked until one is found. |

### Registry surfaces that belong to #61

| Public path | Exact evidence |
| --- | --- |
| `/reposters add` | [`socials/reposters.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/socials/reposters.json): `reposters add (platform) (#channel)`; enables auto-reposting; success `Added reposter for {{platform}} in {{channel}}`. |
| `/reposters remove` | `reposters remove (platform) (#channel)`; success `Removed reposter for {{platform}} in {{channel}}`; bounded selection and no-reposter errors. |
| `/reposters list` | `reposters list`; title `Reposters`; empty message `No reposters found for this server`. |
| `/reposters prefix` | `reposters prefix (on\|off)`; success `Prefix reposting has been turned {{state}}`; invalid/missing state error is exact. |
| `/reposters customprefix` | `reposters customprefix (prefix)`; success `Custom prefix set to **{{prefix}}**`, reset string, premium marker, and 10-character maximum. |
| `/reposters clear` | `reposters clear`; success `Cleared all reposters for this server`. |
| `/repost` | URL-only post repost; supported platforms in the registry are Instagram, TikTok, and Twitter/X. Profile/username lookups are explicitly unsupported. |
| Feed platform paths | Guide syntax: `,tiktok add (username) (channel)`, `,instagram add (username) (channel)`, `,twitch add (login) (channel)`, `,youtube add (channel_name) (channel)`, `,x add (handle) (channel)`, `,pinterest add (username) (channel) [board]`, `,soundcloud add (artist) (channel)`, and `,kicklive add (channel_name) (channel)`. All feed persistence/polling/custom messages are #61. |

### Guide-only lookup claims with no exact registry path

The current guide has sections for Rolimons, Minecraft, Spotify, League of
Legends, and some additional profile features, but the pinned English registry
has no corresponding `rolimons.json`, `minecraft.json`, `spotify.json`, or
`leagueoflegends.json`. It also does not publish exact command options for
these sections. The implementation must not invent `/rolimons`, `/minecraft`,
`/spotify`, or `/lol` option schemas and call them exact Greed parity. The
guide's documented capability claims are still recorded in the provider matrix
below so a later credentialed/provider-approved slice can resume from them.

## Provider feasibility and lawful access

“Keyless” below means the bot can use a provider-owned, documented endpoint
without a user token, API key, cookie, or scraping. A provider's public website
or an undocumented JSON endpoint is not a keyless API contract.

| Provider / Greed capability | First-party contract | Keyless result and blocker |
| --- | --- | --- |
| GitHub profile, repository, and public commit email | [Get a user](https://docs.github.com/en/rest/users/users), [search repositories](https://docs.github.com/en/rest/search/search#search-repositories), and [search commits](https://docs.github.com/en/rest/search/search#search-commits) accept unauthenticated requests for public data. GitHub documents `author-email` as a commit-search qualifier. [REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) state unauthenticated core requests are 60/hour per originating IP and search uses a separate, lower bucket. | **Implementable keyless.** Expose separate user, repository, and public-commit-email paths; use only public fields, identify the bot with `Accept`, `User-Agent`, and API-version headers, cap searches at five results, cache briefly, bound one request per invocation, and return explicit 404/inaccessible/rate-limit/provider errors. GitHub's contribution calendar is not available from these keyless REST paths and remains an explicit field-level blocker. |
| Roblox profile, games, groups, and outfits | Roblox's official [Users reference](https://create.roblox.com/docs/cloud/reference/features/users), [Games reference](https://create.roblox.com/docs/cloud/reference/domains/games), [Groups reference](https://create.roblox.com/docs/cloud/reference/domains/groups), and [Avatar reference](https://create.roblox.com/docs/cloud/reference/domains/avatar) list unauthenticated (`Cookie None`) legacy endpoints for username resolution, public user/profile counts and presence, user-created games, group roles, avatar details, and outfits. Roblox warns in its [Cloud API reference](https://create.roblox.com/docs/cloud) that legacy APIs may break without notice and have minimal stability guarantees; stable Open Cloud APIs use API keys or OAuth. | **Implementable only as a bounded legacy-keyless adapter.** Split profile, games, groups, and outfits into separate paths so each invocation has one username-resolution request followed by a small fixed provider chain. Cap returned collections at five, never paginate upstream, and do not add cookies, `.ROBLOSECURITY`, or undocumented scrapers. Distinguish not-found, private/deleted/inaccessible, provider error, rate-limited, and malformed responses. |
| Rolimons | Rolimon's [Terms and Privacy](https://www.rolimons.com/termsandprivacy) prohibit scraping/systematic collection, automated tools, public redistribution, and use of its data to create/support a competing service; the restrictions explicitly cover its APIs. | **Blocked.** The Greed capability (“item values and trading stats”, requiring a Roblox username and 7/30/90-day charts) cannot be reproduced through Rolimons data without prior written permission or a licensed API contract. Do not use site scraping, community mirrors, or an assumed API key. |
| Valorant | Riot's [Valorant developer policy](https://developer.riotgames.com/docs/valorant) requires product registration, and its documented APIs are under the Riot Developer Portal. Riot's [portal/rate-limit documentation](https://developer.riotgames.com/docs/portal) requires API keys and says personal keys are not for public consumption; the Valorant page says VALORANT apps must use RSO opt-in for personal data and production-level access. | **Blocked keyless.** A public bot cannot lawfully make anonymous player/rank/match calls. Keep the exact `Name#Tag` validator and explicit `provider credentials unavailable` diagnostic, but do not ship a fake result or a third-party scraper. Reopen only with a registered production key, RSO/privacy flow, and approved product terms. |
| Fortnite | Epic's official [Fortnite Data API](https://dev.epicgames.com/documentation/en-us/fortnite/using-fortnite-data-api-in-fortnite) is public and unauthenticated, but only exposes aggregate island-performance metrics (minutes played, plays, favorites, recommends, peak CCU, unique players, retention) over bounded windows; it expressly shares no personal player information and has basic rate limiting. The pinned [`utility/fortnite.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/utility/fortnite.json) instead names `login`, `unadd`, `compose`, `equip`, `spoof`, `locker`, `summary`, `humans`, `map`, `news`, `view`, and `remind` actions. | **Only aggregate island metrics are keyless.** They do not establish Greed's account/cosmetic/map/shop/news commands. Those registry actions require Epic-account/OAuth or an undocumented provider, so keep them blocked pending exact first-party credentials/terms. Do not claim the public Data API implements `locker`, `summary`, `equip`, or `spoof`. |
| Minecraft | First-party Minecraft/Microsoft pages document account sign-in and Java/Bedrock product use, while Microsoft Learn's Minecraft references document in-game/Bedrock scripting, not a public Java profile or server-status HTTP API. The Greed guide claims Java skins and server info (Bedrock excluded; server query enabled), but publishes no command schema. | **Blocked as exact keyless parity.** Do not use undocumented Mojang endpoints, third-party profile APIs, DNS/SRV probes, or server scraping as an official contract. A future slice needs a provider-owned documented API and terms; until then return an explicit unsupported/provider-contract diagnostic. |
| Spotify | Spotify's [oEmbed API](https://developer.spotify.com/documentation/embeds/reference/oembed) accepts a URL for an artist, album, track, show, or episode and returns title/thumbnail/embed metadata without a Web API token. Spotify states in its [Web API call guide](https://developer.spotify.com/documentation/web-api/concepts/api-calls) that all Web API requests require authorization; [Get Track](https://developer.spotify.com/documentation/web-api/reference/get-track) is OAuth 2.0, and [rate limits](https://developer.spotify.com/documentation/web-api/concepts/rate-limits) are rolling-window based. | **Metadata preview only is keyless.** A URL-only oEmbed preview can be a ByteBot-owned `/spotify preview` utility if the command is explicitly described as a framework extension; it cannot claim exact Greed search, artist/album top-result, audio preview, or playback parity. Search/track metadata/preview URLs need an app credential/token and Spotify attribution/policy compliance. No exact Spotify registry path exists in the pinned snapshot. |
| Reddit | Reddit's current [Data API wiki](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki) requires OAuth and a registered OAuth token; it warns unauthenticated users can be freely throttled or blocked and requires a descriptive User-Agent. Reddit's [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy) says API access requires explicit approval. | **Blocked keyless.** Public subreddit pages/`.json`, HTML scraping, and third-party mirrors are not a lawful substitute for approved OAuth Data API access. The registry's exact premium error is retained as source evidence, but ByteBot must not gate on billing; it should instead report provider credentials/approval unavailable. |
| YouTube | YouTube's [Data API reference](https://developers.google.com/youtube/v3/docs) requires every request to provide an API key or OAuth token; its [getting-started guide](https://developers.google.com/youtube/v3/getting-started) gives a default 10,000-unit/day project quota and charges all requests. The official [IFrame Player API](https://developers.google.com/youtube/iframe_api_reference) supports playback/embedding, not server-side downloads. | **No keyless Data API/download parity.** An API key can support bounded public metadata/feeds after terms and quota setup; OAuth is required for private/user data. Do not implement the registry's “download a YouTube video” via scraping or downloader libraries: the official surface supplied here is embed/playback, and the provider contract does not authorize a bot to download arbitrary audiovisual content. |
| X/Twitter | X's official API tools show v2 user/post calls require a bearer token; [X response/rate-limit guidance](https://developer.x.com/en/support/twitter-api/error-troubleshooting) states rate limits are app/user based and access plans apply. | **Blocked keyless.** The exact registry user/tweet strings can be retained, but no anonymous public API call or web scraping is permitted for parity. Feed polling/repost behavior is #61 and also requires an approved X API plan/token. |
| TikTok | TikTok's [Display API getting-started guide](https://developers.tiktok.com/doc/display-api-get-started) requires a developer account, approved Login Kit/API products, scopes, and user authorization. [User access-token guidance](https://developers.tiktok.com/docs/en/login-kit-manage-user-access-tokens) says `user.info.basic` and `video.list` are granted via user access tokens. | **Blocked keyless.** The registry's URL/user lookup and feed behavior cannot use logged-out scraping. Reopen with an approved TikTok app, consent flow, scopes, token storage, and terms review. |
| Instagram | Meta's official Instagram API is for professional accounts and requires Meta app/access-token permissions; the first-party collection documents `instagram_basic`/business scopes and says consumer accounts are not accessible. The API's profile endpoint uses an Instagram-scoped ID received from a webhook, not arbitrary username search. | **Blocked for Greed's broad keyless lookup claim.** The guide says lookup needs no permissions, but the provider-owned contract does not support anonymous arbitrary consumer profile lookup. Do not scrape Instagram or use session cookies. Feed setup remains #61 and requires provider approval/tokens if implemented. |
| Telegram | The official [Bot API](https://core.telegram.org/bots/api) is a bot-authenticated interface. It does not publish an anonymous public username/profile-history API; `getUserProfilePhotos` requires a bot token and a user ID. | **Blocked as anonymous lookup.** A bot token could support only users/channels accessible to that Telegram bot and does not establish the registry's arbitrary username/avatar-history contract. Keep the exact error strings, but do not probe `t.me` pages or use MTProto user scraping. |
| guns.lol / haunt.gg | The Greed registry names these as bio profile sources but no provider-owned public API/terms were found in this freeze. | **Blocked pending first-party contract.** Do not scrape profile pages or assume JSON endpoints. |

## ByteBot command and category mapping

The existing bot's command discovery uses category modules rather than Greed's
prefix tree. Keep this slice under the existing `Information`/`Games`/`Utility`
categories rather than creating one top-level command per provider:

- `Information`: GitHub, Reddit, X, Instagram, TikTok, Telegram, bio profiles,
  and provider metadata lookups.
- `Games`: Roblox, Valorant, Minecraft, Fortnite, and Rolimons where a lawful
  provider contract exists.
- `Utility`: URL-only previews or bounded one-off media actions that are not
  profile lookups. The Greed `/fortnite` utility file is an account/action
  family, not permission to expose account mutations in a lookup command.

Discord application commands permit only 25 top-level options. Use one small
lookup hub with a provider discriminator and provider-specific typed options,
or reuse the bot's existing `information` and `games` hubs if their current
registries already reserve the names. Provider names and option names must be
validated before network access. A blocked provider should still display in
help only as unavailable/credential-gated, never as a fake successful command.

RBAC is member-accessible for read-only lookups; it must not grant any provider
account action or imply a Discord permission. Feed/reposter mutations and
target-channel changes remain #61 and require the existing server-management
RBAC plus bot send/embed permissions in the target channel.

## Error and safety contract

For an implementable provider, map failures to stable user-visible classes:

1. invalid input (username/URL/Riot ID/unsupported kind);
2. provider not found, private, deleted, suspended, or inaccessible;
3. provider rate limit/quota with a bounded retry hint when the provider
   supplies one;
4. provider authentication/approval/credential missing; and
5. provider unavailable or malformed response.

Never distinguish a private account from a deleted account when the provider
does not, never expose provider tokens or cookies, and never silently fall back
to an unrelated scraped source. Network requests use the existing outbound
HTTP trust boundary: HTTPS, public-address validation, timeout, response-size
bound, redirect policy, and one bounded request chain per invocation.

## Implementation gate

Issue #60 may implement only these provider paths from this freeze:

- GitHub public user profile, repository search, and public-commit email search
  using the documented unauthenticated REST paths. Contribution-calendar data
  remains blocked because the keyless REST contract does not expose it.
- Roblox public profile/presence, user-created games, groups, and outfits through
  the documented keyless legacy endpoints, with the stability caveat and bounded
  per-command adapters above.
- A ByteBot-owned URL metadata preview for Spotify only if its command is
  explicitly not represented as exact Greed search/audio-preview parity.
- Fortnite aggregate island metrics only if a concrete command path is added as
  a framework extension; the pinned Greed command file does not define one.

Rolimons, Valorant, Minecraft, Spotify Web API search/audio previews, Reddit,
YouTube downloads, X, TikTok, Instagram, Telegram, and bio-provider scraping
are blocked by credentials, approval, provider terms, or missing exact public
contracts. Do not weaken these blockers to make a test or a parity checklist
look green. Feed/reposting work is explicitly deferred to #61.
