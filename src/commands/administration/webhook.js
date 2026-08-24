const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { boundedList, configOf } = require('../../services/roleAutomationService');

const identifier = option => option.setName('id').setDescription('ByteBot webhook short ID').setRequired(true).setMaxLength(16);
const script = option => option.setName('script').setDescription('Message, embed, or Components V2 script').setRequired(true).setMaxLength(6000);

module.exports = {
    data: new SlashCommandBuilder().setName('webhook').setDescription('Manage ByteBot-owned webhooks')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageWebhooks).setDMPermission(false)
        .addSubcommand(sub => sub.setName('create').setDescription('Create a managed webhook')
            .addStringOption(option => option.setName('name').setDescription('Webhook name').setRequired(true).setMinLength(1).setMaxLength(80))
            .addChannelOption(option => option.setName('channel').setDescription('Target channel; defaults to this channel')))
        .addSubcommand(sub => sub.setName('send').setDescription('Send through a managed webhook').addStringOption(identifier).addStringOption(script))
        .addSubcommand(sub => sub.setName('edit').setDescription('Edit a tracked webhook message').addChannelOption(option => option.setName('channel').setDescription('Message channel').setRequired(true))
            .addStringOption(option => option.setName('message_id').setDescription('Webhook message ID').setRequired(true)).addStringOption(script))
        .addSubcommand(sub => sub.setName('delete').setDescription('Delete a managed webhook').addStringOption(identifier))
        .addSubcommand(sub => sub.setName('avatar').setDescription('Set a managed webhook avatar').addStringOption(identifier)
            .addAttachmentOption(option => option.setName('image').setDescription('Image up to 8 MiB').setRequired(true)))
        .addSubcommand(sub => sub.setName('list').setDescription('List managed webhooks')),
    permissions: [PermissionFlagsBits.ManageWebhooks], cooldown: 2, longRunning: true, deferEphemeral: true,
    async execute(interaction, client) {
        const service = client.richContentService;
        const action = interaction.options.getSubcommand();
        if (action === 'list') {
            const lines = service.listWebhooks(interaction.guildId).map(rule => {
                const config = configOf(rule);
                return `\`${rule.key}\` — **${config.name}** — <#${config.channelId}>`;
            });
            return interaction.editReply({ content: boundedList(lines, 'No managed webhooks found.'), allowedMentions: { parse: [] } });
        }
        if (action === 'create') {
            const channel = interaction.options.getChannel('channel') || interaction.channel;
            const rule = await service.createWebhook(interaction.guild, channel, interaction.options.getString('name'), interaction.user.id);
            return interaction.editReply(`Created webhook \`${rule.key}\` in ${channel}.`);
        }
        const id = interaction.options.getString('id');
        if (action === 'send') {
            const sent = await service.sendWebhook(interaction.guild, id, interaction.options.getString('script'), {
                user: interaction.user, member: interaction.member, guild: interaction.guild
            });
            return interaction.editReply(`Sent webhook message \`${sent.id}\`.`);
        }
        if (action === 'edit') {
            await service.editWebhookMessage(interaction.guild, interaction.options.getChannel('channel'),
                interaction.options.getString('message_id'), interaction.options.getString('script'), {
                    user: interaction.user, member: interaction.member, guild: interaction.guild
                });
            return interaction.editReply(`Edited webhook message \`${interaction.options.getString('message_id')}\`.`);
        }
        if (action === 'avatar') {
            await service.setWebhookAvatar(interaction.guild, id, interaction.options.getAttachment('image'));
            return interaction.editReply(`Updated webhook \`${id}\` avatar.`);
        }
        await service.deleteWebhook(interaction.guild, id);
        return interaction.editReply(`Deleted webhook \`${id}\`.`);
    }
};
