# Command access controls

ByteBot exposes Greed-style command controls under the existing Server hub. The legacy `/perm` command remains executable internally for aliases but is not registered as a separate slash command.

## Slash-command layout

All management actions require a real Discord Administrator permission and reply ephemerally.

| Path | Behavior |
| --- | --- |
| `/server permissions disable` | Disable a command path for the server or one channel, role, or member. |
| `/server permissions enable` | Remove the matching disabled rule. |
| `/server permissions allow` | Add a scope to the command path's allowlist. Once an allow rule exists, unmatched members are denied. |
| `/server permissions deny` | Deny one server, channel, role, or member scope. A matching deny wins over allow. |
| `/server permissions unrestrict` | Remove allow and deny rules for one scope, or all scopes when omitted. |
| `/server permissions list` | List legacy role allowlists and scoped rules. |
| `/server permissions reset` | Clear all legacy and scoped rules for a command path. |
| `/server permissions fake` | Add, remove, list, or reset virtual Discord permission labels for a role. |
| `/server permissions denyperm` | Block, unblock, list, or clear permissions that ByteBot-assigned roles may carry. |
| `/server permissions protect` | Add, remove, or list members and roles protected from moderation. |

`command` autocompletes complete public paths such as `fun uwuify` and `mod user ban`. With no channel, role, or member option, a scoped rule applies to the whole server. Supplying more than one scope is rejected. Root rules apply to the root and its descendants; exact-path rules apply only to that path. A matching allow rule acts as a whitelist exception to a disabled scope; a matching deny still wins. Running `enable` without a scope removes every disabled rule for that path.

## Authorization boundaries

Discord permissions are checked before ByteBot policy. Neither a role allowlist nor a fake permission can replace a real permission required for a Discord API action. Administrators bypass ByteBot allow, deny, disable, and legacy role rules, but still pass Discord's own permission checks.

Fake-permission `add` accepts one or more comma-separated Discord permission names. `remove` clears one role and `reset` clears the server, matching Greed's documented lifecycle. Fake permissions affect only commands that explicitly declare a `virtualPermissions` policy. `/server community view` uses a virtual Administrator policy because it is read-only. Mutating administration and moderation commands retain real Discord permission requirements.

`denyperm` is the opposite guardrail: when ByteBot assigns a role, the assignment is rejected if that role carries any permission blocked for the server. Removal remains possible. This applies at the shared role-assignment seam, including automated birthday and achievement roles.

Protected members and members holding a protected role are rejected by the shared moderation hierarchy check. This covers `/mod user ban`, `/mod user kick`, `/mod user warn`, and the public **Moderate User** context-menu flow. Protection does not alter Discord roles or permissions; an administrator can remove it through `/server permissions protect action:remove`.
