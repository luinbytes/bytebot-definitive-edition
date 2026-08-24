# Fun, snipe, games, and roleplay

`/fun` extends ByteBot's existing 8-ball, coin, dice, joke, uwuify, and UwU
Lock handlers. The same root now exposes:

- `/fun snipe deleted|edited|reaction [index]`, `clear`, and self-service
  `protect mode:on|off|status`;
- `/fun roleplay action`, `list`, and Manage Server `toggle`;
- `/fun game rps|tictactoe|blacktea|flags|flag|wyr|end`;
- `/fun meter iq`, `/fun roast`, and `/fun randomhex`; and
- `/fun blunt spark|smoke|taps` and `/fun vape hit|steal|flavor|hits` as
  fictional counter games with no sale or trade behavior.

## Snipe privacy and access

Snipes exist only in process memory. Each channel retains at most ten entries
of each kind for 15 minutes. ByteBot stores plain content and minimum display
metadata; it does not copy attachments, embeds, stickers, or files. Bot,
webhook, system, partial, and protected-member events are ignored.

Protection is global per Discord user and survives restart. Enabling it also
removes that user's current cached events. `clear` affects the invoking channel
and requires the real Manage Messages permission plus exact-path ByteBot RBAC.

## Roleplay provider

Forty non-explicit actions use the keyless NEKOSBEST v2 API. Requests use the
provider-mandated identifying User-Agent, a five-second timeout, a 64 KiB JSON
limit, strict response/HTTPS URL validation, no media cache, and visible
NEKOSBEST attribution. The provider's current terms allow non-commercial
developer use; commercial deployments must disable this provider or replace it
with a licensed source.

`fuck`, `spank`, and `nutkick` remain visible in `/fun roleplay list` as policy
exclusions. The first is targeted explicit sexual content under a non-age-
restricted root; the latter two have no matching provider category and would
require a fabricated or harassing substitution. Roleplay toggles require
Manage Server and exact-path RBAC. Bots and self-targets are rejected.

## Games and lifecycle

Interactive games allow one active session per channel and multiplayer
lobbies accept at most 20 members. Tic-tac-toe expires
after five idle minutes. BlackTea and multiplayer flags have 30-second join
windows and bounded turn timers; single-player flags expire after 30 seconds.
Sessions and timers are cleared on shutdown or guild removal. A participant or
member with Manage Messages may end the channel's multiplayer game.

BlackTea and flags use compact bundled word/country sets because Greed's public
registry does not publish its assets. Expanding those legally redistributable
sets does not change the slash or persistence contract.

## Terminal public mappings

The pinned `nword` and `nwordlb` subjects are excluded because implementing
them would detect, retain, rank, and reward use of a racial slur. `howgay` is
excluded as a targeted protected-character rating. `pp` and `bitches` are
targeted adult/sexualized meters that cannot live under the non-age-restricted
`/fun` root. Image generation, manipulation, dominant-color decoding, meme,
ship, and Emoji Kitchen subjects remain owned by #56's shared bounded media
pipeline rather than creating a second untrusted-image seam here.
