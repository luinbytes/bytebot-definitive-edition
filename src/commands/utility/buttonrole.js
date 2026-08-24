const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { boundedList, configOf } = require('../../services/roleAutomationService');

const link = option => option.setName('message_link').setDescription('ByteBot-authored message link').setRequired(true);
const data = new SlashCommandBuilder().setName('buttonrole').setDescription('Manage self-assignable role buttons')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles).setDMPermission(false)
    .addSubcommand(sub => sub.setName('add').setDescription('Add a role button').addStringOption(link)
        .addRoleOption(option => option.setName('role').setDescription('Role to toggle').setRequired(true))
        .addStringOption(option => option.setName('style').setDescription('Button style').addChoices(
            { name: 'Primary', value: 'primary' }, { name: 'Secondary', value: 'secondary' }, { name: 'Success', value: 'success' }, { name: 'Danger', value: 'danger' }))
        .addStringOption(option => option.setName('emoji').setDescription('Optional button emoji').setMaxLength(100))
        .addStringOption(option => option.setName('label').setDescription('Optional button label').setMaxLength(80)))
    .addSubcommand(sub => sub.setName('remove').setDescription('Remove a role button by its displayed index').addStringOption(link)
        .addIntegerOption(option => option.setName('index').setDescription('Button index, starting at 1').setMinValue(1).setMaxValue(25).setRequired(true)))
    .addSubcommand(sub => sub.setName('removeall').setDescription('Remove every role button from a message').addStringOption(link))
    .addSubcommand(sub => sub.setName('reset').setDescription('Remove every role button in the server')
        .addBooleanOption(option => option.setName('confirm').setDescription('Confirm removal').setRequired(true)))
    .addSubcommand(sub => sub.setName('list').setDescription('List role buttons'));

async function messageRules(client, guildId, messageId) {
    return (await client.automationService.list(guildId, 'button-role')).filter(rule => configOf(rule).messageId === messageId);
}

module.exports = {
    data, permissions: [PermissionFlagsBits.ManageRoles], cooldown: 2, longRunning: true, deferEphemeral: true,
    async execute(interaction, client) {
        const service = client.roleAutomationService;
        const action = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;
        if (action === 'add') {
            await service.addButtonRole({ guild: interaction.guild, messageLink: interaction.options.getString('message_link'),
                role: interaction.options.getRole('role'), style: interaction.options.getString('style') || 'secondary',
                emoji: interaction.options.getString('emoji'), label: interaction.options.getString('label'), actor: interaction.member,
                createdBy: interaction.user.id });
            return interaction.editReply('Role button added.');
        }
        if (action === 'list') {
            const rules = await client.automationService.list(guildId, 'button-role');
            const indexes = new Map();
            const lines = rules.map(rule => {
                const config = configOf(rule);
                const index = (indexes.get(config.messageId) || 0) + 1;
                indexes.set(config.messageId, index);
                return `${index}. <#${config.channelId}> / ${config.messageId} → <@&${config.roleId}> (${config.label})`;
            });
            return interaction.editReply({ content: boundedList(lines, 'No role buttons configured.'), allowedMentions: { parse: [] } });
        }
        if (action === 'reset') {
            if (!interaction.options.getBoolean('confirm')) return interaction.editReply('Nothing was removed. Set `confirm` to true.');
            const rules = await client.automationService.clear(guildId, 'button-role');
            const messages = new Map(rules.map(rule => [configOf(rule).messageId, configOf(rule)]));
            for (const config of messages.values()) {
                const channel = interaction.guild.channels.cache.get(config.channelId);
                const message = await channel?.messages.fetch(config.messageId).catch(() => null);
                if (message?.author.id === client.user.id) await message.edit({ components: [] }).catch(() => null);
            }
            return interaction.editReply(`Reset ${rules.length} role button(s).`);
        }
        const message = await service.fetchMessage(interaction.guild, interaction.options.getString('message_link'));
        if (message.author.id !== client.user.id) return interaction.editReply('Button roles can only be removed from ByteBot-authored messages.');
        const rules = await messageRules(client, guildId, message.id);
        if (action === 'remove') {
            const rule = rules[interaction.options.getInteger('index') - 1];
            if (!rule) return interaction.editReply('No role button exists at that index.');
            await client.automationService.remove(guildId, 'button-role', rule.key);
            await service.refreshButtons(interaction.guild, message);
            return interaction.editReply('Role button removed.');
        }
        for (const rule of rules) await client.automationService.remove(guildId, 'button-role', rule.key);
        await service.refreshButtons(interaction.guild, message);
        return interaction.editReply(`Removed ${rules.length} role button(s) from that message.`);
    }
};
