# Greed role automation compatibility contract

Frozen 2026-08-23 before implementation. The primary contract is Greed's public English registry at `3dadc41852a09567add8a6b2b522d5e2b1a53b2f`, reconciled with its current public reaction-role, booster-role, permissions, and Premium documentation. No live Greed bot was probed.

| Surface | ByteBot contract |
| --- | --- |
| Reaction roles | `add <message_link> <emoji> <role>`, `remove`, `list`, `clear`; add the reaction automatically; add/remove the mapped role with the member's reaction; accept accessible Unicode or custom emoji; use the highest public allowance of 500 per guild. |
| Button roles | `add <message_link> <role> [style] [emoji] [label]`, `remove <message_link> <index>`, `removeall`, `reset`, `list`; only edit ByteBot-authored messages; maximum 25 buttons per message; stable custom IDs survive restarts and stale/moved components fail closed. |
| Temporary roles | `add <member> <role> <duration>`, plus list/remove lifecycle paths; duration 1 minute through 365 days; persisted expiry resumes after restart. |
| Booster roles | `setup`, `disable`, `base`, `create`, `delete`, `rename`, `color`, `icon`, `share`, `list`, `include`, `sync`, `hoist`, `limit`; `filter add|remove|list`; `shares list|remove|max`. The pinned registry requires the setup actor and role owners to be active boosters. Use the pinned 249-role and 50-share maxima without entitlement gates. Roles are removed when their owner leaves or stops boosting. |
| Boosters | `list` active boosters and `lost` recently stopped boosters. |

Reaction, button, temporary-role, and booster server-configuration paths require real Discord `ManageRoles`; booster server settings additionally require `ManageGuild`. Greed's booster self-service actions remain available to active boosters without staff permissions and can affect only the invoking member's own persisted role. Every grant revalidates bot hierarchy, managed-role state, and ByteBot's blocked-permission policy at interaction time. Temporary and booster cleanup is leased and retryable after restart. Lists suppress mentions and report omitted records.

Discord exposes role icons only where the guild supports them. ByteBot accepts Unicode emoji and bounded Discord-CDN HTTPS images; it does not fetch arbitrary icon URLs. Gradient colors use Discord's role-color API when available and otherwise apply the primary color only.
