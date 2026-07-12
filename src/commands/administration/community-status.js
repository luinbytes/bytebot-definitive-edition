const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const { db } = require('../../database');
const { guilds, birthdayConfig, starboardConfig, suggestionConfig, achievementRoleConfig, achievementRoles } = require('../../database/schema');
const { eq } = require('drizzle-orm');
const embeds = require('../../utils/embeds');
const { getPermissionNames } = require('../../utils/permissions');

const CHANNEL_REQUIREMENTS = {
    welcome: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
    birthday: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
    starboard: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
    suggestions: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AddReactions]
};

const EMBED_FIELD_VALUE_LIMIT = 1024;

async function getGuildConfiguration(guildId) {
    const [guildRows, birthdayRows, starboardRows, suggestionRows, achievementRoleRows, achievementRoleResourceRows] = await Promise.all([
        db.select().from(guilds).where(eq(guilds.id, guildId)),
        db.select().from(birthdayConfig).where(eq(birthdayConfig.guildId, guildId)),
        db.select().from(starboardConfig).where(eq(starboardConfig.guildId, guildId)),
        db.select().from(suggestionConfig).where(eq(suggestionConfig.guildId, guildId)),
        db.select().from(achievementRoleConfig).where(eq(achievementRoleConfig.guildId, guildId)),
        db.select().from(achievementRoles).where(eq(achievementRoles.guildId, guildId))
    ]);

    return {
        guild: guildRows[0],
        birthday: birthdayRows[0],
        starboard: starboardRows[0],
        suggestions: suggestionRows[0],
        achievementRoles: achievementRoleRows[0],
        achievementRoleResources: achievementRoleResourceRows || []
    };
}

async function inspectChannelPermissions(guild, featureName, channelId, requiredPermissions) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return `${featureName}: configured channel is unavailable`;

    const botMember = guild.members.me || guild.members.cache?.get(guild.client?.user?.id);
    const permissions = botMember && channel.permissionsFor(botMember);
    if (!permissions) return `${featureName}: unable to inspect bot channel permissions`;

    const missing = requiredPermissions.filter(permission => !permissions.has(permission));
    return missing.length === 0 ? null : `${featureName}: ${formatPermissionNames(missing)}`;
}

function isSupportedSendableTextChannel(channel) {
    return channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement;
}

async function inspectConfiguredTextChannel(guild, featureName, channelId, requiredPermissions) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return `${featureName} channel is unavailable`;
    if (!isSupportedSendableTextChannel(channel)) return `${featureName} channel is not a supported sendable text channel`;

    const botMember = guild.members.me || guild.members.cache?.get(guild.client?.user?.id);
    const permissions = botMember && channel.permissionsFor(botMember);
    if (!permissions) return `${featureName}: unable to inspect bot channel permissions`;

    const missing = requiredPermissions.filter(permission => !permissions.has(permission));
    return missing.length === 0 ? null : `${featureName}: ${formatPermissionNames(missing)}`;
}

async function inspectConfiguredRole(guild, featureName, roleId) {
    const role = await guild.roles?.fetch(roleId).catch(() => null);
    if (!role) return { missing: `${featureName} role is unavailable` };
    if (role.managed) return { permission: `${featureName}: configured role is managed by an integration` };

    const botHighestRole = guild.members.me?.roles?.highest;
    if (!botHighestRole || role.position >= botHighestRole.position) {
        return { permission: `${featureName}: configured role is above or equal to the bot's highest role` };
    }
    return null;
}

function formatPermissionNames(permissions) {
    return getPermissionNames(permissions)
        .map(name => name.replace(/([A-Z])/g, ' $1').trim())
        .join(', ');
}

function status(enabled, configured) {
    if (!configured) return '⚪ Not configured';
    return enabled ? '✅ Enabled' : '❌ Disabled';
}

function formatGapList(items, emptyValue) {
    if (items.length === 0) return emptyValue;

    const lines = items.map(item => `• ${item}`);
    const fullValue = lines.join('\n');
    if (fullValue.length <= EMBED_FIELD_VALUE_LIMIT) return fullValue;

    // Keep whole findings only: a partial role/channel name is less useful than
    // an explicit count of the remaining findings, and Discord rejects fields
    // over 1,024 characters.
    const included = [];
    for (let index = 0; index < lines.length; index++) {
        const remaining = lines.length - index - 1;
        const truncation = `• … and ${remaining} more ${remaining === 1 ? 'item' : 'items'}`;
        const candidate = [...included, lines[index], truncation].join('\n');
        if (candidate.length > EMBED_FIELD_VALUE_LIMIT) break;
        included.push(lines[index]);
    }

    const remaining = lines.length - included.length;
    return [...included, `• … and ${remaining} more ${remaining === 1 ? 'item' : 'items'}`].join('\n');
}

module.exports = {
    register: false,
    data: new SlashCommandBuilder()
        .setName('community-status')
        .setDescription('View read-only community configuration status')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    permissions: [PermissionFlagsBits.Administrator],

    async execute(interaction) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const config = await getGuildConfiguration(interaction.guild.id);
        const missingConfiguration = [];
        const permissionChecks = [];
        const guildConfig = config.guild;

        if (!guildConfig) missingConfiguration.push('Guild settings');
        if (!guildConfig?.voiceHubChannelId) missingConfiguration.push('BytePods hub channel');
        if (guildConfig?.welcomeEnabled && !guildConfig.welcomeChannel) missingConfiguration.push('Welcome channel');
        if (config.birthday?.enabled && !config.birthday.channelId) missingConfiguration.push('Birthday announcement channel');
        if (config.starboard?.enabled && !config.starboard.channelId) missingConfiguration.push('Starboard channel');
        if (config.suggestions?.enabled && !config.suggestions.channelId) missingConfiguration.push('Suggestion channel');

        const botPermissions = interaction.guild.members.me?.permissions;
        const achievementRoles = config.achievementRoles || { enabled: true };
        const needsBirthdayRole = config.birthday?.enabled && Boolean(config.birthday.roleId);
        const needsSuggestionReviewRole = config.suggestions?.enabled && Boolean(config.suggestions.reviewRoleId);
        const needsAchievementRoles = achievementRoles.enabled;
        if ((needsBirthdayRole || needsSuggestionReviewRole || needsAchievementRoles) && !botPermissions?.has(PermissionFlagsBits.ManageRoles)) {
            if (needsBirthdayRole) permissionChecks.push(`Birthdays: ${formatPermissionNames([PermissionFlagsBits.ManageRoles])}`);
            if (needsSuggestionReviewRole) permissionChecks.push(`Suggestions: ${formatPermissionNames([PermissionFlagsBits.ManageRoles])}`);
            if (needsAchievementRoles) permissionChecks.push(`Achievement Roles: ${formatPermissionNames([PermissionFlagsBits.ManageRoles])}`);
        }

        const podPermissions = [
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.MoveMembers,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks
        ];
        let bytePodsUsable = Boolean(guildConfig?.voiceHubChannelId);
        let hubChannel = null;
        if (guildConfig?.voiceHubChannelId) {
            hubChannel = await interaction.guild.channels.fetch(guildConfig.voiceHubChannelId).catch(() => null);
            if (!hubChannel) {
                bytePodsUsable = false;
                missingConfiguration.push('BytePods hub channel is unavailable');
            } else if (hubChannel.type !== ChannelType.GuildVoice) {
                bytePodsUsable = false;
                missingConfiguration.push('BytePods hub channel is not a voice channel');
            } else {
                const hubGap = await inspectChannelPermissions(interaction.guild, 'BytePods hub channel', hubChannel.id, podPermissions);
                if (hubGap) permissionChecks.push(hubGap);
            }
        }

        const effectiveCategoryId = guildConfig?.voiceHubCategoryId || hubChannel?.parentId;
        if (effectiveCategoryId) {
            const category = await interaction.guild.channels.fetch(effectiveCategoryId).catch(() => null);
            if (!category) {
                bytePodsUsable = false;
                missingConfiguration.push('BytePods category is unavailable');
            } else if (category.type !== ChannelType.GuildCategory) {
                bytePodsUsable = false;
                missingConfiguration.push('BytePods category is not a category');
            } else {
                const categoryGap = await inspectChannelPermissions(interaction.guild, 'BytePods category', category.id, podPermissions);
                if (categoryGap) permissionChecks.push(categoryGap);
            }
        }

        const configuredChannels = [
            ['Welcome', guildConfig?.welcomeEnabled, guildConfig?.welcomeChannel, CHANNEL_REQUIREMENTS.welcome],
            ['Birthdays', config.birthday?.enabled, config.birthday?.channelId, CHANNEL_REQUIREMENTS.birthday],
            ['Starboard', config.starboard?.enabled, config.starboard?.channelId, CHANNEL_REQUIREMENTS.starboard],
            ['Suggestions', config.suggestions?.enabled, config.suggestions?.channelId, CHANNEL_REQUIREMENTS.suggestions]
        ];
        const channelGaps = await Promise.all(configuredChannels
            .filter(([, enabled, channelId]) => enabled && channelId)
            .map(([featureName, , channelId, requirements]) => inspectConfiguredTextChannel(interaction.guild, featureName, channelId, requirements)));
        channelGaps.filter(Boolean).forEach(gap => {
            if (gap.includes(' channel is unavailable') || gap.includes(' channel is not a supported sendable text channel')) {
                missingConfiguration.push(gap);
            } else {
                permissionChecks.push(gap);
            }
        });

        const roleChecks = await Promise.all([
            config.birthday?.enabled && config.birthday.roleId
                ? inspectConfiguredRole(interaction.guild, 'Birthdays', config.birthday.roleId)
                : null,
            config.suggestions?.enabled && config.suggestions.reviewRoleId
                ? inspectConfiguredRole(interaction.guild, 'Suggestions', config.suggestions.reviewRoleId)
                : null,
            ...(achievementRoles.enabled ? config.achievementRoleResources.map(role =>
                inspectConfiguredRole(interaction.guild, 'Achievement Roles', role.roleId)) : [])
        ]);
        roleChecks.filter(Boolean).forEach(gap => {
            if (gap.missing) missingConfiguration.push(gap.missing);
            if (gap.permission) permissionChecks.push(gap.permission);
        });

        const embed = embeds.brand('Community Status', `Read-only status for ${interaction.guild.name}`)
            .addFields(
                { name: 'Achievements', value: status(guildConfig?.achievementsEnabled !== false, true), inline: true },
                { name: 'Activity Streaks', value: status(true, true), inline: true },
                { name: 'Achievement Roles', value: status(achievementRoles.enabled, true), inline: true },
                { name: 'BytePods', value: status(bytePodsUsable, Boolean(guildConfig?.voiceHubChannelId)), inline: true },
                { name: 'Welcome', value: status(guildConfig?.welcomeEnabled, Boolean(guildConfig?.welcomeChannel)), inline: true },
                { name: 'Birthdays', value: status(config.birthday?.enabled, Boolean(config.birthday)), inline: true },
                { name: 'Starboard', value: status(config.starboard?.enabled, Boolean(config.starboard)), inline: true },
                { name: 'Suggestions', value: status(config.suggestions?.enabled, Boolean(config.suggestions)), inline: true },
                { name: 'Reminders', value: '✅ Available — no server configuration required', inline: true },
                { name: 'Bookmarks', value: '✅ Available — no server configuration required', inline: true },
                { name: 'Games', value: '✅ Available — no server configuration required', inline: true },
                { name: 'Missing Configuration', value: formatGapList(missingConfiguration, 'None'), inline: false },
                { name: 'Permission Gaps', value: formatGapList(permissionChecks, 'None detected'), inline: false }
            )
            .setFooter({ text: 'This view only reads current configuration and Discord permission state.' });

        return interaction.editReply({ embeds: [embed] });
    }
};
