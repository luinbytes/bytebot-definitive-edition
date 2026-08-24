const { Events, ActivityType } = require('discord.js');
const logger = require('../utils/logger');
const { db } = require('../database');
const { bytepodActiveSessions, bytepodVoiceStats, bytepods } = require('../database/schema');
const { eq, and } = require('drizzle-orm');
const { dbLog } = require('../utils/dbLogger');
const { scheduleOwnershipTransfer } = require('./voiceStateUpdate');
const { reconcileForcedNicknamesWithRetry } = require('../services/roleModerationService');
const { recoverPendingIncidents } = require('../services/antinukeService');
const { recoverLockdowns, recoverPendingIncidents: recoverPendingAntiraidIncidents } = require('../services/antiraidService');
const { reconcileNativeRules, recoverPendingIncidents: recoverPendingAutomodIncidents } = require('../services/automodService');

async function fetchDiscordResource(fetch, unknownCode) {
    try {
        return { resource: await fetch(), missing: false };
    } catch (error) {
        if (error?.code === unknownCode || error?.rawError?.code === unknownCode) {
            return { resource: null, missing: true };
        }
        throw error;
    }
}

async function recoverAntinuke(client) {
    try {
        const result = await recoverPendingIncidents(client);
        if (result.recovered) logger.info(`AntiNuke incidents recovered: ${result.recovered}`);
        result.failures.forEach(failure => logger.error(`AntiNuke recovery failed for ${failure}`));
        if (result.remaining) {
            logger.warn(`AntiNuke incidents still pending: ${result.remaining}`);
            const timer = setTimeout(() => recoverAntinuke(client), Math.max(30000, result.retryAfterMs || 0));
            timer.unref?.();
        }
    } catch (error) {
        logger.error(`Failed to recover AntiNuke incidents on startup: ${error.message}`);
    }
}

async function reconcileAutomod(client) {
    try {
        const result = await reconcileNativeRules(client);
        result.failures.forEach(failure => logger.error(`AutoMod migration reconciliation failed for ${failure}`));
        if (result.failures.length) {
            const timer = setTimeout(() => reconcileAutomod(client), 30000);
            timer.unref?.();
        }
    } catch (error) {
        logger.error(`Failed to reconcile AutoMod migration: ${error.message}`);
        const timer = setTimeout(() => reconcileAutomod(client), 30000);
        timer.unref?.();
    }
}

// Helper to finalize a stale voice session
async function finalizeStaleSession(session, client) {
    const durationSeconds = Math.floor((Date.now() - session.startTime) / 1000);

    // Delete active session
    await dbLog.delete('bytepodActiveSessions',
        () => db.delete(bytepodActiveSessions)
            .where(eq(bytepodActiveSessions.id, session.id)),
        { sessionId: session.id, userId: session.userId, guildId: session.guildId }
    );

    // Upsert aggregate stats
    const existing = await dbLog.select('bytepodVoiceStats',
        () => db.select().from(bytepodVoiceStats)
            .where(and(
                eq(bytepodVoiceStats.userId, session.userId),
                eq(bytepodVoiceStats.guildId, session.guildId)
            )).get(),
        { userId: session.userId, guildId: session.guildId }
    );

    if (existing) {
        await dbLog.update('bytepodVoiceStats',
            () => db.update(bytepodVoiceStats)
                .set({
                    totalSeconds: existing.totalSeconds + durationSeconds,
                    sessionCount: existing.sessionCount + 1
                })
                .where(eq(bytepodVoiceStats.id, existing.id)),
            { userId: session.userId, guildId: session.guildId, durationSeconds }
        );
    } else {
        await dbLog.insert('bytepodVoiceStats',
            () => db.insert(bytepodVoiceStats).values({
                userId: session.userId,
                guildId: session.guildId,
                totalSeconds: durationSeconds,
                sessionCount: 1
            }),
            { userId: session.userId, guildId: session.guildId, durationSeconds }
        );
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

        await recoverAntinuke(client);

        const interruptedSecurityIncidents = recoverPendingAntiraidIncidents() + recoverPendingAutomodIncidents();
        if (interruptedSecurityIncidents) logger.warn(`Marked ${interruptedSecurityIncidents} interrupted security incidents as failed.`);

        recoverLockdowns(client).then(result => {
            result.failures.forEach(failure => logger.error(`AntiRaid lockdown recovery failed for ${failure}`));
        }).catch(error => logger.error(`Failed to recover AntiRaid lockdowns: ${error.message}`));
        reconcileAutomod(client);

        reconcileForcedNicknamesWithRetry(client).then(result => {
            if (result.reconciled) logger.info(`Forced nicknames reconciled: ${result.reconciled}`);
            result.failures.forEach(failure => logger.error(`Forced nickname reconciliation failed for ${failure}`));
        }).catch(error => {
            logger.error(`Failed to reconcile forced nicknames on startup: ${error.message}`);
        });

        // Voice-session recovery below records activity, so this service must exist first.
        try {
            const ActivityStreakService = require('../services/activityStreakService');
            client.activityStreakService = new ActivityStreakService(client);
            client.activityStreakService.startDailyCheck();
            logger.success('Activity streak service initialized');

            await client.activityStreakService.cleanupOrphanedRoles();
            setInterval(() => {
                client.activityStreakService.cleanupOrphanedRoles().catch((error) => {
                    logger.error('Scheduled role cleanup failed:', error);
                });
            }, 86400000);
            logger.success('Achievement role cleanup scheduled');
        } catch (e) {
            logger.error(`Failed to initialize activity streak service: ${e}`);
        }

        // --- Validate Active BytePod Sessions (Restart Resilience) ---
        try {
            const activeSessions = await dbLog.select('bytepodActiveSessions',
                () => db.select().from(bytepodActiveSessions),
                { operation: 'startupValidation' }
            );
            let finalized = 0;
            let continued = 0;

            for (const session of activeSessions) {
                try {
                    const guildResult = await fetchDiscordResource(
                        () => client.guilds.fetch(session.guildId),
                        10004
                    );
                    if (guildResult.missing) {
                        // Guild no longer accessible, cleanup session
                        await finalizeStaleSession(session, client);
                        finalized++;
                        continue;
                    }
                    const guild = guildResult.resource;

                    const channelResult = await fetchDiscordResource(
                        () => guild.channels.fetch(session.podId),
                        10003
                    );
                    if (channelResult.missing) {
                        // Channel deleted while bot was offline, finalize session
                        await finalizeStaleSession(session, client);
                        finalized++;
                        continue;
                    }
                    const channel = channelResult.resource;

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
            const allPods = await dbLog.select('bytepods',
                () => db.select().from(bytepods),
                { operation: 'startupCleanup' }
            );
            let deleted = 0;
            let orphaned = 0;
            let active = 0;

            for (const pod of allPods) {
                try {
                    const guildResult = await fetchDiscordResource(
                        () => client.guilds.fetch(pod.guildId),
                        10004
                    );
                    if (guildResult.missing) {
                        // Guild no longer accessible, remove DB record
                        await dbLog.delete('bytepods',
                            () => db.delete(bytepods).where(eq(bytepods.channelId, pod.channelId)),
                            { podId: pod.channelId, guildId: pod.guildId, operation: 'orphanedGuild' }
                        );
                        orphaned++;
                        continue;
                    }
                    const guild = guildResult.resource;

                    const channelResult = await fetchDiscordResource(
                        () => guild.channels.fetch(pod.channelId),
                        10003
                    );
                    if (channelResult.missing) {
                        // Channel was deleted while bot was offline, cleanup DB
                        await dbLog.delete('bytepods',
                            () => db.delete(bytepods).where(eq(bytepods.channelId, pod.channelId)),
                            { podId: pod.channelId, guildId: pod.guildId, operation: 'orphanedChannel' }
                        );
                        orphaned++;
                        continue;
                    }
                    const channel = channelResult.resource;

                    // Channel exists - check if empty
                    if (channel.members.size === 0) {
                        // Empty pod, delete it
                        await channel.delete('BytePod cleanup: Empty on bot restart');
                        await dbLog.delete('bytepods',
                            () => db.delete(bytepods).where(eq(bytepods.channelId, pod.channelId)),
                            { podId: pod.channelId, guildId: pod.guildId, operation: 'emptyPod' }
                        );
                        deleted++;
                    } else {
                        // Pod has members, keep it
                        active++;
                        if (pod.ownerLeftAt) {
                            const remainingDelay = pod.ownerLeftAt + (5 * 60 * 1000) - Date.now();
                            scheduleOwnershipTransfer(guild, pod.channelId, remainingDelay);
                        }
                    }
                } catch (e) {
                    logger.error(`BytePod cleanup error for ${pod.channelId}: ${e.message}`);
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

        // --- Initialize message/member automation ---
        try {
            const AutomationService = require('../services/automationService');
            client.automationService = new AutomationService(client);
            const RoleAutomationService = require('../services/roleAutomationService');
            client.roleAutomationService = new RoleAutomationService(client, client.automationService);
            const RichContentService = require('../services/richContentService');
            client.richContentService = new RichContentService(client, client.automationService);
            await client.automationService.start();
            logger.success('Automation service initialized');
        } catch (e) {
            logger.error(`Failed to initialize automation service: ${e}`);
        }

        try {
            const { GiveawayService } = require('../services/giveawayService');
            client.giveawayService = new GiveawayService(client);
            await client.giveawayService.reconcile();
            client.giveawayService.start();
            logger.success('Giveaway service initialized');
        } catch (e) {
            logger.error(`Failed to initialize giveaway service: ${e}`);
        }

        try {
            const { EconomyService } = require('../services/economyService');
            const { sqlite } = require('../database');
            client.economyService = new EconomyService({ client, sqlite });
            const recovery = await client.economyService.reconcile();
            if (recovery.reconciled || recovery.pending || recovery.refundedGames) {
                logger.info(`Economy recovery: ${recovery.reconciled} shops reconciled, ${recovery.pending} pending, ${recovery.refundedGames} games refunded`);
            }
            logger.success('Economy service initialized');
        } catch (e) {
            logger.error(`Failed to initialize economy service: ${e}`);
        }

        if (process.env.MUSIC_LIBRARY_PATH) {
            try {
                const { MusicLibrary, MusicService } = require('../services/musicService');
                const { db } = require('../database');
                MusicService.checkRuntime();
                client.musicService = new MusicService({
                    library: new MusicLibrary(process.env.MUSIC_LIBRARY_PATH), db
                });
                logger.success('Music service initialized');
            } catch (e) {
                logger.error(`Failed to initialize music service: ${e.message}`);
            }
        } else {
            logger.info('Music service disabled: MUSIC_LIBRARY_PATH is not configured');
        }

        try {
            const { TicketService } = require('../services/ticketService');
            client.ticketService = new TicketService(client);
            await client.ticketService.reconcile();
            client.ticketService.start();
            logger.success('Ticket service initialized');
        } catch (e) {
            logger.error(`Failed to initialize ticket service: ${e}`);
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
