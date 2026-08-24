# Self-service and booster roles

ByteBot exposes Greed's public role automation without billing gates:

- Utility: `/reactionrole`, `/buttonrole`, `/temprole`, and `/boosters`.
- Administration and member self-service: `/boosterrole`.

Reaction and button configuration requires real Discord **Manage Roles**. Every member click/reaction revalidates ByteBot's role hierarchy and `/server permissions denyperm` policy before granting a role. Reaction mappings follow add and remove events. Button mappings use IDs tied to the original ByteBot-authored message, so copied, removed, disabled, or otherwise stale components fail closed after restarts.

Temporary expiries reuse the persisted leased automation scheduler. Booster ownership is claimed transactionally, and the same scheduler reconciles ownership hourly so missed offline events and transient cleanup failures retry. Booster roles require an active boost, boost level 2, an editable base role, and server setup by a boosting member with **Manage Server** and **Manage Roles**. The full public edit, share, filter, include, sync, limit, and loss-cleanup lifecycle is available. Limits are 500 reaction mappings, 25 buttons per message, 249 booster roles, and 50 shares per booster.

See [the frozen role compatibility contract](../research/greed-role-automation-contract.md) for source conflicts and icon/gradient boundaries.
