const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const { and, count, eq } = require('drizzle-orm');
const { db } = require('../../database');
const { autoResponses } = require('../../database/schema');

const data = new SlashCommandBuilder().setName('autoresponder').setDescription('Greed-compatible automated responders')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).setDMPermission(false);
const trigger = option => option.setName('trigger').setDescription('Responder trigger').setRequired(true).setMinLength(1).setMaxLength(100);
const channel = option => option.setName('channel').setDescription('Allowed channel')
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread).setRequired(true);
const role = option => option.setName('role').setDescription('Allowed or action role').setRequired(true);

data.addSubcommand(sub => sub.setName('add').setDescription('Add a responder')
    .addStringOption(option => option.setName('trigger').setDescription('Trigger keyword').setRequired(true).setMaxLength(100))
    .addStringOption(option => option.setName('response').setDescription('Response').setRequired(true).setMaxLength(2000))
    .addBooleanOption(option => option.setName('strict').setDescription('Require an exact match'))
    .addBooleanOption(option => option.setName('reply').setDescription('Reply to the triggering message'))
    .addBooleanOption(option => option.setName('delete').setDescription('Delete the triggering message'))
    .addIntegerOption(option => option.setName('self_destruct').setDescription('Delete response after 6-60 seconds').setMinValue(6).setMaxValue(60))
    .addStringOption(option => option.setName('mentions').setDescription('Allowed mentions').addChoices(
        { name: 'None', value: 'none' }, { name: 'Users', value: 'users' }, { name: 'Roles', value: 'roles' }, { name: 'Everyone', value: 'everyone' })))
    .addSubcommand(sub => sub.setName('update').setDescription('Update a responder').addStringOption(trigger)
        .addStringOption(option => option.setName('response').setDescription('New response').setRequired(true).setMaxLength(2000)))
    .addSubcommand(sub => sub.setName('enable').setDescription('Enable a responder').addStringOption(trigger))
    .addSubcommand(sub => sub.setName('disable').setDescription('Disable a responder').addStringOption(trigger))
    .addSubcommand(sub => sub.setName('remove').setDescription('Remove a responder').addStringOption(trigger))
    .addSubcommand(sub => sub.setName('list').setDescription('List responders'))
    .addSubcommand(sub => sub.setName('clear').setDescription('Remove every responder')
        .addBooleanOption(option => option.setName('confirm').setDescription('Confirm removal').setRequired(true)))
    .addSubcommand(sub => sub.setName('reset').setDescription('Reset every responder')
        .addBooleanOption(option => option.setName('confirm').setDescription('Confirm removal').setRequired(true)))
    .addSubcommand(sub => sub.setName('channels-add').setDescription('Allow a channel').addStringOption(trigger).addChannelOption(channel))
    .addSubcommand(sub => sub.setName('channels-remove').setDescription('Remove a channel restriction').addStringOption(trigger).addChannelOption(channel))
    .addSubcommand(sub => sub.setName('channels-list').setDescription('List channel restrictions').addStringOption(trigger))
    .addSubcommand(sub => sub.setName('roles-add').setDescription('Allow a role').addStringOption(trigger).addRoleOption(role))
    .addSubcommand(sub => sub.setName('roles-remove').setDescription('Remove a role restriction').addStringOption(trigger).addRoleOption(role))
    .addSubcommand(sub => sub.setName('roles-list').setDescription('List role restrictions').addStringOption(trigger))
    .addSubcommand(sub => sub.setName('role-add').setDescription('Add a role action').addStringOption(trigger).addRoleOption(role)
        .addStringOption(option => option.setName('mode').setDescription('Action').setRequired(true).addChoices(
            { name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }, { name: 'Toggle', value: 'toggle' })))
    .addSubcommand(sub => sub.setName('role-remove').setDescription('Remove a role action').addStringOption(trigger).addRoleOption(role))
    .addSubcommand(sub => sub.setName('role-list').setDescription('List role actions').addStringOption(trigger));

function getResponder(guildId, responderTrigger) {
    return db.select().from(autoResponses).where(and(eq(autoResponses.guildId, guildId), eq(autoResponses.trigger, responderTrigger))).get();
}

module.exports = {
    data,
    permissions: [PermissionFlagsBits.ManageGuild],
    cooldown: 2,
    longRunning: true,
    async execute(interaction, client) {
        const action = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;
        if (action === 'add') {
            const total = await db.select({ count: count() }).from(autoResponses).where(eq(autoResponses.guildId, guildId)).get();
            if (total.count >= 1000) return interaction.editReply({ content: 'This server has reached the 1,000 auto-responder limit.', flags: [MessageFlags.Ephemeral] });
            if (await getResponder(guildId, interaction.options.getString('trigger'))) return interaction.editReply({ content: 'That trigger already has an auto-responder.', flags: [MessageFlags.Ephemeral] });
            const created = await db.insert(autoResponses).values({
                guildId, trigger: interaction.options.getString('trigger'), response: interaction.options.getString('response'),
                creatorId: interaction.user.id, matchType: interaction.options.getBoolean('strict') ? 'exact' : 'contains',
                reply: interaction.options.getBoolean('reply') || false, deleteTrigger: interaction.options.getBoolean('delete') || false,
                selfDestructSeconds: interaction.options.getInteger('self_destruct'), mentionPolicy: interaction.options.getString('mentions') || 'none',
                enabled: true, cooldown: 60, useCount: 0, createdAt: new Date()
            }).returning().get();
            client.autoResponderService.invalidateCache(guildId);
            return interaction.editReply({ content: `Auto-responder #${created.id} created.`, flags: [MessageFlags.Ephemeral] });
        }
        if (['clear', 'reset'].includes(action)) {
            if (!interaction.options.getBoolean('confirm')) return interaction.editReply({ content: 'Nothing was removed. Set `confirm` to true to continue.', flags: [MessageFlags.Ephemeral] });
            const removed = await db.delete(autoResponses).where(eq(autoResponses.guildId, guildId)).returning().all();
            client.autoResponderService.invalidateCache(guildId);
            return interaction.editReply({ content: `Removed ${removed.length} auto-responder(s).`, flags: [MessageFlags.Ephemeral] });
        }
        if (action === 'list') {
            const total = await db.select({ count: count() }).from(autoResponses).where(eq(autoResponses.guildId, guildId)).get();
            const rows = await db.select().from(autoResponses).where(eq(autoResponses.guildId, guildId)).orderBy(autoResponses.id).limit(25).all();
            const lines = rows.map(row => `#${row.id} ${row.enabled ? '✅' : '⏸️'} **${row.trigger}** → ${row.response.slice(0, 100)}`);
            const visible = [];
            while (lines.length && `${visible.join('\n')}\n${lines[0]}`.length <= 1800) visible.push(lines.shift());
            const omitted = Number(total.count) - visible.length;
            const content = visible.length ? `${visible.join('\n')}${omitted ? `\n… ${omitted} more configured.` : ''}` : 'No auto-responders configured.';
            return interaction.editReply({ content, allowedMentions: { parse: [] }, flags: [MessageFlags.Ephemeral] });
        }
        const row = await getResponder(guildId, interaction.options.getString('trigger'));
        if (!row) return interaction.editReply({ content: 'That auto-responder does not exist.', flags: [MessageFlags.Ephemeral] });
        if (action === 'remove') await db.delete(autoResponses).where(eq(autoResponses.id, row.id));
        else if (action === 'enable' || action === 'disable') await db.update(autoResponses).set({ enabled: action === 'enable' }).where(eq(autoResponses.id, row.id));
        else if (action === 'update') await db.update(autoResponses).set({ response: interaction.options.getString('response') }).where(eq(autoResponses.id, row.id));
        else {
            const field = action.startsWith('channels-') ? 'channelIds' : action.startsWith('roles-') ? 'roleIds' : 'actionRoles';
            const value = JSON.parse(row[field] || '[]');
            if (action.endsWith('-list')) return interaction.editReply({ content: value.length ? JSON.stringify(value) : 'None configured.', flags: [MessageFlags.Ephemeral] });
            const target = field === 'channelIds' ? interaction.options.getChannel('channel').id : interaction.options.getRole('role').id;
            const selectedRole = field === 'channelIds' ? null : interaction.options.getRole('role');
            if (selectedRole && (!selectedRole.editable || selectedRole.managed)) {
                return interaction.editReply({ content: 'That role is managed or above ByteBot and cannot be used safely.', flags: [MessageFlags.Ephemeral] });
            }
            const next = field === 'actionRoles'
                ? (action.endsWith('-remove') ? value.filter(item => item.roleId !== target) : [...value.filter(item => item.roleId !== target), { roleId: target, mode: interaction.options.getString('mode') }])
                : (action.endsWith('-remove') ? value.filter(item => item !== target) : [...new Set([...value, target])]);
            await db.update(autoResponses).set({ [field]: JSON.stringify(next) }).where(eq(autoResponses.id, row.id));
        }
        client.autoResponderService.invalidateCache(guildId);
        return interaction.editReply({ content: `Auto-responder #${row.id} updated.`, flags: [MessageFlags.Ephemeral] });
    }
};
