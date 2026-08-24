const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { RoleManager } = require('../../utils/discordApiUtil');
const { boundedList } = require('../../services/roleAutomationService');

function parseDuration(value) {
    const match = /^(\d+)\s*([mhd])$/i.exec(String(value || ''));
    if (!match) return null;
    const ms = Number(match[1]) * { m: 60000, h: 3600000, d: 86400000 }[match[2].toLowerCase()];
    return ms >= 60000 && ms <= 365 * 86400000 ? ms : null;
}

const member = option => option.setName('member').setDescription('Target member').setRequired(true);
const role = option => option.setName('role').setDescription('Temporary role').setRequired(true);
const data = new SlashCommandBuilder().setName('temprole').setDescription('Manage temporary member roles')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles).setDMPermission(false)
    .addSubcommand(sub => sub.setName('add').setDescription('Add a temporary role').addUserOption(member).addRoleOption(role)
        .addStringOption(option => option.setName('duration').setDescription('1m to 365d').setRequired(true)))
    .addSubcommand(sub => sub.setName('remove').setDescription('Remove a temporary role now').addUserOption(member).addRoleOption(role))
    .addSubcommand(sub => sub.setName('list').setDescription('List temporary roles')
        .addUserOption(option => option.setName('member').setDescription('Optional member filter')));

module.exports = {
    data, permissions: [PermissionFlagsBits.ManageRoles], cooldown: 2, longRunning: true, deferEphemeral: true,
    async execute(interaction, client) {
        const action = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;
        if (action === 'list') {
            const user = interaction.options.getUser('member');
            const rules = (await client.automationService.list(guildId, 'temp-role')).filter(rule => !user || JSON.parse(rule.config).userId === user.id);
            const lines = rules.map(rule => {
                const config = JSON.parse(rule.config);
                return `<@${config.userId}> → <@&${config.roleId}> until <t:${Math.floor(rule.nextRunAt / 1000)}:R>`;
            });
            return interaction.editReply({ content: boundedList(lines, 'No temporary roles configured.'), allowedMentions: { parse: [] } });
        }
        const target = await interaction.guild.members.fetch(interaction.options.getUser('member').id);
        const selectedRole = interaction.options.getRole('role');
        const key = `${target.id}:${selectedRole.id}`;
        const invalid = await client.roleAutomationService.validateRole(interaction.guild, selectedRole, interaction.member);
        if (invalid) return interaction.editReply(invalid);
        if (action === 'remove') {
            const result = await RoleManager.removeRole(target, selectedRole, { reason: `Temporary role removed by ${interaction.user.id}`, logContext: 'temp-role' });
            if (!result.success) return interaction.editReply(result.error);
            await client.automationService.remove(guildId, 'temp-role', key);
            return interaction.editReply('Temporary role removed.');
        }
        const duration = parseDuration(interaction.options.getString('duration'));
        if (!duration) return interaction.editReply('Use a duration from `1m` through `365d`.');
        const result = await RoleManager.addRole(target, selectedRole, { reason: `Temporary role assigned by ${interaction.user.id}`, logContext: 'temp-role' });
        if (!result.success) return interaction.editReply(result.error);
        const expiresAt = Date.now() + duration;
        try {
            await client.automationService.upsert({ guildId, kind: 'temp-role', key, config: { userId: target.id, roleId: selectedRole.id },
                nextRunAt: expiresAt, createdBy: interaction.user.id });
        } catch (error) {
            await RoleManager.removeRole(target, selectedRole, { reason: 'Temporary role scheduling failed', logContext: 'temp-role' });
            throw error;
        }
        return interaction.editReply(`Added ${selectedRole} to ${target} until <t:${Math.floor(expiresAt / 1000)}:F>.`);
    }
};

module.exports.parseDuration = parseDuration;
