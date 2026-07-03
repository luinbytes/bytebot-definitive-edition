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
