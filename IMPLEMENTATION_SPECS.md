# ByteBot Feature Implementation Specifications

**Created:** 2025-12-22
**Purpose:** Detailed technical specifications, edge case analysis, and implementation flows for 6 new features
**Status:** Pre-Implementation Planning

---

## Table of Contents

1. [Context Menu DM Handling Strategy](#context-menu-dm-handling-strategy)
2. [Feature 1: Reminder System](#feature-1-reminder-system)
3. [Feature 2: Starboard](#feature-2-starboard)
4. [Feature 3: Birthday Tracker](#feature-3-birthday-tracker)
5. [Feature 4: User Context Menus](#feature-4-user-context-menus)
6. [Feature 5: Message Bookmarks](#feature-5-message-bookmarks)
7. [Feature 6: Auto-Responder](#feature-6-auto-responder)
8. [Cross-Feature Integration Points](#cross-feature-integration-points)
9. [Error Handling Patterns](#error-handling-patterns)
10. [State Management Strategy](#state-management-strategy)

---

## Context Menu DM Handling Strategy

### Problem
Context menus (user/message) can be invoked from DMs, where `interaction.guild` is `null`. Guild-specific features (mod actions, bookmarks) need special handling.

### Solution Patterns

#### Pattern A: Block DM Usage (Simple)
```javascript
module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Moderate User')
    .setType(ApplicationCommandType.User)
    .setDMPermission(false),  // ← Blocks DM invocation entirely

  async execute(interaction) {
    // No DM check needed, Discord enforces it
  }
};
```
**Use for:** Mod Actions, Server-specific features

#### Pattern B: Guild Selection Flow (Complex)
```javascript
async execute(interaction) {
  // Check if in DM
  if (!interaction.guild) {
    // Get mutual guilds
    const mutualGuilds = client.guilds.cache.filter(g =>
      g.members.cache.has(interaction.user.id) &&
      g.members.cache.has(interaction.targetUser.id)
    );

    if (mutualGuilds.size === 0) {
      return interaction.reply({
        embeds: [embeds.error('No Mutual Servers', 'You must share a server with this user.')],
        flags: [MessageFlags.Ephemeral]
      });
    }

    if (mutualGuilds.size === 1) {
      // Auto-select the only mutual guild
      interaction.guild = mutualGuilds.first();
    } else {
      // Show guild selection menu
      const row = new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`select_guild_${interaction.id}`)
            .setPlaceholder('Select a server')
            .addOptions(mutualGuilds.map(g => ({
              label: g.name,
              value: g.id,
              description: `${g.memberCount} members`
            })))
        );

      return interaction.reply({
        content: 'Select which server to perform this action in:',
        components: [row],
        flags: [MessageFlags.Ephemeral]
      });
    }
  }

  // Continue with guild-specific logic
}
```
**Use for:** Features that COULD work cross-guild (future enhancement)

#### Pattern C: DM-Compatible (No Guild Needed)
```javascript
async execute(interaction) {
  // Works anywhere - no guild required
  const user = interaction.targetUser;
  const avatarURL = user.displayAvatarURL({ size: 4096 });

  // Show avatar (works in DMs and guilds)
}
```
**Use for:** View Avatar, Copy ID, User Info (basic)

### Decision Matrix

| Feature | DM Strategy | Reasoning |
|---------|-------------|-----------|
| View Avatar | Pattern C | No guild data needed |
| User Info | Pattern C | Show basic user info, skip guild-specific data in DMs |
| Copy ID | Pattern C | Universal feature |
| Check Permissions | Pattern A (Block) | Permissions are guild-specific |
| Activity History | Pattern A (Block) | Requires guild data (lastSeen, voice stats) |
| Mod Actions | Pattern A (Block) | Must be in guild to moderate |
| Bookmark Message | Pattern A (Block) | Bookmarks tied to guild context |
| Report Message | Pattern A (Block) | Reports go to guild mod log |

---

## Feature 1: Reminder System

### Detailed Implementation Flow

#### 1.1 Command: `/remind me`

**Flow Diagram:**
```
User: /remind me 30m buy groceries
  ↓
[1] Validate time input
  ↓ Invalid → Error: "Invalid time format. Examples: 10m, 2h, 3d"
  ↓ Valid
  ↓
[2] Parse time → timestamp
  ↓
[3] Check future (triggerAt > now)
  ↓ Past → Error: "Time must be in the future"
  ↓ Valid
  ↓
[4] Check max duration (< 1 year)
  ↓ Too long → Error: "Maximum reminder duration is 1 year"
  ↓ Valid
  ↓
[5] Check user reminder count
  ↓ ≥ 25 → Error: "You have reached the maximum of 25 active reminders. Use /remind list to manage them."
  ↓ < 25
  ↓
[6] Insert to DB
  ↓
[7] Calculate delay
  ↓ > MAX_TIMEOUT (24.8 days)?
    ↓ YES → Schedule interval check
    ↓ NO → Schedule setTimeout
  ↓
[8] Store timeout ID in service.activeTimers
  ↓
[9] Reply with confirmation embed
    - "Reminder set for <t:timestamp:R> (<t:timestamp:F>)"
    - Show reminder ID for cancellation
```

**Edge Cases:**

1. **Bot restart before reminder fires**
   - **Detection:** On startup, query `active=1 AND triggerAt <= now + 5min`
   - **Action:** Fire immediately with note "⏰ Overdue Reminder (bot was offline)"
   - **Threshold:** 5min grace period to avoid spam

2. **User DMs disabled**
   - **Detection:** Try to send DM, catch error
   - **Action:** Mark reminder as failed, log to console
   - **Future:** Store failed delivery, retry once after 1 hour

3. **Very long delays (> 24.8 days)**
   - **Problem:** `setTimeout` max is 2147483647ms (~24.8 days)
   - **Solution:**
     ```javascript
     if (delay > MAX_SAFE_TIMEOUT) {
       // Set interval to check every 24 hours
       this.longDelayChecks.set(reminderId, setInterval(() => {
         if (Date.now() >= triggerAt) {
           this.fireReminder(reminderId);
           clearInterval(this.longDelayChecks.get(reminderId));
         }
       }, 86400000)); // Check daily
     } else {
       // Normal setTimeout
       this.activeTimers.set(reminderId, setTimeout(...));
     }
     ```

4. **Reminder fires while user is being rate-limited**
   - **Problem:** DM might fail if user hit global DM rate limit
   - **Solution:** Retry with exponential backoff (2s, 4s, 8s), max 3 attempts
   - **Fallback:** Mark as failed after retries exhausted

5. **Timezone confusion**
   - **Problem:** User says "tomorrow 3pm" but unclear which timezone
   - **Solution:**
     - Store all times as UTC timestamps
     - Display with Discord's `<t:timestamp:F>` (shows in user's local time)
     - Do NOT parse relative dates in MVP (too complex)
     - Stick to simple durations: 10m, 2h, 3d

#### 1.2 Command: `/remind here`

**Additional Checks:**
```
User: /remind here 1h meeting starts
  ↓
[Same as /remind me steps 1-5]
  ↓
[6] Check if in guild
  ↓ DM → Error: "Channel reminders can only be set in servers"
  ↓ In guild
  ↓
[7] Check channel permissions
  ↓ !SendMessages → Error: "I don't have permission to send messages in this channel"
  ↓ Has permission
  ↓
[8] Store channelId in DB (not null)
  ↓
[Continue with scheduling...]
```

**Edge Cases:**

1. **Channel deleted before reminder fires**
   - **Detection:** Channel.send() throws `DiscordAPIError[10003]: Unknown Channel`
   - **Action:**
     ```javascript
     try {
       await channel.send({ embeds: [reminderEmbed] });
     } catch (error) {
       if (error.code === 10003) {
         // Channel deleted, send DM instead
         logger.warn(`Channel ${channelId} deleted, sending reminder to user DM`);
         await user.send({ embeds: [reminderEmbed] });
       } else {
         throw error;
       }
     }
     ```

2. **Bot kicked from guild**
   - **Detection:** On `guildDelete` event
   - **Action:**
     ```javascript
     // In guildDelete.js
     await db.update(reminders)
       .set({ active: 0 })
       .where(and(
         eq(reminders.guildId, guild.id),
         eq(reminders.active, 1)
       ));
     ```
   - **Cleanup:** Clear all guild reminders, no DM sent (user won't see context)

3. **User left guild before reminder**
   - **Detection:** Guild.members.fetch() returns null
   - **Action:** Send DM anyway (reminder still valid)
   - **Message:** "⏰ Reminder from **[Guild Name]** (you are no longer a member)\n\n{message}"

4. **Channel permissions changed**
   - **Detection:** Bot lost SendMessages permission
   - **Action:** Same as deleted channel → DM user
   - **Log:** Warn in console

#### 1.3 Command: `/remind list`

**Flow:**
```
User: /remind list
  ↓
[1] Query user's active reminders
  SELECT * FROM reminders
  WHERE userId = ? AND active = 1
  ORDER BY triggerAt ASC
  ↓
[2] Paginate (10 per page)
  ↓
[3] Build embed
  - Show ID, message preview (50 chars), time (<t:timestamp:R>), type (DM/Channel)
  ↓
[4] Add navigation buttons if > 10 reminders
  - Previous | Page X/Y | Next
  ↓
[5] Reply ephemeral
```

**Edge Cases:**

1. **No active reminders**
   - Show: "You have no active reminders. Use `/remind me` to create one."

2. **Pagination button spam**
   - **Problem:** User clicks Next multiple times rapidly
   - **Solution:**
     ```javascript
     if (interaction.deferred || interaction.replied) {
       return; // Ignore duplicate clicks
     }
     await interaction.deferUpdate();
     ```

3. **Reminder fires while user is viewing list**
   - **Problem:** List becomes stale
   - **Solution:** Add "Last updated: <t:timestamp:R>" footer
   - **Enhancement:** Add 🔄 Refresh button

#### 1.4 Time Parser Implementation

**Supported Formats:**
```javascript
// Simple durations (MVP)
"10s" → 10 seconds
"30m" → 30 minutes
"2h" → 2 hours
"5d" → 5 days
"1w" → 1 week
"2h 30m" → 2.5 hours (compound)

// NOT SUPPORTED in MVP (too complex):
"tomorrow 3pm" ❌
"next friday" ❌
"in 2 weeks at 5pm" ❌
```

**Parser Logic:**
```javascript
function parseTime(input) {
  const regex = /(\d+)([smhdw])/g;
  let totalMs = 0;
  let match;

  while ((match = regex.exec(input.toLowerCase())) !== null) {
    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 's': totalMs += value * 1000; break;
      case 'm': totalMs += value * 60000; break;
      case 'h': totalMs += value * 3600000; break;
      case 'd': totalMs += value * 86400000; break;
      case 'w': totalMs += value * 604800000; break;
    }
  }

  if (totalMs === 0) {
    return { success: false, error: 'Invalid time format. Examples: 10m, 2h, 3d' };
  }

  const timestamp = Date.now() + totalMs;

  // Max 1 year
  if (totalMs > 31536000000) {
    return { success: false, error: 'Maximum reminder duration is 1 year' };
  }

  return { success: true, timestamp, duration: totalMs };
}
```

**Edge Cases:**

1. **Negative numbers:** "remind me -5m"
   - regex won't match negative, return error

2. **Decimal values:** "remind me 2.5h"
   - regex won't match, return error
   - Suggest: "Use `2h 30m` instead"

3. **Invalid units:** "remind me 5x test"
   - regex won't match, return error

4. **Huge numbers:** "remind me 999999999999d"
   - Will exceed max, caught by 1-year check

5. **Zero duration:** "remind me 0m"
   - totalMs = 0, return error

#### 1.5 Reminder Service Lifecycle

**Startup Sequence:**
```javascript
// In src/index.js
client.on(Events.ClientReady, async () => {
  client.reminderService = new ReminderService(client);
  await client.reminderService.loadReminders();
  logger.success('Reminder system initialized');
});
```

**Load Reminders:**
```javascript
async loadReminders() {
  const now = Date.now();
  const gracePeriod = 5 * 60 * 1000; // 5 minutes

  // Get all active reminders
  const activeReminders = await db.select()
    .from(reminders)
    .where(eq(reminders.active, 1));

  logger.info(`Loading ${activeReminders.length} active reminders`);

  for (const reminder of activeReminders) {
    if (reminder.triggerAt <= now) {
      // Overdue
      if (now - reminder.triggerAt < gracePeriod) {
        // Within grace period, fire immediately
        logger.info(`Firing overdue reminder ${reminder.id} (${Math.round((now - reminder.triggerAt) / 1000)}s late)`);
        await this.fireReminder(reminder.id);
      } else {
        // Too old, mark as missed
        logger.warn(`Reminder ${reminder.id} missed by ${Math.round((now - reminder.triggerAt) / 60000)}min, marking inactive`);
        await db.update(reminders)
          .set({ active: 0 })
          .where(eq(reminders.id, reminder.id));
      }
    } else {
      // Future reminder, schedule it
      this.scheduleReminder(reminder);
    }
  }
}
```

**Memory Management:**
```javascript
class ReminderService {
  constructor(client) {
    this.client = client;
    this.activeTimers = new Map(); // reminderId -> timeoutId
    this.longDelayChecks = new Map(); // reminderId -> intervalId

    // Cleanup on process exit
    process.on('SIGTERM', () => this.cleanup());
    process.on('SIGINT', () => this.cleanup());
  }

  cleanup() {
    logger.info('Cleaning up reminder service...');
    this.activeTimers.forEach(timeoutId => clearTimeout(timeoutId));
    this.longDelayChecks.forEach(intervalId => clearInterval(intervalId));
    this.activeTimers.clear();
    this.longDelayChecks.clear();
  }
}
```

### Database Schema Details

```javascript
export const reminders = sqliteTable('reminders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('userId').notNull(),
  guildId: text('guildId'), // null for DM reminders
  channelId: text('channelId'), // null for DM reminders
  message: text('message').notNull(),
  triggerAt: integer('triggerAt', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
  recurring: text('recurring'), // null for one-time, 'daily'/'weekly'/'monthly' for recurring
  active: integer('active', { mode: 'boolean' }).default(1).notNull()
}, (table) => ({
  userActiveIdx: index('reminders_user_active_idx').on(table.userId, table.active),
  triggerIdx: index('reminders_trigger_idx').on(table.triggerAt, table.active),
  guildIdx: index('reminders_guild_idx').on(table.guildId, table.active)
}));
```

**Indexes Explained:**
- `userActiveIdx`: Fast lookup for `/remind list`
- `triggerIdx`: Fast lookup for upcoming reminders (scheduler queries)
- `guildIdx`: Fast cleanup when bot leaves guild

### Concurrency & Race Conditions

**Scenario 1: User cancels while reminder is firing**
```javascript
// In cancelReminder()
async cancelReminder(reminderId, userId) {
  // Atomic check and update
  const result = await db.update(reminders)
    .set({ active: 0 })
    .where(and(
      eq(reminders.id, reminderId),
      eq(reminders.userId, userId),
      eq(reminders.active, 1)
    ))
    .returning();

  if (result.length === 0) {
    throw new Error('Reminder not found or already inactive');
  }

  // Clear timeout (safe even if already fired)
  if (this.activeTimers.has(reminderId)) {
    clearTimeout(this.activeTimers.get(reminderId));
    this.activeTimers.delete(reminderId);
  }
}
```

**Scenario 2: Multiple bot instances (sharding)**
- **Problem:** If bot is sharded, multiple instances might try to fire same reminder
- **Solution:** Use DB as source of truth
  ```javascript
  async fireReminder(reminderId) {
    // Atomic check-and-mark
    const result = await db.update(reminders)
      .set({ active: 0 })
      .where(and(
        eq(reminders.id, reminderId),
        eq(reminders.active, 1)
      ))
      .returning();

    if (result.length === 0) {
      // Another instance already fired it
      logger.debug(`Reminder ${reminderId} already fired by another instance`);
      return;
    }

    // We won the race, send the reminder
    const reminder = result[0];
    // ... send DM/channel message
  }
  ```

---

## Feature 2: Starboard

### Detailed Implementation Flow

#### 2.1 Reaction Event Flow

**messageReactionAdd:**
```
User adds ⭐ to message
  ↓
[1] Check if reaction is partial
  ↓ YES → fetch full reaction
  ↓
[2] Ignore if user is bot
  ↓
[3] Fetch starboard config for guild
  ↓ Not found → return (starboard disabled)
  ↓ enabled = 0 → return
  ↓
[4] Check if emoji matches config.emoji
  ↓ No match → return
  ↓
[5] Fetch message (may be partial)
  ↓
[6] Count valid stars
  - reaction.users.fetch() to get all reactors
  - Filter out message author (no self-starring)
  - Filter out bots
  ↓
[7] Check if already in starboard DB
  ↓ YES → Update star count
    ↓
    [7a] If count >= threshold:
      ↓ starboardMessageId exists?
        ↓ YES → Edit starboard message
        ↓ NO → Post to starboard (was previously removed)
    ↓
    [7b] If count < threshold:
      ↓ starboardMessageId exists?
        ↓ YES → Delete from starboard, set starboardMessageId = null
  ↓
  ↓ NO → New starred message
    ↓
    [8] If count >= threshold:
      ↓ Cache message content, first image
      ↓ Post to starboard channel
      ↓ Insert to DB with starboardMessageId
```

**Edge Cases:**

1. **Self-starring prevention**
   ```javascript
   async countValidStars(message, reaction) {
     const users = await reaction.users.fetch();
     const validStars = users.filter(user =>
       !user.bot && user.id !== message.author.id
     );
     return validStars.size;
   }
   ```

2. **Partial message/reaction**
   ```javascript
   // In messageReactionAdd event
   if (reaction.partial) {
     try {
       await reaction.fetch();
     } catch (error) {
       logger.error('Failed to fetch partial reaction:', error);
       return;
     }
   }

   if (reaction.message.partial) {
     try {
       await reaction.message.fetch();
     } catch (error) {
       logger.error('Failed to fetch partial message:', error);
       return;
     }
   }
   ```

3. **Starboard channel deleted**
   ```javascript
   async postToStarboard(message, starCount) {
     const channel = await this.client.channels.fetch(config.channelId).catch(() => null);

     if (!channel) {
       // Channel deleted, disable starboard
       await db.update(starboardConfig)
         .set({ enabled: 0 })
         .where(eq(starboardConfig.guildId, message.guild.id));

       // Notify guild owner
       const owner = await message.guild.fetchOwner();
       await owner.send({
         embeds: [embeds.warn(
           'Starboard Disabled',
           `The starboard channel in **${message.guild.name}** was deleted. Starboard has been disabled.`
         )]
       }).catch(() => {}); // Owner may have DMs off

       return;
     }

     // Continue posting...
   }
   ```

4. **Message deleted from starboard**
   - **Detection:** Edit starboard message fails with 10008 (Unknown Message)
   - **Action:** Re-post to starboard, update starboardMessageId
   ```javascript
   try {
     await starboardMsg.edit({ embeds: [newEmbed] });
   } catch (error) {
     if (error.code === 10008) {
       // Message deleted, re-post
       const newMsg = await starboardChannel.send({ embeds: [newEmbed] });
       await db.update(starboardMessages)
         .set({ starboardMessageId: newMsg.id })
         .where(eq(starboardMessages.id, entry.id));
     }
   }
   ```

5. **Original message deleted**
   ```javascript
   // In messageDelete event
   module.exports = {
     name: Events.MessageDelete,
     async execute(message, client) {
       // Check if message is in starboard
       const entry = await db.select()
         .from(starboardMessages)
         .where(eq(starboardMessages.originalMessageId, message.id))
         .get();

       if (entry) {
         // Keep in starboard with "[Original message deleted]" footer
         const starboardChannel = await client.channels.fetch(config.channelId);
         const starboardMsg = await starboardChannel.messages.fetch(entry.starboardMessageId);

         const embed = starboardMsg.embeds[0];
         embed.setFooter({ text: '⚠️ Original message deleted' });

         await starboardMsg.edit({ embeds: [embed] });
       }
     }
   };
   ```

6. **Mass reaction purge**
   - **Detection:** `messageReactionRemoveAll` event
   - **Action:** Recount stars from scratch
   ```javascript
   module.exports = {
     name: Events.MessageReactionRemoveAll,
     async execute(message, reactions, client) {
       // Message lost all reactions
       const entry = await db.select()
         .from(starboardMessages)
         .where(eq(starboardMessages.originalMessageId, message.id))
         .get();

       if (entry && entry.starboardMessageId) {
         // Remove from starboard
         const starboardChannel = await client.channels.fetch(config.channelId);
         await starboardChannel.messages.delete(entry.starboardMessageId).catch(() => {});

         // Update DB
         await db.update(starboardMessages)
           .set({ starCount: 0, starboardMessageId: null })
           .where(eq(starboardMessages.id, entry.id));
       }
     }
   };
   ```

7. **NSFW content filtering**
   ```javascript
   async postToStarboard(message, starCount) {
     const starboardChannel = await this.client.channels.fetch(config.channelId);

     // If original message is NSFW but starboard channel isn't, skip
     if (message.channel.nsfw && !starboardChannel.nsfw) {
       logger.info(`Skipping NSFW message ${message.id} - starboard channel not NSFW`);
       return;
     }

     // Continue posting...
   }
   ```

#### 2.2 Starboard Embed Format

```javascript
function createStarboardEmbed(message, starCount) {
  const embed = embeds.base(
    `${config.emoji} ${starCount} | #${message.channel.name}`,
    message.content || '*[No content]*'
  );

  embed.setAuthor({
    name: message.author.tag,
    iconURL: message.author.displayAvatarURL()
  });

  // Add first image if exists
  const attachment = message.attachments.find(att =>
    att.contentType?.startsWith('image/')
  );
  if (attachment) {
    embed.setImage(attachment.url);
  }

  // Jump link
  embed.addFields({
    name: 'Source',
    value: `[Jump to message](${message.url})`
  });

  embed.setTimestamp(message.createdAt);

  return embed;
}
```

#### 2.3 Star Count Update Debouncing

**Problem:** If 10 users star a message rapidly, we'd make 10 API calls to update the starboard message.

**Solution:** Debounce updates
```javascript
class StarboardService {
  constructor(client) {
    this.client = client;
    this.updateQueue = new Map(); // messageId -> timeout
  }

  async queueStarboardUpdate(messageId) {
    // Clear existing timeout
    if (this.updateQueue.has(messageId)) {
      clearTimeout(this.updateQueue.get(messageId));
    }

    // Set new timeout (5 seconds)
    const timeout = setTimeout(async () => {
      await this.updateStarboardMessage(messageId);
      this.updateQueue.delete(messageId);
    }, 5000);

    this.updateQueue.set(messageId, timeout);
  }

  async updateStarboardMessage(messageId) {
    // Fetch current star count from Discord
    // Update starboard embed
  }
}
```

### Database Schema Details

```javascript
export const starboardConfig = sqliteTable('starboardConfig', {
  guildId: text('guildId').primaryKey(),
  channelId: text('channelId').notNull(),
  threshold: integer('threshold').default(5).notNull(),
  emoji: text('emoji').default('⭐').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).default(1).notNull()
});

export const starboardMessages = sqliteTable('starboardMessages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guildId: text('guildId').notNull(),
  originalMessageId: text('originalMessageId').notNull().unique(),
  originalChannelId: text('originalChannelId').notNull(),
  starboardMessageId: text('starboardMessageId'),
  authorId: text('authorId').notNull(),
  starCount: integer('starCount').default(0).notNull(),
  content: text('content'), // Cached content
  imageUrl: text('imageUrl'), // First attachment URL
  postedAt: integer('postedAt', { mode: 'timestamp_ms' }).notNull()
}, (table) => ({
  guildStarCountIdx: index('starboard_guild_starcount_idx').on(table.guildId, table.starCount),
  authorGuildIdx: index('starboard_author_guild_idx').on(table.authorId, table.guildId)
}));
```

### Required Intents

```javascript
// In src/index.js
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions, // ← NEW for starboard
  ]
});
```

### Reaction Event Handler Pattern

```javascript
// src/events/messageReactionAdd.js
const { Events } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageReactionAdd,
  async execute(reaction, user, client) {
    try {
      // Handle partials
      if (reaction.partial) await reaction.fetch();
      if (reaction.message.partial) await reaction.message.fetch();

      // Ignore bots
      if (user.bot) return;

      // Check starboard
      if (client.starboardService) {
        await client.starboardService.handleReactionAdd(reaction, user);
      }
    } catch (error) {
      logger.error('Error in messageReactionAdd:', error);
    }
  }
};
```

---

## Feature 3: Birthday Tracker

### Detailed Implementation Flow

#### 3.1 Birthday Registration

**Flow:**
```
User: /birthday set 03-15
  ↓
[1] Parse date string (MM-DD format)
  ↓ Invalid format → Error: "Invalid format. Use MM-DD (e.g., 03-15)"
  ↓
[2] Validate month (1-12)
  ↓ Invalid → Error: "Invalid month. Must be 01-12"
  ↓
[3] Validate day for month
  ↓ Feb 30 → Error: "February only has 29 days"
  ↓ Nov 31 → Error: "November only has 30 days"
  ↓
[4] Special case: Feb 29 (leap year)
  ↓ Show warning: "Leap year birthday! Will be celebrated on Feb 28 in non-leap years."
  ↓
[5] Check if user already has birthday set
  ↓ EXISTS → Update existing record
  ↓ NEW → Insert new record
  ↓
[6] Reply with confirmation
  "Birthday set to [Month Day]! You'll be celebrated in this server on your birthday. 🎂"
```

**Edge Cases:**

1. **Invalid date formats**
   ```javascript
   function parseBirthday(input) {
     // Validate format: MM-DD
     const regex = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

     if (!regex.test(input)) {
       return { valid: false, error: 'Invalid format. Use MM-DD (e.g., 03-15 for March 15th)' };
     }

     const [month, day] = input.split('-').map(Number);

     // Validate day for month
     const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

     if (day > daysInMonth[month - 1]) {
       const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
       return { valid: false, error: `${monthNames[month - 1]} only has ${daysInMonth[month - 1]} days` };
     }

     return { valid: true, month, day };
   }
   ```

2. **Leap year birthdays (Feb 29)**
   ```javascript
   async checkBirthdays() {
     const today = new Date();
     const month = today.getUTCMonth() + 1;
     const day = today.getUTCDate();

     // Check for Feb 29 birthdays on Feb 28 in non-leap years
     const isLeapYear = (year) => (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);

     let birthdayQuery = eq(birthdays.month, month);

     if (month === 2 && day === 28 && !isLeapYear(today.getUTCFullYear())) {
       // Non-leap year Feb 28: also check for Feb 29 birthdays
       birthdayQuery = and(
         eq(birthdays.month, 2),
         or(
           eq(birthdays.day, 28),
           eq(birthdays.day, 29)
         )
       );
     } else {
       birthdayQuery = and(
         eq(birthdays.month, month),
         eq(birthdays.day, day)
       );
     }

     // Query birthdays...
   }
   ```

3. **User in multiple guilds**
   - **Problem:** User sets birthday in Guild A, also in Guild B
   - **Solution:** Store per-guild birthdays (composite unique: userId + guildId)
   - **UX:** When user runs `/birthday set` in new guild, it's a separate entry
   ```javascript
   await db.insert(birthdays).values({
     userId: interaction.user.id,
     guildId: interaction.guild.id,
     month,
     day,
     createdAt: Date.now()
   }).onConflictDoUpdate({
     target: [birthdays.userId, birthdays.guildId], // Composite key
     set: { month, day }
   });
   ```

4. **Timezone hell**
   - **Decision:** Use UTC midnight only (simple, predictable)
   - **Future:** Add per-guild timezone setting (Phase 2)
   - **Implementation:**
   ```javascript
   startDailyCheck() {
     // Calculate ms until next midnight UTC
     const now = new Date();
     const tomorrow = new Date(now);
     tomorrow.setUTCHours(24, 0, 0, 0);
     const msUntilMidnight = tomorrow - now;

     // Schedule first check
     setTimeout(() => {
       this.checkBirthdays();

       // Then check every 24 hours
       setInterval(() => {
         this.checkBirthdays();
       }, 86400000); // 24 hours
     }, msUntilMidnight);

     logger.info(`Birthday checker will run in ${Math.round(msUntilMidnight / 60000)} minutes`);
   }
   ```

#### 3.2 Birthday Announcements

**Flow:**
```
Midnight UTC hits
  ↓
[1] Query all guilds with enabled=1
  ↓
[2] For each guild:
  ↓
  [3] Query birthdays for today (month + day)
    ↓
  [4] Fetch guild
    ↓ Guild not found → Skip (bot was kicked)
    ↓
  [5] Fetch announcement channel
    ↓ Channel not found → Disable system, notify owner
    ↓
  [6] Filter users (only keep members still in guild)
    ↓
  [7] If no valid birthday members → Skip
    ↓
  [8] Build announcement embed
    ↓
  [9] Send to channel
    ↓
  [10] If birthday role configured:
    ↓ Assign role to birthday members
    ↓ Schedule role removal after 24 hours
    ↓
  [11] Update lastCheck timestamp
```

**Edge Cases:**

1. **Bot offline at midnight**
   ```javascript
   // On startup (ready.js)
   async startDailyCheck() {
     // Check if we missed yesterday's check
     const lastCheck = await db.select()
       .from(birthdayConfig)
       .where(eq(birthdayConfig.enabled, 1));

     const yesterdayMidnight = new Date();
     yesterdayMidnight.setUTCHours(0, 0, 0, 0);
     yesterdayMidnight.setUTCDate(yesterdayMidnight.getUTCDate() - 1);

     for (const config of lastCheck) {
       if (!config.lastCheck || config.lastCheck < yesterdayMidnight.getTime()) {
         logger.info(`Missed birthday check for guild ${config.guildId}, running now`);
         await this.checkBirthdaysForGuild(config.guildId);
       }
     }

     // Continue with normal schedule...
   }
   ```

2. **User left guild**
   ```javascript
   async checkBirthdaysForGuild(guildId) {
     const todayBirthdays = /* query birthdays */;
     const guild = await this.client.guilds.fetch(guildId);

     // Filter to only members still in guild
     const validMembers = [];
     for (const birthday of todayBirthdays) {
       const member = await guild.members.fetch(birthday.userId).catch(() => null);
       if (member) {
         validMembers.push(member);
       }
     }

     if (validMembers.length === 0) {
       logger.debug(`No valid birthday members in guild ${guildId}`);
       return;
     }

     // Continue with announcement...
   }
   ```

3. **Announcement channel deleted**
   ```javascript
   const channel = await this.client.channels.fetch(config.channelId).catch(() => null);

   if (!channel) {
     // Disable system
     await db.update(birthdayConfig)
       .set({ enabled: 0 })
       .where(eq(birthdayConfig.guildId, guildId));

     // Notify owner
     const guild = await this.client.guilds.fetch(guildId);
     const owner = await guild.fetchOwner();
     await owner.send({
       embeds: [embeds.warn(
         'Birthday Announcements Disabled',
         `The birthday announcement channel in **${guild.name}** was deleted. Birthday system has been disabled. Use \`/birthday setup\` to reconfigure.`
       )]
     }).catch(() => {});

     return;
   }
   ```

4. **Birthday role deleted**
   ```javascript
   if (config.roleId) {
     const role = guild.roles.cache.get(config.roleId);

     if (!role) {
       logger.warn(`Birthday role ${config.roleId} not found in guild ${guildId}`);
       // Continue without role, don't disable system
     } else {
       // Assign role
       for (const member of validMembers) {
         await member.roles.add(role).catch(err => {
           logger.error(`Failed to assign birthday role to ${member.id}:`, err);
         });
       }

       // Schedule removal after 24 hours
       setTimeout(async () => {
         for (const member of validMembers) {
           await member.roles.remove(role).catch(() => {});
         }
       }, 86400000);
     }
   }
   ```

5. **Multiple birthdays on same day**
   ```javascript
   function getBirthdayEmbed(members) {
     const embed = embeds.brand(
       '🎂 Happy Birthday! 🎉',
       `Let's celebrate ${members.length > 1 ? 'these wonderful members' : 'this wonderful member'}:`
     );

     const mentions = members.map(m => `<@${m.id}>`).join(', ');
     embed.setDescription(mentions + '\n\n' + getRandomBirthdayMessage());

     embed.setFooter({ text: `🎈 Wishing you all the best!` });
     embed.setThumbnail('https://i.imgur.com/birthday-cake.png'); // Optional

     return embed;
   }

   function getRandomBirthdayMessage() {
     const messages = [
       'Hope your special day is filled with joy!',
       'Another year older, another year wiser! 🎈',
       'May your birthday be as awesome as you are!',
       'Cheers to another trip around the sun! ☀️',
       'Have a fantastic birthday! 🥳'
     ];
     return messages[Math.floor(Math.random() * messages.length)];
   }
   ```

6. **Birthday role conflict with existing roles**
   - **Problem:** User already has the birthday role (from manual assignment)
   - **Solution:** Check before adding, don't error
   ```javascript
   if (!member.roles.cache.has(role.id)) {
     await member.roles.add(role);
   }
   ```

#### 3.3 Privacy Considerations

**Data Stored:**
- ✅ Month and day only
- ❌ NO year (privacy)
- ❌ NO age calculation
- ❌ NO public age display

**Who can see birthdays?**
- Anyone in the guild can use `/birthday view @user`
- Future: Add privacy setting (hide from /view, but still announce)

**Opt-out:**
- `/birthday remove` - Deletes birthday from guild
- Birthday data is per-guild, not global

---

## Feature 4: User Context Menus

### Detailed Implementation Flow

#### 4.1 Context Menu Registration

**Command Handler Changes:**
```javascript
// src/handlers/commandHandler.js

// Add after slash command registration
async function registerContextMenus(client) {
  const contextMenuFiles = glob.sync('src/commands/context-menus/**/*.js');
  const contextMenus = [];

  for (const file of contextMenuFiles) {
    const menu = require(path.resolve(file));

    // Validate structure
    if (!menu.data || !menu.execute) {
      logger.warn(`Context menu ${file} is missing data or execute`);
      continue;
    }

    // Store in client
    client.contextMenus.set(menu.data.name, menu);
    contextMenus.push(menu.data.toJSON());

    logger.debug(`Loaded context menu: ${menu.data.name}`);
  }

  // Register to Discord
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: [...commands, ...contextMenus] } // Combine with slash commands
  );

  logger.success(`Registered ${contextMenus.length} context menus`);
}
```

**Interaction Handler Changes:**
```javascript
// src/events/interactionCreate.js

// Add after autocomplete handler
if (interaction.isUserContextMenuCommand() || interaction.isMessageContextMenuCommand()) {
  const menu = client.contextMenus.get(interaction.commandName);

  if (!menu) {
    logger.error(`No context menu matching ${interaction.commandName} was found.`);
    return;
  }

  // Same security pipeline as slash commands

  // 1. DM Check
  const isDM = !interaction.guild;
  const dmAllowed = menu.data.dm_permission !== false;

  if (isDM && !dmAllowed) {
    return interaction.reply({
      embeds: [embeds.error('Server Only', 'This action can only be used within a server.')],
      flags: [MessageFlags.Ephemeral]
    });
  }

  // 2. Permission checks (if in guild)
  if (interaction.guild && menu.permissions) {
    const { checkUserPermissions } = require('../utils/permissions');
    const { allowed, error } = await checkUserPermissions(interaction, menu);

    if (!allowed) {
      return interaction.reply({
        embeds: [error],
        flags: [MessageFlags.Ephemeral]
      });
    }
  }

  // 3. Execute
  try {
    await menu.execute(interaction, client);
  } catch (error) {
    logger.errorContext(`Error executing context menu: ${interaction.commandName}`, error, {
      menuName: interaction.commandName,
      userId: interaction.user.id,
      guildId: interaction.guildId,
      targetType: interaction.targetType
    });

    const errorMessage = embeds.error('Error', 'An error occurred while processing this action.');

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ embeds: [errorMessage], flags: [MessageFlags.Ephemeral] });
    } else {
      await interaction.reply({ embeds: [errorMessage], flags: [MessageFlags.Ephemeral] });
    }
  }

  return;
}
```

#### 4.2 Individual Context Menus

##### View Avatar

**Implementation:**
```javascript
// src/commands/context-menus/avatar.js
const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('View Avatar')
    .setType(ApplicationCommandType.User),
  // No dm_permission set, defaults to true (works in DMs)

  async execute(interaction) {
    const user = interaction.targetUser;
    const member = interaction.targetMember; // null if in DMs

    // Get avatar URLs
    const userAvatar = user.displayAvatarURL({ size: 4096, extension: 'png' });
    const guildAvatar = member?.avatarURL({ size: 4096, extension: 'png' });

    const embed = embeds.brand(
      `${user.tag}'s Avatar`,
      guildAvatar && guildAvatar !== userAvatar
        ? '**Server Avatar** (below) • [User Avatar](' + userAvatar + ')'
        : null
    );

    // Show guild avatar if different, else user avatar
    embed.setImage(guildAvatar || userAvatar);

    // Download links
    const links = [];
    if (guildAvatar) {
      links.push(`[Server PNG](${guildAvatar})`);
      links.push(`[Server WebP](${member.avatarURL({ size: 4096, extension: 'webp' })})`);
    }
    links.push(`[User PNG](${userAvatar})`);
    links.push(`[User WebP](${user.displayAvatarURL({ size: 4096, extension: 'webp' })})`);

    embed.addFields({
      name: 'Download',
      value: links.join(' • ')
    });

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral]
    });
  }
};
```

**Edge Cases:**
1. **User has no custom avatar** → Show default Discord avatar
2. **Guild avatar same as user avatar** → Don't show redundant info
3. **Animated avatar** → Add GIF download link

##### User Info

**Implementation:**
```javascript
// src/commands/context-menus/userinfo.js
const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const embeds = require('../../utils/embeds');
const { db } = require('../../database');
const { users } = require('../../database/schema');
const { eq } = require('drizzle-orm');

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('User Info')
    .setType(ApplicationCommandType.User),

  async execute(interaction) {
    const user = interaction.targetUser;
    const member = interaction.targetMember; // null if in DMs

    const embed = embeds.info(
      `${user.tag}`,
      `**User ID:** \`${user.id}\``
    );

    embed.setThumbnail(user.displayAvatarURL({ size: 256 }));

    // Account info
    const createdAt = Math.floor(user.createdTimestamp / 1000);
    embed.addFields({
      name: 'Account Created',
      value: `<t:${createdAt}:F> (<t:${createdAt}:R>)`,
      inline: false
    });

    // Guild-specific info (only if in guild)
    if (member) {
      const joinedAt = Math.floor(member.joinedTimestamp / 1000);
      embed.addFields({
        name: 'Joined Server',
        value: `<t:${joinedAt}:F> (<t:${joinedAt}:R>)`,
        inline: false
      });

      // Roles (top 20)
      const roles = member.roles.cache
        .filter(role => role.id !== interaction.guild.id)
        .sort((a, b) => b.position - a.position)
        .map(role => role.toString())
        .slice(0, 20);

      if (roles.length > 0) {
        embed.addFields({
          name: `Roles [${member.roles.cache.size - 1}]`,
          value: roles.join(', ') + (member.roles.cache.size > 21 ? '...' : ''),
          inline: false
        });
      }

      // Nickname
      if (member.nickname) {
        embed.addFields({
          name: 'Nickname',
          value: member.nickname,
          inline: true
        });
      }
    }

    // Bot stats from DB
    const userData = await db.select()
      .from(users)
      .where(eq(users.id, user.id))
      .get();

    if (userData) {
      embed.addFields({
        name: 'Bot Activity',
        value: `Commands Run: ${userData.commandsRun}\nLast Seen: <t:${Math.floor(new Date(userData.lastSeen).getTime() / 1000)}:R>`,
        inline: false
      });
    }

    // Badges
    const flags = user.flags?.toArray() || [];
    if (flags.length > 0) {
      const badgeEmojis = {
        Staff: '👮',
        Partner: '🤝',
        Hypesquad: '🎉',
        BugHunterLevel1: '🐛',
        BugHunterLevel2: '🐛🐛',
        PremiumEarlySupporter: '💎',
        VerifiedDeveloper: '🔧'
      };

      const badges = flags.map(flag => badgeEmojis[flag] || flag).join(' ');
      embed.addFields({
        name: 'Badges',
        value: badges,
        inline: false
      });
    }

    // Bot/System indicators
    if (user.bot) {
      embed.setFooter({ text: '🤖 Bot Account' });
    } else if (user.system) {
      embed.setFooter({ text: '⚙️ System Account' });
    }

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral]
    });
  }
};
```

**Edge Cases:**
1. **User not in guild (DM context)** → Skip guild-specific fields
2. **User has no DB entry** → Skip bot activity section
3. **User has 100+ roles** → Truncate to top 20 + "..."

##### Copy ID

**Implementation:**
```javascript
// src/commands/context-menus/copyid.js
const { ContextMenuCommandBuilder, ApplicationCommandType, MessageFlags } = require('discord.js');

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Copy User ID')
    .setType(ApplicationCommandType.User),

  async execute(interaction) {
    const user = interaction.targetUser;

    await interaction.reply({
      content: `**User ID:**\n\`\`\`\n${user.id}\n\`\`\`\nClick to select and copy!`,
      flags: [MessageFlags.Ephemeral]
    });
  }
};
```

**Edge Cases:** None (extremely simple)

##### Check Permissions

**Implementation:**
```javascript
// src/commands/context-menus/permissions.js
const { ContextMenuCommandBuilder, ApplicationCommandType, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Check Permissions')
    .setType(ApplicationCommandType.User)
    .setDMPermission(false), // Guild only

  async execute(interaction) {
    const member = interaction.targetMember;
    const channel = interaction.channel;

    // Get permissions in current channel
    const permissions = member.permissionsIn(channel);

    // Categorize permissions
    const dangerous = [];
    const important = [];
    const other = [];

    const dangerousPerms = [
      'Administrator',
      'ManageGuild',
      'ManageRoles',
      'ManageChannels',
      'BanMembers',
      'KickMembers',
      'ManageWebhooks',
      'ManageNicknames'
    ];

    const importantPerms = [
      'SendMessages',
      'EmbedLinks',
      'AttachFiles',
      'ManageMessages',
      'MentionEveryone',
      'UseExternalEmojis',
      'Connect',
      'Speak',
      'MoveMembers',
      'MuteMembers',
      'DeafenMembers'
    ];

    for (const [perm, value] of Object.entries(PermissionFlagsBits)) {
      if (permissions.has(value)) {
        if (dangerousPerms.includes(perm)) {
          dangerous.push(perm);
        } else if (importantPerms.includes(perm)) {
          important.push(perm);
        } else {
          other.push(perm);
        }
      }
    }

    const embed = embeds.info(
      `Permissions for ${member.user.tag}`,
      `**Channel:** ${channel.toString()}`
    );

    if (permissions.has(PermissionFlagsBits.Administrator)) {
      embed.addFields({
        name: '⚠️ Administrator',
        value: 'This user has the Administrator permission, which grants **ALL** permissions.',
        inline: false
      });
    }

    if (dangerous.length > 0) {
      embed.addFields({
        name: '🔴 Dangerous Permissions',
        value: dangerous.map(p => `\`${p}\``).join(', '),
        inline: false
      });
    }

    if (important.length > 0) {
      embed.addFields({
        name: '🟡 Important Permissions',
        value: important.map(p => `\`${p}\``).join(', '),
        inline: false
      });
    }

    if (other.length > 0 && other.length < 20) {
      embed.addFields({
        name: '🟢 Other Permissions',
        value: other.map(p => `\`${p}\``).join(', '),
        inline: false
      });
    }

    embed.setFooter({ text: `Total: ${dangerous.length + important.length + other.length} permissions` });

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral]
    });
  }
};
```

**Edge Cases:**
1. **Administrator permission** → Show warning, skip listing all perms
2. **Channel-specific overrides** → Permissions shown are for THIS channel only
3. **Too many permissions** → Group into categories

##### Activity History

**Implementation:**
```javascript
// src/commands/context-menus/activity.js
const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const embeds = require('../../utils/embeds');
const { db } = require('../../database');
const { users, bytepodVoiceStats } = require('../../database/schema');
const { eq, and } = require('drizzle-orm');

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Activity History')
    .setType(ApplicationCommandType.User)
    .setDMPermission(false), // Guild only

  async execute(interaction) {
    const user = interaction.targetUser;
    const member = interaction.targetMember;
    const guild = interaction.guild;

    const embed = embeds.info(
      `Activity History for ${user.tag}`,
      null
    );

    embed.setThumbnail(user.displayAvatarURL({ size: 128 }));

    // Bot stats
    const userData = await db.select()
      .from(users)
      .where(and(
        eq(users.id, user.id),
        eq(users.guildId, guild.id)
      ))
      .get();

    if (userData) {
      embed.addFields({
        name: '📊 Bot Usage',
        value: `Commands Run: **${userData.commandsRun}**\nLast Seen: <t:${Math.floor(new Date(userData.lastSeen).getTime() / 1000)}:R>`,
        inline: false
      });
    }

    // Voice stats
    const voiceStats = await db.select()
      .from(bytepodVoiceStats)
      .where(and(
        eq(bytepodVoiceStats.userId, user.id),
        eq(bytepodVoiceStats.guildId, guild.id)
      ))
      .get();

    if (voiceStats && voiceStats.totalSeconds > 0) {
      const hours = Math.floor(voiceStats.totalSeconds / 3600);
      const minutes = Math.floor((voiceStats.totalSeconds % 3600) / 60);

      embed.addFields({
        name: '🎙️ Voice Activity (BytePods)',
        value: `Total Time: **${hours}h ${minutes}m**\nSessions: **${voiceStats.sessionCount}**`,
        inline: false
      });
    }

    // Current voice channel
    if (member.voice.channel) {
      embed.addFields({
        name: '🔊 Currently In',
        value: `Voice: ${member.voice.channel.toString()}${member.voice.mute ? ' (Muted)' : ''}${member.voice.deaf ? ' (Deafened)' : ''}`,
        inline: false
      });
    }

    // Try to get last message in current channel
    try {
      const messages = await interaction.channel.messages.fetch({ limit: 100 });
      const lastMsg = messages.find(m => m.author.id === user.id);

      if (lastMsg) {
        const timestamp = Math.floor(lastMsg.createdTimestamp / 1000);
        embed.addFields({
          name: '💬 Last Message (this channel)',
          value: `<t:${timestamp}:R> • [Jump](${lastMsg.url})`,
          inline: false
        });
      }
    } catch (error) {
      // Ignore if can't fetch messages
    }

    // If no data found
    if (embed.data.fields?.length === 0) {
      embed.setDescription('No activity data available for this user.');
    }

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral]
    });
  }
};
```

**Edge Cases:**
1. **User has no activity** → Show "No data available"
2. **Can't fetch messages** → Skip last message field
3. **User in voice but bot can't see** → Show channel name only

##### Mod Actions

**Implementation:**
```javascript
// src/commands/context-menus/modactions.js
const { ContextMenuCommandBuilder, ApplicationCommandType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Moderate User')
    .setType(ApplicationCommandType.User)
    .setDMPermission(false), // Guild only

  permissions: ['ManageMessages'], // Require mod permissions

  async execute(interaction) {
    const target = interaction.targetUser;
    const targetMember = interaction.targetMember;
    const executor = interaction.member;

    // Can't moderate self
    if (target.id === interaction.user.id) {
      return interaction.reply({
        embeds: [embeds.error('Invalid Target', 'You cannot moderate yourself.')],
        flags: [MessageFlags.Ephemeral]
      });
    }

    // Can't moderate bots (unless you're admin)
    if (target.bot && !executor.permissions.has('Administrator')) {
      return interaction.reply({
        embeds: [embeds.error('Invalid Target', 'You cannot moderate bots.')],
        flags: [MessageFlags.Ephemeral]
      });
    }

    // Role hierarchy check
    if (targetMember && executor.roles.highest.position <= targetMember.roles.highest.position) {
      return interaction.reply({
        embeds: [embeds.error('Insufficient Permissions', 'You cannot moderate users with equal or higher roles.')],
        flags: [MessageFlags.Ephemeral]
      });
    }

    // Build action buttons
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`mod_warn_${target.id}`)
          .setLabel('Warn')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('⚠️'),
        new ButtonBuilder()
          .setCustomId(`mod_kick_${target.id}`)
          .setLabel('Kick')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('👢'),
        new ButtonBuilder()
          .setCustomId(`mod_ban_${target.id}`)
          .setLabel('Ban')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🔨'),
        new ButtonBuilder()
          .setCustomId(`mod_history_${target.id}`)
          .setLabel('History')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📋')
      );

    const embed = embeds.brand(
      'Moderation Actions',
      `**Target:** ${target.tag}\n**ID:** \`${target.id}\`\n\nSelect an action below:`
    );

    embed.setThumbnail(target.displayAvatarURL({ size: 128 }));

    await interaction.reply({
      embeds: [embed],
      components: [row],
      flags: [MessageFlags.Ephemeral]
    });
  },

  // Handler for button interactions
  async handleButton(interaction) {
    const [action, type, userId] = interaction.customId.split('_');

    if (action !== 'mod') return;

    switch (type) {
      case 'warn':
        // Show modal for reason
        const warnModal = new ModalBuilder()
          .setCustomId(`modal_warn_${userId}`)
          .setTitle('Warn User');

        const reasonInput = new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500);

        warnModal.addComponents(
          new ActionRowBuilder().addComponents(reasonInput)
        );

        await interaction.showModal(warnModal);
        break;

      case 'kick':
        // Similar modal flow
        break;

      case 'ban':
        // Similar modal flow
        break;

      case 'history':
        // Show moderation history (reuse /warnings logic)
        const { db } = require('../../database');
        const { moderationLogs } = require('../../database/schema');
        const { eq } = require('drizzle-orm');

        const logs = await db.select()
          .from(moderationLogs)
          .where(eq(moderationLogs.targetId, userId))
          .orderBy(desc(moderationLogs.timestamp))
          .limit(10);

        if (logs.length === 0) {
          return interaction.reply({
            content: 'No moderation history found.',
            flags: [MessageFlags.Ephemeral]
          });
        }

        // Build embed with history
        const historyEmbed = embeds.info(
          'Moderation History',
          logs.map(log =>
            `**${log.action}** by <@${log.executorId}>\n` +
            `<t:${Math.floor(log.timestamp / 1000)}:R> • ${log.reason}`
          ).join('\n\n')
        );

        await interaction.reply({
          embeds: [historyEmbed],
          flags: [MessageFlags.Ephemeral]
        });
        break;
    }
  }
};
```

**Edge Cases:**
1. **User left guild** → Show error "User no longer in server"
2. **Role hierarchy** → Can't moderate higher/equal roles
3. **Bot permissions** → Check bot can kick/ban before showing button
4. **Self-moderation** → Block attempting to moderate yourself
5. **Targeting bots** → Require Administrator to moderate bots

**Button Handler Integration:**
```javascript
// In interactionCreate.js
if (interaction.isButton() && interaction.customId.startsWith('mod_')) {
  const modActionsMenu = client.contextMenus.get('Moderate User');
  if (modActionsMenu && modActionsMenu.handleButton) {
    await modActionsMenu.handleButton(interaction);
  }
  return;
}

if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_warn_')) {
  // Extract userId from customId
  const userId = interaction.customId.split('_')[2];
  const reason = interaction.fields.getTextInputValue('reason');

  // Reuse existing /warn command logic
  const warnCommand = client.commands.get('warn');
  // ... execute warn

  await interaction.reply({
    embeds: [embeds.success('User Warned', `<@${userId}> has been warned.`)],
    flags: [MessageFlags.Ephemeral]
  });
}
```

### Context Menu DM Handling Summary

| Menu | DM Permission | Reasoning |
|------|---------------|-----------|
| View Avatar | ✅ Allowed | No guild data needed |
| User Info | ✅ Allowed | Shows basic info, skips guild fields in DMs |
| Copy ID | ✅ Allowed | Universal feature |
| Check Permissions | ❌ Blocked | Permissions are channel/guild-specific |
| Activity History | ❌ Blocked | Requires guild data (DB queries) |
| Moderate User | ❌ Blocked | Must be in guild to moderate |

---

## Feature 5: Message Bookmarks

### Detailed Implementation Flow

#### 5.1 Bookmark via Context Menu

**Flow:**
```
User right-clicks message → Apps → "Bookmark Message"
  ↓
[1] Check if in guild
  ↓ DM → Error: "Bookmarks can only be saved from server messages"
  ↓ In guild
  ↓
[2] Check user's bookmark count
  ↓ ≥ 100 → Error: "You have reached the maximum of 100 bookmarks. Delete some with /bookmark delete"
  ↓ < 100
  ↓
[3] Check if already bookmarked
  ↓ Duplicate → Error: "You've already bookmarked this message!"
  ↓ New
  ↓
[4] Cache message data
  - content (text)
  - author ID
  - attachments (URLs, up to 5)
  - timestamp
  ↓
[5] Insert to DB
  ↓
[6] Try to send confirmation DM
  ↓ Success → DM contains:
    - Bookmark confirmation
    - Message preview (first 200 chars)
    - Author tag
    - Jump link to original
    - Bookmark ID (for deletion)
  ↓ Failure (DMs disabled) →
    Ephemeral reply: "Bookmark saved! (Couldn't DM you - check your privacy settings)"
  ↓
[7] Reply ephemeral in guild
  "✅ Message bookmarked! Check your DMs."
```

**Implementation:**
```javascript
// src/commands/context-menus/bookmark.js
const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const embeds = require('../../utils/embeds');
const { db } = require('../../database');
const { bookmarks } = require('../../database/schema');
const { eq, and, count } = require('drizzle-orm');

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Bookmark Message')
    .setType(ApplicationCommandType.Message)
    .setDMPermission(false), // Guild only

  async execute(interaction) {
    const message = interaction.targetMessage;
    const user = interaction.user;

    // Check bookmark limit
    const userBookmarkCount = await db.select({ count: count() })
      .from(bookmarks)
      .where(eq(bookmarks.userId, user.id))
      .get();

    if (userBookmarkCount.count >= 100) {
      return interaction.reply({
        embeds: [embeds.error(
          'Bookmark Limit Reached',
          'You have reached the maximum of 100 bookmarks. Use `/bookmark delete` to remove some.'
        )],
        flags: [MessageFlags.Ephemeral]
      });
    }

    // Check for duplicate
    const existing = await db.select()
      .from(bookmarks)
      .where(and(
        eq(bookmarks.userId, user.id),
        eq(bookmarks.messageId, message.id)
      ))
      .get();

    if (existing) {
      return interaction.reply({
        embeds: [embeds.warn('Already Bookmarked', 'You already have this message bookmarked!')],
        flags: [MessageFlags.Ephemeral]
      });
    }

    // Cache attachments (up to 5)
    const attachmentUrls = message.attachments
      .map(att => att.url)
      .slice(0, 5);

    // Insert bookmark
    const [bookmark] = await db.insert(bookmarks).values({
      userId: user.id,
      guildId: message.guild.id,
      channelId: message.channel.id,
      messageId: message.id,
      content: message.content || '[No content]',
      authorId: message.author.id,
      attachmentUrls: JSON.stringify(attachmentUrls),
      savedAt: Date.now(),
      messageDeleted: 0
    }).returning();

    // Build confirmation embed
    const confirmEmbed = embeds.success(
      '🔖 Message Bookmarked',
      `**From:** <@${message.author.id}> in <#${message.channel.id}>\n` +
      `**When:** <t:${Math.floor(message.createdTimestamp / 1000)}:R>\n\n` +
      `**Content:**\n${message.content.slice(0, 200)}${message.content.length > 200 ? '...' : ''}\n\n` +
      `[Jump to message](${message.url})`
    );

    confirmEmbed.setFooter({ text: `Bookmark ID: ${bookmark.id} • Use /bookmark list to view all` });

    if (attachmentUrls.length > 0) {
      confirmEmbed.addFields({
        name: 'Attachments',
        value: `${attachmentUrls.length} file(s) cached`
      });
    }

    // Try to DM user
    let dmSent = false;
    try {
      await user.send({ embeds: [confirmEmbed] });
      dmSent = true;
    } catch (error) {
      // User has DMs disabled
    }

    // Reply in guild
    if (dmSent) {
      await interaction.reply({
        content: '✅ Message bookmarked! Check your DMs.',
        flags: [MessageFlags.Ephemeral]
      });
    } else {
      await interaction.reply({
        embeds: [embeds.success(
          'Bookmark Saved',
          `Message bookmarked! (ID: ${bookmark.id})\n\n` +
          `⚠️ Couldn't send you a DM. Check your privacy settings or use \`/bookmark list\` to view your bookmarks.`
        )],
        flags: [MessageFlags.Ephemeral]
      });
    }
  }
};
```

**Edge Cases:**

1. **Message has no content (image-only)**
   - Store `"[Image message]"` or `"[Attachment message]"`
   - Cache first attachment URL as primary content

2. **Message has 10+ attachments**
   - Only cache first 5 (Discord CDN links, no permanent storage)
   - Note in bookmark: "5+ attachments"

3. **Attachment CDN links expire**
   - **Problem:** Discord CDN links may expire after time
   - **Solution:** Show warning in `/bookmark list`: "⚠️ Attachment links may have expired"
   - **Future:** Download and rehost (complex, needs file storage)

4. **Message is deleted before bookmark saved**
   - **Detection:** message.fetch() throws 10008
   - **Action:** Still allow bookmark (cache what we have)
   - **Mark:** messageDeleted = 1 immediately

#### 5.2 Command: `/bookmark list`

**Flow:**
```
User: /bookmark list [page]
  ↓
[1] Query user's bookmarks
  SELECT * FROM bookmarks
  WHERE userId = ?
  ORDER BY savedAt DESC
  LIMIT 10 OFFSET (page - 1) * 10
  ↓
[2] Count total bookmarks
  ↓
[3] Calculate pages (total / 10)
  ↓
[4] Build embed
  For each bookmark:
    - Show ID, author, channel
    - Content preview (100 chars)
    - Timestamp
    - [DELETED] flag if messageDeleted = 1
  ↓
[5] Add pagination buttons if > 10 total
  - ⬅️ Previous | Page X/Y | Next ➡️
  ↓
[6] Reply ephemeral
```

**Implementation:**
```javascript
// In /bookmark command
case 'list':
  const page = interaction.options.getInteger('page') || 1;
  const limit = 10;
  const offset = (page - 1) * limit;

  // Get bookmarks
  const userBookmarks = await db.select()
    .from(bookmarks)
    .where(eq(bookmarks.userId, interaction.user.id))
    .orderBy(desc(bookmarks.savedAt))
    .limit(limit)
    .offset(offset);

  // Get total count
  const totalCount = await db.select({ count: count() })
    .from(bookmarks)
    .where(eq(bookmarks.userId, interaction.user.id))
    .get();

  const totalPages = Math.ceil(totalCount.count / limit);

  if (userBookmarks.length === 0) {
    return interaction.reply({
      embeds: [embeds.info(
        'No Bookmarks',
        'You have no bookmarks yet! Right-click a message → Apps → "Bookmark Message" to save one.'
      )],
      flags: [MessageFlags.Ephemeral]
    });
  }

  // Build embed
  const embed = embeds.brand(
    '🔖 Your Bookmarks',
    `Page ${page} of ${totalPages} • Total: ${totalCount.count}`
  );

  for (const bookmark of userBookmarks) {
    const guild = client.guilds.cache.get(bookmark.guildId);
    const guildName = guild?.name || 'Unknown Server';

    const deleted = bookmark.messageDeleted ? ' **[DELETED]**' : '';
    const content = bookmark.content.length > 100
      ? bookmark.content.slice(0, 100) + '...'
      : bookmark.content;

    const timestamp = Math.floor(bookmark.savedAt / 1000);

    const jumpLink = bookmark.messageDeleted
      ? ''
      : `\n[Jump](https://discord.com/channels/${bookmark.guildId}/${bookmark.channelId}/${bookmark.messageId})`;

    embed.addFields({
      name: `ID: ${bookmark.id} • ${guildName}${deleted}`,
      value: `<@${bookmark.authorId}> in <#${bookmark.channelId}> • <t:${timestamp}:R>\n>>> ${content}${jumpLink}`,
      inline: false
    });
  }

  // Pagination buttons
  const components = [];
  if (totalPages > 1) {
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`bookmark_page_${page - 1}`)
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('⬅️')
          .setDisabled(page === 1),
        new ButtonBuilder()
          .setCustomId(`bookmark_page_${page + 1}`)
          .setLabel('Next')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('➡️')
          .setDisabled(page === totalPages)
      );
    components.push(row);
  }

  await interaction.reply({
    embeds: [embed],
    components,
    flags: [MessageFlags.Ephemeral]
  });
  break;
```

**Edge Cases:**

1. **Page number out of range**
   - `/bookmark list 999` → Clamp to last valid page
   - Or show error: "Invalid page number. Max page: X"

2. **Guild/channel deleted**
   - Show "Unknown Server" / "Unknown Channel"
   - Jump link will 404, but that's expected

3. **Author left Discord/deleted account**
   - Show "Unknown User" or "Deleted User"
   - Don't error, just display placeholder

4. **Pagination button spam**
   ```javascript
   // In button handler
   if (interaction.customId.startsWith('bookmark_page_')) {
     const page = parseInt(interaction.customId.split('_')[2]);

     await interaction.deferUpdate(); // Prevent "interaction failed"

     // Re-run list logic with new page
     // ... (same query logic)

     await interaction.editReply({
       embeds: [newEmbed],
       components: [newButtons]
     });
   }
   ```

#### 5.3 Command: `/bookmark delete`

**Flow:**
```
User: /bookmark delete <id>
  ↓
[1] Validate ownership
  SELECT * FROM bookmarks WHERE id = ? AND userId = ?
  ↓ Not found → Error: "Bookmark not found or you don't own it"
  ↓
[2] Delete from DB
  ↓
[3] Reply confirmation
  "Bookmark #X deleted successfully."
```

**Autocomplete:**
```javascript
async autocomplete(interaction) {
  const focusedOption = interaction.options.getFocused(true);

  if (focusedOption.name === 'id') {
    // Get user's bookmarks
    const userBookmarks = await db.select({
      id: bookmarks.id,
      content: bookmarks.content,
      guildId: bookmarks.guildId
    })
      .from(bookmarks)
      .where(eq(bookmarks.userId, interaction.user.id))
      .orderBy(desc(bookmarks.savedAt))
      .limit(25); // Discord autocomplete limit

    // Build autocomplete choices
    const choices = userBookmarks.map(b => {
      const guild = interaction.client.guilds.cache.get(b.guildId);
      const preview = b.content.slice(0, 50) + (b.content.length > 50 ? '...' : '');

      return {
        name: `#${b.id} • ${guild?.name || 'Unknown'} • ${preview}`,
        value: b.id
      };
    });

    await interaction.respond(choices);
  }
}
```

**Edge Cases:**

1. **Invalid bookmark ID**
   - Autocomplete prevents this mostly
   - If manual ID entry: "Bookmark #X not found"

2. **Trying to delete someone else's bookmark**
   - WHERE clause includes userId check
   - Error: "Bookmark not found or you don't own it"

#### 5.4 Command: `/bookmark search`

**Flow:**
```
User: /bookmark search "bytepod"
  ↓
[1] Query bookmarks with content LIKE %query%
  SELECT * FROM bookmarks
  WHERE userId = ? AND content LIKE ?
  ORDER BY savedAt DESC
  LIMIT 25
  ↓
[2] Highlight matches in results
  ↓
[3] Show results in embed (paginated if > 10)
```

**Implementation:**
```javascript
case 'search':
  const query = interaction.options.getString('query');

  const results = await db.select()
    .from(bookmarks)
    .where(and(
      eq(bookmarks.userId, interaction.user.id),
      sql`${bookmarks.content} LIKE ${'%' + query + '%'}`
    ))
    .orderBy(desc(bookmarks.savedAt))
    .limit(25);

  if (results.length === 0) {
    return interaction.reply({
      embeds: [embeds.info('No Results', `No bookmarks found matching "${query}"`)],
      flags: [MessageFlags.Ephemeral]
    });
  }

  const embed = embeds.brand(
    `🔍 Search Results for "${query}"`,
    `Found ${results.length} bookmark(s)`
  );

  for (const bookmark of results.slice(0, 10)) {
    // Highlight query in content
    const highlightedContent = bookmark.content.replace(
      new RegExp(query, 'gi'),
      match => `**${match}**`
    );

    const preview = highlightedContent.length > 150
      ? highlightedContent.slice(0, 150) + '...'
      : highlightedContent;

    const jumpLink = bookmark.messageDeleted
      ? ' **[DELETED]**'
      : `\n[Jump](https://discord.com/channels/${bookmark.guildId}/${bookmark.channelId}/${bookmark.messageId})`;

    embed.addFields({
      name: `ID: ${bookmark.id}`,
      value: `>>> ${preview}${jumpLink}`,
      inline: false
    });
  }

  if (results.length > 10) {
    embed.setFooter({ text: `Showing first 10 of ${results.length} results` });
  }

  await interaction.reply({
    embeds: [embed],
    flags: [MessageFlags.Ephemeral]
  });
  break;
```

**Edge Cases:**

1. **Search query too broad** ("the")
   - Limit to 25 results max
   - Show: "Showing first 25 matches"

2. **Special regex characters** ("test.*")
   - Escape regex special chars or use LIKE instead of regex
   - SQLite LIKE is safe

3. **Case sensitivity**
   - Use case-insensitive LIKE (SQLite default)

#### 5.5 Message Deletion Handling

**Event Handler:**
```javascript
// src/events/messageDelete.js
const { Events } = require('discord.js');
const { db } = require('../database');
const { bookmarks } = require('../database/schema');
const { eq } = require('drizzle-orm');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageDelete,
  async execute(message, client) {
    // Check if message is bookmarked
    const bookmarked = await db.select()
      .from(bookmarks)
      .where(eq(bookmarks.messageId, message.id));

    if (bookmarked.length > 0) {
      // Mark as deleted
      await db.update(bookmarks)
        .set({ messageDeleted: 1 })
        .where(eq(bookmarks.messageId, message.id));

      logger.info(`Marked ${bookmarked.length} bookmark(s) as deleted for message ${message.id}`);
    }
  }
};
```

**Edge Cases:**

1. **Bulk delete** (channel purge)
   - `messageDeleteBulk` event
   - Same logic, but loop through all deleted messages
   ```javascript
   module.exports = {
     name: Events.MessageBulkDelete,
     async execute(messages, channel, client) {
       const messageIds = Array.from(messages.keys());

       // Update all at once
       await db.update(bookmarks)
         .set({ messageDeleted: 1 })
         .where(inArray(bookmarks.messageId, messageIds));

       logger.info(`Marked bookmarks as deleted for ${messageIds.length} bulk-deleted messages`);
     }
   };
   ```

2. **Channel deleted**
   - All messages in channel are deleted
   - No messageDelete event fires
   - **Solution:** Periodic cleanup task (see below)

3. **Guild deleted**
   - Similar issue
   - **Solution:** On guildDelete, mark all guild bookmarks as deleted

#### 5.6 Periodic Cleanup Task

**Purpose:** Verify bookmarked messages still exist (catch channel deletions, etc.)

**Implementation:**
```javascript
// src/services/bookmarkService.js
class BookmarkService {
  constructor(client) {
    this.client = client;
    this.cleanupInterval = null;
  }

  startCleanupTask() {
    // Run weekly (604800000 ms)
    this.cleanupInterval = setInterval(() => {
      this.cleanupDeletedMessages();
    }, 604800000);

    logger.info('Bookmark cleanup task started (runs weekly)');
  }

  async cleanupDeletedMessages() {
    logger.info('Running bookmark cleanup task...');

    // Get all non-deleted bookmarks
    const activeBookmarks = await db.select()
      .from(bookmarks)
      .where(eq(bookmarks.messageDeleted, 0));

    let deletedCount = 0;
    let checkedCount = 0;

    for (const bookmark of activeBookmarks) {
      try {
        const channel = await this.client.channels.fetch(bookmark.channelId).catch(() => null);

        if (!channel) {
          // Channel deleted
          await db.update(bookmarks)
            .set({ messageDeleted: 1 })
            .where(eq(bookmarks.id, bookmark.id));
          deletedCount++;
          continue;
        }

        // Try to fetch message
        const message = await channel.messages.fetch(bookmark.messageId).catch(() => null);

        if (!message) {
          // Message deleted
          await db.update(bookmarks)
            .set({ messageDeleted: 1 })
            .where(eq(bookmarks.id, bookmark.id));
          deletedCount++;
        }

        checkedCount++;

        // Rate limit protection: wait 100ms between checks
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        logger.error(`Error checking bookmark ${bookmark.id}:`, error);
      }
    }

    logger.success(`Bookmark cleanup complete: ${checkedCount} checked, ${deletedCount} marked as deleted`);
  }

  cleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

module.exports = BookmarkService;
```

**Start in index.js:**
```javascript
// After bot ready
client.bookmarkService = new BookmarkService(client);
client.bookmarkService.startCleanupTask();
```

**Edge Cases:**

1. **Rate limiting**
   - Fetching thousands of messages can hit rate limits
   - **Solution:** Add 100ms delay between fetches
   - **Better:** Batch check (check 100 per day instead of all at once)

2. **Bot lacks permissions**
   - Can't fetch message in channel where bot lost access
   - **Solution:** Catch error, mark as deleted

---

## Feature 6: Auto-Responder

### Detailed Implementation Flow

#### 6.1 Message Event Flow

**messageCreate Event:**
```
Message sent in guild
  ↓
[1] Ignore if author is bot
  ↓
[2] Ignore if in DMs (guild-only feature)
  ↓
[3] Query active auto-responses for guild
  SELECT * FROM autoResponses
  WHERE guildId = ? AND enabled = 1
  ↓ No responses → return
  ↓
[4] For each auto-response:
  ↓
  [5] Check channel restriction
    ↓ channelId NOT NULL AND doesn't match → skip
    ↓
  [6] Check role restriction
    ↓ requireRoleId NOT NULL AND user doesn't have role → skip
    ↓
  [7] Check cooldown
    ↓ On cooldown → skip
    ↓
  [8] Match trigger against message content
    ↓ No match → skip
    ↓ MATCH FOUND
    ↓
  [9] Parse response variables
    - {user} → <@userId>
    - {server} → guildName
    - {channel} → <#channelId>
    ↓
  [10] Send response
    ↓
  [11] Update cooldown
    ↓
  [12] Increment useCount, update lastUsed
    ↓
  [13] STOP (only one response per message)
```

**Implementation:**
```javascript
// src/events/messageCreate.js
const { Events } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  name: Events.MessageCreate,
  async execute(message, client) {
    // Ignore bots
    if (message.author.bot) return;

    // Guild only
    if (!message.guild) return;

    // Auto-responder check
    if (client.autoResponderService) {
      try {
        await client.autoResponderService.checkMessage(message);
      } catch (error) {
        logger.error('Auto-responder error:', error);
      }
    }
  }
};
```

**Service Implementation:**
```javascript
// src/services/autoResponderService.js
const { db } = require('../database');
const { autoResponses } = require('../database/schema');
const { eq, and, sql } = require('drizzle-orm');
const logger = require('../utils/logger');

class AutoResponderService {
  constructor(client) {
    this.client = client;
    this.cooldowns = new Map(); // `${responseId}_${channelId}` -> timestamp
    this.cache = new Map(); // guildId -> array of active responses
    this.cacheExpiry = new Map(); // guildId -> expiry timestamp
  }

  async checkMessage(message) {
    // Get cached responses for guild (cache for 5 minutes)
    let responses = this.getCachedResponses(message.guild.id);

    if (!responses) {
      responses = await db.select()
        .from(autoResponses)
        .where(and(
          eq(autoResponses.guildId, message.guild.id),
          eq(autoResponses.enabled, 1)
        ));

      this.cacheResponses(message.guild.id, responses);
    }

    if (responses.length === 0) return;

    // Check each response
    for (const response of responses) {
      // Channel restriction
      if (response.channelId && response.channelId !== message.channel.id) {
        continue;
      }

      // Role restriction
      if (response.requireRoleId) {
        const member = await message.guild.members.fetch(message.author.id).catch(() => null);
        if (!member || !member.roles.cache.has(response.requireRoleId)) {
          continue;
        }
      }

      // Cooldown check
      const cooldownKey = `${response.id}_${message.channel.id}`;
      const now = Date.now();
      const cooldownEnd = this.cooldowns.get(cooldownKey) || 0;

      if (now < cooldownEnd) {
        continue; // Still on cooldown
      }

      // Match trigger
      if (!this.matchesTrigger(message.content, response.trigger, response.matchType)) {
        continue;
      }

      // MATCH FOUND - send response
      const parsedResponse = this.parseResponse(response.response, message);

      try {
        await message.channel.send(parsedResponse);

        // Update cooldown
        this.cooldowns.set(cooldownKey, now + (response.cooldown * 1000));

        // Update stats
        await db.update(autoResponses)
          .set({
            useCount: sql`${autoResponses.useCount} + 1`,
            lastUsed: now
          })
          .where(eq(autoResponses.id, response.id));

        logger.debug(`Auto-response triggered: ${response.trigger} in ${message.guild.name}`);

        // Only trigger ONE response per message
        break;

      } catch (error) {
        logger.error(`Failed to send auto-response ${response.id}:`, error);
      }
    }
  }

  matchesTrigger(content, trigger, matchType) {
    const contentLower = content.toLowerCase();
    const triggerLower = trigger.toLowerCase();

    switch (matchType) {
      case 'exact':
        return contentLower === triggerLower;

      case 'contains':
        return contentLower.includes(triggerLower);

      case 'wildcard':
        // Convert wildcard to regex: "test*" -> /^test.*$/
        const pattern = '^' + triggerLower.replace(/\*/g, '.*') + '$';
        return new RegExp(pattern).test(contentLower);

      case 'regex':
        try {
          return new RegExp(trigger, 'i').test(content);
        } catch (error) {
          logger.error(`Invalid regex in auto-response: ${trigger}`);
          return false;
        }

      default:
        return false;
    }
  }

  parseResponse(response, message) {
    return response
      .replace(/{user}/g, `<@${message.author.id}>`)
      .replace(/{server}/g, message.guild.name)
      .replace(/{channel}/g, `<#${message.channel.id}>`)
      .replace(/{mention}/g, `<@${message.author.id}>`) // Alias
      .replace(/{username}/g, message.author.username);
  }

  getCachedResponses(guildId) {
    const expiry = this.cacheExpiry.get(guildId);
    if (expiry && Date.now() < expiry) {
      return this.cache.get(guildId);
    }
    return null;
  }

  cacheResponses(guildId, responses) {
    this.cache.set(guildId, responses);
    this.cacheExpiry.set(guildId, Date.now() + 300000); // 5 minutes
  }

  invalidateCache(guildId) {
    this.cache.delete(guildId);
    this.cacheExpiry.delete(guildId);
  }
}

module.exports = AutoResponderService;
```

**Edge Cases:**

1. **Response triggers itself (infinite loop)**
   - **Problem:** Response contains trigger keyword
   - **Solution:** Ignore bot messages (line 15 of messageCreate)
   - **Example:** Trigger: "hello", Response: "hello there!" → Won't loop because bot messages ignored

2. **Multiple triggers match same message**
   - **Solution:** Use FIRST match only (break after sending)
   - **Future:** Add priority system (Phase 2)

3. **Message triggers response, then gets deleted**
   - **Result:** Response stays (intended behavior)
   - **Alternative:** Could delete response too (add reaction listener)

4. **User spams trigger to spam responses**
   - **Solution:** Cooldown system prevents spam
   - **Enhancement:** Global cooldown per user (prevent trigger hopping)

5. **Response fails to send (permissions)**
   ```javascript
   try {
     await message.channel.send(parsedResponse);
   } catch (error) {
     if (error.code === 50013) { // Missing Permissions
       logger.warn(`Auto-response blocked in ${message.channel.id}: Missing permissions`);
       // Optionally: disable response for this channel
     }
   }
   ```

6. **Regex ReDoS attack**
   - **Problem:** Malicious regex can cause CPU hang
   - **Solution:** Restrict regex to devOnly or add timeout
   ```javascript
   case 'regex':
     try {
       // Timeout protection (not built-in, would need library)
       const regex = new RegExp(trigger, 'i');
       return regex.test(content);
     } catch (error) {
       logger.error(`Invalid/dangerous regex: ${trigger}`);
       return false;
     }
   ```

7. **Too many auto-responses (performance)**
   - **Limit:** 50 per guild (enforced in add command)
   - **Cache:** Responses cached per guild (5 min TTL)
   - **Indexing:** DB indexed on (guildId, enabled)

#### 6.2 Command: `/autorespond add`

**Flow:**
```
User: /autorespond add trigger:"help" response:"Check #faq!" match_type:contains
  ↓
[1] Permission check (ManageGuild)
  ↓
[2] Check guild's response count
  ↓ ≥ 50 → Error: "Maximum 50 auto-responses per server"
  ↓
[3] Validate trigger length (1-100 chars)
  ↓ Invalid → Error
  ↓
[4] Validate response length (1-2000 chars)
  ↓ Invalid → Error
  ↓
[5] If match_type = regex:
  ↓ Check if user is dev
    ↓ NO → Error: "Regex matching restricted to bot developers (security risk)"
    ↓ YES → Validate regex compiles
      ↓ Invalid → Error: "Invalid regex pattern"
  ↓
[6] If channel specified:
  ↓ Validate channel exists
  ↓
[7] If role specified:
  ↓ Validate role exists
  ↓
[8] Insert to DB
  ↓
[9] Invalidate guild cache
  ↓
[10] Reply with confirmation
```

**Implementation:**
```javascript
// In /autorespond command
case 'add':
  const trigger = interaction.options.getString('trigger');
  const response = interaction.options.getString('response');
  const matchType = interaction.options.getString('match_type') || 'contains';
  const channel = interaction.options.getChannel('channel');
  const role = interaction.options.getRole('role');
  const cooldown = interaction.options.getInteger('cooldown') || 60;

  // Check limit
  const count = await db.select({ count: count() })
    .from(autoResponses)
    .where(eq(autoResponses.guildId, interaction.guild.id))
    .get();

  if (count.count >= 50) {
    return interaction.reply({
      embeds: [embeds.error(
        'Limit Reached',
        'This server has reached the maximum of 50 auto-responses. Delete some with `/autorespond remove`.'
      )],
      flags: [MessageFlags.Ephemeral]
    });
  }

  // Validate regex (if used)
  if (matchType === 'regex') {
    if (!config.developers.includes(interaction.user.id)) {
      return interaction.reply({
        embeds: [embeds.error(
          'Permission Denied',
          'Regex matching is restricted to bot developers due to security risks (ReDoS attacks). Use `wildcard` or `contains` instead.'
        )],
        flags: [MessageFlags.Ephemeral]
      });
    }

    try {
      new RegExp(trigger);
    } catch (error) {
      return interaction.reply({
        embeds: [embeds.error('Invalid Regex', `The regex pattern is invalid: ${error.message}`)],
        flags: [MessageFlags.Ephemeral]
      });
    }
  }

  // Insert
  await db.insert(autoResponses).values({
    guildId: interaction.guild.id,
    trigger,
    response,
    channelId: channel?.id || null,
    creatorId: interaction.user.id,
    enabled: 1,
    cooldown,
    matchType,
    requireRoleId: role?.id || null,
    useCount: 0,
    createdAt: Date.now(),
    lastUsed: null
  });

  // Invalidate cache
  client.autoResponderService.invalidateCache(interaction.guild.id);

  // Confirmation
  const embed = embeds.success(
    'Auto-Response Created',
    `**Trigger:** ${trigger}\n` +
    `**Match Type:** ${matchType}\n` +
    `**Response:** ${response}\n` +
    `**Channel:** ${channel ? channel.toString() : 'All channels'}\n` +
    `**Role Required:** ${role ? role.toString() : 'None'}\n` +
    `**Cooldown:** ${cooldown}s`
  );

  await interaction.reply({ embeds: [embed] });
  break;
```

**Edge Cases:**

1. **Trigger contains special chars** (@, #, etc.)
   - Allow, but escape for regex mode

2. **Response contains mentions**
   - Allow @everyone/@here only if user has MentionEveryone permission
   ```javascript
   if ((response.includes('@everyone') || response.includes('@here')) &&
       !interaction.member.permissions.has('MentionEveryone')) {
     return interaction.reply({
       embeds: [embeds.error('Permission Denied', 'You cannot create auto-responses with @everyone/@here without the "Mention Everyone" permission.')],
       flags: [MessageFlags.Ephemeral]
     });
   }
   ```

3. **Channel/role deleted after creation**
   - Response still exists, but restriction is ineffective
   - `/autorespond list` should show "Unknown Channel" / "Unknown Role"

#### 6.3 Command: `/autorespond list`

**Flow:**
```
User: /autorespond list
  ↓
[1] Query guild's auto-responses
  ORDER BY createdAt DESC
  ↓
[2] Build embed table
  For each response (max 25):
    - ID, trigger, status (enabled/disabled)
    - Channel (if restricted)
    - Use count
  ↓
[3] Paginate if > 25
  ↓
[4] Reply
```

**Implementation:**
```javascript
case 'list':
  const responses = await db.select()
    .from(autoResponses)
    .where(eq(autoResponses.guildId, interaction.guild.id))
    .orderBy(desc(autoResponses.createdAt));

  if (responses.length === 0) {
    return interaction.reply({
      embeds: [embeds.info(
        'No Auto-Responses',
        'This server has no auto-responses yet. Create one with `/autorespond add`.'
      )],
      flags: [MessageFlags.Ephemeral]
    });
  }

  const embed = embeds.brand(
    '🤖 Auto-Responses',
    `Total: ${responses.length} (max 50)`
  );

  for (const response of responses.slice(0, 25)) {
    const channel = response.channelId
      ? `<#${response.channelId}>`
      : 'All channels';

    const status = response.enabled ? '✅ Enabled' : '❌ Disabled';

    embed.addFields({
      name: `ID: ${response.id} • ${status}`,
      value: `**Trigger:** ${response.trigger}\n` +
             `**Type:** ${response.matchType} | **Channel:** ${channel}\n` +
             `**Used:** ${response.useCount} times`,
      inline: false
    });
  }

  if (responses.length > 25) {
    embed.setFooter({ text: `Showing first 25 of ${responses.length}` });
  }

  await interaction.reply({
    embeds: [embed],
    flags: [MessageFlags.Ephemeral]
  });
  break;
```

#### 6.4 Performance Optimization

**Caching Strategy:**
```javascript
// Cache active responses per guild
// Expire after 5 minutes or on manual invalidation
// Reduces DB queries from every message to once per 5 min

getCachedResponses(guildId) {
  const expiry = this.cacheExpiry.get(guildId);
  if (expiry && Date.now() < expiry) {
    return this.cache.get(guildId);
  }
  return null;
}

// Invalidate on:
// - New response added
// - Response edited
// - Response deleted
// - Response toggled
```

**Cooldown Management:**
```javascript
// In-memory Map, no DB writes needed
// Format: `${responseId}_${channelId}` -> expiryTimestamp

// Cleanup stale entries periodically
constructor() {
  // ...
  setInterval(() => {
    const now = Date.now();
    for (const [key, expiry] of this.cooldowns.entries()) {
      if (expiry < now) {
        this.cooldowns.delete(key);
      }
    }
  }, 60000); // Clean every minute
}
```

**Database Indexes:**
```javascript
export const autoResponses = sqliteTable('autoResponses', {
  // ... columns
}, (table) => ({
  guildEnabledIdx: index('autoresponse_guild_enabled_idx').on(table.guildId, table.enabled),
  guildChannelIdx: index('autoresponse_guild_channel_idx').on(table.guildId, table.channelId)
}));
```

---

## Cross-Feature Integration Points

### 1. Context Menus + Bookmarks
- Message context menu "Bookmark Message" saves to bookmarks system
- Shared error handling patterns
- Both use MessageFlags.Ephemeral

### 2. User Info + Birthday Tracker
- User Info context menu could show birthday (if set)
  ```javascript
  // In User Info context menu
  const birthday = await db.select()
    .from(birthdays)
    .where(and(
      eq(birthdays.userId, user.id),
      eq(birthdays.guildId, interaction.guild.id)
    ))
    .get();

  if (birthday) {
    const monthNames = ['Jan', 'Feb', 'Mar', ...];
    embed.addFields({
      name: '🎂 Birthday',
      value: `${monthNames[birthday.month - 1]} ${birthday.day}`,
      inline: true
    });
  }
  ```

### 3. Mod Actions + Auto-Responder
- Mod actions could trigger auto-responses (e.g., "warned" keyword)
- Need flag to prevent bot messages triggering responses

### 4. Reminders + Bookmarks
- User might bookmark a message, then set reminder about it
- Potential future: "Remind me about this message" context menu → Creates reminder with bookmark

### 5. All Features + RBAC System
- All slash commands respect existing permission system
- Context menus honor `permissions` array
- Auto-responder honors role restrictions

---

## Error Handling Patterns

### Standard Error Response
```javascript
try {
  // ... feature logic
} catch (error) {
  logger.errorContext('Feature Error', error, {
    feature: 'reminders',
    userId: interaction.user.id,
    guildId: interaction.guild?.id
  });

  const errorEmbed = embeds.error(
    'Something Went Wrong',
    'An unexpected error occurred. The developers have been notified.'
  );

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
  } else {
    await interaction.reply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
  }
}
```

### Discord API Error Codes
```javascript
// Common errors to handle
const ERROR_CODES = {
  UNKNOWN_MESSAGE: 10008,
  UNKNOWN_CHANNEL: 10003,
  UNKNOWN_GUILD: 10004,
  UNKNOWN_USER: 10013,
  MISSING_PERMISSIONS: 50013,
  CANNOT_DM_USER: 50007,
  INTERACTION_TIMEOUT: 10062
};

// Example handling
try {
  await user.send({ content: 'DM message' });
} catch (error) {
  if (error.code === ERROR_CODES.CANNOT_DM_USER) {
    // User has DMs disabled, handle gracefully
    return interaction.reply({
      content: '⚠️ Could not send you a DM. Please enable DMs from server members.',
      flags: [MessageFlags.Ephemeral]
    });
  }
  throw error; // Re-throw if unexpected
}
```

### Rate Limit Handling
```javascript
// For bulk operations (bookmark cleanup, etc.)
async function fetchWithRateLimit(fetchFn, delay = 100) {
  try {
    return await fetchFn();
  } catch (error) {
    if (error.status === 429) {
      // Rate limited
      const retryAfter = error.retryAfter || 1000;
      logger.warn(`Rate limited, retrying after ${retryAfter}ms`);
      await new Promise(resolve => setTimeout(resolve, retryAfter));
      return await fetchFn();
    }
    throw error;
  }
}

// Add delay between operations
for (const item of items) {
  await processItem(item);
  await new Promise(resolve => setTimeout(resolve, delay));
}
```

---

## State Management Strategy

### In-Memory State

**Reminders:**
- `activeTimers: Map<reminderId, timeoutId>`
- `longDelayChecks: Map<reminderId, intervalId>`
- Cleared on bot restart → Reload from DB

**Auto-Responder:**
- `cooldowns: Map<responseId_channelId, expiryTimestamp>`
- `cache: Map<guildId, autoResponses[]>`
- `cacheExpiry: Map<guildId, timestamp>`
- Cleared on restart → Acceptable (cooldowns reset)

**Starboard:**
- `updateQueue: Map<messageId, timeoutId>`
- Debounce map for star count updates
- Cleared on restart → Acceptable (updates catch up)

**Birthday Tracker:**
- `checkInterval: intervalId`
- Single interval for daily checks
- Recalculated on startup

### Database as Source of Truth

**Always query DB for:**
- User permissions (RBAC)
- Bookmark ownership
- Reminder active status
- Auto-response enabled status
- Birthday announcements (lastCheck timestamp)

**Never cache:**
- User permissions (can change frequently)
- Guild configurations (can be edited)
- Active/inactive flags (need immediate consistency)

### Cache Invalidation Rules

**Invalidate on:**
1. **Create** → Add to cache OR invalidate entire guild cache
2. **Update** → Invalidate specific entry OR guild cache
3. **Delete** → Remove from cache OR invalidate guild cache
4. **Toggle** → Invalidate guild cache

**Cache TTL:**
- Auto-responder: 5 minutes (high frequency feature)
- Birthday config: No cache needed (checked once per day)
- Starboard config: Cache indefinitely, invalidate on change
- Reminders: No cache (state in memory already)

---

## Concurrency & Race Conditions

### Reminder Firing Race
**Problem:** User cancels reminder while it's firing

**Solution:**
```javascript
async fireReminder(reminderId) {
  // Atomic check-and-mark inactive
  const [reminder] = await db.update(reminders)
    .set({ active: 0 })
    .where(and(
      eq(reminders.id, reminderId),
      eq(reminders.active, 1) // Only update if still active
    ))
    .returning();

  if (!reminder) {
    // Already cancelled by user
    return;
  }

  // Safe to send reminder now
}
```

### Bookmark Duplicate Save
**Problem:** User double-clicks "Bookmark Message"

**Solution:**
```javascript
// Check for existing before insert
const existing = await db.select()
  .from(bookmarks)
  .where(and(
    eq(bookmarks.userId, userId),
    eq(bookmarks.messageId, messageId)
  ))
  .get();

if (existing) {
  return { error: 'Already bookmarked' };
}

// Then insert (race window is tiny)
```

### Auto-Response Trigger Spam
**Problem:** Multiple messages trigger same response rapidly

**Solution:** Cooldown system (already implemented)

### Starboard Star Count Update
**Problem:** 10 users star message simultaneously

**Solution:** Debounce updates (5 second window)

---

**End of Implementation Specifications** • 2025-12-22
