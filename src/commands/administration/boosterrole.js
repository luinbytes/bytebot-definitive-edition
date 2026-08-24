const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { RoleManager } = require('../../utils/discordApiUtil');
const { boundedList, configOf } = require('../../services/roleAutomationService');

const color = option => option.setName('color').setDescription('Hex color, such as #ff0000').setRequired(true);
const member = option => option.setName('member').setDescription('Target member').setRequired(true);
const data = new SlashCommandBuilder().setName('boosterrole').setDescription('Create and manage custom booster roles').setDMPermission(false)
    .addSubcommand(sub => sub.setName('setup').setDescription('Enable booster roles'))
    .addSubcommand(sub => sub.setName('disable').setDescription('Disable booster roles'))
    .addSubcommand(sub => sub.setName('base').setDescription('Set the base role').addRoleOption(option => option.setName('role').setDescription('Base role').setRequired(true)))
    .addSubcommand(sub => sub.setName('create').setDescription('Create your booster role')
        .addStringOption(option => option.setName('name').setDescription('Role name').setMinLength(2).setMaxLength(100).setRequired(true))
        .addStringOption(color)
        .addStringOption(option => option.setName('secondary').setDescription('Optional secondary gradient color'))
        .addStringOption(option => option.setName('tertiary').setDescription('Optional tertiary gradient color')))
    .addSubcommand(sub => sub.setName('delete').setDescription('Delete your booster role'))
    .addSubcommand(sub => sub.setName('rename').setDescription('Rename your booster role')
        .addStringOption(option => option.setName('name').setDescription('New role name').setMinLength(2).setMaxLength(100).setRequired(true)))
    .addSubcommand(sub => sub.setName('color').setDescription('Change your booster role color').addStringOption(color)
        .addStringOption(option => option.setName('secondary').setDescription('Optional secondary gradient color'))
        .addStringOption(option => option.setName('tertiary').setDescription('Optional tertiary gradient color')))
    .addSubcommand(sub => sub.setName('icon').setDescription('Change or reset your booster role icon')
        .addStringOption(option => option.setName('icon').setDescription('Emoji, Discord CDN URL, or reset').setRequired(true)))
    .addSubcommand(sub => sub.setName('share').setDescription('Toggle sharing with a member').addUserOption(member))
    .addSubcommand(sub => sub.setName('list').setDescription('List booster roles'))
    .addSubcommand(sub => sub.setName('include').setDescription('Associate an existing role and booster')
        .addRoleOption(option => option.setName('role').setDescription('Existing role').setRequired(true)).addUserOption(member))
    .addSubcommand(sub => sub.setName('sync').setDescription('Synchronize booster role positions'))
    .addSubcommand(sub => sub.setName('hoist').setDescription('Set default hoisting')
        .addBooleanOption(option => option.setName('enabled').setDescription('Hoist new booster roles').setRequired(true)))
    .addSubcommand(sub => sub.setName('limit').setDescription('Set the role limit')
        .addIntegerOption(option => option.setName('limit').setDescription('1-249 roles').setMinValue(1).setMaxValue(249).setRequired(true)))
    .addSubcommandGroup(group => group.setName('filter').setDescription('Manage blocked role-name words')
        .addSubcommand(sub => sub.setName('add').setDescription('Add a filtered word')
            .addStringOption(option => option.setName('word').setDescription('Word to block').setMinLength(2).setMaxLength(50).setRequired(true)))
        .addSubcommand(sub => sub.setName('remove').setDescription('Remove a filtered word')
            .addStringOption(option => option.setName('word').setDescription('Word to unblock').setMinLength(2).setMaxLength(50).setRequired(true)))
        .addSubcommand(sub => sub.setName('list').setDescription('List filtered words')))
    .addSubcommandGroup(group => group.setName('shares').setDescription('Manage booster role shares')
        .addSubcommand(sub => sub.setName('list').setDescription('List your role shares'))
        .addSubcommand(sub => sub.setName('remove').setDescription('Remove a role share').addUserOption(member))
        .addSubcommand(sub => sub.setName('max').setDescription('Set the shares limit')
            .addIntegerOption(option => option.setName('maximum').setDescription('1-50 shares').setMinValue(1).setMaxValue(50).setRequired(true))));

const ADMIN_ACTIONS = new Set(['setup', 'disable', 'base', 'include', 'sync', 'hoist', 'limit', 'filter-add', 'filter-remove', 'filter-list', 'shares-max']);

function parseColor(value) {
    const match = /^#?([\da-f]{6})$/i.exec(String(value || ''));
    return match ? Number.parseInt(match[1], 16) : null;
}

function filtered(name, words) {
    const normalized = name.toLowerCase();
    return words.find(word => normalized.includes(word));
}

async function setColors(role, interaction) {
    const primary = parseColor(interaction.options.getString('color'));
    const secondaryValue = interaction.options.getString('secondary');
    const tertiaryValue = interaction.options.getString('tertiary');
    const secondary = secondaryValue ? parseColor(secondaryValue) : null;
    const tertiary = tertiaryValue ? parseColor(tertiaryValue) : null;
    if (primary === null || (secondaryValue && secondary === null) || (tertiaryValue && tertiary === null)) throw new Error('Use six-digit hex colors such as `#ff0000`.');
    if ((secondary !== null || tertiary !== null) && role.setColors) {
        await role.setColors({ primaryColor: primary, secondaryColor: secondary, tertiaryColor: tertiary }, 'Booster role color');
    } else await role.setColor(primary, 'Booster role color');
}

async function discordIcon(input) {
    if (input === 'reset') return null;
    const custom = /^<a?:\w+:(\d+)>$/.exec(input);
    if (custom) return custom[1];
    if (!/^https?:\/\//i.test(input)) return input;
    if (!/^https:\/\//i.test(input)) throw new Error('Icon URLs must use HTTPS.');
    const url = new URL(input);
    if (!['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname)) throw new Error('Icon URLs must use Discord CDN.');
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const finalUrl = new URL(response.url);
    if (finalUrl.protocol !== 'https:' || !['cdn.discordapp.com', 'media.discordapp.net'].includes(finalUrl.hostname)) throw new Error('Icon redirects must stay on Discord CDN.');
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')
        || Number(response.headers.get('content-length') || 0) > 262144) throw new Error('The icon could not be downloaded as an image within 256 KiB.');
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 262144) throw new Error('The icon must be 256 KiB or smaller.');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

module.exports = {
    data, permissions: [], cooldown: 2, longRunning: true, deferEphemeral: true,
    async execute(interaction, client) {
        const group = interaction.options.getSubcommandGroup(false);
        const subcommand = interaction.options.getSubcommand();
        const action = group ? `${group}-${subcommand}` : subcommand;
        if (ADMIN_ACTIONS.has(action) && (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)
            || !interaction.member.permissions.has(PermissionFlagsBits.ManageRoles))) return interaction.editReply('You need **Manage Server** and **Manage Roles** for that setting.');
        const guild = interaction.guild;
        const service = client.roleAutomationService;
        const automation = client.automationService;
        const currentRule = await automation.get(guild.id, 'booster-config', 'main');
        const config = { enabled: false, maxRoles: 249, maxShares: 50, filters: [], hoist: false, ...configOf(currentRule || {}) };
        const saveConfig = () => automation.upsert({ guildId: guild.id, kind: 'booster-config', key: 'main', config,
            enabled: config.enabled, createdBy: interaction.user.id });

        if (action === 'setup') {
            if (guild.premiumTier < 2) return interaction.editReply('This server must be boost level 2 or higher.');
            if (!interaction.member.premiumSince) return interaction.editReply('You must be an active server booster to enable this feature.');
            config.enabled = true;
            await saveConfig();
            return interaction.editReply('Booster roles enabled. Set a base role with `/boosterrole base`.');
        }
        if (action === 'disable') { config.enabled = false; await saveConfig(); return interaction.editReply('Booster roles disabled.'); }
        if (action === 'base') {
            const role = interaction.options.getRole('role');
            const invalid = await service.validateRole(guild, role, interaction.member);
            if (invalid) return interaction.editReply(invalid);
            config.baseRoleId = role.id; await saveConfig();
            return interaction.editReply(`Booster roles will be positioned above ${role}.`);
        }
        if (action === 'hoist') { config.hoist = interaction.options.getBoolean('enabled'); await saveConfig(); return interaction.editReply(`Default hoisting ${config.hoist ? 'enabled' : 'disabled'}.`); }
        if (action === 'limit') { config.maxRoles = interaction.options.getInteger('limit'); await saveConfig(); return interaction.editReply(`Booster role limit set to ${config.maxRoles}.`); }
        if (action.startsWith('filter-')) {
            if (action === 'filter-list') return interaction.editReply({ content: boundedList(config.filters.map(word => `\`${word}\``), 'No filtered words.'), allowedMentions: { parse: [] } });
            const word = interaction.options.getString('word').toLowerCase();
            config.filters = action === 'filter-add' ? [...new Set([...config.filters, word])] : config.filters.filter(item => item !== word);
            await saveConfig();
            return interaction.editReply(`Filter word ${action === 'filter-add' ? 'added' : 'removed'}.`);
        }
        if (action === 'shares-max') { config.maxShares = interaction.options.getInteger('maximum'); await saveConfig(); return interaction.editReply(`Maximum shares set to ${config.maxShares}.`); }
        if (action === 'list') {
            const rules = await automation.list(guild.id, 'booster-role');
            const lines = rules.map(rule => `<@${rule.key}> → ${configOf(rule).roleId ? `<@&${configOf(rule).roleId}>` : 'pending cleanup'}`);
            return interaction.editReply({ content: boundedList(lines, 'No booster roles configured.'), allowedMentions: { parse: [] } });
        }
        if (action === 'include') {
            const role = interaction.options.getRole('role');
            const owner = await guild.members.fetch(interaction.options.getUser('member').id);
            if (!owner.premiumSince) return interaction.editReply('That member is not an active booster.');
            const invalid = await service.validateRole(guild, role, interaction.member);
            if (invalid) return interaction.editReply(invalid);
            const claim = service.claimBoosterRole({ guildId: guild.id, ownerId: owner.id, roleId: role.id,
                maxRoles: config.maxRoles, createdBy: interaction.user.id });
            if (claim.status === 'owner') return interaction.editReply('That booster already owns a role.');
            if (claim.status === 'role') return interaction.editReply('That role is already owned by another booster.');
            if (claim.status === 'limit') return interaction.editReply(`This server has reached its ${config.maxRoles}-role limit.`);
            const granted = await RoleManager.addRole(owner, role, { reason: 'Included booster role', logContext: 'booster-role' });
            if (!granted.success) { await automation.remove(guild.id, 'booster-role', owner.id); return interaction.editReply(granted.error); }
            await automation.upsert({ guildId: guild.id, kind: 'booster-role', key: owner.id,
                config: { roleId: role.id, shares: [], pendingGrant: false, included: true },
                nextRunAt: Date.now() + 3600000, createdBy: interaction.user.id });
            return interaction.editReply(`Associated ${role} with ${owner}.`);
        }
        if (action === 'sync') {
            const base = guild.roles.cache.get(config.baseRoleId);
            if (!base) return interaction.editReply('Set a valid base role first.');
            const rules = await automation.list(guild.id, 'booster-role');
            let synced = 0;
            for (const rule of rules) {
                const role = guild.roles.cache.get(configOf(rule).roleId);
                if (role?.editable) { await role.setPosition(base.position + 1 + synced, { reason: 'Booster role sync' }); synced += 1; }
            }
            return interaction.editReply(`Synchronized ${synced} booster role(s).`);
        }

        if (!config.enabled) return interaction.editReply('Booster roles are not enabled in this server.');
        if (!interaction.member.premiumSince) return interaction.editReply('You must be an active server booster.');
        const ownerRule = await service.boosterRole(guild.id, interaction.user.id);
        const ownerConfig = configOf(ownerRule || {});
        const ownerRole = guild.roles.cache.get(ownerConfig.roleId);
        if (action === 'create') {
            const base = guild.roles.cache.get(config.baseRoleId);
            if (!base || !base.editable) return interaction.editReply('An editable base role must be configured first.');
            const name = interaction.options.getString('name');
            const blocked = filtered(name, config.filters);
            if (blocked) return interaction.editReply(`That role name contains the filtered word \`${blocked}\`.`);
            for (const option of ['color', 'secondary', 'tertiary']) {
                const value = interaction.options.getString(option);
                if (value && parseColor(value) === null) return interaction.editReply('Use six-digit hex colors such as `#ff0000`.');
            }
            const claim = service.claimBoosterRole({ guildId: guild.id, ownerId: interaction.user.id,
                maxRoles: config.maxRoles, createdBy: interaction.user.id });
            if (claim.status === 'owner') return interaction.editReply('You already own a booster role.');
            if (claim.status === 'limit') return interaction.editReply(`This server has reached its ${config.maxRoles}-role limit.`);
            let role;
            try {
                role = await guild.roles.create({ name: claim.pendingName, color: parseColor(interaction.options.getString('color')), hoist: config.hoist,
                    reason: `Booster role for ${interaction.user.id}` });
                await automation.upsert({ guildId: guild.id, kind: 'booster-role', key: interaction.user.id,
                    config: { roleId: role.id, shares: [], cleanup: true, included: false }, nextRunAt: Date.now() + 60000, createdBy: interaction.user.id });
                await role.setName(name, 'Booster role name');
                await setColors(role, interaction);
                await role.setPosition(base.position + 1, { reason: 'Booster role base position' });
                const granted = await RoleManager.addRole(interaction.member, role, { reason: 'Booster role owner', logContext: 'booster-role' });
                if (!granted.success) throw new Error(granted.error);
                await automation.upsert({ guildId: guild.id, kind: 'booster-role', key: interaction.user.id,
                    config: { roleId: role.id, shares: [], cleanup: false, included: false }, nextRunAt: Date.now() + 3600000, createdBy: interaction.user.id });
            } catch (error) {
                const deleted = !role || await role.delete('Booster role setup failed').then(() => true).catch(() => false);
                if (deleted) await automation.remove(guild.id, 'booster-role', interaction.user.id);
                throw error;
            }
            return interaction.editReply(`Created ${role}.`);
        }
        if (ownerRule && (ownerConfig.pendingGrant || ownerConfig.cleanup || ownerConfig.pendingName)) {
            return interaction.editReply('Your booster role is still being reconciled. Try again shortly.');
        }
        if (!ownerRule || !ownerRole) return interaction.editReply('You do not have a booster role in this server.');
        if (action === 'delete') {
            await service.requestBoosterCleanup(interaction.member);
            return interaction.editReply(ownerConfig.included ? 'Your included booster role was disconnected.' : 'Your booster role was deleted.');
        }
        if (action === 'rename') {
            const name = interaction.options.getString('name');
            const blocked = filtered(name, config.filters);
            if (blocked) return interaction.editReply(`That role name contains the filtered word \`${blocked}\`.`);
            await ownerRole.setName(name, 'Booster role rename'); return interaction.editReply(`Renamed your role to **${name}**.`);
        }
        if (action === 'color') { await setColors(ownerRole, interaction); return interaction.editReply('Your booster role color was updated.'); }
        if (action === 'icon') {
            const input = interaction.options.getString('icon');
            const icon = await discordIcon(input);
            if (typeof icon === 'string' && !/^\d+$/.test(icon)) await ownerRole.setUnicodeEmoji(icon === 'reset' ? null : icon, 'Booster role icon');
            else await ownerRole.setIcon(icon, 'Booster role icon');
            return interaction.editReply(`Your booster role icon was ${icon === null ? 'reset' : 'updated'}.`);
        }
        if (action === 'shares-list') {
            return interaction.editReply({ content: ownerConfig.shares?.length ? ownerConfig.shares.map(id => `<@${id}>`).join(', ') : 'You are not sharing your role.', allowedMentions: { parse: [] } });
        }
        return service.withBoosterLock(`${guild.id}:${interaction.user.id}`, async () => {
            const lockedRule = await service.boosterRole(guild.id, interaction.user.id);
            const lockedConfig = configOf(lockedRule || {});
            const lockedRole = guild.roles.cache.get(lockedConfig.roleId);
            if (!lockedRule || !lockedRole) return interaction.editReply('You do not have a booster role in this server.');
            const target = await guild.members.fetch(interaction.options.getUser('member').id);
            if (target.id === interaction.user.id) return interaction.editReply('You cannot share your role with yourself.');
            const shares = new Set(lockedConfig.shares || []);
            const wasShared = shares.has(target.id);
            if (action === 'shares-remove' || wasShared) {
                const removed = await RoleManager.removeRole(target, lockedRole, { reason: 'Booster role share removed', logContext: 'booster-role' });
                if (!removed.success) return interaction.editReply(removed.error);
                shares.delete(target.id);
            } else {
                if (shares.size >= config.maxShares) return interaction.editReply(`You have reached the ${config.maxShares}-share limit.`);
                const granted = await RoleManager.addRole(target, lockedRole, { reason: 'Booster role shared', logContext: 'booster-role' });
                if (!granted.success) return interaction.editReply(granted.error);
                shares.add(target.id);
            }
            try {
                await automation.upsert({ guildId: guild.id, kind: 'booster-role', key: interaction.user.id,
                    config: { ...lockedConfig, shares: [...shares] }, nextRunAt: Date.now() + 3600000, createdBy: lockedRule.createdBy });
            } catch (error) {
                if (wasShared) await RoleManager.addRole(target, lockedRole, { reason: 'Booster role share failed', logContext: 'booster-role' });
                else await RoleManager.removeRole(target, lockedRole, { reason: 'Booster role share failed', logContext: 'booster-role' });
                throw error;
            }
            return interaction.editReply(`Booster role share ${shares.has(target.id) ? 'added' : 'removed'}.`);
        });
    }
};
