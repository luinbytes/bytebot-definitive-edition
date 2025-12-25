# Duplicate Commands Fix Guide

## Problem

You're seeing duplicate slash commands in Discord (e.g., `/joke` appears twice). This happens when commands are registered **both globally AND to specific guilds**.

## Root Cause

Discord's command registration has two scopes:

1. **Global commands** - Available in all guilds where the bot is installed
2. **Guild commands** - Available only in a specific guild

When commands exist in **both** scopes, Discord shows **both**, causing duplicates.

### How It Happened

Looking at your deployment history, commands were likely registered multiple times using different scopes:

- `npm start -- --deploy` → Registers to GUILD_ID (guild-specific)
- `npm start -- --deploy-global` → Registers globally (all guilds)
- `/deploy scope:Global` → Registers globally
- `/deploy scope:Guild` → Registers to current guild

## Solution

### Step 1: Clear ALL Command Registrations

Use the new `/clear` command to remove all existing registrations:

```
/clear scope:Both Global & Guild
```

This will:
- Remove all global commands
- Remove all guild-specific commands
- Clear the duplicate issue

### Step 2: Choose ONE Deployment Strategy

After clearing, choose **one** deployment method:

#### Option A: Guild-Only (Recommended for Development)

**Pros:**
- Instant updates (no 1-hour wait)
- Changes only affect your development server
- Easier testing

**Cons:**
- Must manually deploy to each new guild
- Commands won't appear in other servers automatically

**Deploy Command:**
```
/deploy scope:Guild
```

**Or via CLI:**
```bash
npm start -- --deploy
```

#### Option B: Global (Recommended for Production)

**Pros:**
- Automatically available in all guilds
- Single deployment for all servers
- Better for production bots

**Cons:**
- Takes up to 1 hour to propagate
- Changes affect all servers immediately
- Harder to test changes

**Deploy Command:**
```
/deploy scope:Global
```

**Or via CLI:**
```bash
npm start -- --deploy-global
```

## Prevention

### New Duplicate Detection

The `/deploy` command now automatically detects duplicates:

1. **Before deploying**, it checks for existing registrations
2. **If duplicates exist**, it shows a warning and prevents deployment
3. **Guides you** to use `/clear` first

### Example Warning

```
⚠️ Duplicate Commands Detected

• Global commands: 25
• Guild commands (Your Server): 25

This causes commands to appear twice in Discord.

To fix:
1. Use /clear scope:Both to remove all commands
2. Choose ONE deployment strategy:
   • Global (production): /deploy scope:Global
   • Guild (development): /deploy scope:Guild

Proceeding with deployment will not fix duplicates.
```

## New Commands

### `/clear` Command

Clears command registrations from Discord.

**Options:**
- `scope:Global Commands` - Clear only global commands
- `scope:Guild Commands` - Clear only guild commands (current server)
- `scope:Both Global & Guild` - Clear everything (recommended for fixing duplicates)

**Safety Features:**
- Requires confirmation button
- Shows how many commands will be removed
- Developer-only (devOnly: true)
- 10-second cooldown

### Updated `/deploy` Command

Now includes duplicate detection:
- Checks for existing registrations before deploying
- Warns if deploying would create or not fix duplicates
- Shows existing command counts
- Prevents accidental duplicate creation

## Technical Details

### Command Registration Scopes

Discord's REST API has two registration endpoints:

1. **Global:** `PUT /applications/{app_id}/commands`
   - Commands available in all guilds
   - 1-hour cache time (slow updates)
   - Rate limit: 200 creates/day globally

2. **Guild:** `PUT /applications/{app_id}/guilds/{guild_id}/commands`
   - Commands available only in specified guild
   - Instant updates
   - Rate limit: 200 creates/day per guild

### Why Duplicates Appear

When commands are registered to **both** endpoints:
- Discord fetches from **both** sources
- Shows **all** matching commands
- No deduplication occurs
- User sees duplicates in the UI

### Files Changed

1. **src/commands/developer/clear.js** (NEW)
   - Command to clear registrations
   - Supports global, guild, or both scopes
   - Safe confirmation flow

2. **src/utils/commandDeployer.js**
   - Added `checkExistingRegistrations()` function
   - Detects duplicate registrations
   - Returns counts for both scopes

3. **src/commands/developer/deploy.js**
   - Added duplicate detection before deployment
   - Shows warning if duplicates exist
   - Prevents accidental duplicate creation

## Recommended Workflow

### For Development

1. Use **guild-only** deployment:
   ```bash
   npm start -- --deploy
   ```

2. Test in your development server only

3. When ready for production, clear and deploy globally:
   ```
   /clear scope:Both
   /deploy scope:Global
   ```

### For Production

1. Use **global** deployment:
   ```bash
   npm start -- --deploy-global
   ```

2. Wait 1 hour for propagation

3. Test in a production server

4. Never use guild-specific deployment

## Troubleshooting

### "Commands still showing as duplicates after clearing"

Discord has a cache. Try:
1. Restart Discord client
2. Wait 5-10 minutes
3. Check if commands are truly gone with `/deploy` (it checks existing)

### "Clear command doesn't work"

Check:
1. Bot token is valid in `.env`
2. Bot has `applications.commands` scope
3. You have developer permissions (config.json)

### "Deploy shows 0 commands cleared but I see duplicates"

This might be a Discord cache issue:
1. Reinstall the bot to the server (remove & re-add)
2. Or wait up to 1 hour for Discord's cache to expire

## Prevention Checklist

- [ ] Choose ONE deployment strategy (global OR guild)
- [ ] Document your choice in `.env` or README
- [ ] Only use that deployment method
- [ ] Run `/deploy` to check for duplicates regularly
- [ ] Use `/clear scope:Both` before switching strategies

## Summary

**Quick Fix:**
```
1. /clear scope:Both Global & Guild
2. /deploy scope:Guild  (or scope:Global for production)
3. Done!
```

**Prevent Future Duplicates:**
- Stick to ONE deployment method
- Use `/deploy` command (it now detects duplicates)
- Never mix global and guild deployments
