# AntiNuke

ByteBot's AntiNuke evaluates Discord audit-log events against guild-local rolling thresholds. It is based on Greed's current public [AntiNuke guide](https://greed.best/docs/moderation/antinuke) and the pinned English command registry. AntiNuke is available without billing or entitlement checks.

## Commands

AntiNuke lives in the existing Security area of the `/server` hub:

- `/server security antinuke-settings`
- `/server security antinuke-toggle enabled:<true|false>`
- `/server security antinuke-punishment punishment:<ban|kick|timeout|strip|stripstaff|jail>`
- `/server security antinuke-window minutes:<1-1440>`
- `/server security antinuke-module action:<view|toggle|threshold|punishment> module:<module>` with the value required by the selected action
- `/server security antinuke-admin action:<add|remove|list> [user]`
- `/server security antinuke-whitelist action:<add|remove|list> [user]`
- `/server security antinuke-incidents [limit]`
- `/server security antinuke-log action:<set|clear|view> [channel]`

Discord only permits 25 fixed choices while the current guide documents 27 modules, so the module option uses autocomplete. The server owner manages AntiNuke by default. Explicit AntiNuke admins and configured ByteBot developers may also manage it; Discord Administrator alone does not cross that boundary. An AntiNuke admin can configure protection but is still evaluated as an actor. Only the guild owner, ByteBot itself, and the explicit whitelist bypass enforcement. Every configuration, admin, and whitelist mutation is a moderation case, and ByteBot's path-aware RBAC may restrict command access further without granting this trust.

## Modules and enforcement

The 27 current public modules are guild update, webhooks, vanity URL, integration create/update/delete, bot add, kick, ban, member prune, role create/update/delete, channel create/update/delete, emoji create/update/delete, sticker create/update/delete, soundboard create/update/delete, and invite create/delete. The global switch and each module default to off. A module defaults to a threshold of three actions and inherits the global `strip` punishment unless overridden. The default rolling window is 60 seconds; the public sources do not publish window bounds, so ByteBot explicitly accepts one minute through one day.

Discord reports these actions after they happen. ByteBot therefore contains the attributed actor when the threshold is reached; it cannot truthfully claim to pre-empt a native Discord action or recreate a deleted Discord object. Incidents are durable, and seen audit-entry IDs are retained for seven days so restarts and duplicate gateway delivery cannot reset or repeat a threshold claim without growing the event table forever.

Punishments reuse ByteBot's case-backed moderation service and real Discord permission, protected-target, and hierarchy checks. If a configured punishment fails, ByteBot attempts dangerous-role stripping once. It records `punished`, `fallback_strip`, or `containment_failed` and does not cascade through more mutations. Pending or applying incidents are retried on startup, while new events cannot open a second incident for the same actor and module during recovery. Existing `/mod channel lockdown-all` remains the explicit, reversible server-lockdown control; current public AntiNuke documentation does not identify lockdown as an automatic AntiNuke punishment. A log delivery failure cannot erase the durable incident.
