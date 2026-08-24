const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { sqlite } = require('../database');
const { GuildBackupService, SECTIONS } = require('../services/guildBackupService');

function addBackupGroup(builder) {
    return builder.addSubcommandGroup(group => group
        .setName('backup')
        .setDescription('Create and restore server backups')
        .addSubcommand(sub => sub.setName('create').setDescription('Create a server backup')
            .addStringOption(opt => opt.setName('name').setDescription('Backup name').setRequired(true).setMinLength(1).setMaxLength(100))
            .addStringOption(opt => opt.setName('description').setDescription('Optional description').setMaxLength(500)))
        .addSubcommand(sub => sub.setName('list').setDescription('List your backups for this server'))
        .addSubcommand(sub => sub.setName('view').setDescription('View backup details')
            .addStringOption(opt => opt.setName('backup_id').setDescription('Backup ID').setRequired(true)))
        .addSubcommand(sub => sub.setName('rename').setDescription('Rename a backup')
            .addStringOption(opt => opt.setName('backup_id').setDescription('Backup ID').setRequired(true))
            .addStringOption(opt => opt.setName('new_name').setDescription('New backup name').setRequired(true).setMinLength(1).setMaxLength(100)))
        .addSubcommand(sub => sub.setName('delete').setDescription('Delete a backup')
            .addStringOption(opt => opt.setName('backup_id').setDescription('Backup ID').setRequired(true))
            .addBooleanOption(opt => opt.setName('confirm').setDescription('Confirm permanent deletion').setRequired(true)))
        .addSubcommand(sub => {
            sub.setName('restore').setDescription('Preview or restore a backup')
                .addStringOption(opt => opt.setName('backup_id').setDescription('Backup ID').setRequired(true))
                .addStringOption(opt => opt.setName('mode').setDescription('Restore mode').addChoices(
                    { name: 'Merge', value: 'merge' }, { name: 'Destructive', value: 'destructive' }
                ));
            for (const section of SECTIONS) {
                sub.addBooleanOption(opt => opt.setName(section).setDescription(`Restore ${section}`));
            }
            return sub.addBooleanOption(opt => opt.setName('confirm').setDescription('Apply the previewed restore'));
        }));
}

async function respond(interaction, content) {
    const payload = { content, flags: [MessageFlags.Ephemeral] };
    return interaction.deferred || interaction.replied ? interaction.editReply(payload) : interaction.reply(payload);
}

function counts(value) {
    return Object.entries(value).map(([section, count]) => `${section}: ${count}`).join(' · ');
}

async function fetchGuildStructure(guild) {
    await Promise.all([
        guild.roles.fetch?.(), guild.channels.fetch?.(), guild.emojis.fetch?.(), guild.stickers.fetch?.()
    ]);
}

async function executeBackup(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return respond(interaction, 'You need **Manage Server** to manage backups.');
    }
    const service = new GuildBackupService({ sqlite });
    const action = interaction.options.getSubcommand();
    const id = interaction.options.getString('backup_id');
    try {
        if (action === 'create') {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            await fetchGuildStructure(interaction.guild);
            const backup = service.create({
                guild: interaction.guild,
                creatorId: interaction.user.id,
                name: interaction.options.getString('name', true),
                description: interaction.options.getString('description')
            });
            return respond(interaction, `Created **${backup.name}** (\`${backup.id}\`, ${backup.size.toLocaleString()} bytes).`);
        }
        if (action === 'list') {
            const backups = service.list(interaction.guild.id, interaction.user.id);
            return respond(interaction, backups.length
                ? backups.map(backup => `\`${backup.id}\` **${backup.name}** · ${backup.size.toLocaleString()} bytes`).join('\n')
                : 'You have no backups for this server.');
        }
        if (action === 'view') {
            const backup = service.view(interaction.guild.id, interaction.user.id, id);
            if (!backup) throw new Error('Backup not found.');
            return respond(interaction, `**${backup.name}** (\`${backup.id}\`)\n${backup.description || 'No description.'}\n${counts({
                roles: backup.payload.roles.length,
                channels: backup.payload.channels.length,
                emojis: backup.payload.emojis.length,
                stickers: backup.payload.stickers.length,
                bytebot: Object.values(backup.payload.bytebot).reduce((total, rows) => total + rows.length, 0)
            })}`);
        }
        if (action === 'rename') {
            const backup = service.rename(interaction.guild.id, interaction.user.id, id, interaction.options.getString('new_name', true));
            if (!backup) throw new Error('Backup not found.');
            return respond(interaction, `Renamed backup \`${backup.id}\` to **${backup.name}**.`);
        }
        if (action === 'delete') {
            if (!interaction.options.getBoolean('confirm', true)) return respond(interaction, 'Backup deletion cancelled.');
            if (!service.delete(interaction.guild.id, interaction.user.id, id)) throw new Error('Backup not found.');
            return respond(interaction, `Deleted backup \`${id}\`.`);
        }

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        await fetchGuildStructure(interaction.guild);
        const selected = SECTIONS.map(section => [section, interaction.options.getBoolean(section)])
            .filter(([, enabled]) => enabled).map(([section]) => section);
        const supplied = SECTIONS.some(section => interaction.options.getBoolean(section) !== null);
        const sections = supplied ? selected : SECTIONS;
        const values = {
            guild: interaction.guild,
            creatorId: interaction.user.id,
            id,
            mode: interaction.options.getString('mode') || 'merge',
            sections
        };
        if (!interaction.options.getBoolean('confirm')) {
            const plan = service.preview(values);
            return respond(interaction, `Restore preview for \`${id}\` (**${plan.mode}**)\nCreate: ${counts(plan.create)}\nRemove: ${counts(plan.remove)}\nRun the command again with \`confirm:True\` to apply it.`);
        }
        const result = await service.restore({ ...values, confirmed: true });
        return respond(interaction, `Restore finished.\nCreated: ${counts(result.created)}\nRemoved: ${counts(result.removed)}\nFailures: ${result.failures.length
            ? result.failures.map(failure => `${failure.section}/${failure.name}: ${failure.error}`).join('\n').slice(0, 1200)
            : 'none'}`);
    } catch (error) {
        return respond(interaction, `Backup failed: ${error.message}`);
    }
}

module.exports = { addBackupGroup, executeBackup };
