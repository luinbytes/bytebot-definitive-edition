# ByteBot Notes

## Agent skills

### Issue tracker

Issues and specs are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the default five Matt workflow labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout using root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.

## BytePod Ownership Reclaim

`reclaimRequestPending` lives on the `bytepods` table. Prevents duplicate reclaim prompts when the original owner tries to request a BytePod back while another request is already pending.

### Voice Reconnect Bug

Reclaim request buttons use an explicit reply instead of `deferUpdate` where needed. This avoids the Discord voice reconnect behavior that can happen when a button update touches the message flow at the wrong time.

### Duplicate Reclaim Prompts

Duplicate reclaim prompts are blocked by checking and setting `reclaimRequestPending` in the `bytepods table` before sending another request.

### originalOwnerId Backfill

`originalOwnerId Backfill` preserves reclaim eligibility for old pods by filling the original owner when older rows do not already have it.
