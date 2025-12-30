const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { db } = require('../../database');
const { birthdays, birthdayConfig } = require('../../database/schema');
const { eq, and } = require('drizzle-orm');
const embeds = require('../../utils/embeds');
const { shouldBeEphemeral } = require('../../utils/ephemeralHelper');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('birthday')
        .setDescription('Birthday tracking and celebration system')
        .addSubcommand(sub =>
            sub.setName('set')
                .setDescription('Set your birthday (month and day only, no year)')
                .addStringOption(opt => opt
                    .setName('date')
                    .setDescription('Your birthday in MM-DD format (e.g., 03-15 for March 15th)')
                    .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove your birthday from this server'))
        .addSubcommand(sub =>
            sub.setName('view')
                .setDescription('View someone\'s birthday')
                .addUserOption(opt => opt
                    .setName('user')
                    .setDescription('User to check (defaults to yourself)'))
                .addBooleanOption(opt => opt
                    .setName('private')
                    .setDescription('Make response visible only to you')
                    .setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('upcoming')
                .setDescription('View upcoming birthdays in this server')
                .addIntegerOption(opt => opt
                    .setName('days')
                    .setDescription('Number of days to look ahead (default: 7)')
                    .setMinValue(1)
                    .setMaxValue(30)))
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Configure birthday announcements (Admin only)')
                .addChannelOption(opt => opt
                    .setName('channel')
                    .setDescription('Channel for birthday announcements')
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('role')
                .setDescription('Set birthday role (assigned for 24h on birthdays) - Admin only')
                .addRoleOption(opt => opt
                    .setName('role')
                    .setDescription('Role to assign on birthdays (leave empty to disable)'))),

    cooldown: 5,
    // Note: Manual defer in execute() based on subcommand (mixed ephemeral/public)

    async execute(interaction, client) {
        const subcommand = interaction.options.getSubcommand();

        // Manually defer based on subcommand - some are private, some are public
        if (subcommand === 'view') {
            // View supports user preference control
            const targetUser = interaction.options.getUser('user') || interaction.user;
            const isEphemeral = await shouldBeEphemeral(interaction, {
                commandDefault: false,
                userOverride: interaction.options.getBoolean('private'),
                targetUserId: targetUser.id
            });
            await interaction.deferReply({ flags: isEphemeral ? [MessageFlags.Ephemeral] : [] });
        } else if (['set', 'remove', 'setup', 'role'].includes(subcommand)) {
            // Always ephemeral for personal/admin actions
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        } else {
            // Public for upcoming birthdays (social feature)
            await interaction.deferReply();
        }

        switch (subcommand) {
            case 'set':
                await this.handleSet(interaction);
                break;

            case 'remove':
                await this.handleRemove(interaction);
                break;

            case 'view':
                await this.handleView(interaction);
                break;

            case 'upcoming':
                await this.handleUpcoming(interaction, client);
                break;

            case 'setup':
                await this.handleSetup(interaction);
                break;

            case 'role':
                await this.handleRole(interaction);
                break;
        }
    },

    /**
     * Handle /birthday set
     */
    async handleSet(interaction) {
        const dateInput = interaction.options.getString('date');

        // Parse and validate date
        const result = this.parseBirthday(dateInput);

        if (!result.valid) {
            return interaction.editReply({
                embeds: [embeds.error('Invalid Date', result.error)]
            });
        }

        const { month, day } = result;

        // Check for leap year birthday
        let leapYearWarning = '';
        if (month === 2 && day === 29) {
            leapYearWarning = '\n\n⚠️ **Leap year birthday!** You\'ll be celebrated on February 28th in non-leap years.';
        }

        // Check if birthday already exists for this user in this guild
        const existingBirthday = await db.select().from(birthdays).where(
            and(
                eq(birthdays.userId, interaction.user.id),
                eq(birthdays.guildId, interaction.guild.id)
            )
        ).get();

        if (existingBirthday) {
            // Update existing birthday
            await db.update(birthdays)
                .set({ month, day })
                .where(
                    and(
                        eq(birthdays.userId, interaction.user.id),
                        eq(birthdays.guildId, interaction.guild.id)
                    )
                );
        } else {
            // Insert new birthday
            await db.insert(birthdays).values({
                userId: interaction.user.id,
                guildId: interaction.guild.id,
                month,
                day,
                createdAt: new Date()
            });
        }

        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];

        await interaction.editReply({
            embeds: [embeds.success(
                '🎂 Birthday Set!',
                `Your birthday has been set to **${monthNames[month - 1]} ${day}**!\n\nYou'll be celebrated in this server on your special day.${leapYearWarning}`
            )]
        });
    },

    /**
     * Handle /birthday remove
     */
    async handleRemove(interaction) {
        const result = await db.delete(birthdays)
            .where(and(
                eq(birthdays.userId, interaction.user.id),
                eq(birthdays.guildId, interaction.guild.id)
            ))
            .returning();

        if (result.length === 0) {
            return interaction.editReply({
                embeds: [embeds.warn('No Birthday Set', 'You don\'t have a birthday set in this server.')]
            });
        }

        await interaction.editReply({
            embeds: [embeds.success('Birthday Removed', 'Your birthday has been removed from this server.')]
        });
    },

    /**
     * Handle /birthday view
     */
    async handleView(interaction) {
        const targetUser = interaction.options.getUser('user') || interaction.user;

        const birthday = await db.select()
            .from(birthdays)
            .where(and(
                eq(birthdays.userId, targetUser.id),
                eq(birthdays.guildId, interaction.guild.id)
            ))
            .get();

        if (!birthday) {
            const pronoun = targetUser.id === interaction.user.id ? 'You don\'t' : 'That user doesn\'t';
            return interaction.editReply({
                embeds: [embeds.info(
                    'No Birthday Set',
                    `${pronoun} have a birthday set in this server.`
                )]
            });
        }

        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];

        const embed = embeds.info(
            `🎂 ${targetUser.tag}'s Birthday`,
            `**${monthNames[birthday.month - 1]} ${birthday.day}**`
        );

        embed.setThumbnail(targetUser.displayAvatarURL({ size: 128 }));

        // Calculate days until birthday
        const today = new Date();
        const thisYear = today.getUTCFullYear();
        const nextBirthday = new Date(Date.UTC(thisYear, birthday.month - 1, birthday.day));

        if (nextBirthday < today) {
            nextBirthday.setUTCFullYear(thisYear + 1);
        }

        const daysUntil = Math.ceil((nextBirthday - today) / 86400000);

        if (daysUntil === 0) {
            embed.addFields({ name: 'Today!', value: 'Happy Birthday! 🎂', inline: false });
        } else if (daysUntil === 1) {
            embed.addFields({ name: 'Coming Up', value: 'Tomorrow! 🎈', inline: false });
        } else {
            embed.addFields({ name: 'Coming Up', value: `In ${daysUntil} days`, inline: false });
        }

        await interaction.editReply({ embeds: [embed] });
    },

    /**
     * Handle /birthday upcoming
     */
    async handleUpcoming(interaction, client) {
        const days = interaction.options.getInteger('days') || 7;

        const upcomingBirthdays = await client.birthdayService.getUpcomingBirthdays(
            interaction.guild.id,
            days
        );

        if (upcomingBirthdays.length === 0) {
            return interaction.editReply({
                embeds: [embeds.info(
                    'No Upcoming Birthdays',
                    `No birthdays in the next ${days} day(s).`
                )]
            });
        }

        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];

        const embed = embeds.brand(
            `🎂 Upcoming Birthdays (Next ${days} Days)`,
            null
        );

        // Group by days until
        const grouped = {};
        for (const birthday of upcomingBirthdays) {
            if (!grouped[birthday.daysUntil]) {
                grouped[birthday.daysUntil] = [];
            }
            grouped[birthday.daysUntil].push(birthday);
        }

        // Add fields for each day
        for (const [daysUntil, birthdayList] of Object.entries(grouped)) {
            const userMentions = birthdayList.map(b => `<@${b.userId}>`).join(', ');
            const sample = birthdayList[0];
            const dateStr = `${monthNames[sample.month - 1]} ${sample.day}`;

            const dayLabel = daysUntil === '1' ? 'Tomorrow' : `In ${daysUntil} days`;

            embed.addFields({
                name: `${dayLabel} • ${dateStr}`,
                value: userMentions,
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });
    },

    /**
     * Handle /birthday setup (Admin only)
     */
    async handleSetup(interaction) {
        // Check permissions
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.editReply({
                embeds: [embeds.error('Permission Denied', 'You need Administrator permission to configure birthday announcements.')]
            });
        }

        const channel = interaction.options.getChannel('channel');

        // Verify bot permissions
        const botMember = interaction.guild.members.me;
        if (!botMember.permissionsIn(channel).has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
            return interaction.editReply({
                embeds: [embeds.error(
                    'Missing Permissions',
                    `I don't have permission to send messages in ${channel}. Please ensure I have "Send Messages" and "Embed Links" permissions.`
                )]
            });
        }

        // Insert or update config
        await db.insert(birthdayConfig).values({
            guildId: interaction.guild.id,
            channelId: channel.id,
            enabled: 1,
            lastCheck: null,
            roleId: null
        }).onConflictDoUpdate({
            target: birthdayConfig.guildId,
            set: { channelId: channel.id, enabled: 1 }
        });

        await interaction.editReply({
            embeds: [embeds.success(
                '🎂 Birthday System Configured',
                `Birthday announcements will be sent to ${channel}.\n\nMembers can now set their birthdays with \`/birthday set\`.`
            )]
        });
    },

    /**
     * Handle /birthday role (Admin only)
     */
    async handleRole(interaction) {
        // Check permissions
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.editReply({
                embeds: [embeds.error('Permission Denied', 'You need Administrator permission to configure the birthday role.')]
            });
        }

        const role = interaction.options.getRole('role');

        // Check if birthday system is set up
        const config = await db.select()
            .from(birthdayConfig)
            .where(eq(birthdayConfig.guildId, interaction.guild.id))
            .get();

        if (!config) {
            return interaction.editReply({
                embeds: [embeds.error(
                    'Setup Required',
                    'Please configure birthday announcements first using `/birthday setup`.'
                )]
            });
        }

        // Verify bot can manage role
        if (role) {
            const botMember = interaction.guild.members.me;
            if (role.position >= botMember.roles.highest.position) {
                return interaction.editReply({
                    embeds: [embeds.error(
                        'Role Hierarchy Error',
                        'I cannot manage this role as it is higher than or equal to my highest role. Please move my role above the birthday role.'
                    )]
                });
            }

            if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
                return interaction.editReply({
                    embeds: [embeds.error(
                        'Missing Permissions',
                        'I need the "Manage Roles" permission to assign the birthday role.'
                    )]
                });
            }
        }

        // Update config
        await db.update(birthdayConfig)
            .set({ roleId: role?.id || null })
            .where(eq(birthdayConfig.guildId, interaction.guild.id));

        if (role) {
            await interaction.editReply({
                embeds: [embeds.success(
                    '🎉 Birthday Role Set',
                    `${role} will be assigned to members on their birthday for 24 hours.`
                )]
            });
        } else {
            await interaction.editReply({
                embeds: [embeds.success(
                    'Birthday Role Disabled',
                    'Birthday role feature has been disabled.'
                )]
            });
        }
    },

    /**
     * Parse and validate birthday date string
     * @param {string} input - Date in MM-DD format
     * @returns {Object} - { valid: boolean, month?: number, day?: number, error?: string }
     */
    parseBirthday(input) {
        // Validate format: MM-DD
        const regex = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

        if (!regex.test(input)) {
            return {
                valid: false,
                error: 'Invalid format. Use MM-DD (e.g., 03-15 for March 15th, 12-25 for December 25th)'
            };
        }

        const [month, day] = input.split('-').map(Number);

        // Validate day for month
        const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

        if (day > daysInMonth[month - 1]) {
            const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
            return {
                valid: false,
                error: `${monthNames[month - 1]} only has ${daysInMonth[month - 1]} days.`
            };
        }

        return { valid: true, month, day };
    }
};
