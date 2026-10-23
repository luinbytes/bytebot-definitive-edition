const { ChannelType, PermissionFlagsBits } = require('discord.js');

async function fetchReadableMessage(interaction, input, permissions = []) {
    const value = String(input || '').trim();
    const link = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/channels\/(\d{17,20}|@me)\/(\d{17,20})\/(\d{17,20})\/?$/.exec(value);
    if (!link && !/^\d{17,20}$/.test(value)) return null;

    const guildId = interaction.guildId || interaction.guild?.id;
    if (link && link[1] !== (guildId || '@me')) return null;
    const channelId = link?.[2] || interaction.channelId || interaction.channel?.id;
    const channel = channelId === interaction.channel?.id
        ? interaction.channel
        : await interaction.guild?.channels.fetch(channelId).catch(() => null);
    if (!channel?.messages?.fetch) return null;

    if (guildId) {
        if ((channel.guildId || channel.guild?.id) !== guildId || !interaction.member) return null;
        const access = channel.permissionsFor(interaction.member);
        if (!access?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, ...permissions])) return null;
        if (channel.type === ChannelType.PrivateThread && !access.has(PermissionFlagsBits.ManageThreads)) {
            const member = await channel.members.fetch(interaction.user.id).catch(() => null);
            if (!member) return null;
        }
    } else if (channel !== interaction.channel || permissions.length) {
        return null;
    }

    return channel.messages.fetch(link?.[3] || value).catch(() => null);
}

module.exports = { fetchReadableMessage };
