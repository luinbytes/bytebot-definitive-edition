# Greed social feeds and reposting contract

Issue: [#61](https://github.com/luinbytes/bytebot-definitive-edition/issues/61)

Parent: [#33](https://github.com/luinbytes/bytebot-definitive-edition/issues/33)

Research frozen: 2026-08-25

This is the implementation gate for Greed's persistent social feeds, social
reposting, custom feed messages, and feed role mentions. It records what can be
proved from Greed's public documentation and pinned English localization, then
separates that evidence from provider-owned API and terms constraints. No
private Greed source, live Greed bot, Discord guild, provider cookie, or
credential was used.

Issue #60 owns one-off information and game lookups. A lookup must not create a
persistent feed. This issue owns the feed/reposter lifecycle only.

## Source boundary

The live Greed guide is authoritative for feed names, syntax examples, surface
availability, intervals, caps, variables, and behavior it explicitly describes.
The pinned English registry is authoritative for exact names, descriptions,
usage text, and response strings where a file exists. The public command
catalog is client-rendered and does not expose a stable complete registration
payload, option types, or per-command permissions. Missing details stay
unknown; they are not inferred from the screenshot, marketing copy, or a
third-party scraper.

| Source | What it proves | Boundary |
| --- | --- | --- |
| [Greed Social Lookups & Feeds](https://greed.best/docs/miscellaneous/socials) | Eight feed providers; prefix syntax; platform intervals and caps; feed variables; custom templates; role pings; account deletion/private behavior; dashboard and slash-cap notes. | It does not publish full slash JSON, exact subcommand option types, persistence schema, retries, or all RBAC defaults. |
| [Greed command catalog](https://greed.best/commands) | Public command/category discovery surface. | The rendered page is not a stable machine-readable registration contract. |
| [Pinned `greedbest/i18n` English directory](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/socials) | The public English strings for `reposters`, TikTok, Instagram, X/Twitter, Pinterest, and YouTube. | There are no English feed JSON files for Twitch, SoundCloud, or Kick in this snapshot; setup placeholders are not proof of a completed implementation. |
| [Greed command permissions](https://greed.best/docs/configuration/command-permissions) | Greed administrators can disable commands, whitelist members, and restrict commands to roles. | It does not establish the default permission for each social feed command. |
| [Greed dashboard](https://greed.best/dashboard) | Dashboard is a supported configuration surface; the social guide specifically names it for Pinterest, SoundCloud, and Kick. | Login-only dashboard controls and request payloads are not public evidence. |

## Greed feed parity matrix

The command examples below use Greed's documented comma prefix. A row's
“exact” syntax is exact public documentation; bracketed values and option
types that are not published remain an evidence gap.

| Provider | Greed feed behavior | Exact command/surface evidence | Interval and cap | Stable-source and delivery rules | Evidence gaps |
| --- | --- | --- | --- | --- | --- |
| TikTok | New creator video/photo uploads. | `,tiktok add (username) (channel)`; slash and prefix are both documented for this feed. | New posts every 20 seconds; up to 10 creators per server. | Bot must send in target channel. Deleted or suspended creator stops the feed. | Exact remove/list/message/ping syntax and slash option schema are not published. |
| Instagram | New account uploads, with optional live announcements. | `,instagram add (username) (channel)`; slash and prefix. Alias: `,ig`. | Posts every 2 minutes; live status at most every 10 minutes; up to 10 accounts per server. | Feed management explicitly requires Manage Server. Private accounts cannot be tracked; Greed says it sees only logged-out-visible data. | Live toggle command, remove/list/message/ping syntax, and slash schema are not published. |
| Twitch | Live alerts for a channel. | `,twitch add (login) (channel)`; optional `,twitch ping (login) [role]`; slash and prefix. | Live status every minute. | Deleted/private channel stops alerts; bot must send in target channel. | Exact list/remove/message syntax and whether the optional role is a role option or mention parser are not published. |
| YouTube | New uploads and live streams. | `,youtube add (channel_name) (channel)`; `,youtube live (channel_name)` for separate live announcements; slash and prefix. | Uploads every 2 minutes; live streams every 5 minutes. | Accepts `@handle`, channel ID, or URL. Channel must be public; deleted/private channel stops feed; bot must send in target channel. | Exact live `on/off` grammar is only shown in the template section (`...,youtube live (channel_name) on`); full slash schema is not published. |
| X/Twitter | New original posts, self-replies, and optional reposts. | `,x add (handle) (channel)`; repost toggle `,x reposts (handle) off`; slash and prefix. | Checks every 3 minutes. | Reposts are on by default and labeled. Replies to other accounts are excluded; self-replies are included. Greed follows numeric account ID so handle changes do not break a feed. Protected accounts cannot be followed. | Exact `on` grammar, list/remove/message/ping syntax, and slash schema are not published. |
| Pinterest | New pins from all boards or one selected board. | `,pinterest add (username) (channel) [board]`; prefix/dashboard only because Greed says it has reached Discord's slash cap. | Checks every 3 minutes. | Omitting board follows everything the account saves. Saving another person's pin counts as a new pin. Feed follows username because Greed says Pinterest has no ID lookup; a rename silently stops the feed. | Exact board option type, list/remove/message syntax, and dashboard payload are not published. |
| SoundCloud | New artist tracks. | `,soundcloud add (artist) (channel)`; alias `,sc`; accepts profile name or full profile link; prefix/dashboard only. | Checks every 3 minutes. | Feed follows numeric artist ID, so rename does not break it. Private tracks are never posted. | Exact list/remove/message syntax, slash registration (none evidenced), and dashboard payload are not published. Provider terms explicitly block Discord bots; see provider matrix. |
| Kick | Live alerts. | `,kicklive add (channel_name) (channel)`; alias `,kickalerts`; prefix/dashboard only because `,kick` is the moderation command. | Checks every minute. | Each broadcast is announced once. A stopped-and-restarted stream is a new broadcast; a brief Kick connection drop must not re-announce the same stream. | Exact event subscription, list/remove/message syntax, and dashboard payload are not published. Provider terms constrain redistribution; see provider matrix. |

Greed states that each platform allows up to 10 feeds per guild per platform.
The TikTok and Instagram sections repeat the same cap using “creators” or
“accounts”. This is a guild/provider cap, not permission to create unlimited
provider requests.

### Greed custom messages and variables

Every social feed accepts a custom notification template through the
`,<platform> message` family.
Greed's guide says a template that renders no text, embeds, or components
falls back to the built-in layout. The source does not publish a complete
parser grammar or command option schema. The variable names below are exact
public documentation.

| Provider | Exact variables documented by Greed |
| --- | --- |
| Instagram | `{instagram.url}` (required), `{instagram.caption}`, `{instagram.id}`, `{instagram.created}`, `{instagram.likes}`, `{instagram.comments}`, `{instagram.type}` (`image`, `video`, `carousel`), `{instagram.media}`, `{instagram.creator}`, `{instagram.creator.url}`, `{instagram.creator.avatar}` |
| Twitch | `{twitch.url}`, `{twitch.title}`, `{twitch.category}`, `{twitch.game}` (alias), `{twitch.viewers}`, `{twitch.started}`, `{twitch.thumbnail}`, `{twitch.id}`, `{twitch.creator}`, `{twitch.creator.name}`, `{twitch.creator.url}` |
| YouTube upload | `{youtube.url}`, `{youtube.title}`, `{youtube.description}` (first 5000 characters), `{youtube.id}`, `{youtube.thumbnail}`, `{youtube.published}`, `{youtube.type}` (`short` or `video`), `{youtube.creator}`, `{youtube.creator.url}` |
| YouTube live | `{youtube.url}`, `{youtube.title}`, `{youtube.description}` (always empty), `{youtube.id}`, `{youtube.thumbnail}`, `{youtube.published}` (always empty), `{youtube.type}` (`live`), `{youtube.viewers}`, `{youtube.creator}`, `{youtube.creator.url}`. URL, thumbnail, and ID may be empty when a stream starts. |
| TikTok | `{tiktok.url}`, `{tiktok.caption}`, `{tiktok.id}`, `{tiktok.created}`, `{tiktok.likes}`, `{tiktok.comments}`, `{tiktok.plays}`, `{tiktok.shares}`, `{tiktok.type}` (`photo` or `video`), `{tiktok.creator}`, `{tiktok.creator.name}`, `{tiktok.creator.url}`, `{tiktok.creator.avatar}` |
| X | `{x.url}`, `{x.text}`, `{x.id}`, `{x.media}`, `{x.published}`, `{x.type}` (`post`, `repost`, `reply`), `{x.likes}`, `{x.reposts}`, `{x.replies}`, `{x.creator}`, `{x.creator.handle}`, `{x.creator.url}`, `{x.creator.avatar}`, `{x.creator.verified}` |
| Pinterest | `{pinterest.url}`, `{pinterest.title}`, `{pinterest.id}`, `{pinterest.image}`, `{pinterest.published}`, `{pinterest.creator}`, `{pinterest.creator.handle}`, `{pinterest.creator.url}` |
| SoundCloud | `{soundcloud.url}`, `{soundcloud.title}`, `{soundcloud.description}`, `{soundcloud.id}`, `{soundcloud.artwork}`, `{soundcloud.duration}`, `{soundcloud.plays}`, `{soundcloud.likes}`, `{soundcloud.published}`, `{soundcloud.creator}`, `{soundcloud.creator.handle}`, `{soundcloud.creator.url}` |
| Kick | `{kick.url}`, `{kick.title}`, `{kick.category}`, `{kick.viewers}`, `{kick.started}`, `{kick.thumbnail}`, `{kick.language}`, `{kick.creator}`, `{kick.creator.name}`, `{kick.creator.url}` |

The role-ping syntax is `,<platform> ping (target) (role)`. Greed prepends
`<@&role_id>` before the rendered message, including before fallback content,
and says it configures `allowedMentions` accordingly. Mention behavior must be
explicit in ByteBot; never pass provider text through with unrestricted
mentions.

Greed's template reference documents `{title: ...}`, `{description: ...}`,
`{color: #hex}`, `{image: url}`, `{embed}`, `{field: Name && Value && inline}`,
`{button: label: Watch && url: https://...}`, and `{if condition}...{/if}`.
Those scripting forms belong to the existing rich-content contract; this issue
must not create a second template language.

## Pinned English registry: exact reposter surfaces

The pinned files are the public string contract, not proof that every name is a
registered slash command. Links point to the exact immutable commit.

### `reposters`

Source: [`socials/reposters.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/socials/reposters.json).

| Path | Exact public description/usage | Exact success and error strings |
| --- | --- | --- |
| `reposters` | Description: `Manage social media reposters`; usage/example: `reposters`. Help: `Use \`reposters add (platform) (#channel)\` to enable auto-reposting\n-# Available subcommands: add, remove, list, prefix, customprefix, clear`. | — |
| `reposters add` | `Enable auto-reposting for a platform in a channel`; usage `reposters add (platform) (#channel)`; example `reposters add tiktok #channel`. | Success `Added reposter for {{platform}} in {{channel}}`; errors `Invalid platform!\n-# Must be one of: {{platforms}}`, `Channel not found\n-# Provide a valid channel mention, ID, or name`, `Database is currently unavailable`, `Failed to add reposter`. |
| `reposters remove` | `Disable auto-reposting for a platform or channel`; usage `reposters remove (platform) (#channel)`; example `reposters remove tiktok #channel`. | Success `Removed reposter for {{platform}} in {{channel}}`; errors `No reposters to remove!`, `Invalid selection!\n-# Choose between 1 and {{max}}`, `Channel not found\n-# Provide a valid channel mention, ID, or name`, `Database is currently unavailable`, `Failed to remove reposter`. |
| `reposters list` | `View all active social media reposters`; usage/example `reposters list`; title `Reposters`. | Errors `No reposters found for this server`, `Database is currently unavailable`, `Failed to fetch reposters`. |
| `reposters prefix` | `Toggle greed branding on auto-reposts`; usage `reposters prefix (on\|off)`; example `reposters prefix on`. | Success `Prefix reposting has been turned {{state}}`; missing/invalid state `Please specify 'on' or 'off'\n-# Use: reposters prefix (on\|off)`; database/generic errors as above, with `Failed to update prefix setting`. |
| `reposters customprefix` | `Set a custom prefix for auto-reposts`; usage `reposters customprefix (prefix)`; example `reposters customprefix !`. | Success `Custom prefix set to **{{prefix}}**`; reset `Custom prefix has been reset to default`; errors `Custom prefix is a **premium** feature`, `Prefix must be **10 characters** or less`, `Database is currently unavailable`, `Failed to update custom prefix`. |
| `reposters clear` | `Remove all auto-reposters from this server`; usage/example `reposters clear`. | Success `Cleared all reposters for this server`; errors `Database is currently unavailable`, `Failed to clear reposters`. |

The registry does not define the complete `{{platforms}}` expansion, whether
an auto-reposter watches external provider feeds or reposts links found in
Discord messages, or whether add accepts a source account. The example proves
`tiktok` is accepted, but it does not prove an exhaustive platform list. Do
not silently turn `reposters add` into the separate account-feed command.

### One-off `repost`

The same file defines `repost` as `Repost a social media post from a link`.
Its exact errors are:

- `Please provide a valid URL\n-# Example: repost https://www.tiktok.com/@user/video/123`
- `Unsupported URL\n-# Supported platforms: Instagram, TikTok, Twitter/X`
- `Please provide a post/video URL\n-# Profile or username lookups are not supported in this command`
- `That platform repost command is currently unavailable`

This is a URL-only post command, not a profile lookup. The registry does not
define media download behavior, attribution, attachment limits, or an exact
slash option name. The lawful ByteBot baseline is to validate the canonical
provider URL and post the link/Discord unfurl; copying provider media requires
an approved provider contract and rights review.

### Provider-specific registry files

The pinned English snapshot has no completed feed command file for Twitch,
SoundCloud, or Kick. The TikTok and Instagram files contain setup placeholders,
which must not be presented as working Greed behavior:

- TikTok: `TikTok repost setup command scaffolded for \`@{{username}}\` in {{channel}}.`, `TikTok repost remove command scaffolded for \`@{{username}}\`.`, `TikTok repost list command scaffolded.`, `TikTok repost variables command scaffolded.`, `TikTok repost message command scaffolded for \`@{{username}}\`.`, and `TikTok repost message view command scaffolded for \`@{{username}}\`.`
- Instagram: analogous setup strings beginning `Instagram repost ... command scaffolded` in [`socials/instagram.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/socials/instagram.json).

The exact provider errors in the pinned files are still useful diagnostics:

- TikTok [`socials/tiktok.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/socials/tiktok.json): invalid URL, fetch failure, no data, user fetch failure, user data failure, missing URL/username, and `{{url}}\n-# The file size exceeds Discord's upload limit for this server`.
- Instagram [`socials/instagram.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/socials/instagram.json): `User not found. The user may not exist or the account is private.`, `Post not found. The post may not exist or has been deleted.`, `Rate limited by Instagram. Please try again later.`, and `Failed to fetch Instagram data. Please try again later.`

## Surface and slash-command contract

Greed says Pinterest, SoundCloud, and Kick are prefix-only because it is at
Discord's 100 slash-command cap; it says those three are also configurable in
the dashboard. Every other feed provider is described as available through
both slash and prefix surfaces. Greed's documented prefix is `,`.

The public sources do not show a complete slash registration. Therefore:

| Surface | Public Greed evidence | ByteBot implementation boundary |
| --- | --- | --- |
| Slash | TikTok, Instagram, Twitch, YouTube, and X feeds are said to work on both surfaces. Exact slash roots/subcommands/options are not published. | Use one grouped command to stay within Discord's cap. A minimal candidate is `/feed add|remove|list|message|view|ping|reposts`, with `provider`, `account`, `channel`, optional `board`, `role`, and `enabled` options. This is ByteBot-owned routing, not a claim that Greed registers this shape. |
| Prefix | Exact Greed examples are `,tiktok`, `,instagram`/`,ig`, `,twitch`, `,youtube`, `,x`, `,pinterest`, `,soundcloud`/`,sc`, and `,kicklive`/`,kickalerts`; `,kick` remains moderation. | Preserve aliases only where the existing prefix dispatcher supports them; never make `,kick` ambiguous. |
| Dashboard | Greed names the dashboard for Pinterest, SoundCloud, and Kick and links a generic dashboard from the docs. | ByteBot has no public web dashboard in this repository. Do not claim dashboard parity; expose the same state through slash/prefix list/view commands. |
| Reposters | `reposters add|remove|list|prefix|customprefix|clear` and `repost` are proven by the pinned file, but not guaranteed slash registrations. | Group under one ByteBot `/reposters` root and one `/repost url` or `/repost link` path; retain exact displayed strings where compatible. |

For the current repository's command layout, the smallest fit is a Utility
command module with `sourceCategories: ['Socials', 'Utility']`; the Greed
ledger advances Socials while the existing help surface remains stable. A new
runtime help category is not justified by public Greed evidence. Feed and
reposter state must remain guild-scoped and guild-only for mutations.

## RBAC and Discord permission evidence

Greed explicitly says Instagram feed management requires Manage Server. It
also explicitly requires the bot to send in TikTok, Twitch, and YouTube target
channels. Its command-permissions guide says Administrator controls command
disable/restrict/whitelist, but does not publish defaults for these social
commands. The following is therefore the ByteBot policy, not an invented Greed
permission claim:

| Action | ByteBot policy | Reason/evidence |
| --- | --- | --- |
| Add/remove/clear feed or reposter | Guild-only; invoking member needs real Discord `ManageGuild`; path-aware ByteBot RBAC may narrow but never elevate. | Greed's Instagram evidence says Manage Server; feed state changes are server configuration. |
| List/view current server feeds | Guild-only; member-readable by default, subject to path-aware RBAC. | Greed publishes list as a management surface but does not state a permission. |
| Set message, prefix, role ping, X repost toggle, YouTube live toggle | `ManageGuild`; validate stored template and target at write time. | These mutate server notification behavior; exact Greed defaults are not public. |
| Bot delivery | Target channel must permit the bot `ViewChannel`, `SendMessages`, and `EmbedLinks`; add `SendMessagesInThreads` for thread targets. | Greed explicitly requires send-message access; Discord permission checks are authoritative. |
| Role ping | Default `allowed_mentions: { parse: [] }`; allow only the configured role ID after validating the role and Discord mentionability/`MentionEveryone` requirements. | Greed says role ID is prepended and `allowedMentions` is configured; Discord documents role mention rules. |
| Webhook identity/mirroring | Only if separately enabled and the bot has `ManageWebhooks`; keep a bot-authored fallback. | Discord requires Manage Webhooks to create/manage channel webhooks, and webhook authorship is distinguishable by `webhook_id`. Social feeds do not prove Greed uses webhooks. |
| Provider credential setup | Never accept secrets in a Discord command. Store only through the deployment's secret/configuration path and redact diagnostics. | Provider contracts require app credentials/tokens; Discord messages are not a secret store. |

Greed's premium marker on `customprefix` is a product/entitlement claim. This
ByteBot has no billing or Greed entitlement service, so it must not create a
fake premium gate. Either expose the bounded setting to all eligible guild
admins or record it as an explicit provider/product decision; do not claim
Greed's paid tier has been reproduced.

Discord's webhook API permits per-message `username` and `avatar_url`, but the
resulting author is the webhook, not the original provider or Discord user.
If a future repost implementation uses this visual customization, it must
label the behavior honestly, sanitize mentions, prevent webhook replay loops,
and retain a kill switch/audit record. Link reposting does not need webhook
identity and should use normal bot sends where possible.

## Provider-owned API, terms, and feasibility matrix

“Keyless” means an unauthenticated, provider-documented endpoint that permits
the required data use. A public website, an undocumented JSON endpoint, a
browser cookie, `.ROBLOSECURITY`, or a scraped HTML page is not a keyless API.

| Provider | First-party API contract | Rate/push constraints relevant to Greed | Current lawful result |
| --- | --- | --- | --- |
| TikTok | [Display API overview](https://developers.tiktok.com/docs/en/display-api-overview) exposes `/v2/user/info/`, `/v2/video/list/`, and `/v2/video/query/`. [Get Started](https://developers.tiktok.com/docs/en/display-api-get-started) requires a TikTok developer account, approved Login Kit/API products, user authorization, and `user.info.basic` + `video.list` scopes. The list API returns the authorized user's recent videos; it is not an anonymous arbitrary-creator feed API. | [Rate limits](https://developers.tiktok.com/docs/en/tiktok-api-v2-rate-limit) list 600 requests/minute per Display endpoint and HTTP 429 `rate_limit_exceeded`. [Login token guidance](https://developers.tiktok.com/docs/en/oauth-user-access-token-management) says access tokens expire in 24 hours and refresh tokens are used to renew them. | **Blocked keyless.** Reopen only with an approved app, consent/token storage, refresh handling, and a provider-approved use for tracking the account. Do not scrape logged-out TikTok or download arbitrary media. TikTok's [developer guidelines](https://developers.tiktok.com/docs/en/our-guidelines-developer-guidelines) require app review, copyright preservation, user control, and respect for throttling. |
| Instagram | Meta's [Instagram API overview](https://developers.facebook.com/docs/instagram-api/overview/) and [Instagram API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/) describe authenticated app access for professional accounts, access tokens, and approved permissions. [Webhooks](https://developers.facebook.com/docs/instagram-api/guides/webhooks/) are the provider-owned event path where available. | Meta's quotas and rate limits are app/account/token dependent; do not invent a polling interval or anonymous endpoint. Treat 429/permission/token errors as provider diagnostics and back off. | **Blocked keyless for Greed's broad username claim.** The public guide's “no permissions” lookup statement does not authorize anonymous consumer-account scraping. Reopen with a registered Meta app, professional-account scope, consent/token lifecycle, webhook/API terms review, and an explicitly supported account model. |
| Twitch | [Helix API guide](https://dev.twitch.tv/docs/api/guide/) requires an app access token or user access token and `Client-Id`. [Get Streams](https://dev.twitch.tv/docs/api/reference#get-streams) supplies live status; [Get Users](https://dev.twitch.tv/docs/api/reference#get-users) resolves login to numeric broadcaster ID. [EventSub](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/) provides `stream.online` and `stream.offline`; those subscription types need no user scope, while webhook creation uses an app access token per [Managing subscriptions](https://dev.twitch.tv/docs/eventsub/manage-subscriptions/). | Twitch documents per-client-ID rate limiting in its [API concepts](https://dev.twitch.tv/docs/api/guide/). EventSub is preferable to polling for live transitions. Keep Greed's one-minute poll only as a bounded fallback after credentials exist. | **Credentialed, conditionally implementable.** No secret is present in this repo. An implementation needs app registration, encrypted token/config storage, numeric-ID resolution, EventSub webhook verification, dedup by stream ID, and explicit provider terms/branding review. |
| YouTube | [YouTube Data API getting started](https://developers.google.com/youtube/v3/getting-started) requires a Google project/API enablement and API key or OAuth. [Channels](https://developers.google.com/youtube/v3/docs/channels) supports public channel metadata and upload playlist resolution. [Push notifications](https://developers.google.com/youtube/v3/guides/push_notifications) provide provider-hosted PubSubHubbub/WebSub notifications for channel uploads and updates. | Default project allocation is 10,000 units/day for most endpoints; every request consumes quota, and `search.list` has a distinct high cost/bucket. WebSub reduces upload polling; live status still needs a bounded Data API path. | **Credentialed, conditionally implementable for metadata/link notifications.** Require API key/OAuth, quota accounting, public channel validation, WebSub challenge/renewal handling, and no video downloader. The pinned `/youtube` file's “Download a YouTube video” is a separate capability and remains blocked; the official [IFrame Player API](https://developers.google.com/youtube/iframe_api_reference) is playback/embed, not server-side download. |
| X/Twitter | [X API overview](https://docs.x.com/x-api/overview) and [Introduction](https://docs.x.com/x-api/introduction) require an approved developer account, Project/App, and bearer token for v2. [Filtered Stream](https://docs.x.com/x-api/posts/filtered-stream/introduction) supports near-real-time posts and rules; [stream webhooks](https://docs.x.com/x-api/webhooks/stream/introduction) require approved developer access and a public HTTPS callback. | [Rate limits](https://docs.x.com/x-api/fundamentals/rate-limits) are per endpoint and per app/user, usually 15 minutes or 24 hours; 429 lasts until reset. The API is pay-per-use/plan-scoped as documented by X. | **Blocked without credentials/plan.** Reopen with approved X access, bearer-token storage, numeric user IDs, rate-budgeted timeline/stream delivery, webhook CRC/signature validation, and data retention/compliance review. Never use HTML scraping or an anonymous endpoint. |
| Pinterest | [Authentication](https://developers.pinterest.com/docs/getting-started/set-up-authentication-and-authorization/) says Pinterest API services are only available to authenticated/authorized users and require an app ID/secret, redirect URI, scopes, and access token. Public reads use scopes such as `boards:read`/`pins:read`. [Access tiers](https://developers.pinterest.com/docs/key-concepts/access-tiers/) require approved Trial/Standard access. | [Rate limits](https://developers.pinterest.com/docs/reference/rate-limits/) state Trial is 1,000 requests/day per app and Standard is 100 requests/sec per user/app, with endpoint categories such as `org_read`; limits can change. Greed's 3-minute per-feed polling would exceed Trial at scale unless requests are batched or provider access is upgraded. | **Blocked keyless; conditional credentialed.** Reopen with approved app/access tier, authenticated account/board model, request batching, and provider terms review. Do not assume an arbitrary username-to-account-ID endpoint or scrape boards. |
| SoundCloud | [API guide](https://developers.soundcloud.com/docs/api/) says all resources require an authenticated app; Client Credentials can access public resources, while Authorization Code handles user resources. [Rate limits](https://developers.soundcloud.com/docs/api/rate-limits.html) document 429 behavior and token/play limits. | The crucial first-party policy is [Public APIs](https://help.soundcloud.com/hc/en-us/articles/115003446727-API-Public-APIs): SoundCloud says public APIs may not be used to develop a Discord bot, mix SoundCloud music with other content, or download/store SoundCloud content. | **Policy-blocked, even with credentials.** Do not implement SoundCloud feed polling, audio copying, or track storage. Preserve the blocker and source link in help/docs rather than disguising it as a temporary outage. |
| Kick | The official [Kick Developer Public API Swagger](https://api.kick.com/swagger/index.html) exposes OAuth, channels, livestreams, and event subscriptions. Its event subscription endpoint documents webhooks, `events:subscribe`, a 10,000-subscription-per-event-type/app limit, and 1,000 `chat.message.sent` subscriptions for unverified apps. | The public Swagger does not publish a universal request-rate number. The [Kick Developer Agreement](https://dev.kick.com/terms-of-service) prohibits exceeding/circumventing reasonable API limits and restricts re-syndication/re-distribution of API metadata/content; it requires deletion/expiry handling and limits cache duration. | **Credentialed but terms-blocked until approved.** The API can technically support event-driven live alerts, but reposting Kick metadata to Discord needs a written/terms-approved use and embed/redistribution review. Do not poll undocumented endpoints or use the public web site's internal API. |

### Generic reposting

The three URL platforms in Greed's pinned `repost` surface are Instagram,
TikTok, and Twitter/X. None of the provider contracts above authorizes an
anonymous bot to download and redistribute arbitrary creator media. The
smallest lawful subset is:

1. Validate a canonical supported URL and reject profiles/usernames.
2. Post the provider URL as normal Discord content, letting Discord's own
   unfurl/embed path render where available.
3. Do not fetch provider cookies, scrape HTML, download media, strip
   watermarks, or store provider content.
4. If a credentialed provider adapter later supplies metadata or a thumbnail,
   use only fields and retention allowed by that provider's current terms, with
   attribution and deletion handling.

The `reposters add` surface remains an evidence gap because the pinned file
does not define whether it watches provider feeds, Discord links, or both. It
must not be implemented as a broad message crawler until that behavior is
verified by a new first-party Greed source.

## Polling, push, deduplication, and restart contract

Greed publishes intervals and caps but not persistence or retry behavior. The
following are required ByteBot safety semantics, clearly ByteBot-owned:

| Concern | Required behavior |
| --- | --- |
| Durable configuration | Persist guild, provider, source identity, target channel, optional board, role, enabled state, template, and provider cursor/last-seen marker. A restart must resume rows without replaying the last delivered item. |
| Hard bounds | Enforce at most 10 active feeds per guild/provider, plus a deployment-wide provider request budget. Do not create one unbounded timer per feed. Use one bounded scheduler with jitter and a provider-specific adapter. |
| Poll intervals | Treat Greed's 20s/60s/120s/180s values as parity targets only after the provider contract allows them. Honor provider `Retry-After`, 429, quota, token, and backoff signals; a provider limit wins over a Greed marketing interval. |
| Push first | Prefer Twitch EventSub, YouTube WebSub, and provider-approved webhooks over polling. Verify signatures/challenges, acknowledge quickly, enqueue work, and process delivery idempotently. |
| Stable identity | Follow the provider identity rules: TikTok/Instagram/X source IDs where the API supplies them; X numeric user ID; Pinterest username; SoundCloud numeric artist ID; Kick broadcaster ID; YouTube channel ID. Never use a display name as a durable key when a provider ID exists. |
| Event key | Deduplicate on `(provider, source_id, content_or_broadcast_id, event_type)` with a unique database constraint. A content URL alone is not sufficient because redirects and edited posts can change. |
| Atomic delivery | Claim a due item, render/validate the message, send once, then commit the delivery marker. On a send failure, release/retry with bounded exponential backoff; do not mark delivered before Discord acknowledges. |
| Restart recovery | Rebuild timers from persisted rows at startup, preserve the last-seen cursor and delivery ledger, and recover leased work after a bounded timeout. A process crash between provider fetch and Discord send must be resolved by the unique event key, not by an in-memory Set. |
| Deletion/private transitions | Disable or mark a feed unavailable when the provider returns deleted, suspended, private, revoked-token, or missing-source diagnostics. Do not silently delete the row; show an actionable state in list/view and allow re-enable after correction. |
| Provider failure | Preserve `not found`, private/deleted, invalid credential, malformed payload, rate-limited, quota, and transport failures as distinct user-facing diagnostics. Retry only transient/rate-limit cases; never retry a malformed payload in a tight loop. |
| Discord delivery | Preflight target channel permissions and embed/attachment lengths; suppress unconfigured mentions with `allowed_mentions`. If a configured channel is deleted or inaccessible, pause the feed and report it rather than dropping state. |
| Kick semantics | Store the broadcast/event ID. A stop/start is a new ID and announces once; duplicate webhook notifications or short provider reconnects must not announce twice. This mirrors Greed's explicit Kick rule. |
| Token lifecycle | Keep provider tokens out of the database logs and Discord responses, refresh before expiry, revoke/delete on provider authorization removal, and make “needs reauthorization” visible. |

## Implementable subset and blockers

### Implementable now without provider credentials

- The public-source contract and exact Greed strings/options above.
- One-off `/repost` URL validation and canonical link posting for Instagram,
  TikTok, and X/Twitter, with no provider media download or scraping.
- Help/list diagnostics that state “provider credentials or terms approval are
  unavailable” instead of pretending a feed exists.

No dormant provider scheduler, token table, or blocked adapter is instantiated
while every feed provider is gated. The persistence contract above applies when
an authorized provider adapter becomes implementable.

### Conditionally implementable after approval and secrets

- Twitch live alerts using Helix + EventSub.
- YouTube upload notifications using WebSub plus quota-bounded Data API live
  checks.
- Kick live alerts only after explicit review/approval of the Developer
  Agreement's redistribution/cache rules; prefer its event API and a link/embed.
- Instagram, TikTok, X, and Pinterest only after the exact provider app,
  account-consent, scope, quota, retention, and terms model is approved.

### Explicitly blocked

- SoundCloud Discord feeds: provider's own Public APIs page names Discord bots
  as an unsupported use.
- Anonymous/logged-out scraping, browser-cookie reuse, or undocumented JSON
  endpoints for any provider.
- YouTube download/re-upload, TikTok watermark removal/download, or generic
  media mirroring without a provider license/contract.
- Any `reposters add` implementation that invents source-account semantics or
  crawls all Discord messages without first-party Greed evidence.

## Acceptance gate for implementation

Before code or Discord-suite testing begins, a follow-up implementation change
must show:

1. A source-cited command/option matrix using this file, with every unknown
   explicitly labelled ByteBot-owned.
2. A provider adapter status for each of the eight platforms: credential
   source, terms approval, rate budget, push/poll method, and data retention.
3. Any provider-backed feed implementation has guild-scoped persistence with a
   unique delivery key and restart recovery. Link-only `/repost` has no cursor
   or persistent delivery state.
4. Real Discord RBAC/permission checks at each mutating path; ByteBot role
   rules may narrow access but may not grant Manage Server, Manage Webhooks, or
   target-channel send permissions.
5. Explicit private/deleted, revoked-token, rate-limit/quota, malformed,
   inaccessible-channel, and provider-terms diagnostics.
6. Mention-safe, attribution-preserving rendering and a kill switch for every
   automatic delivery path.
7. No claim of Greed premium parity: ByteBot has no billing/entitlement
   service, so premium markers remain documented product evidence only.

## First-party citations

- Greed: [Social Lookups & Feeds](https://greed.best/docs/miscellaneous/socials), [Commands](https://greed.best/commands), [Command Permissions](https://greed.best/docs/configuration/command-permissions), [Dashboard](https://greed.best/dashboard).
- Greed i18n at immutable commit [`3dadc418`](https://github.com/greedbest/i18n/tree/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/socials): [`reposters.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/socials/reposters.json), [`tiktok.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/socials/tiktok.json), [`instagram.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/socials/instagram.json), [`twitter.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/socials/twitter.json), [`pinterest.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/socials/pinterest.json), and [`youtube.json`](https://raw.githubusercontent.com/greedbest/i18n/3dadc41852a09567add8a6b2b522d5e2b1a53b2f/locales/en/commands/socials/youtube.json).
- Discord: [Application Commands](https://docs.discord.com/developers/docs/interactions/slash-commands), [Permissions](https://docs.discord.com/developers/topics/permissions), [Webhooks](https://docs.discord.com/developers/platform/webhooks), [Webhook resource](https://docs.discord.com/developers/resources/webhook), and [Message resource](https://docs.discord.com/developers/resources/message).
- TikTok: [Display API overview](https://developers.tiktok.com/docs/en/display-api-overview), [Get Started](https://developers.tiktok.com/docs/en/display-api-get-started), [Rate limits](https://developers.tiktok.com/docs/en/tiktok-api-v2-rate-limit), [User access tokens](https://developers.tiktok.com/docs/en/oauth-user-access-token-management), [Developer guidelines](https://developers.tiktok.com/docs/en/our-guidelines-developer-guidelines), and [Content display](https://developers.tiktok.com/docs/en/content-display-landing).
- Meta: [Instagram API overview](https://developers.facebook.com/docs/instagram-api/overview/), [Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/), [Webhooks](https://developers.facebook.com/docs/instagram-api/guides/webhooks/), and [Graph API rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting).
- Twitch: [API guide](https://dev.twitch.tv/docs/api/guide/), [API reference](https://dev.twitch.tv/docs/api/reference), [EventSub types](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/), and [Managing subscriptions](https://dev.twitch.tv/docs/eventsub/manage-subscriptions/).
- YouTube: [Data API getting started](https://developers.google.com/youtube/v3/getting-started), [Channels](https://developers.google.com/youtube/v3/docs/channels), [Push notifications](https://developers.google.com/youtube/v3/guides/push_notifications), [API errors/quota](https://developers.google.com/youtube/v3/docs/errors), and [IFrame Player API](https://developers.google.com/youtube/iframe_api_reference).
- X: [API overview](https://docs.x.com/x-api/overview), [Introduction](https://docs.x.com/x-api/introduction), [Filtered Stream](https://docs.x.com/x-api/posts/filtered-stream/introduction), [Stream webhooks](https://docs.x.com/x-api/webhooks/stream/introduction), and [Rate limits](https://docs.x.com/x-api/fundamentals/rate-limits).
- Pinterest: [Authentication](https://developers.pinterest.com/docs/getting-started/set-up-authentication-and-authorization/), [Access tiers](https://developers.pinterest.com/docs/key-concepts/access-tiers/), [Rate limits](https://developers.pinterest.com/docs/reference/rate-limits/), and [Make an API call](https://developers.pinterest.com/docs/getting-started/make-an-api-call/).
- SoundCloud: [API guide](https://developers.soundcloud.com/docs/api/), [Rate limits](https://developers.soundcloud.com/docs/api/rate-limits.html), [Get an API key](https://developers.soundcloud.com/docs/api/register-app), and [Public APIs policy](https://help.soundcloud.com/hc/en-us/articles/115003446727-API-Public-APIs).
- Kick: [Developer Public API Swagger](https://api.kick.com/swagger/index.html), [Developer Agreement/terms](https://dev.kick.com/terms-of-service), and [Kick Dev help](https://help.kick.com/en/articles/8159966-kick-dev).
