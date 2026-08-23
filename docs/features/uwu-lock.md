# UwU Lock

UwU Lock is a guild-scoped rule that replaces a targeted member's supported messages with a webhook-authored, uwuified replay. Discord still labels the replay as an app/webhook message; ByteBot does not represent it as authored by the member.

## Commands

- `/fun uwuify text:<text>` is available to members and transforms text on demand.
- `/fun uwulock add member:<member>`, `remove`, and `list` manage targets.
- `/fun uwulock protect action:<add|remove|list> [member]` manages protected members.

UwU Lock management requires Discord's Manage Server permission. Exact command-path role overrides remain available through ByteBot RBAC to narrow which Manage Server holders may act; a ByteBot role never grants the Discord permission. `/server permissions add command:fun uwulock add` and the matching remove/reset paths accept and autocomplete full command paths. A member has one state per server: targeted, protected, or absent. Protecting a target changes them to protected; a protected member cannot be targeted until protection is removed. Guild owners, ByteBot, bots, and webhook authors cannot be targeted.

## Replay contract

ByteBot deterministically replaces `r`/`l` with `w` while preserving URLs, inline and fenced code, Discord mentions/timestamps, and custom emoji tokens. It never adds random faces or extra text, so a valid 2,000-character message cannot grow past Discord's content limit. Replays disable allowed mentions.

Supported messages contain normal text and up to 10 attachments totalling at most 8 MiB. Replies, polls, stickers, components, non-default message types, or larger/incomplete attachment payloads remain untouched. Threads use a webhook from their parent channel.

The bot must be able to delete the original and manage webhooks in the channel. It finds or lazily creates a bot-owned `ByteBot UwU Lock` webhook, sends the replay with the member's current display name and avatar, and deletes the original only after delivery succeeds. If original deletion fails, ByteBot deletes the replay only after confirming the original still exists; an ambiguous fetch keeps the replay so content cannot be lost. Webhook tokens are never persisted or logged.
