# ByteBot Notes

## BytePod Ownership Reclaim

`reclaimRequestPending` lives on the `bytepods` table. Prevents duplicate reclaim prompts when the original owner tries to request a BytePod back while another request is already pending.

### Voice Reconnect Bug

Reclaim request buttons use an explicit reply instead of `deferUpdate` where needed. This avoids the Discord voice reconnect behavior that can happen when a button update touches the message flow at the wrong time.

### Duplicate Reclaim Prompts

Duplicate reclaim prompts are blocked by checking and setting `reclaimRequestPending` in the `bytepods table` before sending another request.

### originalOwnerId Backfill

`originalOwnerId Backfill` preserves reclaim eligibility for old pods by filling the original owner when older rows do not already have it.
