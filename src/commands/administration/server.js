const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { executeAliasCommand } = require('../../utils/commandAlias');
const { sqlite } = require('../../database');
const embeds = require('../../utils/embeds');
const { executeRecordedAction } = require('../../services/moderationService');
const {
    MODULES, PUNISHMENTS, ensureConfig, isTrustedManager, upsertModule
} = require('../../services/antinukeService');
const config = require('../../../config.json');
const {
    addAntiraidGroup, addAutomodGroup, executeAntiraid, executeAutomod
} = require('../../utils/securityAutomationCommand');
const { addLifecycleGroups, executeLifecycle } = require('../../utils/lifecycleMessageCommand');

const MODULE_CHOICES = MODULES.map(value => ({ name: value, value }));
const PUNISHMENT_CHOICES = PUNISHMENTS.map(value => ({ name: value, value }));

const TARGETS = {
    info: { commandName: 'serverinfo', requirePath: 'src/commands/utility/serverinfo.js' },
    stats: { commandName: 'stats', requirePath: 'src/commands/utility/stats.js', subcommand: 'server' },
    config: { commandName: 'config', requirePath: 'src/commands/administration/config.js' },
    logs: { commandName: 'config', requirePath: 'src/commands/administration/config.js', map: { set: 'logs' } },
    starboard: { commandName: 'starboard', requirePath: 'src/commands/administration/starboard.js', map: { view: 'config' } },
    suggestion: { commandName: 'suggestion', requirePath: 'src/commands/administration/suggestion.js', map: { top: 'leaderboard' } },
    birthday: { commandName: 'birthday', requirePath: 'src/commands/utility/birthday.js' },
    permissions: { commandName: 'perm', requirePath: 'src/commands/administration/perm.js' },
    achievement: { commandName: 'achievement', requirePath: 'src/commands/administration/achievement.js', map: { roles: 'list_roles' } },
    streak: { commandName: 'streak', requirePath: 'src/commands/utility/streak.js', map: { top: 'leaderboard' } },
    community: { commandName: 'community-status', requirePath: 'src/commands/administration/community-status.js' }
};

function aliasFor(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand(false);

    if (!group) {
        return {
            ...TARGETS[subcommand],
            subcommand: TARGETS[subcommand].subcommand || null,
            subcommandGroup: null
        };
    }

    const target = TARGETS[group];
    const legacySubcommand = target.map?.[subcommand] || subcommand;
    const optionValues = {};

    return {
        ...target,
        subcommand: legacySubcommand,
        subcommandGroup: null,
        optionValues
    };
}

function addCommandScope(subcommand) {
    return subcommand
        .addStringOption(opt => opt.setName('command').setDescription('Command path').setRequired(true).setAutocomplete(true))
        .addChannelOption(opt => opt.setName('channel').setDescription('Limit this rule to a channel'))
        .addRoleOption(opt => opt.setName('role').setDescription('Limit this rule to a role'))
        .addUserOption(opt => opt.setName('member').setDescription('Limit this rule to a member'));
}

function securitySettings(guildId) {
    const current = ensureConfig(guildId);
    const modules = sqlite.prepare(`
        SELECT module, enabled, threshold, punishment FROM antinuke_modules
        WHERE guild_id = ? ORDER BY module
    `).all(guildId);
    return embeds.brand('AntiNuke Settings', [
        `Status: **${current.enabled ? 'enabled' : 'disabled'}**`,
        `Default punishment: **${current.punishment}**`,
        `Window: **${current.window_seconds} seconds**`,
        `Log channel: ${current.log_channel_id ? `<#${current.log_channel_id}>` : '**not set**'}`,
        `Enabled modules: **${modules.filter(row => row.enabled).length}/${MODULES.length}**`,
        modules.length ? modules.map(row =>
            `\`${row.module}\` ${row.enabled ? 'on' : 'off'} · ${row.threshold} · ${row.punishment || 'default'}`
        ).join('\n').slice(0, 3500) : 'No module overrides configured.'
    ].join('\n'));
}

async function recordSecurityChange(interaction, action, targetId, reason, perform) {
    return executeRecordedAction({
        guildId: interaction.guild.id,
        targetId: targetId || interaction.guild.id,
        executorId: interaction.user.id,
        action,
        reason,
        perform
    });
}

function requireUser(interaction, action) {
    const user = interaction.options.getUser('user');
    if (!user && action !== 'list') throw new Error(`A user is required to ${action} an entry.`);
    return user;
}

async function executeSecurity(interaction) {
    if (!isTrustedManager(interaction.guild, interaction.user.id, config.developers || [])) {
        return interaction.reply({
            embeds: [embeds.error('Access Denied', 'Only the server owner, a bot developer, or an AntiNuke admin can manage AntiNuke.')],
            flags: [MessageFlags.Ephemeral]
        });
    }

    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    try {
        if (subcommand === 'antinuke-settings') {
            return interaction.reply({ embeds: [securitySettings(guildId)], flags: [MessageFlags.Ephemeral] });
        }
        if (subcommand === 'antinuke-toggle') {
            const enabled = interaction.options.getBoolean('enabled', true);
            if (enabled && !interaction.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
                throw new Error('I need View Audit Log before AntiNuke can be enabled.');
            }
            await recordSecurityChange(interaction, 'ANTINUKE_TOGGLE', guildId, `Set AntiNuke enabled=${enabled}`, () => {
                ensureConfig(guildId);
                sqlite.prepare('UPDATE antinuke_config SET enabled = ? WHERE guild_id = ?').run(Number(enabled), guildId);
            });
        } else if (subcommand === 'antinuke-punishment') {
            const punishment = interaction.options.getString('punishment', true);
            await recordSecurityChange(interaction, 'ANTINUKE_PUNISHMENT', guildId, `Set AntiNuke punishment=${punishment}`, () => {
                ensureConfig(guildId);
                sqlite.prepare('UPDATE antinuke_config SET punishment = ? WHERE guild_id = ?').run(punishment, guildId);
            });
        } else if (subcommand === 'antinuke-window') {
            const seconds = interaction.options.getInteger('minutes', true) * 60;
            await recordSecurityChange(interaction, 'ANTINUKE_WINDOW', guildId, `Set AntiNuke window=${seconds}s`, () => {
                ensureConfig(guildId);
                sqlite.prepare('UPDATE antinuke_config SET window_seconds = ? WHERE guild_id = ?').run(seconds, guildId);
            });
        } else if (subcommand === 'antinuke-module') {
            const action = interaction.options.getString('action', true);
            const module = interaction.options.getString('module', true);
            if (!MODULES.includes(module)) throw new Error('Unknown AntiNuke module.');
            if (action === 'view') {
                const row = sqlite.prepare('SELECT * FROM antinuke_modules WHERE guild_id = ? AND module = ?').get(guildId, module)
                    || { module, enabled: 0, threshold: 3, punishment: null };
                return interaction.reply({
                    embeds: [embeds.brand(`AntiNuke: ${module}`, `Status: **${row.enabled ? 'on' : 'off'}**\nThreshold: **${row.threshold}**\nPunishment: **${row.punishment || 'default'}**`)],
                    flags: [MessageFlags.Ephemeral]
                });
            }
            const changes = {};
            if (action === 'toggle') {
                const enabled = interaction.options.getBoolean('enabled');
                if (enabled == null) throw new Error('enabled is required for the toggle action.');
                changes.enabled = Number(enabled);
            } else if (action === 'threshold') {
                const threshold = interaction.options.getInteger('threshold');
                if (threshold == null) throw new Error('threshold is required for the threshold action.');
                changes.threshold = threshold;
            } else if (action === 'punishment') {
                const punishment = interaction.options.getString('punishment');
                if (!punishment) throw new Error('punishment is required for the punishment action.');
                changes.punishment = punishment === 'default' ? null : punishment;
            }
            await recordSecurityChange(interaction, 'ANTINUKE_MODULE', module, `${action} ${module}`, () => upsertModule(guildId, module, changes));
        } else if (subcommand === 'antinuke-admin' || subcommand === 'antinuke-whitelist') {
            const action = interaction.options.getString('action', true);
            const table = subcommand === 'antinuke-admin' ? 'antinuke_admins' : 'antinuke_whitelist';
            const label = subcommand === 'antinuke-admin' ? 'admin' : 'whitelist';
            const user = requireUser(interaction, action);
            if (action === 'list') {
                const { count } = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE guild_id = ?`).get(guildId);
                const rows = sqlite.prepare(`
                    SELECT user_id, added_by FROM ${table} WHERE guild_id = ? ORDER BY user_id LIMIT 50
                `).all(guildId);
                const body = rows.length
                    ? `${rows.map(row => `<@${row.user_id}> · added by <@${row.added_by}>`).join('\n')}${count > rows.length ? `\n…and ${count - rows.length} more.` : ''}`
                    : `No AntiNuke ${label} entries.`;
                return interaction.reply({ embeds: [embeds.brand(`AntiNuke ${label}`, body)], flags: [MessageFlags.Ephemeral] });
            }
            await recordSecurityChange(interaction, `ANTINUKE_${label.toUpperCase()}_${action.toUpperCase()}`, user.id, `${action} ${label} ${user.id}`, () => {
                if (action === 'add') {
                    sqlite.prepare(`INSERT INTO ${table} (guild_id, user_id, added_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`)
                        .run(guildId, user.id, interaction.user.id, Date.now());
                } else {
                    sqlite.prepare(`DELETE FROM ${table} WHERE guild_id = ? AND user_id = ?`).run(guildId, user.id);
                }
            });
        } else if (subcommand === 'antinuke-incidents') {
            const limit = interaction.options.getInteger('limit') || 10;
            const rows = sqlite.prepare(`
                SELECT * FROM antinuke_incidents WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?
            `).all(guildId, limit);
            const body = rows.length
                ? rows.map(row => `#${row.id} <@${row.actor_id}> · \`${row.module}\` · ${row.punishment} · **${row.status}**`).join('\n')
                : 'No AntiNuke incidents recorded.';
            return interaction.reply({ embeds: [embeds.brand('AntiNuke Incidents', body)], flags: [MessageFlags.Ephemeral] });
        } else if (subcommand === 'antinuke-log') {
            const action = interaction.options.getString('action', true);
            if (action === 'view') {
                return interaction.reply({ embeds: [securitySettings(guildId)], flags: [MessageFlags.Ephemeral] });
            }
            const channel = interaction.options.getChannel('channel');
            if (action === 'set' && !channel) throw new Error('channel is required for the set action.');
            if (channel && !interaction.guild.members.me.permissionsIn(channel)
                .has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
                throw new Error('I need Send Messages and Embed Links in the AntiNuke log channel.');
            }
            await recordSecurityChange(interaction, 'ANTINUKE_LOG', channel?.id || guildId, `${action} AntiNuke log channel`, () => {
                ensureConfig(guildId);
                sqlite.prepare('UPDATE antinuke_config SET log_channel_id = ? WHERE guild_id = ?')
                    .run(action === 'clear' ? null : channel.id, guildId);
            });
        }
        return interaction.reply({ embeds: [securitySettings(guildId)], flags: [MessageFlags.Ephemeral] });
    } catch (error) {
        return interaction.reply({ embeds: [embeds.error('AntiNuke Error', error.message)], flags: [MessageFlags.Ephemeral] });
    }
}

const serverBuilder = new SlashCommandBuilder()
        .setName('server')
        .setDescription('Server information, setup, and community systems')
        .setDMPermission(false)
        .addSubcommand(sub => sub.setName('info').setDescription('View server information'))
        .addSubcommand(sub => sub
            .setName('stats')
            .setDescription('View server statistics')
            .addBooleanOption(opt => opt.setName('private').setDescription('Show only to you')))
        .addSubcommandGroup(group => group
            .setName('config')
            .setDescription('Server configuration')
            .addSubcommand(sub => sub.setName('view').setDescription('View server configuration')))
        .addSubcommandGroup(group => group
            .setName('logs')
            .setDescription('Moderation log settings')
            .addSubcommand(sub => sub
                .setName('set')
                .setDescription('Set the moderation log channel')
                .addChannelOption(opt => opt
                    .setName('channel')
                    .setDescription('Log channel')
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true))))
        .addSubcommandGroup(group => group
            .setName('starboard')
            .setDescription('Starboard system')
            .addSubcommand(sub => sub
                .setName('setup')
                .setDescription('Set up starboard')
                .addChannelOption(opt => opt.setName('channel').setDescription('Starboard channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
                .addIntegerOption(opt => opt.setName('threshold').setDescription('Stars required').setMinValue(1).setMaxValue(50))
                .addStringOption(opt => opt.setName('emoji').setDescription('Emoji to track')))
            .addSubcommand(sub => sub.setName('view').setDescription('View starboard settings'))
            .addSubcommand(sub => sub.setName('enable').setDescription('Enable starboard'))
            .addSubcommand(sub => sub.setName('disable').setDescription('Disable starboard'))
            .addSubcommand(sub => sub
                .setName('top')
                .setDescription('View top starred messages')
                .addIntegerOption(opt => opt.setName('limit').setDescription('Messages to show').setMinValue(1).setMaxValue(25))))
        .addSubcommandGroup(group => group
            .setName('suggestion')
            .setDescription('Suggestion system')
            .addSubcommand(sub => sub
                .setName('submit')
                .setDescription('Submit a suggestion')
                .addStringOption(opt => opt.setName('idea').setDescription('Suggestion idea').setRequired(true).setMaxLength(2000))
                .addBooleanOption(opt => opt.setName('anonymous').setDescription('Submit anonymously')))
            .addSubcommand(sub => sub
                .setName('view')
                .setDescription('View a suggestion')
                .addIntegerOption(opt => opt.setName('id').setDescription('Suggestion ID').setRequired(true)))
            .addSubcommand(sub => sub
                .setName('list')
                .setDescription('List suggestions')
                .addStringOption(opt => opt.setName('status').setDescription('Filter by status'))
                .addIntegerOption(opt => opt.setName('limit').setDescription('Suggestions to show').setMinValue(1).setMaxValue(25)))
            .addSubcommand(sub => sub
                .setName('top')
                .setDescription('View top suggestions')
                .addIntegerOption(opt => opt.setName('limit').setDescription('Suggestions to show').setMinValue(1).setMaxValue(25)))
            .addSubcommand(sub => sub
                .setName('setup')
                .setDescription('Configure suggestions')
                .addChannelOption(opt => opt.setName('channel').setDescription('Suggestion channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
                .addRoleOption(opt => opt.setName('review_role').setDescription('Review role'))
                .addBooleanOption(opt => opt.setName('allow_anonymous').setDescription('Allow anonymous suggestions')))
            .addSubcommand(sub => sub
                .setName('approve')
                .setDescription('Approve a suggestion')
                .addIntegerOption(opt => opt.setName('id').setDescription('Suggestion ID').setRequired(true))
                .addStringOption(opt => opt.setName('reason').setDescription('Reason').setMaxLength(500)))
            .addSubcommand(sub => sub
                .setName('deny')
                .setDescription('Deny a suggestion')
                .addIntegerOption(opt => opt.setName('id').setDescription('Suggestion ID').setRequired(true))
                .addStringOption(opt => opt.setName('reason').setDescription('Reason').setMaxLength(500)))
            .addSubcommand(sub => sub
                .setName('implement')
                .setDescription('Mark a suggestion implemented')
                .addIntegerOption(opt => opt.setName('id').setDescription('Suggestion ID').setRequired(true))
                .addStringOption(opt => opt.setName('note').setDescription('Implementation note').setMaxLength(500))))
        .addSubcommandGroup(group => group
            .setName('birthday')
            .setDescription('Server birthday system')
            .addSubcommand(sub => sub
                .setName('upcoming')
                .setDescription('View upcoming birthdays')
                .addIntegerOption(opt => opt.setName('days').setDescription('Days ahead').setMinValue(1).setMaxValue(30)))
            .addSubcommand(sub => sub
                .setName('setup')
                .setDescription('Set birthday announcement channel')
                .addChannelOption(opt => opt.setName('channel').setDescription('Announcement channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
            .addSubcommand(sub => sub
                .setName('role')
                .setDescription('Set birthday role')
                .addRoleOption(opt => opt.setName('role').setDescription('Birthday role'))))
        .addSubcommandGroup(group => group
            .setName('permissions')
            .setDescription('Command access and protected targets')
            .addSubcommand(sub => sub.setName('add').setDescription('Allow a role to use a command').addStringOption(opt => opt.setName('command').setDescription('Command path').setRequired(true).setAutocomplete(true)).addRoleOption(opt => opt.setName('role').setDescription('Allowed role').setRequired(true)))
            .addSubcommand(sub => sub.setName('remove').setDescription('Remove a command role').addStringOption(opt => opt.setName('command').setDescription('Command path').setRequired(true).setAutocomplete(true)).addRoleOption(opt => opt.setName('role').setDescription('Allowed role').setRequired(true)))
            .addSubcommand(sub => sub.setName('list').setDescription('List command role permissions'))
            .addSubcommand(sub => sub.setName('reset').setDescription('Reset command role permissions').addStringOption(opt => opt.setName('command').setDescription('Command path').setRequired(true).setAutocomplete(true)))
            .addSubcommand(sub => addCommandScope(sub.setName('disable').setDescription('Disable a command in a scope')))
            .addSubcommand(sub => addCommandScope(sub.setName('enable').setDescription('Enable a command in a scope')))
            .addSubcommand(sub => addCommandScope(sub.setName('allow').setDescription('Allow a command only in a scope')))
            .addSubcommand(sub => addCommandScope(sub.setName('deny').setDescription('Deny a command in a scope')))
            .addSubcommand(sub => addCommandScope(sub.setName('unrestrict').setDescription('Remove allow and deny rules in a scope')))
            .addSubcommand(sub => sub
                .setName('fake')
                .setDescription('Manage virtual permission labels')
                .addStringOption(opt => opt.setName('action').setDescription('Action').setRequired(true).addChoices(
                    { name: 'Add', value: 'add' },
                    { name: 'Remove', value: 'remove' },
                    { name: 'List', value: 'list' },
                    { name: 'Reset', value: 'reset' }
                ))
                .addRoleOption(opt => opt.setName('role').setDescription('Role'))
                .addStringOption(opt => opt.setName('permissions').setDescription('Comma-separated Discord permission names')))
            .addSubcommand(sub => sub
                .setName('denyperm')
                .setDescription('Block dangerous permissions on assigned roles')
                .addStringOption(opt => opt.setName('action').setDescription('Action').setRequired(true).addChoices(
                    { name: 'Add', value: 'add' },
                    { name: 'Remove', value: 'remove' },
                    { name: 'List blocked', value: 'list' },
                    { name: 'List available', value: 'available' },
                    { name: 'Clear', value: 'clear' }
                ))
                .addStringOption(opt => opt.setName('permission').setDescription('Discord permission name')))
            .addSubcommand(sub => sub
                .setName('protect')
                .setDescription('Protect members or roles from moderation')
                .addStringOption(opt => opt.setName('action').setDescription('Action').setRequired(true).addChoices(
                    { name: 'Add', value: 'add' },
                    { name: 'Remove', value: 'remove' },
                    { name: 'List', value: 'list' }
                ))
                .addUserOption(opt => opt.setName('member').setDescription('Member'))
                .addRoleOption(opt => opt.setName('role').setDescription('Role'))))
        .addSubcommandGroup(group => group
            .setName('achievement')
            .setDescription('Server achievement administration')
            .addSubcommand(sub => sub
                .setName('setup')
                .setDescription('Configure achievement roles')
                .addBooleanOption(opt => opt.setName('enabled').setDescription('Enable or disable role rewards'))
                .addStringOption(opt => opt.setName('prefix').setDescription('Role name prefix').setMaxLength(10))
                .addBooleanOption(opt => opt.setName('use_rarity_colors').setDescription('Use rarity-based colors'))
                .addBooleanOption(opt => opt.setName('cleanup_orphaned').setDescription('Delete roles with no members'))
                .addBooleanOption(opt => opt.setName('notify_on_earn').setDescription('Send achievement DM notifications')))
            .addSubcommand(sub => sub.setName('view').setDescription('View achievement settings'))
            .addSubcommand(sub => sub.setName('cleanup').setDescription('Clean up achievement roles'))
            .addSubcommand(sub => sub.setName('roles').setDescription('List achievement roles'))
            .addSubcommand(sub => sub.setName('create').setDescription('Create a custom achievement'))
            .addSubcommand(sub => sub.setName('award').setDescription('Award an achievement').addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true)).addStringOption(opt => opt.setName('achievement').setDescription('Achievement ID').setRequired(true)))
            .addSubcommand(sub => sub.setName('remove').setDescription('Remove an achievement').addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true)).addStringOption(opt => opt.setName('achievement').setDescription('Achievement ID').setRequired(true)))
            .addSubcommand(sub => sub.setName('enable').setDescription('Enable the achievement system'))
            .addSubcommand(sub => sub.setName('disable').setDescription('Disable the achievement system')))
        .addSubcommandGroup(group => group
            .setName('streak')
            .setDescription('Server streak rankings')
            .addSubcommand(sub => sub
                .setName('top')
                .setDescription('View streak leaderboard')
                .addStringOption(opt => opt.setName('type').setDescription('Leaderboard type'))))
        .addSubcommandGroup(group => group
            .setName('security')
            .setDescription('AntiNuke protection and trusted actors')
            .addSubcommand(sub => sub.setName('antinuke-settings').setDescription('View AntiNuke settings'))
            .addSubcommand(sub => sub.setName('antinuke-toggle').setDescription('Enable or disable AntiNuke')
                .addBooleanOption(opt => opt.setName('enabled').setDescription('Whether AntiNuke is enabled').setRequired(true)))
            .addSubcommand(sub => sub.setName('antinuke-punishment').setDescription('Set the default punishment')
                .addStringOption(opt => opt.setName('punishment').setDescription('Default punishment').setRequired(true).addChoices(...PUNISHMENT_CHOICES)))
            .addSubcommand(sub => sub.setName('antinuke-window').setDescription('Set the rolling action window')
                .addIntegerOption(opt => opt.setName('minutes').setDescription('Window in minutes').setRequired(true).setMinValue(1).setMaxValue(1440)))
            .addSubcommand(sub => sub.setName('antinuke-module').setDescription('View or configure one protection module')
                .addStringOption(opt => opt.setName('action').setDescription('Configuration action').setRequired(true).addChoices(
                    { name: 'View', value: 'view' }, { name: 'Toggle', value: 'toggle' },
                    { name: 'Threshold', value: 'threshold' }, { name: 'Punishment', value: 'punishment' }
                ))
                .addStringOption(opt => opt.setName('module').setDescription('Protected audit action').setRequired(true).setAutocomplete(true))
                .addBooleanOption(opt => opt.setName('enabled').setDescription('Required for toggle'))
                .addIntegerOption(opt => opt.setName('threshold').setDescription('Required for threshold').setMinValue(1).setMaxValue(127))
                .addStringOption(opt => opt.setName('punishment').setDescription('Required for punishment').addChoices(
                    ...PUNISHMENT_CHOICES, { name: 'Use default', value: 'default' }
                )))
            .addSubcommand(sub => sub.setName('antinuke-admin').setDescription('Manage AntiNuke configuration admins')
                .addStringOption(opt => opt.setName('action').setDescription('Action').setRequired(true).addChoices(
                    { name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }, { name: 'List', value: 'list' }
                )).addUserOption(opt => opt.setName('user').setDescription('User to add or remove')))
            .addSubcommand(sub => sub.setName('antinuke-whitelist').setDescription('Manage users exempt from enforcement')
                .addStringOption(opt => opt.setName('action').setDescription('Action').setRequired(true).addChoices(
                    { name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }, { name: 'List', value: 'list' }
                )).addUserOption(opt => opt.setName('user').setDescription('User to add or remove')))
            .addSubcommand(sub => sub.setName('antinuke-incidents').setDescription('View recent AntiNuke incidents')
                .addIntegerOption(opt => opt.setName('limit').setDescription('Incidents to show').setMinValue(1).setMaxValue(25)))
            .addSubcommand(sub => sub.setName('antinuke-log').setDescription('Configure AntiNuke incident logs')
                .addStringOption(opt => opt.setName('action').setDescription('Action').setRequired(true).addChoices(
                    { name: 'Set', value: 'set' }, { name: 'Clear', value: 'clear' }, { name: 'View', value: 'view' }
                )).addChannelOption(opt => opt.setName('channel').setDescription('Log channel').addChannelTypes(ChannelType.GuildText))))
        .addSubcommandGroup(group => group
            .setName('community')
            .setDescription('Community feature setup status')
            .addSubcommand(sub => sub
                .setName('view')
                .setDescription('View read-only community configuration status')));

addAntiraidGroup(serverBuilder);
addAutomodGroup(serverBuilder);
addLifecycleGroups(serverBuilder);

module.exports = {
    data: serverBuilder,

    async autocomplete(interaction, client) {
        if (interaction.options.getSubcommandGroup(false) === 'permissions') {
            return require('./perm').autocomplete(interaction, client);
        }
        if (interaction.options.getSubcommandGroup(false) === 'security'
            && interaction.options.getFocused(true).name === 'module') {
            const query = interaction.options.getFocused().toLowerCase();
            return interaction.respond(MODULE_CHOICES
                .filter(choice => choice.name.includes(query))
                .slice(0, 25));
        }
        return interaction.respond([]);
    },

    async execute(interaction, client) {
        if (interaction.options.getSubcommandGroup(false) === 'security') return executeSecurity(interaction);
        if (interaction.options.getSubcommandGroup(false) === 'antiraid') return executeAntiraid(interaction);
        if (interaction.options.getSubcommandGroup(false) === 'automod') return executeAutomod(interaction);
        if (['welcome', 'goodbye', 'boost', 'system'].includes(interaction.options.getSubcommandGroup(false))) return executeLifecycle(interaction);
        return executeAliasCommand(interaction, client, aliasFor(interaction));
    }
};
