const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { boundedList, configOf } = require('../../services/roleAutomationService');
const { messageToScript, sourceReply } = require('../../services/richContentService');

const named = option => option.setName('name').setDescription('Saved embed name').setRequired(true).setMaxLength(32);
const script = option => option.setName('script').setDescription('Message, embed, or Components V2 script').setRequired(true).setMaxLength(6000);

async function fetchMessage(interaction, input) {
    const match = /(?:channels\/\d+\/(\d+)\/)?(\d+)\/?$/.exec(String(input));
    if (!match) return null;
    const channel = match[1] ? await interaction.guild?.channels.fetch(match[1]).catch(() => null) : interaction.channel;
    return channel?.messages?.fetch(match[2]).catch(() => null);
}

module.exports = {
    data: new SlashCommandBuilder().setName('embed').setDescription('Create and manage rich messages')
        .addSubcommand(sub => sub.setName('create').setDescription('Send a script in this channel').addStringOption(script))
        .addSubcommand(sub => sub.setName('copy').setDescription('Copy a message or published embed')
            .addStringOption(option => option.setName('message').setDescription('Message link or ID'))
            .addStringOption(option => option.setName('published').setDescription('Published embed ID'))
            .addStringOption(option => option.setName('save_as').setDescription('Name for the copied published embed').setMaxLength(32)))
        .addSubcommand(sub => sub.setName('save').setDescription('Save a reusable embed').addStringOption(named).addStringOption(script))
        .addSubcommand(sub => sub.setName('list').setDescription('List your saved embeds'))
        .addSubcommand(sub => sub.setName('raw').setDescription('Show saved embed source').addStringOption(named))
        .addSubcommand(sub => sub.setName('rename').setDescription('Rename a saved embed').addStringOption(named)
            .addStringOption(option => option.setName('new_name').setDescription('New name').setRequired(true).setMaxLength(32)))
        .addSubcommand(sub => sub.setName('remove').setDescription('Remove a saved embed').addStringOption(named))
        .addSubcommand(sub => sub.setName('publish').setDescription('Publish a saved embed for discovery').addStringOption(named)
            .addStringOption(option => option.setName('category').setDescription('Discovery category').setRequired(true).setMaxLength(32))
            .addStringOption(option => option.setName('description').setDescription('Public description').setMaxLength(200)))
        .addSubcommand(sub => sub.setName('published').setDescription('Browse published embeds')
            .addStringOption(option => option.setName('category').setDescription('Optional exact category').setMaxLength(32)))
        .addSubcommand(sub => sub.setName('unpublish').setDescription('Remove your published embed').addStringOption(named))
        .addSubcommand(sub => sub.setName('colors').setDescription('View server embed colors'))
        .addSubcommand(sub => sub.setName('setcolor').setDescription('Set a server embed color')
            .addStringOption(option => option.setName('type').setDescription('information, success, error, or warning').setRequired(true)
                .addChoices(...['information', 'success', 'error', 'warning'].map(value => ({ name: value, value }))))
            .addStringOption(option => option.setName('color').setDescription('Six-digit hex color').setRequired(true)))
        .addSubcommand(sub => sub.setName('resetcolors').setDescription('Reset all server embed colors')
            .addBooleanOption(option => option.setName('confirm').setDescription('Confirm reset').setRequired(true))),
    permissions: [], cooldown: 2, longRunning: true, deferEphemeral: true,
    async execute(interaction, client) {
        const service = client.richContentService;
        const action = interaction.options.getSubcommand();
        const name = interaction.options.getString('name');
        if (['colors', 'setcolor', 'resetcolors'].includes(action)) {
            if (!interaction.guild) return interaction.editReply('Server embed colors are unavailable in DMs.');
            if (action === 'colors') {
                const colors = service.getEmbedColors(interaction.guildId);
                return interaction.editReply(['information', 'success', 'error', 'warning']
                    .map(type => `**${type}:** ${colors[type] || 'default'}`).join('\n'));
            }
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.editReply('You need **Manage Server** to change embed colors.');
            if (action === 'setcolor') {
                const type = interaction.options.getString('type');
                const color = interaction.options.getString('color');
                service.setEmbedColor(interaction.guildId, type, color, interaction.user.id);
                return interaction.editReply(`Set **${type}** embeds to **${color}**.`);
            }
            if (!interaction.options.getBoolean('confirm')) return interaction.editReply('Reset cancelled; confirmation was not provided.');
            service.resetEmbedColors(interaction.guildId);
            return interaction.editReply('Reset all server embed colors.');
        }
        if (action === 'create') {
            if (!interaction.channel?.send) return interaction.editReply('Rich messages cannot be sent here.');
            const source = interaction.options.getString('script');
            await interaction.channel.send(service.render(source, { user: interaction.user, member: interaction.member,
                guild: interaction.guild, channel: interaction.channel }));
            return interaction.editReply('Rich message sent.');
        }
        if (action === 'copy') {
            const messageInput = interaction.options.getString('message');
            const published = interaction.options.getString('published');
            if (Boolean(messageInput) === Boolean(published)) return interaction.editReply('Provide exactly one message or published embed ID.');
            if (published) {
                const savedAs = service.copyPublishedEmbed(interaction.user.id, published, interaction.options.getString('save_as'));
                return interaction.editReply(`Copied published embed to **${savedAs}**.`);
            }
            const message = await fetchMessage(interaction, messageInput);
            if (!message) return interaction.editReply('That message was not found or is not accessible.');
            return interaction.editReply(sourceReply(messageToScript(message)));
        }
        if (action === 'save') {
            const source = interaction.options.getString('script');
            service.render(source, { user: interaction.user, member: interaction.member, guild: interaction.guild, channel: interaction.channel });
            await service.saveEmbed(interaction.user.id, name, source);
            return interaction.editReply(`Saved embed **${name.toLowerCase()}**.`);
        }
        if (action === 'list') return interaction.editReply({ content: boundedList(service.listEmbeds(interaction.user.id)
            .map(rule => `\`${rule.key}\``), 'You have no saved embeds.'), allowedMentions: { parse: [] } });
        if (action === 'published') {
            const lines = service.listPublished(interaction.options.getString('category') || '').map(rule => {
                const config = configOf(rule);
                return `\`${rule.key}\` — **${config.category}** — ${config.description || 'No description'} — ${config.copies || 0} copies`;
            });
            return interaction.editReply({ content: boundedList(lines, 'No published embeds found.'), allowedMentions: { parse: [] } });
        }
        const saved = name && service.getEmbed(interaction.user.id, name);
        if (['raw', 'rename', 'remove', 'publish'].includes(action) && !saved) return interaction.editReply(`Saved embed **${name}** was not found.`);
        if (action === 'raw') return interaction.editReply(sourceReply(configOf(saved).script, `${saved.key}.txt`));
        if (action === 'rename') {
            const next = interaction.options.getString('new_name');
            service.renameEmbed(interaction.user.id, name, next);
            return interaction.editReply(`Renamed **${name}** to **${next.toLowerCase()}**.`);
        }
        if (action === 'remove') { service.removeEmbed(interaction.user.id, name); return interaction.editReply(`Removed **${name}**.`); }
        if (action === 'publish') {
            await service.publishEmbed(interaction.user.id, name, interaction.options.getString('category'), interaction.options.getString('description'));
            return interaction.editReply(`Published **${name}**.`);
        }
        if (!service.unpublishEmbed(interaction.user.id, name)) return interaction.editReply(`Published embed **${name}** was not found.`);
        return interaction.editReply(`Unpublished **${name}**.`);
    }
};
