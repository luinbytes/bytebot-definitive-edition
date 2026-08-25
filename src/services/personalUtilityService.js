const { and, desc, eq, inArray } = require('drizzle-orm');
const { db } = require('../database');
const { afkStatuses, diaryEntries, personalSettings } = require('../database/schema');
const { renderScript, SAFE_MENTIONS } = require('./richContentService');

const TIMEZONE_ALIASES = new Map(Object.entries({
    utc: 'UTC', gmt: 'UTC', london: 'Europe/London', paris: 'Europe/Paris',
    berlin: 'Europe/Berlin', tokyo: 'Asia/Tokyo', sydney: 'Australia/Sydney',
    est: 'America/New_York', edt: 'America/New_York',
    cst: 'America/Chicago', cdt: 'America/Chicago',
    mst: 'America/Denver', mdt: 'America/Denver',
    pst: 'America/Los_Angeles', pdt: 'America/Los_Angeles',
    'new york': 'America/New_York', chicago: 'America/Chicago',
    denver: 'America/Denver', 'los angeles': 'America/Los_Angeles'
}));

function normalizeTimezone(value) {
    const input = String(value || '').trim();
    const candidate = TIMEZONE_ALIASES.get(input.toLowerCase()) || input;
    try {
        return new Intl.DateTimeFormat('en', { timeZone: candidate }).resolvedOptions().timeZone;
    } catch {
        throw new Error('Provide a valid time zone using IANA, a supported abbreviation, or a supported city name.');
    }
}

async function getSettings(userId) {
    return db.select().from(personalSettings).where(eq(personalSettings.userId, userId)).get() || null;
}

async function setTimezone(userId, timezone) {
    const normalized = normalizeTimezone(timezone);
    const now = Date.now();
    return db.insert(personalSettings).values({ userId, timezone: normalized, updatedAt: now })
        .onConflictDoUpdate({ target: personalSettings.userId, set: { timezone: normalized, updatedAt: now } })
        .returning().get();
}

async function removeTimezone(userId) {
    const settings = await getSettings(userId);
    if (!settings) return false;
    if (!settings.afkTemplate) {
        db.delete(personalSettings).where(eq(personalSettings.userId, userId)).run();
    } else {
        db.update(personalSettings).set({ timezone: null, updatedAt: Date.now() })
            .where(eq(personalSettings.userId, userId)).run();
    }
    return Boolean(settings.timezone);
}

async function setAfkTemplate(userId, template) {
    const value = template == null ? null : String(template).trim();
    if (value && value.length > 2000) throw new Error('AFK templates can contain at most 2,000 characters.');
    const settings = await getSettings(userId);
    if (!value) {
        if (!settings) return null;
        if (!settings.timezone) db.delete(personalSettings).where(eq(personalSettings.userId, userId)).run();
        else db.update(personalSettings).set({ afkTemplate: null, updatedAt: Date.now() })
            .where(eq(personalSettings.userId, userId)).run();
        return null;
    }
    const now = Date.now();
    return db.insert(personalSettings).values({ userId, afkTemplate: value, updatedAt: now })
        .onConflictDoUpdate({ target: personalSettings.userId, set: { afkTemplate: value, updatedAt: now } })
        .returning().get();
}

async function setAfk(userId, status = 'AFK', setAt = Date.now()) {
    const value = String(status || 'AFK').trim() || 'AFK';
    if (value.length > 25) throw new Error('AFK status can contain at most 25 characters.');
    return db.insert(afkStatuses).values({ userId, status: value, setAt })
        .onConflictDoUpdate({ target: afkStatuses.userId, set: { status: value, setAt } })
        .returning().get();
}

async function getAfk(userId) {
    return db.select().from(afkStatuses).where(eq(afkStatuses.userId, userId)).get() || null;
}

async function clearAfk(userId) {
    return db.delete(afkStatuses).where(eq(afkStatuses.userId, userId)).returning().get() || null;
}

function validDiaryDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

async function createDiaryEntry(userId, entryDate, content, createdAt = Date.now()) {
    const text = String(content || '').trim();
    if (!validDiaryDate(entryDate)) throw new Error('Diary date must be a valid UTC date.');
    if (!text || text.length > 2000) throw new Error('Diary entries must contain 1-2,000 characters.');
    try {
        return db.insert(diaryEntries).values({ userId, entryDate, content: text, createdAt }).returning().get();
    } catch (error) {
        if (String(error.message).includes('UNIQUE')) throw new Error('You already have a diary entry for today.');
        throw error;
    }
}

async function listDiaryEntries(userId) {
    return db.select().from(diaryEntries).where(eq(diaryEntries.userId, userId))
        .orderBy(desc(diaryEntries.entryDate), desc(diaryEntries.id)).all();
}

async function deleteDiaryEntry(userId, id) {
    return db.delete(diaryEntries).where(and(eq(diaryEntries.userId, userId), eq(diaryEntries.id, id)))
        .returning().get() !== undefined;
}

async function handleAfkMessage(message, clearedStatus) {
    const cleared = clearedStatus === undefined ? await clearAfk(message.author.id) : clearedStatus;
    if (cleared) {
        await message.reply({
            content: `Welcome back, **${message.author.username}** — I cleared your AFK status.`,
            allowedMentions: SAFE_MENTIONS
        });
    }

    const mentioned = new Map(message.mentions?.users?.map(user => [user.id, user]) || []);
    if (message.mentions?.repliedUser) mentioned.set(message.mentions.repliedUser.id, message.mentions.repliedUser);
    mentioned.delete(message.author.id);

    const users = [...mentioned.values()];
    if (!users.length) return;
    const active = await db.select().from(afkStatuses)
        .where(inArray(afkStatuses.userId, users.map(user => user.id))).all();
    if (!active.length) return;
    const byUser = new Map(users.map(user => [user.id, user]));
    const visible = active.slice(0, 10);

    if (active.length === 1) {
        const afk = active[0];
        const user = byUser.get(afk.userId);
        const settings = await getSettings(user.id);
        const fallback = `<@${user.id}> is AFK: **${afk.status}** — since <t:${Math.floor(afk.setAt / 1000)}:R>.`;
        let payload = { content: fallback, allowedMentions: SAFE_MENTIONS };
        if (settings?.afkTemplate) {
            try {
                payload = renderScript(settings.afkTemplate, {
                    user,
                    mentioner: message.author,
                    message: afk.status,
                    time: `<t:${Math.floor(afk.setAt / 1000)}:R>`
                });
            } catch {
                // A previously valid script can become invalid after dependency changes.
            }
        }
        await message.reply(payload);
        return;
    }

    const lines = visible.map(afk => `<@${afk.userId}> — **${afk.status}** since <t:${Math.floor(afk.setAt / 1000)}:R>`);
    if (active.length > visible.length) lines.push(`…and ${active.length - visible.length} more AFK members.`);
    await message.reply({ content: lines.join('\n'), allowedMentions: SAFE_MENTIONS });
}

module.exports = {
    normalizeTimezone,
    getSettings,
    setTimezone,
    removeTimezone,
    setAfkTemplate,
    setAfk,
    getAfk,
    clearAfk,
    createDiaryEntry,
    listDiaryEntries,
    deleteDiaryEntry,
    handleAfkMessage
};
