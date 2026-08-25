const { AttachmentBuilder, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');
const { UserFacingError } = require('../../utils/errorHandlerUtil');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ai')
        .setDescription('Run local OCR and text-to-speech tools')
        .setDMPermission(true)
        .addSubcommand(sub => sub.setName('ocr').setDescription('Extract text from an image.')
            .addAttachmentOption(option => option.setName('image').setDescription('Image to read').setRequired(true)))
        .addSubcommand(sub => sub.setName('tts').setDescription('Turn text into synthetic speech')
            .addStringOption(option => option.setName('text').setDescription('Text to speak').setRequired(true).setMaxLength(2000))),
    sourceCategories: ['Information', 'Utility'],
    longRunning: true,
    cooldown: 5,

    async execute(interaction, client) {
        if (!client.aiMediaService) throw new UserFacingError('Local AI media tools are unavailable.');
        const action = interaction.options.getSubcommand();
        const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles];
        if (action === 'ocr') required.push(PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks);
        if (interaction.guild && !interaction.guild.members.me.permissionsIn(interaction.channel).has(required)) {
            throw new UserFacingError(action === 'ocr'
                ? 'I need View Channel, Send Messages, Read Message History, Embed Links, and Attach Files permissions to run OCR.'
                : 'I need View Channel, Send Messages, and Attach Files permissions to generate speech.');
        }

        if (action === 'ocr') {
            const text = await client.aiMediaService.ocr(interaction.options.getAttachment('image', true));
            if (!text) throw new UserFacingError('No text could be extracted from the image.');
            const embed = embeds.brand('Extracted Text', text.length <= 4000 ? text : 'The complete extracted text is attached.')
                .setFooter({ text: 'Source: Local Tesseract OCR' });
            return interaction.editReply({
                embeds: [embed],
                files: text.length > 4000 ? [new AttachmentBuilder(Buffer.from(text), { name: 'ocr.txt' })] : [],
                allowedMentions: { parse: [] }
            });
        }

        const audio = await client.aiMediaService.tts(interaction.options.getString('text', true));
        return interaction.editReply({
            content: 'Synthetic speech generated locally with eSpeak NG.',
            files: [new AttachmentBuilder(audio, { name: 'speech.wav' })],
            allowedMentions: { parse: [] }
        });
    }
};
