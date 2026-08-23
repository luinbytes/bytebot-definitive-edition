# Moderation Workflow

ByteBot's `/mod` hub provides guild-local cases for member actions, history, invoke templates, warning escalation, staff-role recognition, and setup. The public behavior is based on Greed's official [moderation documentation](https://greed.best/docs/moderation/moderation); ByteBot uses grouped slash paths instead of prefix-command nesting.

## Command layout

- `/mod user` contains ban, kick, timeout, untimeout, softban, hardban, unban, image/reaction mute, jail, warn, unwarn, strip, and history actions.
- `/mod status` lists active hardbans, jailed/image-muted/reaction-muted members, live Discord timeouts with expiry, or a member's warnings with moderator and timestamp.
- `/mod bulk` provides confirmed unban-all, untimeout-all, and unjail-all recovery paths.
- `/mod logs` shows recent cases, cases by moderator, or the live Discord audit log.
- `/mod case` views, undoes, or explicitly resets guild case history.
- `/mod template` sets, removes, views, resets, lists, tests, and documents invoke templates.
- `/mod config` runs setup/reset, selects moderation channels and roles, manages staff roles, and configures warning punishments.
- `/mod channel` retains the existing clear, lock, and unlock paths.

Every member mutation checks the moderator's real action-specific Discord permission, the bot's matching permission, persisted protected targets, the server owner boundary, and actor/bot role hierarchy. ByteBot RBAC may restrict a path further but cannot grant Discord authority. Context-menu warn, kick, ban, and history use the same case service.

## Cases and recovery

A case is allocated before contacting Discord and becomes `completed`, `failed`, `undone`, or `cleanup_required`. Reversible timeout, role, strip, warning, ban, and hardban cases use `/mod case undo`. Timeouts accept 60 seconds through 27 days. Jail replaces assignable roles with the jail role and durably restores the prior role set on unjail. Softban performs ban then unban; if Discord rejects cleanup, its durable `cleanup_required` case can be retried with case undo. Hardban supports zero to seven days of message-history deletion, is re-applied after an external unban, and can only be undone by the server owner. Active jail and hardban state is stored separately from resettable case history, so resetting cases cannot disable enforcement or lose role restoration data.

Warning thresholds are unique per guild and active warning count. Timeout thresholds require a duration. Warning removal marks its case undone, preserving the audit trail.

## Setup ownership

`/mod config setup` requires Administrator and creates a `greed-mod` category, `logs` and `jail` channels, and `imute`, `rmute`, and `jailed` roles. It applies the corresponding overwrites to current and future channels. `/mod config reset confirm:true` deletes only the exact resource IDs ByteBot recorded as owned. Failed setup or reset records the exact cleanup still required for a safe retry.

## Invoke templates

DM and modlog templates support the documented target, moderator, guild, channel, reason, duration, history, and warning-count variables. Plain text suppresses mentions. The documented `{embed}` color, title, description, field, and thumbnail tags render as Discord embeds. Invalid variable names are rejected when saved; DM delivery failures do not roll back a successful moderation action.
