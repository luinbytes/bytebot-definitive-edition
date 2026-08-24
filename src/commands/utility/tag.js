const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const crypto = require('crypto');
const { boundedList, configOf } = require('../../services/roleAutomationService');

const named = option => option.setName('name').setDescription('Tag name').setRequired(true).setMaxLength(32);
const content = option => option.setName('content').setDescription('Tag message or script').setRequired(true).setMaxLength(6000);

module.exports = {
    data: new SlashCommandBuilder().setName('tag').setDescription('Create and use saved tags')
        .addSubcommand(sub => sub.setName('add').setDescription('Create a tag').addStringOption(named).addStringOption(content))
        .addSubcommand(sub => sub.setName('edit').setDescription('Edit a tag').addStringOption(named).addStringOption(content))
        .addSubcommand(sub => sub.setName('remove').setDescription('Remove a tag').addStringOption(named))
        .addSubcommand(sub => sub.setName('rename').setDescription('Rename a tag').addStringOption(named)
            .addStringOption(option => option.setName('new_name').setDescription('New tag name').setRequired(true).setMaxLength(32)))
        .addSubcommand(sub => sub.setName('reset').setDescription('Remove every tag you authored')
            .addBooleanOption(option => option.setName('confirm').setDescription('Confirm permanent removal').setRequired(true)))
        .addSubcommand(sub => sub.setName('send').setDescription('Send a tag').addStringOption(named))
        .addSubcommand(sub => sub.setName('list').setDescription('List tags you authored'))
        .addSubcommand(sub => sub.setName('search').setDescription('Search tags').addStringOption(option => option.setName('query').setDescription('Name fragment').setRequired(true)))
        .addSubcommand(sub => sub.setName('random').setDescription('Send a random tag'))
        .addSubcommand(sub => sub.setName('author').setDescription('Show a tag author').addStringOption(named))
        .addSubcommand(sub => sub.setName('settings').setDescription('Enable or disable tags in this server')
            .addBooleanOption(option => option.setName('enabled').setDescription('Whether tags may be sent').setRequired(true))),
    permissions: [], cooldown: 2, longRunning: true, deferEphemeral: true,
    async execute(interaction, client) {
        const service = client.richContentService;
        const action = interaction.options.getSubcommand();
        const name = interaction.options.getString('name');
        const canManage = Boolean(interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild));
        if (action === 'settings') {
            if (!interaction.guild || !canManage) return interaction.editReply('You need **Manage Server** to change tag settings.');
            const enabled = interaction.options.getBoolean('enabled');
            service.setTagsEnabled(interaction.guildId, enabled, interaction.user.id);
            return interaction.editReply(`Tags are now ${enabled ? 'enabled' : 'disabled'} in this server.`);
        }
        if (['send', 'random'].includes(action) && interaction.guild && !service.getTagSettings(interaction.guildId).enabled) {
            return interaction.editReply('Tags are disabled in this server.');
        }
        if (action === 'add' || action === 'edit') {
            const source = interaction.options.getString('content');
            const existing = await service.getTag(name);
            if (action === 'add' && existing) return interaction.editReply(`Tag **${name}** already exists.`);
            if (action === 'edit' && !existing) return interaction.editReply(`Tag **${name}** was not found.`);
            service.render(source, { user: interaction.user, member: interaction.member, guild: interaction.guild, channel: interaction.channel });
            await service.saveTag(interaction.user.id, name, source, { canManage });
            return interaction.editReply(`${action === 'add' ? 'Saved' : 'Updated'} tag **${name.toLowerCase()}**.`);
        }
        if (action === 'list' || action === 'search') {
            const query = action === 'search' ? interaction.options.getString('query') : '';
            const rules = (await service.listTags(query)).filter(rule => action === 'search' || rule.createdBy === interaction.user.id);
            return interaction.editReply({ content: boundedList(rules.map(rule => `\`${rule.key}\` — <@${rule.createdBy}>`), 'No tags found.'), allowedMentions: { parse: [] } });
        }
        if (action === 'reset') {
            if (!interaction.options.getBoolean('confirm')) return interaction.editReply('Reset cancelled; confirmation was not provided.');
            return interaction.editReply(`Removed ${service.resetTags(interaction.user.id)} tag(s).`);
        }
        let rule = name ? await service.getTag(name) : null;
        if (action === 'random') {
            const rules = await service.listTags();
            rule = rules.length ? rules[crypto.randomInt(rules.length)] : null;
        }
        if (['send', 'random'].includes(action)) {
            if (!rule) return interaction.editReply('No matching tag was found.');
            const payload = service.render(configOf(rule).script, { user: interaction.user, member: interaction.member,
                guild: interaction.guild, channel: interaction.channel });
            if (interaction.channel?.send) await interaction.channel.send(payload);
            return interaction.editReply(`Sent tag **${rule.key}**.`);
        }
        if (!rule) return interaction.editReply(`Tag **${name}** was not found.`);
        if (action === 'author') return interaction.editReply({ content: `**${rule.key}** was created by <@${rule.createdBy}>.`, allowedMentions: { parse: [] } });
        if (action === 'remove') { await service.removeTag(interaction.user.id, name, { canManage }); return interaction.editReply(`Removed **${name}**.`); }
        if (action === 'rename') {
            const next = interaction.options.getString('new_name');
            await service.renameTag(interaction.user.id, name, next, { canManage });
            return interaction.editReply(`Renamed **${name}** to **${next.toLowerCase()}**.`);
        }
        return interaction.editReply('Unknown tag action.');
    }
};
