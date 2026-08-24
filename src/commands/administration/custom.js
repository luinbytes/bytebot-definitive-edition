const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { boundedList, configOf } = require('../../services/roleAutomationService');
const { sourceReply } = require('../../services/richContentService');

const named = option => option.setName('name').setDescription('Script name').setRequired(true).setMinLength(1).setMaxLength(32);
const script = option => option.setName('script').setDescription('Message, embed, or Components V2 script').setRequired(true).setMaxLength(6000);

module.exports = {
    data: new SlashCommandBuilder().setName('custom').setDescription('Manage reusable button scripts')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).setDMPermission(false)
        .addSubcommand(sub => sub.setName('add').setDescription('Create or overwrite a script').addStringOption(named).addStringOption(script))
        .addSubcommand(sub => sub.setName('list').setDescription('List saved scripts'))
        .addSubcommand(sub => sub.setName('test').setDescription('Render a script privately').addStringOption(named))
        .addSubcommand(sub => sub.setName('raw').setDescription('Show script source').addStringOption(named))
        .addSubcommand(sub => sub.setName('rename').setDescription('Rename a script').addStringOption(named)
            .addStringOption(option => option.setName('new_name').setDescription('New script name').setRequired(true).setMaxLength(32)))
        .addSubcommand(sub => sub.setName('remove').setDescription('Remove a script').addStringOption(named))
        .addSubcommand(sub => sub.setName('reset').setDescription('Remove every custom script')
            .addBooleanOption(option => option.setName('confirm').setDescription('Confirm permanent removal').setRequired(true))),
    permissions: [PermissionFlagsBits.ManageGuild], cooldown: 2, longRunning: true, deferEphemeral: true,
    async execute(interaction, client) {
        const service = client.richContentService;
        const action = interaction.options.getSubcommand();
        const name = interaction.options.getString('name');
        if (action === 'add') {
            const source = interaction.options.getString('script');
            service.render(source, { user: interaction.user, member: interaction.member, guild: interaction.guild, channel: interaction.channel });
            await service.saveCustom(interaction.guildId, interaction.user.id, name, source);
            return interaction.editReply(`Saved custom script **${name.toLowerCase()}**.`);
        }
        if (action === 'list') {
            const lines = service.listCustom(interaction.guildId).map(rule => `\`${rule.key}\` — ${configOf(rule).useCount || 0} uses`);
            return interaction.editReply({ content: boundedList(lines, 'No custom scripts configured.'), allowedMentions: { parse: [] } });
        }
        const rule = name && service.getCustom(interaction.guildId, name);
        if (['test', 'raw', 'rename', 'remove'].includes(action) && !rule) return interaction.editReply(`Custom script **${name}** was not found.`);
        if (action === 'test') return interaction.editReply(service.render(configOf(rule).script, {
            user: interaction.user, member: interaction.member, guild: interaction.guild, channel: interaction.channel,
        }));
        if (action === 'raw') return interaction.editReply(sourceReply(configOf(rule).script, `${rule.key}.txt`));
        if (action === 'rename') {
            const next = interaction.options.getString('new_name');
            service.renameCustom(interaction.guildId, name, next);
            return interaction.editReply(`Renamed **${name}** to **${next.toLowerCase()}**.`);
        }
        if (action === 'remove') { service.removeCustom(interaction.guildId, name); return interaction.editReply(`Removed **${name}**.`); }
        if (!interaction.options.getBoolean('confirm')) return interaction.editReply('Reset cancelled; confirmation was not provided.');
        return interaction.editReply(`Removed ${service.resetCustom(interaction.guildId)} custom script(s).`);
    }
};
