# Information and lookups

ByteBot maps Greed's public information family into its existing Intent Hubs:

- `/me banner`, `/me server-avatar`, `/me server-banner`, and `/me name history`
- `/server info`, `/server role info`, `/server role members`, `/server permissions view`
- `/server invite bot`, `/server invite info`, `/server asset icon`, and `/server asset banner`
- `/lookup calculate`, `/lookup qr`, `/lookup screenshot`, `/lookup weather`, `/lookup definition`, and `/lookup translate`

`/me avatar`, `/me info`, `/server info`, and `/server stats` continue to reuse their established handlers. Every path remains subject to the root or exact-path rules configured through `/server permissions`.

Discord is authoritative for users, members, roles, guilds, permissions, assets, and invites. Username history contains only former names ByteBot observed through Discord's `userUpdate` event while sharing that server; it never invents older names.

Web lookups reject credentials, non-web schemes, private/link-local destinations, oversized inputs, redirects on ByteBot's provider request, non-JSON/non-image responses, and payloads above their documented bounds. Weather uses Open-Meteo, definitions use Urban Dictionary, and QR images use QuickChart. Translation requires a LibreTranslate-compatible `LIBRETRANSLATE_URL`; screenshots require an HTTPS `SCREENSHOT_API_URL` template containing `{url}`. The screenshot browser is a separate trust boundary: deploy it without access to trusted networks and require it to reject private/link-local targets, redirects, and DNS rebinding independently. Missing or failed providers produce a visible diagnostic.

The public-source behavior and evidence gaps are frozen in [`docs/research/greed-information-lookups-contract.md`](../research/greed-information-lookups-contract.md). Live Discord validation remains a separate, explicitly approved step.
