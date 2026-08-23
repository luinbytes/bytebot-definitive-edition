const {
    AutoModerationActionType,
    AutoModerationRuleEventType,
    AutoModerationRuleKeywordPresetType,
    AutoModerationRuleTriggerType,
    MessageFlags,
    PermissionFlagsBits
} = require('discord.js');
const { sqlite } = require('../database');
const embeds = require('./embeds');
const { executeMemberAction, executeRecordedAction } = require('../services/moderationService');
const { lockdownAll } = require('../services/channelModerationService');
const antiraid = require('../services/antiraidService');
const automod = require('../services/automodService');

const boolActions = [
    { name: 'View', value: 'view' }, { name: 'Toggle', value: 'toggle' },
    { name: 'Threshold', value: 'threshold' }, { name: 'Punishment', value: 'punishment' }
];
const listActions = [
    { name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' },
    { name: 'List', value: 'list' }
];
const antiraidPunishments = antiraid.PUNISHMENTS.map(value => ({ name: value, value }));
const automodActions = automod.ACTIONS.map(value => ({ name: value, value }));

function addAntiraidGroup(builder) {
    return builder.addSubcommandGroup(group => group
        .setName('antiraid').setDescription('Raid detection, lockdown, and cleanup')
        .addSubcommand(sub => sub.setName('settings').setDescription('View AntiRaid settings'))
        .addSubcommand(sub => sub.setName('toggle').setDescription('Enable or disable AntiRaid')
            .addBooleanOption(opt => opt.setName('enabled').setDescription('System status').setRequired(true)))
        .addSubcommand(sub => sub.setName('punishment').setDescription('Set the default raid punishment')
            .addStringOption(opt => opt.setName('punishment').setDescription('Default punishment').setRequired(true).addChoices(...antiraidPunishments)))
        .addSubcommand(sub => sub.setName('module').setDescription('Configure a join detector')
            .addStringOption(opt => opt.setName('action').setDescription('Configuration action').setRequired(true).addChoices(
                ...boolActions, { name: 'Window', value: 'window' }, { name: 'Lock channels', value: 'lockchannels' },
                { name: 'Punish members', value: 'punishmembers' }
            ))
            .addStringOption(opt => opt.setName('module').setDescription('Detector').setRequired(true).addChoices(
                ...antiraid.MODULES.map(value => ({ name: value, value }))
            ))
            .addBooleanOption(opt => opt.setName('enabled').setDescription('Required for toggle/lock/punish'))
            .addIntegerOption(opt => opt.setName('threshold').setDescription('Count or account age in days').setMinValue(1).setMaxValue(1000))
            .addIntegerOption(opt => opt.setName('seconds').setDescription('Rolling window seconds').setMinValue(1).setMaxValue(3600))
            .addStringOption(opt => opt.setName('punishment').setDescription('Module punishment').addChoices(
                ...antiraidPunishments, { name: 'Use default', value: 'default' }
            )))
        .addSubcommand(sub => sub.setName('username').setDescription('Manage blocked username patterns')
            .addStringOption(opt => opt.setName('action').setDescription('Action').setRequired(true).addChoices(
                ...listActions, { name: 'Punishment', value: 'punishment' }
            ))
            .addStringOption(opt => opt.setName('pattern').setDescription('Literal case-insensitive pattern').setMaxLength(32))
            .addStringOption(opt => opt.setName('punishment').setDescription('kick or ban').addChoices(
                { name: 'kick', value: 'kick' }, { name: 'ban', value: 'ban' }
            )))
        .addSubcommand(sub => sub.setName('massmention').setDescription('Configure raid mention detection')
            .addStringOption(opt => opt.setName('action').setDescription('Action').setRequired(true).addChoices(
                ...boolActions, { name: 'Lockdown duration', value: 'lockdown' }
            ))
            .addBooleanOption(opt => opt.setName('enabled').setDescription('Required for toggle'))
            .addIntegerOption(opt => opt.setName('threshold').setDescription('Unique mentions').setMinValue(1).setMaxValue(1000))
            .addIntegerOption(opt => opt.setName('seconds').setDescription('Lockdown seconds; 0 disables').setMinValue(0).setMaxValue(86400))
            .addStringOption(opt => opt.setName('punishment').setDescription('Action').addChoices(
                { name: 'timeout', value: 'timeout' }, { name: 'kick', value: 'kick' }, { name: 'ban', value: 'ban' }
            )))
        .addSubcommand(sub => sub.setName('unverifiedbots').setDescription('Configure unverified bot handling')
            .addStringOption(opt => opt.setName('action').setDescription('Action').setRequired(true).addChoices(...boolActions))
            .addBooleanOption(opt => opt.setName('enabled').setDescription('Required for toggle'))
            .addStringOption(opt => opt.setName('punishment').setDescription('Action').addChoices(
                { name: 'kick', value: 'kick' }, { name: 'ban', value: 'ban' }
            )))
        .addSubcommand(sub => sub.setName('lockdown').setDescription('Enter or leave reversible server lockdown')
            .addBooleanOption(opt => opt.setName('enabled').setDescription('Lockdown status').setRequired(true)))
        .addSubcommand(sub => sub.setName('whitelist').setDescription('Manage exempt users and roles')
            .addStringOption(opt => opt.setName('action').setDescription('Action').setRequired(true).addChoices(...listActions))
            .addUserOption(opt => opt.setName('user').setDescription('Exempt user'))
            .addRoleOption(opt => opt.setName('role').setDescription('Exempt role')))
        .addSubcommand(sub => sub.setName('cleanup').setDescription('Confirmed raid-member cleanup')
            .addStringOption(opt => opt.setName('mode').setDescription('Selection').setRequired(true).addChoices(
                { name: 'Most recent members', value: 'recent' }, { name: 'Joined within duration', value: 'joined' }
            ))
            .addIntegerOption(opt => opt.setName('amount').setDescription('Recent member count').setMinValue(1).setMaxValue(1000))
            .addIntegerOption(opt => opt.setName('minutes').setDescription('Joined within minutes').setMinValue(1).setMaxValue(43200))
            .addStringOption(opt => opt.setName('punishment').setDescription('ban or kick').setRequired(true).addChoices(
                { name: 'ban', value: 'ban' }, { name: 'kick', value: 'kick' }
            ))
            .addBooleanOption(opt => opt.setName('confirm').setDescription('Confirm destructive cleanup').setRequired(true))));
}

function addAutomodGroup(builder) {
    return builder.addSubcommandGroup(group => group
        .setName('automod').setDescription('Content filters, regex, and strikes')
        .addSubcommand(sub => sub.setName('settings').setDescription('View AutoMod settings'))
        .addSubcommand(sub => sub.setName('toggle').setDescription('Enable or disable AutoMod')
            .addBooleanOption(opt => opt.setName('enabled').setDescription('System status').setRequired(true)))
        .addSubcommand(sub => sub.setName('timeout').setDescription('Set timeout action duration')
            .addIntegerOption(opt => opt.setName('minutes').setDescription('1 minute to 27 days').setRequired(true).setMinValue(1).setMaxValue(38880)))
        .addSubcommand(sub => sub.setName('filter').setDescription('Configure one content filter')
            .addStringOption(opt => opt.setName('action').setDescription('Configuration action').setRequired(true).addChoices(...boolActions))
            .addStringOption(opt => opt.setName('filter').setDescription('Filter').setRequired(true).addChoices(
                ...automod.FILTERS.map(value => ({ name: value, value }))
            ))
            .addBooleanOption(opt => opt.setName('enabled').setDescription('Required for toggle'))
            .addIntegerOption(opt => opt.setName('threshold').setDescription('Primary threshold').setMinValue(1).setMaxValue(2000))
            .addIntegerOption(opt => opt.setName('secondary').setDescription('Newline threshold for walloftext').setMinValue(0).setMaxValue(2000))
            .addStringOption(opt => opt.setName('punishment').setDescription('Filter action').addChoices(...automodActions)))
        .addSubcommand(sub => ruleSubcommand(sub, 'keywords', 'Manage keyword filters', 'keyword'))
        .addSubcommand(sub => sub.setName('regex').setDescription('Manage isolated named regex rules')
            .addStringOption(opt => opt.setName('action').setDescription('Action').setRequired(true).addChoices(
                ...listActions, { name: 'Test', value: 'test' }
            ))
            .addStringOption(opt => opt.setName('name').setDescription('Rule name').setMaxLength(32))
            .addStringOption(opt => opt.setName('pattern').setDescription('Regex pattern').setMaxLength(260))
            .addStringOption(opt => opt.setName('text').setDescription('Text to test').setMaxLength(2000)))
        .addSubcommand(sub => ruleSubcommand(sub, 'blacklist', 'Manage blocked domains', 'domain'))
        .addSubcommand(sub => ruleSubcommand(sub, 'allowlinks', 'Manage allowed link domains', 'domain'))
        .addSubcommand(sub => ruleSubcommand(sub, 'allowwords', 'Manage allowed words', 'word'))
        .addSubcommand(sub => sub.setName('strikes').setDescription('Configure persistent violation strikes')
            .addStringOption(opt => opt.setName('action').setDescription('Action').setRequired(true).addChoices(
                { name: 'Settings', value: 'settings' }, { name: 'Toggle', value: 'toggle' }, { name: 'Set level', value: 'set' },
                { name: 'Decay', value: 'decay' }, { name: 'Cap', value: 'cap' }, { name: 'View', value: 'view' }, { name: 'Reset', value: 'reset' }
            ))
            .addBooleanOption(opt => opt.setName('enabled').setDescription('Required for toggle'))
            .addIntegerOption(opt => opt.setName('level').setDescription('Strike level').setMinValue(1).setMaxValue(10))
            .addStringOption(opt => opt.setName('punishment').setDescription('Level action').addChoices(...automodActions))
            .addIntegerOption(opt => opt.setName('minutes').setDescription('Timeout duration').setMinValue(1).setMaxValue(38880))
            .addIntegerOption(opt => opt.setName('hours').setDescription('Decay hours').setMinValue(1).setMaxValue(720))
            .addIntegerOption(opt => opt.setName('cap').setDescription('Maximum strikes').setMinValue(1).setMaxValue(100))
            .addUserOption(opt => opt.setName('user').setDescription('Member to view or reset')))
        .addSubcommand(sub => sub.setName('whitelist').setDescription('Manage exempt users and roles')
            .addStringOption(opt => opt.setName('action').setDescription('Action').setRequired(true).addChoices(...listActions))
            .addUserOption(opt => opt.setName('user').setDescription('Exempt user'))
            .addRoleOption(opt => opt.setName('role').setDescription('Exempt role'))
            .addChannelOption(opt => opt.setName('channel').setDescription('Exempt channel')))
        .addSubcommand(sub => sub.setName('migration').setDescription('Manage ByteBot-owned Discord AutoMod rules')
            .addStringOption(opt => opt.setName('action').setDescription('Action').setRequired(true).addChoices(
                { name: 'Migrate', value: 'migrate' }, { name: 'Unmigrate', value: 'unmigrate' }
            ))));
}

function ruleSubcommand(sub, name, description, label) {
    return sub.setName(name).setDescription(description)
        .addStringOption(opt => opt.setName('action').setDescription('Action').setRequired(true).addChoices(
            ...listActions, { name: 'Clear', value: 'clear' }
        ))
        .addStringOption(opt => opt.setName('value').setDescription(label).setMaxLength(60))
        .addBooleanOption(opt => opt.setName('confirm').setDescription('Required for clear'));
}

function reply(interaction, title, body) {
    return interaction.reply({ embeds: [embeds.brand(title, body)], flags: [MessageFlags.Ephemeral] });
}

function requireAdministrator(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        throw new Error('Discord Administrator is required to manage this system.');
    }
}

function option(interaction, type, name) {
    return interaction.options[`get${type}`](name);
}

function targetOption(interaction, action) {
    const user = option(interaction, 'User', 'user');
    const role = option(interaction, 'Role', 'role');
    const channel = interaction.options.getChannel?.('channel');
    const targets = [user && ['user', user.id], role && ['role', role.id], channel && ['channel', channel.id]].filter(Boolean);
    if (action !== 'list' && targets.length !== 1) throw new Error('Choose exactly one user, role, or channel.');
    return targets[0] || [];
}

async function recorded(interaction, action, targetId, perform) {
    return executeRecordedAction({
        guildId: interaction.guild.id, targetId: targetId || interaction.guild.id,
        executorId: interaction.user.id, action, reason: action, perform
    });
}

function antiraidSettings(guildId) {
    const config = antiraid.ensureConfig(guildId);
    const modules = sqlite.prepare('SELECT * FROM antiraid_modules WHERE guild_id = ? ORDER BY module').all(guildId);
    return [
        `Status: **${config.enabled ? 'enabled' : 'disabled'}**`,
        `Default punishment: **${config.punishment}**`,
        `Lockdown: **${config.lockdown_enabled ? 'on' : 'off'}**`,
        `Modules: **${modules.filter(row => row.enabled).length}/${antiraid.MODULES.length} enabled**`,
        ...modules.map(row => `\`${row.module}\` ${row.enabled ? 'on' : 'off'} · ${row.threshold} · ${row.punishment || 'default'}`)
    ].join('\n').slice(0, 4000);
}

async function executeAntiraid(interaction) {
    try {
        requireAdministrator(interaction);
        const guildId = interaction.guild.id;
        const sub = interaction.options.getSubcommand();
        if (sub === 'settings') return reply(interaction, 'AntiRaid Settings', antiraidSettings(guildId));
        if (sub === 'toggle') {
            const enabled = option(interaction, 'Boolean', 'enabled');
            await recorded(interaction, 'ANTIRAID_TOGGLE', guildId, () => {
                antiraid.ensureConfig(guildId);
                sqlite.prepare('UPDATE antiraid_config SET enabled = ? WHERE guild_id = ?').run(Number(enabled), guildId);
            });
        } else if (sub === 'punishment') {
            const punishment = option(interaction, 'String', 'punishment');
            await recorded(interaction, 'ANTIRAID_PUNISHMENT', guildId, () => {
                antiraid.ensureConfig(guildId);
                sqlite.prepare('UPDATE antiraid_config SET punishment = ? WHERE guild_id = ?').run(punishment, guildId);
            });
        } else if (sub === 'module') {
            const action = option(interaction, 'String', 'action');
            const module = option(interaction, 'String', 'module');
            if (action === 'view') {
                const row = antiraid.upsertModule(guildId, module, {});
                return reply(interaction, `AntiRaid: ${module}`, JSON.stringify(row, null, 2));
            }
            const changes = {};
            if (['toggle', 'lockchannels', 'punishmembers'].includes(action)) {
                if (['lockchannels', 'punishmembers'].includes(action) && module !== 'massjoin') throw new Error('That action is only supported by massjoin.');
                const enabled = option(interaction, 'Boolean', 'enabled');
                if (enabled == null) throw new Error('enabled is required for this action.');
                changes[{ toggle: 'enabled', lockchannels: 'lockChannels', punishmembers: 'punishMembers' }[action]] = Number(enabled);
            } else if (action === 'threshold') changes.threshold = option(interaction, 'Integer', 'threshold');
            else if (action === 'window') changes.windowSeconds = option(interaction, 'Integer', 'seconds');
            else if (action === 'punishment') {
                const value = option(interaction, 'String', 'punishment');
                changes.punishment = value === 'default' ? null : value;
            }
            if (Object.values(changes).some(value => value === null) && action !== 'punishment') throw new Error('The action value is required.');
            await recorded(interaction, 'ANTIRAID_MODULE', module, () => antiraid.upsertModule(guildId, module, changes));
        } else if (sub === 'username') {
            const action = option(interaction, 'String', 'action');
            const pattern = option(interaction, 'String', 'pattern')?.trim().toLowerCase();
            if (action === 'list') return listRules(interaction, 'AntiRaid Username Patterns', 'antiraid_username_patterns', guildId, 'pattern');
            if (action === 'punishment') {
                const punishment = option(interaction, 'String', 'punishment');
                if (!punishment) throw new Error('punishment is required.');
                await recorded(interaction, 'ANTIRAID_USERNAME_PUNISHMENT', guildId, () => {
                    antiraid.ensureConfig(guildId);
                    sqlite.prepare('UPDATE antiraid_config SET username_punishment = ? WHERE guild_id = ?').run(punishment, guildId);
                });
            } else {
                if (!pattern) throw new Error('pattern is required.');
                await recorded(interaction, `ANTIRAID_USERNAME_${action.toUpperCase()}`, pattern, () => {
                    if (action === 'add') {
                        const count = sqlite.prepare('SELECT COUNT(*) AS count FROM antiraid_username_patterns WHERE guild_id = ?').get(guildId).count;
                        if (count >= 1000) throw new Error('Username patterns have reached their 1000 entry limit.');
                        sqlite.prepare(`
                            INSERT INTO antiraid_username_patterns (guild_id, pattern, punishment, created_at) VALUES (?, ?, ?, ?)
                        `).run(guildId, pattern, option(interaction, 'String', 'punishment'), Date.now());
                    }
                    else sqlite.prepare('DELETE FROM antiraid_username_patterns WHERE guild_id = ? AND pattern = ?').run(guildId, pattern);
                });
            }
        } else if (sub === 'massmention' || sub === 'unverifiedbots') {
            const action = option(interaction, 'String', 'action');
            const module = sub === 'massmention' ? 'massmention' : 'unverifiedbots';
            if (action === 'view') {
                const row = antiraid.upsertModule(guildId, module, {});
                return reply(interaction, `AntiRaid: ${module}`, JSON.stringify(row, null, 2));
            }
            if (action === 'toggle') {
                const enabled = option(interaction, 'Boolean', 'enabled');
                if (enabled == null) throw new Error('enabled is required.');
                await recorded(interaction, `ANTIRAID_${module.toUpperCase()}_TOGGLE`, module,
                    () => antiraid.upsertModule(guildId, module, { enabled: Number(enabled) }));
            } else if (action === 'threshold') {
                if (module !== 'massmention') throw new Error('Unverified-bot detection does not use a threshold.');
                const threshold = option(interaction, 'Integer', 'threshold');
                if (threshold == null) throw new Error('threshold is required.');
                await recorded(interaction, 'ANTIRAID_MASSMENTION_THRESHOLD', module,
                    () => antiraid.upsertModule(guildId, module, { threshold }));
            } else if (action === 'punishment') {
                const punishment = option(interaction, 'String', 'punishment');
                if (!punishment) throw new Error('punishment is required.');
                await recorded(interaction, `ANTIRAID_${module.toUpperCase()}_PUNISHMENT`, module, () => {
                    antiraid.ensureConfig(guildId);
                    const column = module === 'massmention' ? 'massmention_punishment' : 'unverifiedbot_punishment';
                    sqlite.prepare(`UPDATE antiraid_config SET ${column} = ? WHERE guild_id = ?`).run(punishment, guildId);
                });
            } else if (action === 'lockdown') {
                const seconds = option(interaction, 'Integer', 'seconds');
                if (seconds == null) throw new Error('seconds is required.');
                await recorded(interaction, 'ANTIRAID_MASSMENTION_LOCKDOWN', module, () => {
                    antiraid.ensureConfig(guildId);
                    sqlite.prepare('UPDATE antiraid_config SET massmention_lockdown_seconds = ? WHERE guild_id = ?').run(seconds, guildId);
                });
            }
        } else if (sub === 'lockdown') {
            const enabled = option(interaction, 'Boolean', 'enabled');
            await lockdownAll({ guild: interaction.guild, executor: interaction.member, reason: 'Manual AntiRaid lockdown', unlock: !enabled });
            antiraid.ensureConfig(guildId);
            sqlite.prepare('UPDATE antiraid_config SET lockdown_enabled = ?, lockdown_expires_at = NULL WHERE guild_id = ?').run(Number(enabled), guildId);
        } else if (sub === 'whitelist') {
            return manageExemptions(interaction, 'antiraid_exemptions', 'AntiRaid Whitelist');
        } else if (sub === 'cleanup') {
            return cleanupRaid(interaction);
        }
        return reply(interaction, 'AntiRaid Updated', antiraidSettings(guildId));
    } catch (error) {
        return interaction.reply({ embeds: [embeds.error('AntiRaid Error', error.message)], flags: [MessageFlags.Ephemeral] });
    }
}

function automodSettings(guildId) {
    const config = automod.ensureConfig(guildId);
    const filters = sqlite.prepare('SELECT * FROM automod_filters WHERE guild_id = ? ORDER BY filter').all(guildId);
    return [
        `Status: **${config.enabled ? 'enabled' : 'disabled'}**`,
        `Timeout: **${Math.round(config.timeout_ms / 60000)} minutes**`,
        `Strikes: **${config.strikes_enabled ? 'on' : 'off'}** · cap ${config.strike_cap} · decay ${config.strike_decay_hours}h`,
        `Discord migration: **${config.native_rule_id || config.native_nsfw_rule_id ? 'active' : 'local'}**`,
        `Filters: **${filters.filter(row => row.enabled).length}/${automod.FILTERS.length} enabled**`,
        ...filters.map(row => `\`${row.filter}\` ${row.enabled ? 'on' : 'off'} · ${row.threshold} · ${row.action}`)
    ].join('\n').slice(0, 4000);
}

async function executeAutomod(interaction) {
    try {
        requireAdministrator(interaction);
        const guildId = interaction.guild.id;
        const sub = interaction.options.getSubcommand();
        if (sub === 'settings') return reply(interaction, 'AutoMod Settings', automodSettings(guildId));
        if (sub === 'toggle') {
            await recorded(interaction, 'AUTOMOD_TOGGLE', guildId, async () => {
                const config = automod.ensureConfig(guildId);
                const enabled = Number(option(interaction, 'Boolean', 'enabled'));
                const filters = new Map(sqlite.prepare("SELECT filter, enabled FROM automod_filters WHERE guild_id = ? AND filter IN ('keywords', 'nsfw')")
                    .all(guildId).map(row => [row.filter, Boolean(row.enabled)]));
                for (const [id, filter] of [[config.native_rule_id, 'keywords'], [config.native_nsfw_rule_id, 'nsfw']].filter(([id]) => id)) {
                    const rule = await interaction.guild.autoModerationRules.fetch(id).catch(() => null);
                    if (rule) await rule.edit({ enabled: Boolean(enabled && filters.get(filter)), reason: 'ByteBot AutoMod toggle' });
                }
                sqlite.prepare('UPDATE automod_config SET enabled = ? WHERE guild_id = ?')
                    .run(enabled, guildId);
            });
        } else if (sub === 'timeout') {
            await recorded(interaction, 'AUTOMOD_TIMEOUT', guildId, () => {
                automod.ensureConfig(guildId);
                sqlite.prepare('UPDATE automod_config SET timeout_ms = ? WHERE guild_id = ?')
                    .run(option(interaction, 'Integer', 'minutes') * 60000, guildId);
            });
        } else if (sub === 'filter') {
            const action = option(interaction, 'String', 'action');
            const filter = option(interaction, 'String', 'filter');
            if (action === 'view') return reply(interaction, `AutoMod: ${filter}`, JSON.stringify(automod.upsertFilter(guildId, filter, {}), null, 2));
            const changes = {};
            if (action === 'toggle') changes.enabled = Number(option(interaction, 'Boolean', 'enabled'));
            if (action === 'threshold') {
                changes.threshold = option(interaction, 'Integer', 'threshold');
                const secondary = option(interaction, 'Integer', 'secondary');
                if (secondary != null) changes.secondaryThreshold = secondary;
            }
            if (action === 'punishment') changes.action = option(interaction, 'String', 'punishment');
            if (Object.values(changes).some(value => value == null)) throw new Error('The action value is required.');
            await recorded(interaction, 'AUTOMOD_FILTER', filter, async () => {
                const row = automod.upsertFilter(guildId, filter, changes);
                const config = automod.ensureConfig(guildId);
                const id = filter === 'keywords' ? config.native_rule_id : filter === 'nsfw' ? config.native_nsfw_rule_id : null;
                if (id) {
                    const rule = await interaction.guild.autoModerationRules.fetch(id).catch(() => null);
                    if (rule) await rule.edit({ enabled: Boolean(config.enabled && row.enabled), reason: `ByteBot ${filter} filter toggle` });
                }
            });
        } else if (['keywords', 'blacklist', 'allowlinks', 'allowwords'].includes(sub)) {
            return manageRules(interaction, { keywords: 'keyword', blacklist: 'blacklist', allowlinks: 'allowlink', allowwords: 'allowword' }[sub]);
        } else if (sub === 'regex') {
            return manageRegex(interaction);
        } else if (sub === 'strikes') {
            return manageStrikes(interaction);
        } else if (sub === 'whitelist') {
            return manageExemptions(interaction, 'automod_exemptions', 'AutoMod Whitelist');
        } else if (sub === 'migration') {
            await recorded(interaction, 'AUTOMOD_MIGRATION', guildId, () => manageMigration(interaction));
        }
        return reply(interaction, 'AutoMod Updated', automodSettings(guildId));
    } catch (error) {
        return interaction.reply({ embeds: [embeds.error('AutoMod Error', error.message)], flags: [MessageFlags.Ephemeral] });
    }
}

function listRules(interaction, title, table, guildId, column = 'name', where = '', params = []) {
    const count = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE guild_id = ? ${where}`).get(guildId, ...params).count;
    const rows = sqlite.prepare(`SELECT ${column} AS value FROM ${table} WHERE guild_id = ? ${where} ORDER BY ${column} LIMIT 50`)
        .all(guildId, ...params);
    const body = rows.length ? `${rows.map(row => `\`${row.value}\``).join('\n')}${count > rows.length ? `\n…and ${count - rows.length} more.` : ''}` : 'No entries configured.';
    return reply(interaction, title, body);
}

async function manageRules(interaction, kind) {
    const action = option(interaction, 'String', 'action');
    const value = option(interaction, 'String', 'value');
    if (action === 'list') return listRules(interaction, `AutoMod ${kind}`, 'automod_rules', interaction.guild.id, 'value', 'AND kind = ?', [kind]);
    if (action === 'clear') {
        if (!option(interaction, 'Boolean', 'confirm')) throw new Error('Set confirm:true to clear this list.');
        await recorded(interaction, `AUTOMOD_${kind.toUpperCase()}_CLEAR`, interaction.guild.id,
            () => sqlite.prepare('DELETE FROM automod_rules WHERE guild_id = ? AND kind = ?').run(interaction.guild.id, kind));
    } else {
        if (!value) throw new Error('value is required.');
        await recorded(interaction, `AUTOMOD_${kind.toUpperCase()}_${action.toUpperCase()}`, value, () => {
            if (action === 'add') automod.addRule(interaction.guild.id, kind, value);
            else automod.removeRule(interaction.guild.id, kind, value);
        });
    }
    return reply(interaction, 'AutoMod Updated', automodSettings(interaction.guild.id));
}

async function manageRegex(interaction) {
    const action = option(interaction, 'String', 'action');
    const name = option(interaction, 'String', 'name')?.trim().toLowerCase();
    if (action === 'list') return listRules(interaction, 'AutoMod Regex', 'automod_rules', interaction.guild.id, 'name', "AND kind = 'regex'");
    if (action === 'test') {
        if (!name || !option(interaction, 'String', 'text')) throw new Error('name and text are required.');
        const rule = sqlite.prepare("SELECT value FROM automod_rules WHERE guild_id = ? AND kind = 'regex' AND name = ?").get(interaction.guild.id, name);
        if (!rule) throw new Error('Regex rule not found.');
        const result = await automod.testRegex(rule.value, option(interaction, 'String', 'text'));
        return reply(interaction, `Regex: ${name}`, result.timedOut ? 'Evaluation timed out safely.' : result.matched ? 'Matched.' : 'No match.');
    }
    if (!name) throw new Error('name is required.');
    await recorded(interaction, `AUTOMOD_REGEX_${action.toUpperCase()}`, name, async () => {
        if (action === 'add') await automod.addRegex(interaction.guild.id, name, option(interaction, 'String', 'pattern'));
        else sqlite.prepare("DELETE FROM automod_rules WHERE guild_id = ? AND kind = 'regex' AND name = ?").run(interaction.guild.id, name);
    });
    return reply(interaction, 'AutoMod Updated', automodSettings(interaction.guild.id));
}

async function manageExemptions(interaction, table, title) {
    const action = option(interaction, 'String', 'action');
    if (action === 'list') {
        const count = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE guild_id = ?`).get(interaction.guild.id).count;
        const rows = sqlite.prepare(`SELECT target_type, target_id FROM ${table} WHERE guild_id = ? ORDER BY target_type, target_id LIMIT 50`).all(interaction.guild.id);
        const body = rows.length ? rows.map(row =>
            row.target_type === 'user' ? `<@${row.target_id}>` : row.target_type === 'role' ? `<@&${row.target_id}>` : `<#${row.target_id}>`
        ).join('\n') : 'No exemptions configured.';
        return reply(interaction, title, `${body}${count > rows.length ? `\n…and ${count - rows.length} more.` : ''}`);
    }
    const [type, id] = targetOption(interaction, action);
    if (table === 'automod_exemptions' && action === 'add' && type === 'user') {
        const config = automod.ensureConfig(interaction.guild.id);
        if (config.native_rule_id || config.native_nsfw_rule_id) {
            throw new Error('Discord AutoMod cannot exempt individual users. Unmigrate first or use a role exemption.');
        }
    }
    await recorded(interaction, `${title.toUpperCase().replace(/\W+/g, '_')}_${action.toUpperCase()}`, id, () => {
        if (action === 'add') {
            const count = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE guild_id = ?`).get(interaction.guild.id).count;
            if (count >= 1000) throw new Error(`${title} has reached its 1000 entry limit.`);
            sqlite.prepare(`INSERT INTO ${table} (guild_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`)
                .run(interaction.guild.id, type, id, Date.now());
        }
        else sqlite.prepare(`DELETE FROM ${table} WHERE guild_id = ? AND target_type = ? AND target_id = ?`).run(interaction.guild.id, type, id);
    });
    const mention = type === 'role' ? `<@&${id}>` : type === 'channel' ? `<#${id}>` : `<@${id}>`;
    return reply(interaction, `${title} Updated`, `${action} ${type} ${mention}`);
}

async function manageStrikes(interaction) {
    const guildId = interaction.guild.id;
    const action = option(interaction, 'String', 'action');
    const config = automod.ensureConfig(guildId);
    if (action === 'settings') {
        const levels = sqlite.prepare('SELECT * FROM automod_strike_levels WHERE guild_id = ? ORDER BY level').all(guildId);
        return reply(interaction, 'AutoMod Strikes', `Status: ${config.strikes_enabled ? 'on' : 'off'}\nDecay: ${config.strike_decay_hours}h\nCap: ${config.strike_cap}\n${levels.map(row => `${row.level}: ${row.action}`).join('\n') || 'No levels.'}`);
    }
    if (action === 'view' || action === 'reset') {
        const user = option(interaction, 'User', 'user');
        if (!user) throw new Error('user is required.');
        if (action === 'view') return reply(interaction, 'AutoMod Strikes', `<@${user.id}> has **${automod.getActiveStrikes(guildId, user.id).count}** strikes.`);
        await recorded(interaction, 'AUTOMOD_STRIKES_RESET', user.id,
            () => sqlite.prepare('DELETE FROM automod_strikes WHERE guild_id = ? AND user_id = ?').run(guildId, user.id));
    } else if (action === 'set') {
        const level = option(interaction, 'Integer', 'level');
        const punishment = option(interaction, 'String', 'punishment');
        if (!level || !punishment) throw new Error('level and punishment are required.');
        await recorded(interaction, 'AUTOMOD_STRIKES_LEVEL', String(level),
            () => automod.setStrikeLevel(guildId, level, punishment, (option(interaction, 'Integer', 'minutes') || 5) * 60000));
    } else {
        const values = {
            toggle: ['strikes_enabled', Number(option(interaction, 'Boolean', 'enabled'))],
            decay: ['strike_decay_hours', option(interaction, 'Integer', 'hours')],
            cap: ['strike_cap', option(interaction, 'Integer', 'cap')]
        }[action];
        if (!values || values[1] == null) throw new Error('The action value is required.');
        await recorded(interaction, `AUTOMOD_STRIKES_${action.toUpperCase()}`, guildId,
            () => sqlite.prepare(`UPDATE automod_config SET ${values[0]} = ? WHERE guild_id = ?`).run(values[1], guildId));
    }
    return reply(interaction, 'AutoMod Updated', automodSettings(guildId));
}

async function cleanupRaid(interaction) {
    if (!option(interaction, 'Boolean', 'confirm')) throw new Error('Set confirm:true to run raid cleanup.');
    const collection = await interaction.guild.members.list({ limit: 1000 });
    const members = [...collection.values()].filter(member => !antiraid.isExempt(member));
    const mode = option(interaction, 'String', 'mode');
    const selected = mode === 'recent'
        ? members.sort((a, b) => b.joinedTimestamp - a.joinedTimestamp).slice(0, option(interaction, 'Integer', 'amount') || 0)
        : members.filter(member => member.joinedTimestamp >= Date.now() - (option(interaction, 'Integer', 'minutes') || 0) * 60000);
    if (!selected.length) throw new Error('No members matched the cleanup selection.');
    const action = option(interaction, 'String', 'punishment').toUpperCase();
    const failures = [];
    for (const member of selected.slice(0, 1000)) {
        try {
            await executeMemberAction({ guild: interaction.guild, executor: interaction.member, target: member, action, reason: 'Raid cleanup' });
        } catch (error) { failures.push(`${member.id}: ${error.message}`); }
    }
    return reply(interaction, 'Raid Cleanup', `Processed **${selected.length - failures.length}/${selected.length}** members.${failures.length ? ` ${failures.length} failed.` : ''}`);
}

async function manageMigration(interaction) {
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageGuild)) throw new Error('I need Manage Server to manage Discord AutoMod rules.');
    const guildId = interaction.guild.id;
    const action = option(interaction, 'String', 'action');
    const config = automod.ensureConfig(guildId);
    if (action === 'unmigrate') {
        for (const id of [config.native_rule_id, config.native_nsfw_rule_id].filter(Boolean)) {
            const rule = await interaction.guild.autoModerationRules.fetch(id).catch(() => null);
            if (rule) await rule.delete('ByteBot AutoMod unmigrate');
        }
        sqlite.prepare('UPDATE automod_config SET native_rule_id = NULL, native_nsfw_rule_id = NULL WHERE guild_id = ?').run(guildId);
        return;
    }
    const keywords = sqlite.prepare("SELECT value FROM automod_rules WHERE guild_id = ? AND kind = 'keyword' ORDER BY value LIMIT 1000")
        .all(guildId).map(row => row.value);
    const roles = sqlite.prepare("SELECT target_id FROM automod_exemptions WHERE guild_id = ? AND target_type = 'role' ORDER BY target_id LIMIT 20")
        .all(guildId).map(row => row.target_id);
    const channels = sqlite.prepare("SELECT target_id FROM automod_exemptions WHERE guild_id = ? AND target_type = 'channel' ORDER BY target_id LIMIT 50")
        .all(guildId).map(row => row.target_id);
    const nsfw = sqlite.prepare("SELECT enabled FROM automod_filters WHERE guild_id = ? AND filter = 'nsfw'").get(guildId)?.enabled;
    const keywordsEnabled = sqlite.prepare("SELECT enabled FROM automod_filters WHERE guild_id = ? AND filter = 'keywords'").get(guildId)?.enabled;
    if (!keywords.length && !nsfw) throw new Error('Add a keyword or enable the NSFW filter before migration.');
    if (sqlite.prepare("SELECT 1 FROM automod_exemptions WHERE guild_id = ? AND target_type = 'user' LIMIT 1").get(guildId)) {
        throw new Error('Discord AutoMod cannot exempt individual users. Remove user exemptions or replace them with role exemptions before migration.');
    }
    if (keywords.length) {
        let keywordRule = config.native_rule_id && await interaction.guild.autoModerationRules.fetch(config.native_rule_id).catch(() => null);
        const allowList = sqlite.prepare("SELECT value FROM automod_rules WHERE guild_id = ? AND kind = 'allowword' ORDER BY value LIMIT 100")
            .all(guildId).map(row => row.value);
        const payload = {
            name: 'ByteBot Keywords', eventType: AutoModerationRuleEventType.MessageSend,
            triggerType: AutoModerationRuleTriggerType.Keyword, triggerMetadata: { keywordFilter: keywords, allowList },
            actions: [{ type: AutoModerationActionType.BlockMessage, metadata: { customMessage: 'Blocked by ByteBot AutoMod.' } }],
            exemptRoles: roles, exemptChannels: channels, enabled: Boolean(config.enabled && keywordsEnabled), reason: 'ByteBot keyword migration'
        };
        keywordRule = keywordRule ? await keywordRule.edit(payload) : await interaction.guild.autoModerationRules.create(payload);
        sqlite.prepare('UPDATE automod_config SET native_rule_id = ? WHERE guild_id = ?').run(keywordRule.id, guildId);
    }
    if (nsfw) {
        let nsfwRule = config.native_nsfw_rule_id && await interaction.guild.autoModerationRules.fetch(config.native_nsfw_rule_id).catch(() => null);
        const nsfwPayload = {
            name: 'ByteBot NSFW', eventType: AutoModerationRuleEventType.MessageSend,
            triggerType: AutoModerationRuleTriggerType.KeywordPreset,
            triggerMetadata: { presets: [AutoModerationRuleKeywordPresetType.SexualContent] },
            actions: [{ type: AutoModerationActionType.BlockMessage }], exemptRoles: roles, exemptChannels: channels, enabled: Boolean(config.enabled && nsfw),
            reason: 'ByteBot NSFW migration'
        };
        nsfwRule = nsfwRule ? await nsfwRule.edit(nsfwPayload) : await interaction.guild.autoModerationRules.create(nsfwPayload);
        sqlite.prepare('UPDATE automod_config SET native_nsfw_rule_id = ? WHERE guild_id = ?').run(nsfwRule.id, guildId);
    }
}

module.exports = { addAntiraidGroup, addAutomodGroup, executeAntiraid, executeAutomod };
