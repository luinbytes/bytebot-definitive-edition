const { Events, ActivityType } = require('discord.js');
const logger = require('../utils/logger');
const { db } = require('../database');
const { bytepodActiveSessions, bytepodVoiceStats } = require('../database/schema');
const { eq, and } = require('drizzle-orm');

// Helper to finalize a stale voice session
async function finalizeStaleSession(session) {
    const durationSeconds = Math.floor((Date.now() - session.startTime) / 1000);

    // Delete active session
    await db.delete(bytepodActiveSessions)
        .where(eq(bytepodActiveSessions.id, session.id));

    // Upsert aggregate stats
    const existing = await db.select().from(bytepodVoiceStats)
        .where(and(
            eq(bytepodVoiceStats.userId, session.userId),
            eq(bytepodVoiceStats.guildId, session.guildId)
        )).get();

    if (existing) {
        await db.update(bytepodVoiceStats)
            .set({
                totalSeconds: existing.totalSeconds + durationSeconds,
                sessionCount: existing.sessionCount + 1
            })
            .where(eq(bytepodVoiceStats.id, existing.id));
    } else {
        await db.insert(bytepodVoiceStats).values({
            userId: session.userId,
            guildId: session.guildId,
            totalSeconds: durationSeconds,
            sessionCount: 1
        });
    }

    return durationSeconds;
}

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        logger.success(`Ready! Logged in as ${client.user.tag}`);
        logger.info(`Bot is active in ${client.guilds.cache.size} guilds.`);

        // --- Validate Active BytePod Sessions (Restart Resilience) ---
        try {
            const activeSessions = await db.select().from(bytepodActiveSessions);
            let finalized = 0;
            let continued = 0;

            for (const session of activeSessions) {
                try {
                    const guild = await client.guilds.fetch(session.guildId).catch(() => null);
                    if (!guild) {
                        // Guild no longer accessible, cleanup session
                        await finalizeStaleSession(session);
                        finalized++;
                        continue;
                    }

                    const channel = await guild.channels.fetch(session.podId).catch(() => null);
                    if (!channel) {
                        // Channel deleted while bot was offline, finalize session
                        await finalizeStaleSession(session);
                        finalized++;
                        continue;
                    }

                    const member = channel.members.get(session.userId);
                    if (!member) {
                        // User left while bot was offline, finalize session
                        await finalizeStaleSession(session);
                        finalized++;
                    } else {
                        // User is still in channel, session continues
                        continued++;
                    }
                } catch (e) {
                    logger.error(`Session validation error for session ${session.id}: ${e}`);
                    // On error, cleanup the session to prevent orphans
                    await db.delete(bytepodActiveSessions)
                        .where(eq(bytepodActiveSessions.id, session.id));
                }
            }

            if (activeSessions.length > 0) {
                logger.info(`BytePod sessions: ${finalized} finalized, ${continued} continuing`);
            }
        } catch (e) {
            logger.error(`Failed to validate BytePod sessions on startup: ${e}`);
        }

        // --- Rich Presence Rotation ---
        let i = 0;
        setInterval(() => {
            const activities = [
                { name: 'Doomscrolling (Ranked) 🟣', type: ActivityType.Playing },
                { name: 'Touch Grass (Any%) 🟣', type: ActivityType.Playing },
                { name: 'Existential Dread (Hard Mode) 🟣', type: ActivityType.Playing },
            ];

            client.user.setPresence({
                activities: [activities[i]],
                status: 'online',
            });
            i = ++i % activities.length;
        }, 10_000);
    },
};
