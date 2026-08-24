# Message and member automation

ByteBot includes Greed's publicly documented message/member automation without billing or entitlement gates. Existing `/autorespond manage|browse` remains available; `/autoresponder` exposes the current compatibility surface and its channel, role, reply, deletion, self-destruct, and mention controls.

The slash-command families are:

- Administration: `/autoresponder`, `/autoreact`, `/autorole`, `/vanity`, `/pingonjoin` (with `/poj` as its compatibility alias).
- Utility: `/timer`, `/bumpreminder`, `/stickymessage`, `/revive`, `/tracking`, `/counter`.

Every family defaults to Discord **Manage Server**. ByteBot's path-aware allow/deny rules can narrow access, but never replace that real Discord permission. Target roles must be editable by ByteBot. Outbound messages suppress mentions unless a command explicitly enables a responder mention class; join notifications only allow the joining member mention.

Timers, revive prompts, sticky reposts, metric counters, and bump reminders share the persisted `automation_rules` scheduler. It claims at most 25 due rows per 15-second poll with a five-minute recoverable lease and a Discord-enforced nonce, retries failed delivery after one minute without changing that nonce, and resumes persisted deadlines on startup. Sticky messages wait three seconds after activity. Successful DISBOARD bumps thank immediately and create one two-hour reminder deadline. `/counter enable` also retains Greed's sequential counting-channel behavior; invalid-message cleanup is capped at 250 pending deletions per guild. `/counter add|update` supports `members`, `bots`, `online`, and `voice` across voice, text, category, announcement, and stage channels. Removing a metric deletes only a channel marked as created by ByteBot; sequential and pre-existing channels are retained.

Vanity rewards require the privileged Discord **Server Members Intent** and **Presence Intent** to be enabled for the application; ByteBot requests both gateway intents. Username and vanity tracking use Discord's `userUpdate` and `guildUpdate` events and retain the latest 100 dropped values per configured rule. The pinned 14-day username and 16-day vanity windows are defaults; `/tracking add` can store a source-specific override. Personal `/tracking notify-*` and `/tracking lookup` actions remain member-accessible, while server tracking-channel mutations perform a real **Manage Server** check.

The exact public-source mapping and source conflicts are recorded in [the automation compatibility contract](../research/greed-automation-contract.md).
