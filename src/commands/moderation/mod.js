const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const embeds = require('../../utils/embeds');
const { handleCommandError } = require('../../utils/errorHandlerUtil');
const { validateHierarchy } = require('../../utils/moderationUtil');
const { sqlite } = require('../../database/index');
const { createCommandAliasInteraction, executeAliasCommand } = require('../../utils/commandAlias');
const { checkUserPermissions } = require('../../utils/permissions');
const { parseTime } = require('../../utils/timeParser');
const {
    executeMemberAction, executeUserAction, clearWarnings, getCase, undoCase, requiredPermissionForAction
} = require('../../services/moderationService');
const { VARIABLES, validateTemplate, renderTemplate } = require('../../services/moderationTemplateService');
const { setupModeration, resetModeration } = require('../../services/moderationSetupService');

const MODERATION_ACTIONS = [
    'ban', 'kick', 'timeout', 'softban', 'hardban', 'unban', 'imute', 'rmute',
    'untimeout', 'iunmute', 'runmute', 'jail', 'unjail', 'warn', 'strip', 'staffstrip'
];

const STATUS_PERMISSIONS = {
    hardbans: PermissionFlagsBits.BanMembers,
    jailed: PermissionFlagsBits.ManageRoles,
    'image-muted': PermissionFlagsBits.ManageRoles,
    'reaction-muted': PermissionFlagsBits.ManageRoles,
    'unban-all': PermissionFlagsBits.BanMembers,
    'unjail-all': PermissionFlagsBits.ManageRoles
};

function addReasonOption(command, description = 'Audit reason', required = false) {
    return command.addStringOption(option => option.setName('reason').setDescription(description)
        .setMaxLength(512).setRequired(required));
}

function addTargetReason(subcommand, { duration = false } = {}) {
    subcommand.addUserOption(opt => opt.setName('target').setDescription('Member to moderate').setRequired(true));
    if (duration) {
        subcommand.addStringOption(opt => opt.setName('duration').setDescription('Duration such as 10m, 1h, or 1d').setRequired(true));
    }
    return addReasonOption(subcommand);
}

function addActionOption(subcommand) {
    return subcommand.addStringOption(opt => opt
        .setName('action')
        .setDescription('Moderation action')
        .setRequired(true)
        .addChoices(...MODERATION_ACTIONS.map(action => ({ name: action, value: action }))));
}

function addWarnActionOption(subcommand) {
    return subcommand.addStringOption(opt => opt
        .setName('action')
        .setDescription('Automatic punishment')
        .setRequired(true)
        .addChoices(...['timeout', 'kick', 'jail', 'hardban', 'softban', 'ban']
            .map(action => ({ name: action, value: action }))));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mod')
        .setDescription('Moderation commands')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addSubcommandGroup(group => group
            .setName('user')
            .setDescription('Moderate members')
            .addSubcommand(sub => addReasonOption(sub.setName('ban').setDescription('Ban a member').addUserOption(opt => opt.setName('target').setDescription('The member to ban').setRequired(true)), 'Reason for the ban'))
            .addSubcommand(sub => addReasonOption(sub.setName('kick').setDescription('Kick a member').addUserOption(opt => opt.setName('target').setDescription('The member to kick').setRequired(true)), 'Reason for the kick'))
            .addSubcommand(sub => addTargetReason(sub.setName('timeout').setDescription('Timeout a member'), { duration: true }))
            .addSubcommand(sub => addTargetReason(sub.setName('untimeout').setDescription('Remove a member timeout')))
            .addSubcommand(sub => addTargetReason(sub.setName('softban').setDescription('Ban and immediately unban a member')))
            .addSubcommand(sub => addTargetReason(sub.setName('hardban').setDescription('Persistently re-ban a member if unbanned')).addIntegerOption(opt => opt.setName('history').setDescription('Days of message history to delete').setMinValue(0).setMaxValue(7)))
            .addSubcommand(sub => sub
                .setName('unban')
                .setDescription('Unban a user by ID')
                .addStringOption(opt => opt.setName('user_id').setDescription('Discord user ID').setRequired(true))
                .addStringOption(opt => opt.setName('reason').setDescription('Audit reason').setMaxLength(512)))
            .addSubcommand(sub => addTargetReason(sub.setName('imute').setDescription('Apply the configured image-mute role')))
            .addSubcommand(sub => addTargetReason(sub.setName('iunmute').setDescription('Remove the configured image-mute role')))
            .addSubcommand(sub => addTargetReason(sub.setName('rmute').setDescription('Apply the configured reaction-mute role')))
            .addSubcommand(sub => addTargetReason(sub.setName('runmute').setDescription('Remove the configured reaction-mute role')))
            .addSubcommand(sub => addTargetReason(sub.setName('jail').setDescription('Jail a member')))
            .addSubcommand(sub => addTargetReason(sub.setName('unjail').setDescription('Release a jailed member')))
            .addSubcommand(sub => addReasonOption(sub.setName('warn').setDescription('Warn a member').addUserOption(opt => opt.setName('target').setDescription('The member to warn').setRequired(true)), 'Reason for the warning', true))
            .addSubcommand(sub => addReasonOption(sub.setName('unwarn').setDescription('Remove a warning').addUserOption(opt => opt.setName('target').setDescription('The user to remove the warning from').setRequired(true)).addIntegerOption(opt => opt.setName('id').setDescription('The warning case number to remove').setRequired(true)), 'Audit reason', true))
            .addSubcommand(sub => addTargetReason(sub.setName('warn-clear').setDescription('Clear all active warnings')))
            .addSubcommand(sub => addTargetReason(sub.setName('strip').setDescription('Remove roles carrying dangerous permissions')))
            .addSubcommand(sub => addTargetReason(sub.setName('staffstrip').setDescription('Remove configured staff roles')))
            .addSubcommand(sub => sub
                .setName('history')
                .setDescription('View moderation history for a user')
                .addUserOption(opt => opt.setName('target').setDescription('User to view history for').setRequired(true))
                .addStringOption(opt => opt.setName('action').setDescription('Filter by action type').addChoices(
                    ...MODERATION_ACTIONS.map(action => ({ name: action, value: action.toUpperCase() }))
                ))
                .addIntegerOption(opt => opt.setName('limit').setDescription('Number of results').setMinValue(1).setMaxValue(50))))
        .addSubcommandGroup(group => group
            .setName('status')
            .setDescription('List active moderation state')
            .addSubcommand(sub => sub.setName('hardbans').setDescription('List active hardbans'))
            .addSubcommand(sub => sub.setName('jailed').setDescription('List currently jailed members'))
            .addSubcommand(sub => sub.setName('image-muted').setDescription('List image-muted members'))
            .addSubcommand(sub => sub.setName('reaction-muted').setDescription('List reaction-muted members'))
            .addSubcommand(sub => sub.setName('timeouts').setDescription('List currently timed-out members'))
            .addSubcommand(sub => sub.setName('warnings').setDescription('List active warnings for a member').addUserOption(opt => opt.setName('target').setDescription('Member whose warnings to list').setRequired(true))))
        .addSubcommandGroup(group => group
            .setName('bulk')
            .setDescription('Confirmed bulk moderation reversals')
            .addSubcommand(sub => addReasonOption(sub.setName('unban-all').setDescription('Unban all non-hardbanned users').addBooleanOption(opt => opt.setName('confirm').setDescription('Confirm bulk unban').setRequired(true)), 'Audit reason', true))
            .addSubcommand(sub => addReasonOption(sub.setName('untimeout-all').setDescription('Remove all member timeouts').addBooleanOption(opt => opt.setName('confirm').setDescription('Confirm bulk untimeout').setRequired(true)), 'Audit reason', true))
            .addSubcommand(sub => addReasonOption(sub.setName('unjail-all').setDescription('Release all jailed members').addBooleanOption(opt => opt.setName('confirm').setDescription('Confirm bulk unjail').setRequired(true)), 'Audit reason', true)))
        .addSubcommandGroup(group => group
            .setName('logs')
            .setDescription('Moderation logs')
            .addSubcommand(sub => sub.setName('recent').setDescription('View recent moderation actions').addIntegerOption(opt => opt.setName('limit').setDescription('Number of results').setMinValue(1).setMaxValue(50)))
            .addSubcommand(sub => sub.setName('by-moderator').setDescription('View actions by a moderator').addUserOption(opt => opt.setName('moderator').setDescription('Moderator to view').setRequired(true)).addIntegerOption(opt => opt.setName('limit').setDescription('Number of results').setMinValue(1).setMaxValue(50)))
            .addSubcommand(sub => sub.setName('audit').setDescription('View recent Discord audit log entries').addIntegerOption(opt => opt.setName('limit').setDescription('Number of entries').setMinValue(1).setMaxValue(50))))
        .addSubcommandGroup(group => group
            .setName('channel')
            .setDescription('Moderate the current channel')
            .addSubcommand(sub => sub.setName('clear').setDescription('Delete recent messages').addIntegerOption(opt => opt.setName('amount').setDescription('Number of messages to delete').setRequired(true).setMinValue(1).setMaxValue(100)))
            .addSubcommand(sub => sub.setName('lock').setDescription('Lock the current channel'))
            .addSubcommand(sub => sub.setName('unlock').setDescription('Unlock the current channel')))
        .addSubcommandGroup(group => group
            .setName('case')
            .setDescription('Inspect and undo moderation cases')
            .addSubcommand(sub => sub.setName('view').setDescription('View a case').addIntegerOption(opt => opt.setName('number').setDescription('Guild case number').setRequired(true).setMinValue(1)))
            .addSubcommand(sub => addReasonOption(sub.setName('undo').setDescription('Undo a reversible case').addIntegerOption(opt => opt.setName('number').setDescription('Guild case number').setRequired(true).setMinValue(1)), 'Undo reason', true))
            .addSubcommand(sub => sub.setName('reset').setDescription('Reset case history').addBooleanOption(opt => opt.setName('confirm').setDescription('Confirm permanent case reset').setRequired(true))))
        .addSubcommandGroup(group => group
            .setName('template')
            .setDescription('Moderation response templates')
            .addSubcommand(sub => addActionOption(sub.setName('set').setDescription('Set an action template')).addStringOption(opt => opt.setName('type').setDescription('Delivery type').setRequired(true).addChoices({ name: 'Channel response', value: 'message' }, { name: 'Direct message', value: 'dm' })).addStringOption(opt => opt.setName('message').setDescription('Template text').setRequired(true).setMaxLength(2000)))
            .addSubcommand(sub => addActionOption(sub.setName('remove').setDescription('Remove an action template')).addStringOption(opt => opt.setName('type').setDescription('Delivery type').setRequired(true).addChoices({ name: 'Channel response', value: 'message' }, { name: 'Direct message', value: 'dm' })))
            .addSubcommand(sub => addActionOption(sub.setName('view').setDescription('View an action template')).addStringOption(opt => opt.setName('type').setDescription('Delivery type').setRequired(true).addChoices({ name: 'Channel response', value: 'message' }, { name: 'Direct message', value: 'dm' })))
            .addSubcommand(sub => addActionOption(sub.setName('reset').setDescription('Reset all templates for an action')))
            .addSubcommand(sub => sub.setName('list').setDescription('List configured templates'))
            .addSubcommand(sub => addActionOption(sub.setName('test').setDescription('Preview an action template')).addUserOption(opt => opt.setName('target').setDescription('Preview target')))
            .addSubcommand(sub => sub.setName('variables').setDescription('List template variables')))
        .addSubcommandGroup(group => group
            .setName('config')
            .setDescription('Moderation system configuration')
            .addSubcommand(sub => sub.setName('view').setDescription('View moderation configuration'))
            .addSubcommand(sub => sub.setName('setup').setDescription('Create moderation roles and channels'))
            .addSubcommand(sub => sub.setName('reset').setDescription('Remove ByteBot moderation configuration').addBooleanOption(opt => opt.setName('confirm').setDescription('Confirm reset').setRequired(true)))
            .addSubcommand(sub => sub.setName('modlog').setDescription('Set the moderation log channel').addChannelOption(opt => opt.setName('channel').setDescription('Log channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
            .addSubcommand(sub => sub.setName('imuted').setDescription('Set the image-mute role').addRoleOption(opt => opt.setName('role').setDescription('Image-mute role').setRequired(true)))
            .addSubcommand(sub => sub.setName('rmuted').setDescription('Set the reaction-mute role').addRoleOption(opt => opt.setName('role').setDescription('Reaction-mute role').setRequired(true)))
            .addSubcommand(sub => sub.setName('jail').setDescription('Set the jail channel and role').addChannelOption(opt => opt.setName('channel').setDescription('Jail channel').addChannelTypes(ChannelType.GuildText)).addRoleOption(opt => opt.setName('role').setDescription('Jailed role')))
            .addSubcommand(sub => sub.setName('staff-add').setDescription('Add a staff role').addRoleOption(opt => opt.setName('role').setDescription('Staff role').setRequired(true)))
            .addSubcommand(sub => sub.setName('staff-remove').setDescription('Remove a staff role').addRoleOption(opt => opt.setName('role').setDescription('Staff role').setRequired(true)))
            .addSubcommand(sub => sub.setName('staff-list').setDescription('List staff roles'))
            .addSubcommand(sub => addWarnActionOption(sub.setName('warn-add').setDescription('Add a warning punishment')).addIntegerOption(opt => opt.setName('threshold').setDescription('Active warning count').setRequired(true).setMinValue(1)).addStringOption(opt => opt.setName('duration').setDescription('Required for timeout actions')))
            .addSubcommand(sub => sub.setName('warn-remove').setDescription('Remove a warning punishment').addIntegerOption(opt => opt.setName('threshold').setDescription('Warning threshold').setRequired(true).setMinValue(1)))
            .addSubcommand(sub => sub.setName('warn-list').setDescription('List warning punishments'))),

    permissions: [PermissionFlagsBits.ModerateMembers],
    cooldown: 3,
    longRunning: true,

    async execute(interaction, client) {
        const group = interaction.options.getSubcommandGroup(false);
        const subcommand = interaction.options.getSubcommand();

        // channel-group enforces target-command perms (ManageMessages/ManageChannels), not ModerateMembers
        if (group === 'channel') {
            if (subcommand === 'clear') {
                return executeAliasCommand(interaction, client, {
                    commandName: 'clear',
                    requirePath: 'src/commands/moderation/clear.js',
                    subcommand: null,
                    subcommandGroup: null
                });
            }

            return executeAliasCommand(interaction, client, {
                commandName: 'lockchannel',
                requirePath: 'src/commands/moderation/lockchannel.js',
                subcommand,
                subcommandGroup: null
            });
        }

        const permissionCheck = await checkUserPermissions(interaction, {
            data: { name: 'mod' },
            permissions: [PermissionFlagsBits.ModerateMembers]
        });

        if (!permissionCheck.allowed) {
            if (interaction.deferred || interaction.replied) {
                return interaction.editReply({ embeds: [permissionCheck.error] });
            }

            return interaction.reply({
                embeds: [permissionCheck.error],
                flags: [MessageFlags.Ephemeral]
            });
        }

        const requiredPermission = group === 'config' && ['setup', 'reset'].includes(subcommand)
            ? PermissionFlagsBits.Administrator
            : group === 'config' || group === 'template' || (group === 'case' && subcommand === 'reset')
            ? PermissionFlagsBits.ManageGuild
            : group === 'logs' ? PermissionFlagsBits.ViewAuditLog
            : STATUS_PERMISSIONS[subcommand] || requiredPermissionForAction(subcommand);
        if (requiredPermission) {
            const actionPermission = await checkUserPermissions(interaction, {
                data: { name: 'mod' },
                permissions: [requiredPermission]
            });
            if (!actionPermission.allowed) {
                if (interaction.deferred || interaction.replied) {
                    return interaction.editReply({ embeds: [actionPermission.error] });
                }
                return interaction.reply({ embeds: [actionPermission.error], flags: [MessageFlags.Ephemeral] });
            }
        }

        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply();
        }

        if (group === 'case') {
            return handleCase(interaction, subcommand);
        }
        if (group === 'config') {
            return handleConfig(interaction, subcommand);
        }
        if (group === 'template') {
            return handleTemplate(interaction, subcommand);
        }

        const legacyInteraction = createCommandAliasInteraction(interaction, {
            commandName: 'mod',
            subcommand: subcommand === 'by-moderator' ? 'actions' : subcommand,
            subcommandGroup: null
        });

        switch (legacyInteraction.options.getSubcommand()) {
            case 'ban':
                await handleBan(legacyInteraction);
                break;
            case 'kick':
                await handleKick(legacyInteraction);
                break;
            case 'timeout':
                await handleTimeout(legacyInteraction);
                break;
            case 'untimeout':
                await handleUntimeout(legacyInteraction);
                break;
            case 'softban':
            case 'hardban':
                await handleBanVariant(legacyInteraction, legacyInteraction.options.getSubcommand().toUpperCase());
                break;
            case 'hardbans':
            case 'jailed':
            case 'image-muted':
            case 'reaction-muted':
            case 'timeouts':
            case 'warnings':
                await handleMemberStateList(legacyInteraction, legacyInteraction.options.getSubcommand());
                break;
            case 'unban-all':
            case 'untimeout-all':
            case 'unjail-all':
                await handleBulkReversal(legacyInteraction, legacyInteraction.options.getSubcommand());
                break;
            case 'unban':
                await handleUnban(legacyInteraction);
                break;
            case 'imute':
            case 'iunmute':
            case 'rmute':
            case 'runmute':
            case 'jail':
            case 'unjail':
            case 'strip':
            case 'staffstrip':
                await handleRoleAction(legacyInteraction, legacyInteraction.options.getSubcommand().toUpperCase());
                break;
            case 'warn':
                await handleWarn(legacyInteraction);
                break;
            case 'unwarn':
                await handleUnwarn(legacyInteraction);
                break;
            case 'warn-clear':
                await handleWarnClear(legacyInteraction);
                break;
            case 'history':
                await handleHistory(legacyInteraction);
                break;
            case 'recent':
                await handleRecent(legacyInteraction);
                break;
            case 'actions':
                await handleActions(legacyInteraction);
                break;
            case 'audit':
                await handleAudit(legacyInteraction);
                break;
        }
    }
};

function caseDescription(moderationCase) {
    const reason = (moderationCase.reason || 'No reason provided').slice(0, 1000);
    return `**Case #${moderationCase.case_number}** — **${moderationCase.action}**\n`
        + `Status: **${moderationCase.status}**\n`
        + `Target: <@${moderationCase.target_id}>\n`
        + `Moderator: <@${moderationCase.executor_id}>\n`
        + `Reason: ${reason}`;
}

async function handleTemplate(interaction, subcommand) {
    if (subcommand === 'variables') {
        return interaction.editReply({ embeds: [embeds.info('Invoke Variables', VARIABLES.map(value => `{${value}}`).join(', '))] });
    }

    if (subcommand === 'list') {
        const templates = sqlite.prepare(`
            SELECT action, message_type FROM moderation_templates WHERE guild_id = ? ORDER BY action, message_type
        `).all(interaction.guild.id);
        const description = templates.length
            ? templates.map(item => `**${item.action.toLowerCase()}** — ${item.message_type}`).join('\n')
            : 'No invoke templates configured.';
        return interaction.editReply({ embeds: [embeds.info('Invoke Templates', description)] });
    }

    const action = interaction.options.getString('action').toUpperCase();
    if (subcommand === 'reset') {
        sqlite.prepare('DELETE FROM moderation_templates WHERE guild_id = ? AND action = ?').run(interaction.guild.id, action);
        return interaction.editReply({ embeds: [embeds.success('Templates Reset', `${action.toLowerCase()} uses defaults.`)] });
    }

    const type = interaction.options.getString('type');
    if (subcommand === 'remove') {
        sqlite.prepare(`DELETE FROM moderation_templates WHERE guild_id = ? AND action = ? AND message_type = ?`)
            .run(interaction.guild.id, action, type);
        return interaction.editReply({ embeds: [embeds.success('Template Removed', `${action.toLowerCase()} ${type} was removed.`)] });
    }

    if (subcommand === 'view') {
        const template = sqlite.prepare(`
            SELECT template FROM moderation_templates WHERE guild_id = ? AND action = ? AND message_type = ?
        `).get(interaction.guild.id, action, type);
        return interaction.editReply({ embeds: [template
            ? embeds.info(`${action.toLowerCase()} ${type}`, template.template)
            : embeds.error('Template Not Found', 'That invoke template is not configured.')] });
    }

    if (subcommand === 'set') {
        const template = interaction.options.getString('message');
        const validationError = validateTemplate(template);
        if (validationError) return interaction.editReply({ embeds: [embeds.error('Invalid Template', validationError)] });
        sqlite.prepare(`
            INSERT INTO moderation_templates (guild_id, action, message_type, template) VALUES (?, ?, ?, ?)
            ON CONFLICT (guild_id, action, message_type) DO UPDATE SET template = excluded.template
        `).run(interaction.guild.id, action, type, template);
        return interaction.editReply({ embeds: [embeds.success('Template Saved', `${action.toLowerCase()} ${type} was updated.`)] });
    }

    const target = interaction.options.getMember('target') || interaction.member;
    const template = sqlite.prepare(`
        SELECT template FROM moderation_templates WHERE guild_id = ? AND action = ? ORDER BY message_type LIMIT 1
    `).get(interaction.guild.id, action);
    if (!template) return interaction.editReply({ embeds: [embeds.error('Template Not Found', 'That action has no invoke template.')] });
    const preview = renderTemplate(template.template, {
        guild: interaction.guild,
        channel: interaction.channel,
        target,
        executor: interaction.member,
        moderationCase: { action, reason: 'Preview reason', duration_ms: 3600000, case_number: Number.MAX_SAFE_INTEGER }
    });
    return interaction.editReply(preview);
}

async function handleRoleAction(interaction, action) {
    const target = interaction.options.getMember('target');
    if (!target) return interaction.editReply({ embeds: [embeds.error('Error', 'Target member not found.')] });

    try {
        const moderationCase = await executeMemberAction({
            guild: interaction.guild,
            executor: interaction.member,
            target,
            action,
            reason: interaction.options.getString('reason') || 'No reason provided'
        });
        return interaction.editReply({ embeds: [embeds.success('Member Updated', caseDescription(moderationCase))] });
    } catch (error) {
        return interaction.editReply({ embeds: [embeds.error(`${action} Failed`, error.message)] });
    }
}

async function handleConfig(interaction, subcommand) {
    const columns = {
        modlog: ['log_channel_id', interaction.options.getChannel('channel')?.id],
        imuted: ['image_mute_role_id', interaction.options.getRole('role')?.id],
        rmuted: ['reaction_mute_role_id', interaction.options.getRole('role')?.id]
    };

    if (columns[subcommand]) {
        const [column, value] = columns[subcommand];
        sqlite.prepare(`
            INSERT INTO moderation_config (guild_id, ${column}) VALUES (?, ?)
            ON CONFLICT (guild_id) DO UPDATE SET ${column} = excluded.${column}
        `).run(interaction.guild.id, value);
        return interaction.editReply({ embeds: [embeds.success('Moderation Configured', `${subcommand} was updated.`)] });
    }

    if (subcommand === 'setup') {
        try {
            await setupModeration(interaction.guild);
            return interaction.editReply({ embeds: [embeds.success('Moderation Setup Complete', 'Created greed-mod, logs, jail, imute, rmute, and jailed resources.')] });
        } catch (error) {
            return interaction.editReply({ embeds: [embeds.error('Moderation Setup Failed', error.message)] });
        }
    }
    if (subcommand === 'reset') {
        if (!interaction.options.getBoolean('confirm')) {
            return interaction.editReply({ embeds: [embeds.error('Confirmation Required', 'Set confirm to true to remove ByteBot-owned moderation resources.')] });
        }
        try {
            await resetModeration(interaction.guild);
            return interaction.editReply({ embeds: [embeds.success('Moderation Reset', 'ByteBot-owned moderation resources were removed.')] });
        } catch (error) {
            return interaction.editReply({ embeds: [embeds.error('Moderation Reset Failed', error.message)] });
        }
    }

    if (subcommand === 'jail') {
        const roleId = interaction.options.getRole('role')?.id || null;
        const channelId = interaction.options.getChannel('channel')?.id || null;
        sqlite.prepare(`
            INSERT INTO moderation_config (guild_id, jail_role_id, jail_channel_id) VALUES (?, ?, ?)
            ON CONFLICT (guild_id) DO UPDATE SET jail_role_id = excluded.jail_role_id, jail_channel_id = excluded.jail_channel_id
        `).run(interaction.guild.id, roleId, channelId);
        return interaction.editReply({ embeds: [embeds.success('Moderation Configured', 'Jail settings were updated.')] });
    }

    if (subcommand === 'warn-add') {
        const action = interaction.options.getString('action').toUpperCase();
        const duration = interaction.options.getString('duration');
        const parsed = duration ? parseTime(duration) : null;
        if (action === 'TIMEOUT' && (!parsed || !parsed.success)) {
            return interaction.editReply({ embeds: [embeds.error('Invalid Duration', parsed?.error || 'Timeout punishments require a duration.')] });
        }
        if (action === 'TIMEOUT' && (parsed.duration < 60000 || parsed.duration > 27 * 86400000)) {
            return interaction.editReply({ embeds: [embeds.error('Invalid Duration', 'Timeout duration must be between 60 seconds and 27 days.')] });
        }
        sqlite.prepare(`
            INSERT INTO warning_punishments (guild_id, threshold, action, duration_ms) VALUES (?, ?, ?, ?)
            ON CONFLICT (guild_id, threshold) DO UPDATE SET action = excluded.action, duration_ms = excluded.duration_ms
        `).run(interaction.guild.id, interaction.options.getInteger('threshold'), action, parsed?.duration || null);
        return interaction.editReply({ embeds: [embeds.success('Warning Punishment Saved', 'The warning threshold was updated.')] });
    }

    if (subcommand === 'staff-add') {
        const roleId = interaction.options.getRole('role').id;
        sqlite.prepare(`INSERT INTO moderation_staff_roles (guild_id, role_id) VALUES (?, ?) ON CONFLICT DO NOTHING`)
            .run(interaction.guild.id, roleId);
        return interaction.editReply({ embeds: [embeds.success('Staff Role Added', `<@&${roleId}> is now recognized as staff.`)] });
    }
    if (subcommand === 'staff-remove') {
        const roleId = interaction.options.getRole('role').id;
        sqlite.prepare('DELETE FROM moderation_staff_roles WHERE guild_id = ? AND role_id = ?')
            .run(interaction.guild.id, roleId);
        return interaction.editReply({ embeds: [embeds.success('Staff Role Removed', `<@&${roleId}> is no longer recognized as staff.`)] });
    }
    if (subcommand === 'staff-list') {
        const roles = sqlite.prepare('SELECT role_id FROM moderation_staff_roles WHERE guild_id = ? ORDER BY role_id')
            .all(interaction.guild.id);
        return interaction.editReply({ embeds: [embeds.info('Moderation Staff Roles', roles.length
            ? roles.map(role => `<@&${role.role_id}>`).join('\n').slice(0, 4000)
            : 'No staff roles configured.')] });
    }
    if (subcommand === 'warn-remove') {
        sqlite.prepare('DELETE FROM warning_punishments WHERE guild_id = ? AND threshold = ?')
            .run(interaction.guild.id, interaction.options.getInteger('threshold'));
        return interaction.editReply({ embeds: [embeds.success('Warning Punishment Removed', 'The threshold was removed.')] });
    }
    if (subcommand === 'warn-list') {
        const punishments = sqlite.prepare(`
            SELECT threshold, action, duration_ms FROM warning_punishments WHERE guild_id = ? ORDER BY threshold
        `).all(interaction.guild.id);
        return interaction.editReply({ embeds: [embeds.info('Warning Punishments', punishments.length
            ? punishments.map(item => `${item.threshold} — ${item.action.toLowerCase()}${item.duration_ms ? ` (${item.duration_ms}ms)` : ''}`).join('\n').slice(0, 4000)
            : 'No warning punishments configured.')] });
    }
    if (subcommand === 'view') {
        const config = sqlite.prepare('SELECT * FROM moderation_config WHERE guild_id = ?').get(interaction.guild.id);
        return interaction.editReply({ embeds: [embeds.info('Moderation Configuration', config
            ? `Modlog: ${config.log_channel_id ? `<#${config.log_channel_id}>` : 'not set'}\nImage mute: ${config.image_mute_role_id ? `<@&${config.image_mute_role_id}>` : 'not set'}\nReaction mute: ${config.reaction_mute_role_id ? `<@&${config.reaction_mute_role_id}>` : 'not set'}\nJail: ${config.jail_role_id ? `<@&${config.jail_role_id}>` : 'not set'} / ${config.jail_channel_id ? `<#${config.jail_channel_id}>` : 'not set'}`
            : 'Moderation is not configured.')] });
    }

    return interaction.editReply({ embeds: [embeds.error('Not Implemented', `${subcommand} is not available yet.`)] });
}

async function handleBanVariant(interaction, action) {
    const target = interaction.options.getMember('target');
    if (!target) {
        return interaction.editReply({ embeds: [embeds.error('Error', 'Target member not found.')] });
    }

    try {
        const moderationCase = await executeMemberAction({
            guild: interaction.guild,
            executor: interaction.member,
            target,
            action,
            reason: interaction.options.getString('reason') || 'No reason provided',
            historyDays: interaction.options.getInteger('history')
        });
        return interaction.editReply({ embeds: [embeds.success('Member Banned', caseDescription(moderationCase))] });
    } catch (error) {
        return interaction.editReply({ embeds: [embeds.error(`${action} Failed`, error.message)] });
    }
}

async function handleMemberStateList(interaction, subcommand) {
    let cases;
    let title;
    if (subcommand === 'hardbans') {
        cases = sqlite.prepare(`
            SELECT case_number, user_id AS target_id, reason FROM moderation_hardbans
            WHERE guild_id = ? AND state = 'active' ORDER BY case_number DESC
        `).all(interaction.guild.id);
        title = 'Hard Banned Users';
    } else if (subcommand === 'jailed') {
        cases = sqlite.prepare(`
            SELECT case_number, user_id AS target_id, 'Jail active' AS reason
            FROM moderation_jail_state WHERE guild_id = ? AND state IN ('active', 'pending')
            ORDER BY case_number DESC
        `).all(interaction.guild.id);
        title = 'Jailed Members';
    } else if (subcommand === 'image-muted' || subcommand === 'reaction-muted') {
        const column = subcommand === 'image-muted' ? 'image_mute_role_id' : 'reaction_mute_role_id';
        const config = sqlite.prepare(`SELECT ${column} AS role_id FROM moderation_config WHERE guild_id = ?`)
            .get(interaction.guild.id);
        const members = await interaction.guild.members.fetch();
        cases = config?.role_id ? [...members.values()]
            .filter(member => member.roles.cache.has(config.role_id))
            .map(member => ({ case_number: 'live', target_id: member.id, reason: 'Configured role active' })) : [];
        title = subcommand === 'image-muted' ? 'Image Muted Members' : 'Reaction Muted Members';
    } else if (subcommand === 'timeouts') {
        const members = await interaction.guild.members.fetch();
        cases = [...members.values()]
            .filter(member => member.communicationDisabledUntilTimestamp > Date.now())
            .map(member => ({
                case_number: 'live', target_id: member.id,
                reason: `Expires <t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:R>`
            }));
        title = 'Timed Out Members';
    } else {
        const target = interaction.options.getUser('target');
        cases = sqlite.prepare(`
            SELECT * FROM moderation_cases
            WHERE guild_id = ? AND target_id = ? AND action = 'WARN' AND status = 'completed'
            ORDER BY case_number DESC
        `).all(interaction.guild.id, target.id);
        title = `Warnings for ${target.username}`;
    }
    return interaction.editReply({ embeds: [embeds.info(title, cases.length
        ? cases.map(item => `**#${item.case_number}** <@${item.target_id}> — ${item.reason || 'No reason provided'}${subcommand === 'warnings' ? ` — <@${item.executor_id}> <t:${Math.floor(item.created_at / 1000)}:R>` : ''}`).join('\n').slice(0, 4000)
        : 'No matching members or cases.')] });
}

async function handleBulkReversal(interaction, subcommand) {
    if (!interaction.options.getBoolean('confirm')) {
        return interaction.editReply({ embeds: [embeds.error('Confirmation Required', `Set confirm to true to run ${subcommand}.`)] });
    }
    let targetIds;
    let action;
    if (subcommand === 'unjail-all') {
        targetIds = sqlite.prepare(`SELECT user_id FROM moderation_jail_state WHERE guild_id = ? AND state = 'active'`)
            .all(interaction.guild.id).map(item => item.user_id);
        action = 'UNJAIL';
    } else if (subcommand === 'untimeout-all') {
        const members = await interaction.guild.members.fetch();
        targetIds = [...members.values()]
            .filter(member => member.communicationDisabledUntilTimestamp > Date.now())
            .map(member => member.id);
        action = 'UNTIMEOUT';
    } else {
        const bans = await interaction.guild.bans.fetch();
        const hardbanned = new Set(sqlite.prepare(`
            SELECT user_id FROM moderation_hardbans WHERE guild_id = ? AND state = 'active'
        `).all(interaction.guild.id).map(item => item.user_id));
        targetIds = [...bans.keys()].filter(id => !hardbanned.has(id));
        action = 'UNBAN';
    }
    let succeeded = 0;
    for (const targetId of targetIds) {
        try {
            if (action === 'UNBAN') {
                await executeUserAction({ guild: interaction.guild, executor: interaction.member, targetId, action, reason: interaction.options.getString('reason') });
            } else {
                const target = await interaction.guild.members.fetch(targetId);
                await executeMemberAction({ guild: interaction.guild, executor: interaction.member, target, action, reason: interaction.options.getString('reason') });
            }
            succeeded += 1;
        } catch (_) {
            // Every failure retains its active Discord or ByteBot state for retry.
        }
    }
    return interaction.editReply({ embeds: [embeds.success('Bulk Moderation Complete', `Updated ${succeeded}; failed ${targetIds.length - succeeded}; total ${targetIds.length}.`)] });
}

async function handleAudit(interaction) {
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
        return interaction.editReply({ embeds: [embeds.error('Audit Log Unavailable', 'I need View Audit Log to read Discord audit entries.')] });
    }
    const audit = await interaction.guild.fetchAuditLogs({ limit: interaction.options.getInteger('limit') || 10 });
    const entries = [...audit.entries.values()];
    return interaction.editReply({ embeds: [embeds.info('Discord Audit Log', entries.length
        ? entries.map(entry => `**${entry.action}** — <@${entry.executorId || entry.executor?.id}> → ${entry.targetId ? `<@${entry.targetId}>` : 'server'}\n${entry.reason || 'No reason provided'}`).join('\n\n').slice(0, 4000)
        : 'No audit entries found.')] });
}

async function handleWarnClear(interaction) {
    const target = interaction.options.getMember('target');
    if (!target) return interaction.editReply({ embeds: [embeds.error('Error', 'Target member not found.')] });
    try {
        const moderationCase = clearWarnings({
            guild: interaction.guild,
            executor: interaction.member,
            target,
            reason: interaction.options.getString('reason') || 'No reason provided'
        });
        return interaction.editReply({ embeds: [embeds.success('Warnings Cleared', caseDescription(moderationCase))] });
    } catch (error) {
        return interaction.editReply({ embeds: [embeds.error('Warning Clear Failed', error.message)] });
    }
}

async function handleUnban(interaction) {
    try {
        const moderationCase = await executeUserAction({
            guild: interaction.guild,
            executor: interaction.member,
            targetId: interaction.options.getString('user_id'),
            action: 'UNBAN',
            reason: interaction.options.getString('reason') || 'No reason provided'
        });
        return interaction.editReply({ embeds: [embeds.success('User Unbanned', caseDescription(moderationCase))] });
    } catch (error) {
        return interaction.editReply({ embeds: [embeds.error('Unban Failed', error.message)] });
    }
}

async function handleTimeout(interaction) {
    const target = interaction.options.getMember('target');
    const parsed = parseTime(interaction.options.getString('duration'));
    if (!parsed.success) {
        return interaction.editReply({ embeds: [embeds.error('Invalid Duration', parsed.error)] });
    }

    try {
        const moderationCase = await executeMemberAction({
            guild: interaction.guild,
            executor: interaction.member,
            target,
            action: 'TIMEOUT',
            reason: interaction.options.getString('reason') || 'No reason provided',
            durationMs: parsed.duration
        });
        return interaction.editReply({
            embeds: [embeds.success('Member Timed Out', caseDescription(moderationCase))]
        });
    } catch (error) {
        return interaction.editReply({ embeds: [embeds.error('Timeout Failed', error.message)] });
    }
}

async function handleUntimeout(interaction) {
    const target = interaction.options.getMember('target');
    if (!target) return interaction.editReply({ embeds: [embeds.error('Error', 'Target member not found.')] });
    try {
        const moderationCase = await executeMemberAction({
            guild: interaction.guild,
            executor: interaction.member,
            target,
            action: 'UNTIMEOUT',
            reason: interaction.options.getString('reason') || 'No reason provided'
        });
        return interaction.editReply({ embeds: [embeds.success('Timeout Removed', caseDescription(moderationCase))] });
    } catch (error) {
        return interaction.editReply({ embeds: [embeds.error('Untimeout Failed', error.message)] });
    }
}

async function handleCase(interaction, subcommand) {
    const caseNumber = interaction.options.getInteger('number');

    if (subcommand === 'view') {
        const moderationCase = getCase(interaction.guild.id, caseNumber);
        return interaction.editReply({
            embeds: [moderationCase
                ? embeds.info(`Moderation Case #${caseNumber}`, caseDescription(moderationCase))
                : embeds.error('Case Not Found', `Case #${caseNumber} does not exist.`)]
        });
    }

    if (subcommand === 'undo') {
        try {
            const moderationCase = await undoCase({
                guild: interaction.guild,
                executor: interaction.member,
                caseNumber,
                reason: interaction.options.getString('reason')
            });
            return interaction.editReply({
                embeds: [embeds.success('Case Undone', caseDescription(moderationCase))]
            });
        } catch (error) {
            return interaction.editReply({ embeds: [embeds.error('Undo Failed', error.message)] });
        }
    }

    if (!interaction.options.getBoolean('confirm')) {
        return interaction.editReply({ embeds: [embeds.error('Confirmation Required', 'Set confirm to true to reset cases.')] });
    }
    sqlite.transaction(() => {
        sqlite.prepare('DELETE FROM moderation_cases WHERE guild_id = ?').run(interaction.guild.id);
        sqlite.prepare(`
            INSERT INTO moderation_config (guild_id, next_case_number) VALUES (?, 1)
            ON CONFLICT (guild_id) DO UPDATE SET next_case_number = 1
        `).run(interaction.guild.id);
    })();
    return interaction.editReply({ embeds: [embeds.success('Cases Reset', 'Moderation cases were reset.')] });
}

/**
 * Handle /mod ban
 */
async function handleBan(interaction) {
    const target = interaction.options.getMember('target');
    const reason = interaction.options.getString('reason') ?? 'No reason provided';

    if (!target) {
        return interaction.editReply({
            embeds: [embeds.error('Error', 'Target member not found.')]
        });
    }

    const hierarchy = validateHierarchy(interaction.member, target);
    if (!hierarchy.valid) {
        return interaction.editReply({
            embeds: [embeds.error('Cannot Moderate', hierarchy.error)]
        });
    }

    if (!target.bannable) {
        return interaction.editReply({
            embeds: [embeds.error('Error', 'I cannot ban this user. They might have a higher role than me.')]
        });
    }

    try {
        const moderationCase = await executeMemberAction({
            guild: interaction.guild,
            executor: interaction.member,
            action: 'BAN',
            reason,
            target
        });

        await interaction.editReply({
            embeds: [embeds.success('Member Banned', caseDescription(moderationCase))]
        });
    } catch (error) {
        await handleCommandError(error, interaction, 'banning member');
    }
}

/**
 * Handle /mod kick
 */
async function handleKick(interaction) {
    const target = interaction.options.getMember('target');
    const reason = interaction.options.getString('reason') ?? 'No reason provided';

    if (!target) {
        return interaction.editReply({
            embeds: [embeds.error('Error', 'Target member not found.')]
        });
    }

    const hierarchy = validateHierarchy(interaction.member, target);
    if (!hierarchy.valid) {
        return interaction.editReply({
            embeds: [embeds.error('Cannot Moderate', hierarchy.error)]
        });
    }

    if (!target.kickable) {
        return interaction.editReply({
            embeds: [embeds.error('Error', 'I cannot kick this user. They might have a higher role than me.')]
        });
    }

    try {
        const moderationCase = await executeMemberAction({
            guild: interaction.guild,
            executor: interaction.member,
            target,
            action: 'KICK',
            reason
        });

        await interaction.editReply({
            embeds: [embeds.success('Member Kicked', caseDescription(moderationCase))]
        });
    } catch (error) {
        await handleCommandError(error, interaction, 'kicking member');
    }
}

/**
 * Handle /mod warn
 */
async function handleWarn(interaction) {
    const target = interaction.options.getUser('target');
    const reason = interaction.options.getString('reason');

    const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!targetMember) {
        return interaction.editReply({
            embeds: [embeds.error('Error', 'Target member not found in this server.')]
        });
    }

    const hierarchy = validateHierarchy(interaction.member, targetMember);
    if (!hierarchy.valid) {
        return interaction.editReply({
            embeds: [embeds.error('Cannot Moderate', hierarchy.error)]
        });
    }

    try {
        const moderationCase = await executeMemberAction({
            guild: interaction.guild,
            executor: interaction.member,
            target: targetMember,
            action: 'WARN',
            reason
        });

        const description = caseDescription(moderationCase)
            + (moderationCase.punishmentError ? `\nAutomatic punishment failed: ${moderationCase.punishmentError}` : '');
        await interaction.editReply({
            embeds: [moderationCase.punishmentError
                ? embeds.warn('Member Warned; Punishment Failed', description)
                : embeds.success('Member Warned', description)]
        });
    } catch (error) {
        await handleCommandError(error, interaction, 'warning member');
    }
}

/**
 * Handle /mod unwarn
 */
async function handleUnwarn(interaction) {
    const target = interaction.options.getUser('target');
    const id = interaction.options.getInteger('id');

    try {
        const warning = getCase(interaction.guild.id, id);

        if (!warning || warning.action !== 'WARN') {
            return interaction.editReply({
                embeds: [embeds.error('Not Found', `Warning case **#${id}** was not found in this server.`)]
            });
        }

        if (warning.target_id !== target.id) {
            return interaction.editReply({
                embeds: [embeds.error('Mismatch', `Warning case **#${id}** does not belong to ${target}.`)]
            });
        }

        await undoCase({
            guild: interaction.guild,
            executor: interaction.member,
            caseNumber: id,
            reason: interaction.options.getString('reason')
        });

        return interaction.editReply({
            embeds: [embeds.success('Warning Removed', `Warning case **#${id}** was marked undone for ${target}.`)]
        });

    } catch (error) {
        await handleCommandError(error, interaction, 'removing warning');
    }
}

/**
 * Handle /mod history
 */
async function handleHistory(interaction) {
    const target = interaction.options.getUser('target');
    const actionFilter = interaction.options.getString('action');
    const limit = interaction.options.getInteger('limit') ?? 10;

    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply(); // Public for transparency
    }

    try {
        const logs = sqlite.prepare(`
            SELECT * FROM moderation_cases WHERE guild_id = ? AND target_id = ?
            ${actionFilter ? 'AND action = ?' : ''}
            ORDER BY case_number DESC LIMIT ?
        `).all(...(actionFilter
            ? [interaction.guild.id, target.id, actionFilter, limit]
            : [interaction.guild.id, target.id, limit]));

        const title = actionFilter
            ? `History: ${target.username} (${actionFilter} only)`
            : `History: ${target.username}`;

        if (logs.length === 0) {
            return interaction.editReply({
                embeds: [embeds.brand(title, 'No moderation logs found.')]
            });
        }

        const description = logs.map(log => {
            const timestamp = Math.floor(log.created_at / 1000);
            const reason = log.reason || 'No reason provided';
            return `**#${log.case_number}** [**${log.action}** · ${log.status}] <t:${timestamp}:d>\n→ By: <@${log.executor_id}>\n→ Reason: ${reason}`;
        }).join('\n\n');

        const embed = embeds.brand(title, description.slice(0, 4000))
            .setFooter({ text: `Showing ${logs.length} results` });

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        await handleCommandError(error, interaction, 'fetching history', { ephemeral: false });
    }
}

/**
 * Handle /mod recent
 */
async function handleRecent(interaction) {
    const limit = interaction.options.getInteger('limit') ?? 10;

    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply(); // Public for transparency
    }

    try {
        const logs = sqlite.prepare(`
            SELECT * FROM moderation_cases WHERE guild_id = ? ORDER BY case_number DESC LIMIT ?
        `).all(interaction.guild.id, limit);

        if (logs.length === 0) {
            return interaction.editReply({
                embeds: [embeds.brand('Recent Moderation Actions', 'No moderation logs found.')]
            });
        }

        const description = logs.map(log => {
            const timestamp = Math.floor(log.created_at / 1000);
            const reason = log.reason || 'No reason provided';
            return `**#${log.case_number}** [**${log.action}** · ${log.status}] <t:${timestamp}:d>\n→ Target: <@${log.target_id}> | By: <@${log.executor_id}>\n→ Reason: ${reason}`;
        }).join('\n\n');

        const embed = embeds.brand('Recent Moderation Actions', description.slice(0, 4000))
            .setFooter({ text: `Showing ${logs.length} results` });

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        await handleCommandError(error, interaction, 'fetching recent actions', { ephemeral: false });
    }
}

/**
 * Handle /mod actions (by moderator)
 */
async function handleActions(interaction) {
    const moderator = interaction.options.getUser('moderator');
    const limit = interaction.options.getInteger('limit') ?? 10;

    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply(); // Public for transparency
    }

    try {
        const logs = sqlite.prepare(`
            SELECT * FROM moderation_cases WHERE guild_id = ? AND executor_id = ?
            ORDER BY case_number DESC LIMIT ?
        `).all(interaction.guild.id, moderator.id, limit);

        const title = `Actions by ${moderator.username}`;

        if (logs.length === 0) {
            return interaction.editReply({
                embeds: [embeds.brand(title, 'No moderation logs found.')]
            });
        }

        const description = logs.map(log => {
            const timestamp = Math.floor(log.created_at / 1000);
            const reason = log.reason || 'No reason provided';
            return `**#${log.case_number}** [**${log.action}** · ${log.status}] <t:${timestamp}:d>\n→ Target: <@${log.target_id}>\n→ Reason: ${reason}`;
        }).join('\n\n');

        const embed = embeds.brand(title, description.slice(0, 4000))
            .setFooter({ text: `Showing ${logs.length} results` });

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        await handleCommandError(error, interaction, 'fetching moderator actions', { ephemeral: false });
    }
}
