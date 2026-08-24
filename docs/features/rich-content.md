# Rich content, tags, pagination, and webhooks

ByteBot's rich-content platform is available without billing or entitlement checks. `/embed` creates, saves, copies, publishes, and imports reusable scripts; `/createembed` and `/copyembed` retain the public legacy paths. `/variables` shows the substitutions available to embeds, tags, custom responses, pagination pages, and managed webhooks.

Legacy scripts support message content, ten embeds, fields, images, thumbnails, timestamps, and buttons. `{cv2}` scripts support Discord Components V2 text, sections, action rows, buttons, disabled display selects, separators, galleries, thumbnails, and containers. Custom buttons invoke a named `/custom` script privately. All template values are treated as text, outbound mentions are suppressed, HTTP(S) URLs are validated, and long raw scripts are returned as text files instead of being truncated.

`/tag` stores globally discoverable author-owned scripts; server staff can edit or remove them and can disable tag sends per server. `/pagination` gives ByteBot-authored embed messages up to ten durable reaction-driven pages. `/webhook` stores only ByteBot short IDs and Discord object IDs—never webhook tokens or URLs—and only edits messages it previously tracked.

Server staff can set information, success, error, and warning colors through `/embed setcolor`. The setting applies to ByteBot embeds within that server and supplies the default color for rich embeds that do not declare one explicitly.

See [the frozen rich-content contract](../research/greed-rich-content-contract.md) for the public sources, limits, and compatibility decisions.
