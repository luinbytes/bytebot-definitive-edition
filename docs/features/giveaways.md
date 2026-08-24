# Giveaways

`/giveaway` provides server giveaways without billing gates. It defaults to Discord **Manage Server**, and ByteBot's path-aware RBAC can restrict individual subcommands further. Members enter through ByteBot-owned buttons; bots, members missing the required role, blacklisted roles, and members outside configured level bounds are rejected at click time and checked again when winners are drawn.

Start with `/giveaway start duration:1h winners:1 prize:Nitro`. Optional role, description, preset, image, and thumbnail values are snapshotted into the giveaway. `/giveaway edit` changes an active giveaway; `/giveaway end` ends it early; `/giveaway reroll` creates another immutable winner round while excluding prior winners. `/giveaway blacklist` and `/giveaway setmax` configure role eligibility and weighted entries for everyone, with no premium entitlement.

Templates and named presets reuse ByteBot's rich-message scripts. They may provide content and embeds, while ByteBot retains the entry/view controls. `/giveaway variables` lists the supported giveaway fields. Creator and winner DMs are explicit server settings, and failed DMs are audited without changing the result.

Winner claims, candidate/exclusion snapshots, and rounds are persisted transactionally. Deadline polling and startup reconciliation reuse the stored first round, so retries cannot choose a second first winner. Missing exact messages are marked lost rather than guessed. The complete source mapping and limits are in [the giveaway and counter compatibility contract](../research/greed-giveaway-counter-contract.md).
