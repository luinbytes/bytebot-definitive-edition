const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { boundedList, configOf } = require('../../services/roleAutomationService');

const link = option => option.setName('message_link').setDescription('Discord message link from this server').setRequired(true);
const emoji = option => option.setName('emoji').setDescription('Unicode or accessible custom emoji').setMaxLength(100).setRequired(true);
const data = new SlashCommandBuilder().setName('reactionrole').setDescription('Manage self-assignable reaction roles')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles).setDMPermission(false)
    .addSubcommand(sub => sub.setName('add').setDescription('Add a reaction role').addStringOption(link).addStringOption(emoji)
        .addRoleOption(option => option.setName('role').setDescription('Role to toggle').setRequired(true)))
    .addSubcommand(sub => sub.setName('remove').setDescription('Remove a reaction role').addStringOption(link).addStringOption(emoji))
    .addSubcommand(sub => sub.setName('list').setDescription('List reaction roles'))
    .addSubcommand(sub => sub.setName('clear').setDescription('Clear reaction roles')
        .addStringOption(option => option.setName('message_link').setDescription('Optional message to clear'))
        .addBooleanOption(option => option.setName('confirm').setDescription('Confirm removal').setRequired(true)));

module.exports = {
    data, permissions: [PermissionFlagsBits.ManageRoles], cooldown: 2, longRunning: true, deferEphemeral: true,
    async execute(interaction, client) {
        const service = client.roleAutomationService;
        const action = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;
        if (action === 'add') {
            await service.addReactionRole({ guild: interaction.guild, messageLink: interaction.options.getString('message_link'),
                emoji: interaction.options.getString('emoji'), role: interaction.options.getRole('role'), actor: interaction.member,
                createdBy: interaction.user.id });
            return interaction.editReply('Reaction role added.');
        }
        if (action === 'remove') {
            const removed = await service.removeReactionRole(interaction.guild, interaction.options.getString('message_link'), interaction.options.getString('emoji'));
            return interaction.editReply(removed ? 'Reaction role removed.' : 'That reaction role is not configured.');
        }
        if (action === 'list') {
            const rules = await client.automationService.list(guildId, 'reaction-role');
            const lines = rules.map((rule, index) => {
                const config = configOf(rule);
                return `${index + 1}. ${config.emoji} <#${config.channelId}> / ${config.messageId} → <@&${config.roleId}>`;
            });
            return interaction.editReply({ content: boundedList(lines, 'No reaction roles configured.'), allowedMentions: { parse: [] } });
        }
        if (!interaction.options.getBoolean('confirm')) return interaction.editReply('Nothing was removed. Set `confirm` to true.');
        const messageLink = interaction.options.getString('message_link');
        if (!messageLink) {
            const removed = await client.automationService.clear(guildId, 'reaction-role');
            return interaction.editReply(`Cleared ${removed.length} reaction role(s).`);
        }
        const message = await service.fetchMessage(interaction.guild, messageLink);
        const rules = (await client.automationService.list(guildId, 'reaction-role')).filter(rule => configOf(rule).messageId === message.id);
        for (const rule of rules) await client.automationService.remove(guildId, 'reaction-role', rule.key);
        return interaction.editReply(`Cleared ${rules.length} reaction role(s) from that message.`);
    }
};
