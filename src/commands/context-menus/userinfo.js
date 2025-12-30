const { ContextMenuCommandBuilder, ApplicationCommandType, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const { shouldBeEphemeral } = require('../../utils/ephemeralHelper');
const { db } = require('../../database');
const { users } = require('../../database/schema');
const { eq, and } = require('drizzle-orm');

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('User Info')
        .setType(ApplicationCommandType.User)
        .setDMPermission(true), // Works in DMs

    cooldown: 3,

    async execute(interaction, client) {
        // Manual defer with user preference support
        const targetUser = interaction.targetUser;
        const isEphemeral = await shouldBeEphemeral(interaction, {
            commandDefault: true, // Context menu defaults to ephemeral for privacy
            targetUserId: targetUser.id
        });
        await interaction.deferReply({ flags: isEphemeral ? [MessageFlags.Ephemeral] : [] });

        const user = interaction.targetUser;
        const member = interaction.targetMember; // null if in DMs

        const embed = embeds.info(
            user.tag,
            `**User ID:** \`${user.id}\``
        );

        embed.setThumbnail(user.displayAvatarURL({ size: 256 }));

        // Account creation
        const createdAt = Math.floor(user.createdTimestamp / 1000);
        embed.addFields({
            name: 'Account Created',
            value: `<t:${createdAt}:F>\n(<t:${createdAt}:R>)`,
            inline: true
        });

        // Guild-specific info (only if in guild)
        if (member) {
            const joinedAt = Math.floor(member.joinedTimestamp / 1000);
            embed.addFields({
                name: 'Joined Server',
                value: `<t:${joinedAt}:F>\n(<t:${joinedAt}:R>)`,
                inline: true
            });

            // Nickname
            if (member.nickname) {
                embed.addFields({
                    name: 'Nickname',
                    value: member.nickname,
                    inline: true
                });
            }

            // Roles (top 20)
            const roles = member.roles.cache
                .filter(role => role.id !== interaction.guild.id) // Exclude @everyone
                .sort((a, b) => b.position - a.position)
                .map(role => role.toString());

            if (roles.length > 0) {
                const roleList = roles.slice(0, 20).join(', ');
                const remaining = roles.length > 20 ? ` (+${roles.length - 20} more)` : '';

                embed.addFields({
                    name: `Roles [${roles.length}]`,
                    value: roleList + remaining,
                    inline: false
                });
            }

            // Highest role color
            if (member.roles.highest.color !== 0) {
                embed.setColor(member.roles.highest.color);
            }
        }

        // Bot stats from DB
        try {
            const userData = await db.select()
                .from(users)
                .where(interaction.guild
                    ? and(eq(users.id, user.id), eq(users.guildId, interaction.guild.id))
                    : eq(users.id, user.id)
                )
                .get();

            if (userData) {
                const lastSeenTimestamp = Math.floor(new Date(userData.lastSeen).getTime() / 1000);
                embed.addFields({
                    name: '📊 Bot Activity',
                    value: `Commands Run: **${userData.commandsRun}**\nLast Seen: <t:${lastSeenTimestamp}:R>`,
                    inline: false
                });
            }
        } catch (error) {
            // Skip bot activity if DB query fails
        }

        // User badges
        const flags = user.flags?.toArray() || [];
        if (flags.length > 0) {
            const badgeEmojis = {
                Staff: '👮 Discord Staff',
                Partner: '🤝 Partnered Server Owner',
                Hypesquad: '🎉 HypeSquad Events',
                HypeSquadOnlineHouse1: '🦋 HypeSquad Bravery',
                HypeSquadOnlineHouse2: '🌟 HypeSquad Brilliance',
                HypeSquadOnlineHouse3: '⚖️ HypeSquad Balance',
                BugHunterLevel1: '🐛 Bug Hunter (Level 1)',
                BugHunterLevel2: '🐛🐛 Bug Hunter (Level 2)',
                PremiumEarlySupporter: '💎 Early Supporter',
                VerifiedDeveloper: '🔧 Early Verified Bot Developer',
                ActiveDeveloper: '⚡ Active Developer',
                CertifiedModerator: '🛡️ Certified Moderator'
            };

            const badges = flags.map(flag => badgeEmojis[flag] || flag).join('\n');
            embed.addFields({
                name: 'Badges',
                value: badges,
                inline: false
            });
        }

        // Bot/System indicators
        let footerText = '';
        if (user.bot) {
            footerText = '🤖 Bot Account';
        } else if (user.system) {
            footerText = '⚙️ System Account';
        }

        if (footerText) {
            embed.setFooter({ text: footerText });
        }

        return interaction.editReply({
            embeds: [embed]
        });
    }
};
