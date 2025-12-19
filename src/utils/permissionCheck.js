const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const embeds = require('./embeds');

/**
 * Checks if the bot has the required permissions to manage BytePods.
 * If not, it attempts to notify the guild owner and the user.
 * 
 * @param {import('discord.js').Guild} guild - The guild to check permissions in.
 * @param {import('discord.js').GuildMember} [triggerMember] - The member who triggered the action (optional).
 * @returns {Promise<boolean>} - True if permissions are valid, False if missing (and notification sent).
 */
async function checkBotPermissions(guild, triggerMember) {
    const requiredPermissions = [
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.MoveMembers,
        PermissionFlagsBits.Connect
    ];

    const botMember = guild.members.cache.get(guild.client.user.id);
    if (!botMember) return false;

    const missingPermissions = requiredPermissions.filter(perm => !botMember.permissions.has(perm));

    if (missingPermissions.length === 0) return true;

    // Permissions are missing, attempt to notify
    console.error(`[BytePods] Missing permissions in guild ${guild.name} (${guild.id}):`, missingPermissions);

    const errorEmbed = embeds.error(
        'Missing Permissions',
        `ByteBot is missing the following permissions required for BytePods:\n- ${missingPermissions.map(p => `**${getPermissionName(p)}**`).join('\n- ')}\n\nPlease ask a server administrator to grant these permissions.`
    );

    // Notify User
    if (triggerMember) {
        try {
            await triggerMember.send({ embeds: [errorEmbed] });
        } catch (err) {
            // User DMs might be closed
        }
    }

    // Notify Owner (if different from user)
    if (triggerMember?.id !== guild.ownerId) {
        try {
            const owner = await guild.fetchOwner();
            await owner.send({
                content: `🚨 **ByteBot Alert**: Permission Error in **${guild.name}**`,
                embeds: [errorEmbed]
            });
        } catch (err) {
            console.error('Failed to notify guild owner of permission error.');
        }
    }

    return false;
}

function getPermissionName(bit) {
    for (const [name, value] of Object.entries(PermissionFlagsBits)) {
        if (value === bit) return name.replace(/([A-Z])/g, ' $1').trim();
    }
    return 'Unknown Permission';
}

module.exports = { checkBotPermissions };
