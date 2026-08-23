# ByteBot

ByteBot is a Discord moderation and utility bot. This context captures project-specific language for server safety features and bot behavior.

## Language

**Honeypot Poster**:
A non-exempt member who posts in a configured trap channel, usually a compromised human account preparing to spread scam links.
_Avoid_: Bot account, spam bot

**Honeypot Channel**:
A bot-created trap text channel inside a bot-created safety category. Posting in it is treated as confirmation that the member is unsafe unless a member or role exemption applies.
_Avoid_: Configured channel

**Honeypot Exemption**:
A member or role allowed to post in the trap channel without being banned, such as the server owner, administrators, moderators, or explicitly configured test users.
_Avoid_: Whitelist

**Shame Board**:
The public honeypot status embed that names recent honeypot bans, shows useful account-risk details, and proves the trap is actively protecting the server.
_Avoid_: Recent bans, log embed

**Public Parity Contract**:
The Greed behavior and command surface evidenced by its public command catalog, official documentation, and pinned official English localization registry. Undocumented live behavior is not part of the contract.
_Avoid_: Exact clone, runtime parity

**Intent Hub**:
A top-level slash command that groups actions by what a member is trying to do, such as `/me`, `/server`, or `/fun`.
_Avoid_: Category command, module command

**UwU Lock**:
A server rule that replaces a targeted member's messages with an uwuified replay wherever ByteBot can safely do so.
_Avoid_: Impersonation, user lock

**UwU-Protected Member**:
A server member whom administrators have exempted from UwU Lock targeting.
_Avoid_: Whitelisted user, immune user

**Replayed Message**:
A webhook-authored replacement that uses the original member's visible name and avatar while remaining identifiable by Discord as an app/webhook message.
_Avoid_: Original message, impersonated message
