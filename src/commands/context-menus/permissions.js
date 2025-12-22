const { ContextMenuCommandBuilder, ApplicationCommandType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Check Permissions')
        .setType(ApplicationCommandType.User)
        .setDMPermission(false), // Guild only

    cooldown: 3,

    async execute(interaction, client) {
        const member = interaction.targetMember;
        const channel = interaction.channel;

        // Get permissions in current channel
        const permissions = member.permissionsIn(channel);

        // Categorize permissions
        const dangerous = [];
        const important = [];
        const other = [];

        const dangerousPerms = [
            'Administrator',
            'ManageGuild',
            'ManageRoles',
            'ManageChannels',
            'BanMembers',
            'KickMembers',
            'ManageWebhooks',
            'ManageNicknames',
            'ManageEmojisAndStickers'
        ];

        const importantPerms = [
            'SendMessages',
            'EmbedLinks',
            'AttachFiles',
            'ManageMessages',
            'MentionEveryone',
            'UseExternalEmojis',
            'UseExternalStickers',
            'AddReactions',
            'Connect',
            'Speak',
            'Stream',
            'MoveMembers',
            'MuteMembers',
            'DeafenMembers'
        ];

        // Check each permission
        for (const [perm, value] of Object.entries(PermissionFlagsBits)) {
            if (permissions.has(value)) {
                if (dangerousPerms.includes(perm)) {
                    dangerous.push(perm);
                } else if (importantPerms.includes(perm)) {
                    important.push(perm);
                } else {
                    other.push(perm);
                }
            }
        }

        const embed = embeds.info(
            `Permissions for ${member.user.tag}`,
            `**Channel:** ${channel.toString()}`
        );

        embed.setThumbnail(member.user.displayAvatarURL({ size: 128 }));

        // Administrator warning
        if (permissions.has(PermissionFlagsBits.Administrator)) {
            embed.addFields({
                name: '⚠️ Administrator',
                value: 'This user has the **Administrator** permission, which grants **ALL** permissions in this server.',
                inline: false
            });
        }

        // Dangerous permissions
        if (dangerous.length > 0) {
            embed.addFields({
                name: `🔴 Dangerous Permissions [${dangerous.length}]`,
                value: dangerous.map(p => `\`${p}\``).join(', '),
                inline: false
            });
        }

        // Important permissions
        if (important.length > 0) {
            embed.addFields({
                name: `🟡 Important Permissions [${important.length}]`,
                value: important.map(p => `\`${p}\``).join(', '),
                inline: false
            });
        }

        // Other permissions (only show if not too many)
        if (other.length > 0 && other.length < 20) {
            embed.addFields({
                name: `🟢 Other Permissions [${other.length}]`,
                value: other.map(p => `\`${p}\``).join(', '),
                inline: false
            });
        } else if (other.length >= 20) {
            embed.addFields({
                name: `🟢 Other Permissions [${other.length}]`,
                value: `Too many to display (${other.length} permissions)`,
                inline: false
            });
        }

        const totalPerms = dangerous.length + important.length + other.length;
        embed.setFooter({ text: `Total: ${totalPerms} permissions in this channel` });

        return interaction.reply({
            embeds: [embed],
            flags: [MessageFlags.Ephemeral]
        });
    }
};
