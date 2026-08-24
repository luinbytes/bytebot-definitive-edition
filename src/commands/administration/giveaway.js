const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const messageId = sub => sub.addStringOption(option => option.setName('message_id').setDescription('Giveaway message ID').setRequired(true));
const editableText = (sub, name, description, required = false) => messageId(sub)
    .addStringOption(option => option.setName(name).setDescription(description).setMaxLength(name === 'prize' ? 256 : 2000).setRequired(required));

const data = new SlashCommandBuilder().setName('giveaway').setDescription('Create and manage server giveaways')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).setDMPermission(false)
    .addSubcommand(sub => sub.setName('start').setDescription('Start a giveaway')
        .addStringOption(option => option.setName('duration').setDescription('10s to 30d, such as 1h').setRequired(true))
        .addIntegerOption(option => option.setName('winners').setDescription('Number of winners').setMinValue(1).setMaxValue(50).setRequired(true))
        .addStringOption(option => option.setName('prize').setDescription('Prize').setMinLength(1).setMaxLength(256).setRequired(true))
        .addRoleOption(option => option.setName('role').setDescription('Required role'))
        .addStringOption(option => option.setName('description').setDescription('Optional description').setMaxLength(2000))
        .addStringOption(option => option.setName('preset').setDescription('Saved giveaway preset').setAutocomplete(true))
        .addStringOption(option => option.setName('image').setDescription('Optional HTTP(S) image URL'))
        .addStringOption(option => option.setName('thumbnail').setDescription('Optional HTTP(S) thumbnail URL')))
    .addSubcommand(sub => messageId(sub.setName('end').setDescription('End a giveaway early')))
    .addSubcommand(sub => messageId(sub.setName('reroll').setDescription('Reroll an ended giveaway')))
    .addSubcommand(sub => sub.setName('blacklist').setDescription("Toggle a role's giveaway blacklist")
        .addRoleOption(option => option.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand(sub => sub.setName('setmax').setDescription('Set the maximum entries for a role')
        .addRoleOption(option => option.setName('role').setDescription('Role').setRequired(true))
        .addIntegerOption(option => option.setName('entries').setDescription('Maximum entries').setMinValue(1).setMaxValue(100).setRequired(true)))
    .addSubcommand(sub => sub.setName('dmcreator').setDescription('Set host end notifications')
        .addBooleanOption(option => option.setName('enabled').setDescription('Whether to DM hosts').setRequired(true)))
    .addSubcommand(sub => sub.setName('dmwinners').setDescription('Set winner notifications')
        .addBooleanOption(option => option.setName('enabled').setDescription('Whether to DM winners').setRequired(true)))
    .addSubcommand(sub => sub.setName('template').setDescription('Set or clear the default giveaway script')
        .addStringOption(option => option.setName('script').setDescription('Omit to clear').setMaxLength(2000)))
    .addSubcommand(sub => sub.setName('variables').setDescription('List giveaway template variables'))
    .addSubcommandGroup(group => group.setName('edit').setDescription('Edit an active giveaway')
        .addSubcommand(sub => editableText(sub.setName('prize').setDescription('Edit the prize'), 'prize', 'New prize', true))
        .addSubcommand(sub => messageId(sub.setName('duration').setDescription('Edit the remaining duration'))
            .addStringOption(option => option.setName('duration').setDescription('10s to 30d').setRequired(true)))
        .addSubcommand(sub => messageId(sub.setName('winners').setDescription('Edit the winner count'))
            .addIntegerOption(option => option.setName('winners').setDescription('New winner count').setMinValue(1).setMaxValue(50).setRequired(true)))
        .addSubcommand(sub => editableText(sub.setName('description').setDescription('Edit or clear the description'), 'description', 'Omit to clear'))
        .addSubcommand(sub => editableText(sub.setName('image').setDescription('Edit or clear the image'), 'image', 'HTTP(S) image URL; omit to clear'))
        .addSubcommand(sub => editableText(sub.setName('thumbnail').setDescription('Edit or clear the thumbnail'), 'thumbnail', 'HTTP(S) thumbnail URL; omit to clear'))
        .addSubcommand(sub => messageId(sub.setName('minlevel').setDescription('Set or clear the minimum level'))
            .addIntegerOption(option => option.setName('level').setDescription('0-1000; omit to clear').setMinValue(0).setMaxValue(1000)))
        .addSubcommand(sub => messageId(sub.setName('maxlevel').setDescription('Set or clear the maximum level'))
            .addIntegerOption(option => option.setName('level').setDescription('0-1000; omit to clear').setMinValue(0).setMaxValue(1000))))
    .addSubcommandGroup(group => group.setName('preset').setDescription('Manage giveaway scripts')
        .addSubcommand(sub => sub.setName('save').setDescription('Save an embed preset')
            .addStringOption(option => option.setName('name').setDescription('Preset name').setMinLength(1).setMaxLength(32).setRequired(true))
            .addStringOption(option => option.setName('script').setDescription('Rich-message script').setMinLength(1).setMaxLength(2000).setRequired(true)))
        .addSubcommand(sub => sub.setName('list').setDescription('List saved presets'))
        .addSubcommand(sub => sub.setName('delete').setDescription('Delete a saved preset')
            .addStringOption(option => option.setName('name').setDescription('Preset name').setAutocomplete(true).setRequired(true))));

module.exports = {
    data,
    permissions: [PermissionFlagsBits.ManageGuild],
    cooldown: 2,
    longRunning: true,
    async execute(interaction, client) {
        if (!client.giveawayService) throw new Error('Giveaway service is unavailable.');
        return client.giveawayService.handleCommand(interaction);
    },
    autocomplete(interaction, client) {
        return client.giveawayService?.autocomplete(interaction) || interaction.respond([]);
    }
};
