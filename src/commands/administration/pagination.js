const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { boundedList, configOf } = require('../../services/roleAutomationService');

const message = option => option.setName('message').setDescription('Message link or ID').setRequired(true);
const script = option => option.setName('script').setDescription('Embed script for the page').setRequired(true).setMaxLength(6000);
const page = option => option.setName('page').setDescription('One-based page number').setRequired(true).setMinValue(1).setMaxValue(10);

async function fetchMessage(interaction, input) {
    const match = /(?:channels\/\d+\/(\d+)\/)?(\d+)\/?$/.exec(String(input));
    if (!match) return null;
    const channel = match[1] ? await interaction.guild.channels.fetch(match[1]).catch(() => null) : interaction.channel;
    return channel?.messages?.fetch(match[2]).catch(() => null);
}

module.exports = {
    data: new SlashCommandBuilder().setName('pagination').setDescription('Manage durable paginated embeds')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages).setDMPermission(false)
        .addSubcommand(sub => sub.setName('set').setDescription('Register a ByteBot embed message').addStringOption(message))
        .addSubcommand(sub => sub.setName('add').setDescription('Append an embed page').addStringOption(message).addStringOption(script))
        .addSubcommand(sub => sub.setName('update').setDescription('Update an embed page').addStringOption(message).addIntegerOption(page).addStringOption(script))
        .addSubcommand(sub => sub.setName('remove').setDescription('Remove one embed page').addStringOption(message).addIntegerOption(page))
        .addSubcommand(sub => sub.setName('delete').setDescription('Delete pagination from a message').addStringOption(message))
        .addSubcommand(sub => sub.setName('reset').setDescription('Delete every pagination in this server')
            .addBooleanOption(option => option.setName('confirm').setDescription('Confirm permanent removal').setRequired(true)))
        .addSubcommand(sub => sub.setName('list').setDescription('List paginated embeds'))
        .addSubcommand(sub => sub.setName('restorereactions').setDescription('Restore navigation reactions').addStringOption(message)),
    permissions: [PermissionFlagsBits.ManageMessages], cooldown: 2, longRunning: true, deferEphemeral: true,
    async execute(interaction, client) {
        const service = client.richContentService;
        const action = interaction.options.getSubcommand();
        if (action === 'list') {
            const lines = service.listPagination(interaction.guildId).map(rule => {
                const config = configOf(rule);
                return `https://discord.com/channels/${interaction.guildId}/${config.channelId}/${rule.key} — ${config.pages.length} pages`;
            });
            return interaction.editReply({ content: boundedList(lines, 'No paginated embeds configured.'), allowedMentions: { parse: [] } });
        }
        if (action === 'reset') {
            if (!interaction.options.getBoolean('confirm')) return interaction.editReply('Reset cancelled; confirmation was not provided.');
            return interaction.editReply(`Removed ${service.resetPagination(interaction.guildId)} pagination(s).`);
        }
        const target = await fetchMessage(interaction, interaction.options.getString('message'));
        if (!target) return interaction.editReply('That message was not found or is not accessible.');
        if (action === 'set') { await service.setupPagination(target, interaction.user.id); return interaction.editReply(`Pagination enabled for ${target.url}.`); }
        if (action === 'add') {
            const count = await service.addPaginationPage(target, interaction.options.getString('script'), interaction.user.id);
            return interaction.editReply(`Added page ${count} to ${target.url}.`);
        }
        if (action === 'update') {
            await service.updatePaginationPage(target, interaction.options.getInteger('page'), interaction.options.getString('script'));
            return interaction.editReply(`Updated page ${interaction.options.getInteger('page')} in ${target.url}.`);
        }
        if (action === 'remove') {
            await service.removePaginationPage(target, interaction.options.getInteger('page'));
            return interaction.editReply(`Removed page ${interaction.options.getInteger('page')} from ${target.url}.`);
        }
        if (action === 'delete') { await service.deletePagination(target); return interaction.editReply(`Removed pagination from ${target.url}.`); }
        await service.restorePaginationReactions(target);
        return interaction.editReply(`Restored navigation reactions on ${target.url}.`);
    }
};
