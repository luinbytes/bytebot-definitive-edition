const { MessageFlags } = require('discord.js');
const service = require('../services/personalUtilityService');
const { renderScript, SAFE_MENTIONS } = require('../services/richContentService');

const PRIVATE = [MessageFlags.Ephemeral];

function reply(interaction, content) {
    return interaction.reply({ content, allowedMentions: SAFE_MENTIONS, flags: PRIVATE });
}

function utcDate(now = new Date()) {
    return now.toISOString().slice(0, 10);
}

async function afk(interaction, action) {
    if (action === 'set') {
        if (await service.getAfk(interaction.user.id)) return reply(interaction, 'You are already AFK. Send a message to clear it first.');
        const status = interaction.options.getString('status') || 'AFK';
        await service.setAfk(interaction.user.id, status);
        return reply(interaction, `AFK set: **${status.trim() || 'AFK'}**`);
    }
    if (action === 'embed') {
        const script = interaction.options.getString('script', true).trim();
        renderScript(script, {
            user: interaction.user,
            mentioner: interaction.user,
            message: 'Example message',
            time: 'a moment ago'
        });
        await service.setAfkTemplate(interaction.user.id, script);
        return reply(interaction, 'Your custom AFK response is saved.');
    }
    await service.setAfkTemplate(interaction.user.id, null);
    return reply(interaction, 'Your custom AFK response was reset.');
}

async function timezone(interaction, action) {
    if (action === 'set') {
        const row = await service.setTimezone(interaction.user.id, interaction.options.getString('timezone', true));
        return reply(interaction, `Time zone set to **${row.timezone}**.`);
    }
    if (action === 'remove') {
        const removed = await service.removeTimezone(interaction.user.id);
        return reply(interaction, removed ? 'Your time zone was removed.' : 'You do not have a saved time zone.');
    }
    const user = interaction.options.getUser('user') || interaction.user;
    const settings = await service.getSettings(user.id);
    if (!settings?.timezone) return reply(interaction, `${user.username} does not have a saved time zone.`);
    const current = new Intl.DateTimeFormat('en-GB', {
        timeZone: settings.timezone,
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(new Date());
    return reply(interaction, `**${user.username}** — ${settings.timezone}\nCurrent time: **${current}**`);
}

async function diary(interaction, action) {
    if (action === 'create') {
        const entry = await service.createDiaryEntry(
            interaction.user.id,
            utcDate(),
            interaction.options.getString('content', true)
        );
        return reply(interaction, `Diary entry #${entry.id} saved for ${entry.entryDate}.`);
    }
    if (action === 'delete') {
        const deleted = await service.deleteDiaryEntry(interaction.user.id, interaction.options.getInteger('id', true));
        return reply(interaction, deleted ? 'Diary entry deleted.' : 'That diary entry was not found.');
    }
    const entries = await service.listDiaryEntries(interaction.user.id);
    if (!entries.length) return reply(interaction, 'You do not have any diary entries.');
    const page = interaction.options.getInteger('page') || 1;
    const entry = entries[page - 1];
    if (!entry) return reply(interaction, `Choose a page from 1 to ${entries.length}.`);
    return reply(interaction, `**${entry.entryDate} — entry #${entry.id}**\n${entry.content}\n\nPage ${page}/${entries.length}`);
}

async function executePersonalUtility(interaction) {
    const group = interaction.options.getSubcommandGroup();
    const action = interaction.options.getSubcommand();
    try {
        if (group === 'afk') return await afk(interaction, action);
        if (group === 'timezone') return await timezone(interaction, action);
        if (group === 'diary') return await diary(interaction, action);
    } catch (error) {
        return reply(interaction, error.message || 'That personal utility action failed.');
    }
    throw new Error(`Unsupported personal utility path: ${group} ${action}`);
}

module.exports = { executePersonalUtility, utcDate };
