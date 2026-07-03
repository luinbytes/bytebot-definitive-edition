const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ComponentType,
    PermissionFlagsBits,
    SlashCommandBuilder
} = require('discord.js');
const { and, eq } = require('drizzle-orm');
const { db } = require('../../database');
const {
    honeypotConfig,
    honeypotExemptRoles,
    honeypotExemptUsers,
    honeypotIncidents
} = require('../../database/schema');
const embeds = require('../../utils/embeds');
const { handleCommandError } = require('../../utils/errorHandlerUtil');
const {
    CATEGORY_NAME,
    CHANNEL_NAME,
    CHANNEL_TOPIC,
    REQUIRED_BOT_PERMISSIONS,
    buildShameBoardEmbed,
    buildWarningEmbed,
    sendModLog
} = require('../../utils/honeypotUtil');

const CONFIRM_MS = 120000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('honeypot')
        .setDescription('Configure the compromised-account honeypot channel')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub => sub.setName('setup').setDescription('Create the dangerous/#danger honeypot'))
        .addSubcommand(sub => sub.setName('disable').setDescription('Disable and delete the honeypot category/channel'))
        .addSubcommandGroup(group => group
            .setName('configure')
            .setDescription('Inspect and maintain honeypot policy')
            .addSubcommand(sub => sub.setName('view').setDescription('View honeypot status and exemptions'))
            .addSubcommand(sub => sub
                .setName('exempt-user-add')
                .setDescription('Exempt a user from honeypot bans')
                .addUserOption(opt => opt.setName('user').setDescription('User to exempt').setRequired(true)))
            .addSubcommand(sub => sub
                .setName('exempt-user-remove')
                .setDescription('Remove a user honeypot exemption')
                .addUserOption(opt => opt.setName('user').setDescription('User to remove').setRequired(true)))
            .addSubcommand(sub => sub
                .setName('exempt-role-add')
                .setDescription('Exempt a role from honeypot bans')
                .addRoleOption(opt => opt.setName('role').setDescription('Role to exempt').setRequired(true)))
            .addSubcommand(sub => sub
                .setName('exempt-role-remove')
                .setDescription('Remove a role honeypot exemption')
                .addRoleOption(opt => opt.setName('role').setDescription('Role to remove').setRequired(true)))),

    permissions: [PermissionFlagsBits.ManageGuild],
    cooldown: 3,
    longRunning: true,
    deferEphemeral: true,

    async execute(interaction) {
        const group = interaction.options.getSubcommandGroup(false);
        const subcommand = interaction.options.getSubcommand();

        try {
            if (subcommand === 'setup') return await handleSetup(interaction);
            if (subcommand === 'disable') return await handleDisable(interaction);
            if (group === 'configure') {
                if (subcommand === 'view') return await handleView(interaction);
                if (subcommand.startsWith('exempt-user-')) return await handleUserExemption(interaction, subcommand.endsWith('add'));
                if (subcommand.startsWith('exempt-role-')) return await handleRoleExemption(interaction, subcommand.endsWith('add'));
            }
        } catch (error) {
            await handleCommandError(error, interaction, 'processing honeypot command');
        }
    }
};

function getConfig(guildId) {
    return db.select().from(honeypotConfig).where(eq(honeypotConfig.guildId, guildId)).get();
}

function findFixedConflicts(guild) {
    const category = guild.channels.cache.find(channel =>
        channel.type === ChannelType.GuildCategory && channel.name === CATEGORY_NAME
    );
    const channel = guild.channels.cache.find(channel =>
        channel.type === ChannelType.GuildText && channel.name === CHANNEL_NAME
    );
    return { category, channel };
}

function missingBotPermissions(guild) {
    const bot = guild.members.me;
    return REQUIRED_BOT_PERMISSIONS.filter(permission => !bot.permissions.has(permission));
}

function permissionNames(permissions) {
    const names = Object.entries(PermissionFlagsBits);
    return permissions.map(permission => names.find(([, value]) => value === permission)?.[0] || String(permission));
}

async function handleSetup(interaction) {
    const missing = missingBotPermissions(interaction.guild);
    if (missing.length) {
        return interaction.editReply({
            embeds: [embeds.error('Missing Bot Permissions', `I need: ${permissionNames(missing).map(name => `\`${name}\``).join(', ')}`)]
        });
    }

    const config = getConfig(interaction.guild.id);
    const conflicts = findFixedConflicts(interaction.guild);
    const hasConflict = config?.enabled || config?.categoryId || config?.channelId || conflicts.category || conflicts.channel;

    if (hasConflict) {
        return confirmThen(interaction, {
            title: 'Overwrite Honeypot Setup?',
            description:
                'A honeypot setup or fixed-name channel/category already exists.\n\n' +
                `${describeOverwrite(config, conflicts)}\n\n` +
                'Existing exemption policy and incident history will be preserved.',
            confirmLabel: 'Overwrite',
            confirmStyle: ButtonStyle.Danger,
            onConfirm: async i => {
                await i.update({ embeds: [embeds.info('Overwriting Honeypot', 'Deleting old/conflicting objects and creating a fresh setup...')], components: [] });
                const deleted = await deleteConfiguredObjects(interaction.guild, config, conflicts);
                await createSetup(interaction, deleted);
            }
        });
    }

    return createSetup(interaction, []);
}

function describeOverwrite(config, conflicts) {
    const lines = [];
    if (config?.categoryId) lines.push(`Configured category: \`${config.categoryId}\``);
    if (config?.channelId) lines.push(`Configured channel: \`${config.channelId}\``);
    if (conflicts.category) lines.push(`Fixed-name category conflict: ${conflicts.category}`);
    if (conflicts.channel) lines.push(`Fixed-name channel conflict: ${conflicts.channel}`);
    return lines.join('\n') || 'Stored honeypot config exists.';
}

async function confirmThen(interaction, { title, description, confirmLabel, confirmStyle, onConfirm }) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('honeypot_confirm').setLabel(confirmLabel).setStyle(confirmStyle),
        new ButtonBuilder().setCustomId('honeypot_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );

    const reply = await interaction.editReply({
        embeds: [embeds.warn(title, description)],
        components: [row],
        fetchReply: true
    });

    try {
        const button = await reply.awaitMessageComponent({
            componentType: ComponentType.Button,
            time: CONFIRM_MS,
            filter: i => i.user.id === interaction.user.id && i.customId.startsWith('honeypot_')
        });

        if (button.customId === 'honeypot_cancel') {
            return button.update({ embeds: [embeds.info('Cancelled', 'No honeypot changes were made.')], components: [] });
        }

        return onConfirm(button);
    } catch (_) {
        return interaction.editReply({
            embeds: [embeds.warn('Confirmation Timed Out', 'No honeypot changes were made.')],
            components: []
        });
    }
}

async function createSetup(interaction, deleted = []) {
    let category;
    let channel;

    try {
        category = await interaction.guild.channels.create({
            name: CATEGORY_NAME,
            type: ChannelType.GuildCategory,
            reason: 'Honeypot setup'
        });
        channel = await interaction.guild.channels.create({
            name: CHANNEL_NAME,
            type: ChannelType.GuildText,
            parent: category.id,
            topic: CHANNEL_TOPIC,
            reason: 'Honeypot setup'
        });

        const warning = await channel.send({ embeds: [buildWarningEmbed()] });
        let pinWarningFailed = false;
        try {
            await warning.pin('Honeypot warning');
        } catch (_) {
            pinWarningFailed = true;
        }

        const board = await channel.send({ embeds: [buildShameBoardEmbed([], 0)] });
        await upsertConfig(interaction.guild.id, {
            categoryId: category.id,
            channelId: channel.id,
            warningMessageId: warning.id,
            shameBoardMessageId: board.id,
            enabled: true,
            pinWarningFailed,
            updatedAt: new Date()
        });

        const modLogResult = await sendModLog(interaction.guild, 'Honeypot Setup', `${interaction.user.tag} created ${channel}.`);

        const notes = [
            `Created ${category} / ${channel}.`,
            'You can reposition the category, but keep #danger inside it and avoid adding other channels to that category.',
            pinWarningFailed ? 'Warning was posted, but I could not pin it.' : null,
            modLogResult === false ? 'Could not notify the configured moderation log channel.' : null,
            deleted.length ? `Replaced: ${deleted.join(', ')}` : null
        ].filter(Boolean).join('\n');

        return interaction.editReply({ embeds: [embeds.success('Honeypot Ready', notes)], components: [] });
    } catch (error) {
        await channel?.delete('Rolling back failed honeypot setup').catch(() => {});
        await category?.delete('Rolling back failed honeypot setup').catch(() => {});
        throw error;
    }
}

async function upsertConfig(guildId, values) {
    const existing = getConfig(guildId);
    if (existing) {
        return db.update(honeypotConfig).set(values).where(eq(honeypotConfig.guildId, guildId));
    }

    return db.insert(honeypotConfig).values({
        guildId,
        createdAt: new Date(),
        ...values
    });
}

async function deleteConfiguredObjects(guild, config, conflicts = {}) {
    const ids = new Set([config?.channelId, config?.categoryId, conflicts.channel?.id, conflicts.category?.id].filter(Boolean));
    const deleted = [];

    for (const id of ids) {
        const channel = await guild.channels.fetch(id).catch(() => null);
        if (channel) {
            deleted.push(`#${channel.name}`);
            await channel.delete('Honeypot overwrite/disable');
        }
    }

    return deleted;
}

async function handleDisable(interaction) {
    const config = getConfig(interaction.guild.id);
    if (!config?.enabled && !config?.categoryId && !config?.channelId) {
        return interaction.editReply({ embeds: [embeds.info('Honeypot Disabled', 'No active honeypot setup was found.')] });
    }

    return confirmThen(interaction, {
        title: 'Disable Honeypot?',
        description: 'This will disable enforcement and delete the configured honeypot category/channel. Incidents and exemptions will be preserved.',
        confirmLabel: 'Disable',
        confirmStyle: ButtonStyle.Danger,
        onConfirm: async i => {
            await i.update({ embeds: [embeds.info('Disabling Honeypot', 'Deleting configured Discord objects...')], components: [] });
            const deleted = await deleteConfiguredObjects(interaction.guild, config);
            await db.update(honeypotConfig)
                .set({
                    categoryId: null,
                    channelId: null,
                    warningMessageId: null,
                    shameBoardMessageId: null,
                    enabled: false,
                    updatedAt: new Date()
                })
                .where(eq(honeypotConfig.guildId, interaction.guild.id));
            const modLogResult = await sendModLog(interaction.guild, 'Honeypot Disabled', `${interaction.user.tag} disabled the honeypot.`);

            const detail = deleted.length
                ? `Deleted: ${deleted.join(', ')}`
                : 'Configured Discord objects were already gone.';
            const modLogNote = modLogResult === false ? '\nCould not notify the configured moderation log channel.' : '';
            return i.editReply({ embeds: [embeds.success('Honeypot Disabled', `${detail}${modLogNote}`)], components: [] });
        }
    });
}

async function handleUserExemption(interaction, add) {
    const user = interaction.options.getUser('user');
    const existing = db.select()
        .from(honeypotExemptUsers)
        .where(and(eq(honeypotExemptUsers.guildId, interaction.guild.id), eq(honeypotExemptUsers.userId, user.id)))
        .get();
    let modLogResult = null;

    if (add && !existing) {
        db.insert(honeypotExemptUsers).values({ guildId: interaction.guild.id, userId: user.id });
        modLogResult = await sendModLog(interaction.guild, 'Honeypot Exemption Added', `${interaction.user.tag} exempted user ${user.tag} (${user.id}).`);
    }
    if (!add && existing) {
        db.delete(honeypotExemptUsers).where(eq(honeypotExemptUsers.id, existing.id));
        modLogResult = await sendModLog(interaction.guild, 'Honeypot Exemption Removed', `${interaction.user.tag} removed user exemption ${user.tag} (${user.id}).`);
    }

    const modLogNote = modLogResult === false ? '\nCould not notify the configured moderation log channel.' : '';
    return interaction.editReply({
        embeds: [embeds.success(
            'Honeypot Exemption Updated',
            (add
                ? (existing ? `${user} was already exempt.` : `${user} is now exempt.`)
                : (existing ? `${user} is no longer exempt.` : `${user} was not exempt.`)) + modLogNote
        )]
    });
}

async function handleRoleExemption(interaction, add) {
    const role = interaction.options.getRole('role');
    if (role.id === interaction.guild.id) {
        return interaction.editReply({ embeds: [embeds.error('Cannot Exempt Everyone', '@everyone cannot be exempted from the honeypot.')] });
    }

    const existing = db.select()
        .from(honeypotExemptRoles)
        .where(and(eq(honeypotExemptRoles.guildId, interaction.guild.id), eq(honeypotExemptRoles.roleId, role.id)))
        .get();
    let modLogResult = null;

    if (add && !existing) {
        db.insert(honeypotExemptRoles).values({ guildId: interaction.guild.id, roleId: role.id });
        modLogResult = await sendModLog(interaction.guild, 'Honeypot Role Exemption Added', `${interaction.user.tag} exempted role ${role.name} (${role.id}).`);
    }
    if (!add && existing) {
        db.delete(honeypotExemptRoles).where(eq(honeypotExemptRoles.id, existing.id));
        modLogResult = await sendModLog(interaction.guild, 'Honeypot Role Exemption Removed', `${interaction.user.tag} removed role exemption ${role.name} (${role.id}).`);
    }

    const modLogNote = modLogResult === false ? '\nCould not notify the configured moderation log channel.' : '';
    return interaction.editReply({
        embeds: [embeds.success(
            'Honeypot Exemption Updated',
            (add
                ? (existing ? `${role} was already exempt.` : `${role} is now exempt.`)
                : (existing ? `${role} is no longer exempt.` : `${role} was not exempt.`)) + modLogNote
        )]
    });
}

async function handleView(interaction) {
    const config = getConfig(interaction.guild.id);
    const users = db.select().from(honeypotExemptUsers).where(eq(honeypotExemptUsers.guildId, interaction.guild.id)).all();
    const roles = db.select().from(honeypotExemptRoles).where(eq(honeypotExemptRoles.guildId, interaction.guild.id)).all();
    const total = db.select().from(honeypotIncidents).where(eq(honeypotIncidents.guildId, interaction.guild.id)).all().length;
    const missing = missingBotPermissions(interaction.guild);

    const category = config?.categoryId ? await interaction.guild.channels.fetch(config.categoryId).catch(() => null) : null;
    const channel = config?.channelId ? await interaction.guild.channels.fetch(config.channelId).catch(() => null) : null;
    const warningLink = config?.channelId && config?.warningMessageId
        ? `https://discord.com/channels/${interaction.guild.id}/${config.channelId}/${config.warningMessageId}`
        : 'Not set';
    const boardLink = config?.channelId && config?.shameBoardMessageId
        ? `https://discord.com/channels/${interaction.guild.id}/${config.channelId}/${config.shameBoardMessageId}`
        : 'Not set';

    const embed = embeds.brand('Honeypot Configuration', null).addFields(
        { name: 'Status', value: config?.enabled ? 'Enabled' : 'Disabled', inline: true },
        { name: 'Category', value: category ? `${category}` : (config?.categoryId || 'Not set'), inline: true },
        { name: 'Channel', value: channel ? `${channel}` : (config?.channelId || 'Not set'), inline: true },
        { name: 'Warning', value: warningLink, inline: false },
        { name: 'Shame Board', value: boardLink, inline: false },
        { name: 'Exempt Users', value: users.length ? users.map(row => `<@${row.userId}> (${row.userId})`).join('\n').slice(0, 1024) : 'None', inline: false },
        { name: 'Exempt Roles', value: roles.length ? roles.map(row => `<@&${row.roleId}> (${row.roleId})`).join('\n').slice(0, 1024) : 'None', inline: false },
        { name: 'Bot Permissions', value: missing.length ? `Missing: ${permissionNames(missing).join(', ')}` : 'Healthy', inline: false },
        { name: 'Incident History', value: `${total} total incidents stored`, inline: true }
    );

    const warnings = [];
    if (config?.pinWarningFailed) warnings.push('Warning message was posted but could not be pinned.');
    if (channel && category && channel.parentId !== category.id) warnings.push('#danger is no longer inside dangerous.');
    if (config?.warningMessageId && channel && !await channel.messages.fetch(config.warningMessageId).catch(() => null)) warnings.push('Warning message is missing.');
    if (config?.shameBoardMessageId && channel && !await channel.messages.fetch(config.shameBoardMessageId).catch(() => null)) warnings.push('Shame Board message is missing.');
    if (warnings.length) embed.addFields({ name: 'Warnings', value: warnings.join('\n'), inline: false });

    return interaction.editReply({ embeds: [embed] });
}
