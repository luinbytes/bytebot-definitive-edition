const { Events, ActivityType } = require('discord.js');
const logger = require('../utils/logger');
const { db } = require('../database');
const { bytepodActiveSessions, bytepodVoiceStats, bytepods } = require('../database/schema');
const { eq, and } = require('drizzle-orm');

// Helper to finalize a stale voice session
async function finalizeStaleSession(session, client) {
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

    // Track activity streak (convert seconds to minutes)
    const durationMinutes = Math.floor(durationSeconds / 60);
    if (durationMinutes > 0 && client?.activityStreakService) {
        try {
            await client.activityStreakService.recordActivity(
                session.userId,
                session.guildId,
                'voice',
                durationMinutes
            );
        } catch (error) {
            const logger = require('../utils/logger');
            logger.error('Activity streak tracking error:', error);
            // Don't crash on tracking errors, just log
        }
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
                        await finalizeStaleSession(session, client);
                        finalized++;
                        continue;
                    }

                    const channel = await guild.channels.fetch(session.podId).catch(() => null);
                    if (!channel) {
                        // Channel deleted while bot was offline, finalize session
                        await finalizeStaleSession(session, client);
                        finalized++;
                        continue;
                    }

                    const member = channel.members.get(session.userId);
                    if (!member) {
                        // User left while bot was offline, finalize session
                        await finalizeStaleSession(session, client);
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

        // --- Validate BytePod Channels (Cleanup orphans & empty pods) ---
        try {
            const allPods = await db.select().from(bytepods);
            let deleted = 0;
            let orphaned = 0;
            let active = 0;

            for (const pod of allPods) {
                try {
                    const guild = await client.guilds.fetch(pod.guildId).catch(() => null);
                    if (!guild) {
                        // Guild no longer accessible, remove DB record
                        await db.delete(bytepods).where(eq(bytepods.channelId, pod.channelId));
                        orphaned++;
                        continue;
                    }

                    const channel = await guild.channels.fetch(pod.channelId).catch(() => null);
                    if (!channel) {
                        // Channel was deleted while bot was offline, cleanup DB
                        await db.delete(bytepods).where(eq(bytepods.channelId, pod.channelId));
                        orphaned++;
                        continue;
                    }

                    // Channel exists - check if empty
                    if (channel.members.size === 0) {
                        // Empty pod, delete it
                        await channel.delete('BytePod cleanup: Empty on bot restart').catch(() => null);
                        await db.delete(bytepods).where(eq(bytepods.channelId, pod.channelId));
                        deleted++;
                    } else {
                        // Pod has members, keep it
                        active++;
                    }
                } catch (e) {
                    logger.error(`BytePod cleanup error for ${pod.channelId}: ${e.message}`);
                    // On error, try to cleanup the DB record to prevent permanent orphans
                    await db.delete(bytepods).where(eq(bytepods.channelId, pod.channelId)).catch(() => { });
                    orphaned++;
                }
            }

            if (allPods.length > 0) {
                logger.info(`BytePod cleanup: ${deleted} empty deleted, ${orphaned} orphaned removed, ${active} active`);
            }
        } catch (e) {
            logger.error(`Failed to validate BytePod channels on startup: ${e}`);
        }

        // --- Initialize Birthday Service ---
        try {
            const BirthdayService = require('../services/birthdayService');
            client.birthdayService = new BirthdayService(client);
            client.birthdayService.startDailyCheck();
            logger.success('Birthday service initialized');
        } catch (e) {
            logger.error(`Failed to initialize birthday service: ${e}`);
        }

        // --- Initialize Auto-Responder Service ---
        try {
            const AutoResponderService = require('../services/autoResponderService');
            client.autoResponderService = new AutoResponderService(client);
            logger.success('Auto-responder service initialized');
        } catch (e) {
            logger.error(`Failed to initialize auto-responder service: ${e}`);
        }

        // --- Initialize Starboard Service ---
        try {
            const StarboardService = require('../services/starboardService');
            client.starboardService = new StarboardService(client);
            logger.success('Starboard service initialized');
        } catch (e) {
            logger.error(`Failed to initialize starboard service: ${e}`);
        }

        // --- Initialize Reminder Service ---
        try {
            const ReminderService = require('../services/reminderService');
            client.reminderService = new ReminderService(client);
            await client.reminderService.loadReminders();
            logger.success('Reminder service initialized');
        } catch (e) {
            logger.error(`Failed to initialize reminder service: ${e}`);
        }

        // --- Initialize Activity Streak Service ---
        try {
            const ActivityStreakService = require('../services/activityStreakService');
            client.activityStreakService = new ActivityStreakService(client);
            client.activityStreakService.startDailyCheck();
            logger.success('Activity streak service initialized');
        } catch (e) {
            logger.error(`Failed to initialize activity streak service: ${e}`);
        }

        // --- Initialize Media Gallery Service ---
        try {
            const MediaGalleryService = require('../services/mediaGalleryService');
            client.mediaGalleryService = new MediaGalleryService(client);
            logger.success('Media gallery service initialized');
        } catch (e) {
            logger.error(`Failed to initialize media gallery service: ${e}`);
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
        }, 3_600_000); // 1 hour
    },
};
