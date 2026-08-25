const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { resolveImageInput } = require('../../services/mediaService');
const { EFFECTS, ImageManipulationService, MAX_OUTPUT_BYTES } = require('../../services/imageManipulationService');

function source(subcommand) {
    return subcommand
        .addAttachmentOption(option => option.setName('image').setDescription('PNG, JPG, GIF, or WebP up to 8 MB'))
        .addUserOption(option => option.setName('user').setDescription('Use this member\'s avatar'))
        .addStringOption(option => option.setName('url').setDescription('Public HTTP(S) image URL').setMaxLength(2048));
}

function choice(name) {
    return { name: name.replace(/(^|-)(\w)/g, (_match, prefix, letter) => `${prefix ? ' ' : ''}${letter.toUpperCase()}`), value: name };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('image')
        .setDescription('Transform images, apply effects, and make memes')
        .addSubcommandGroup(group => group.setName('transform').setDescription('Resize, rotate, compress, or convert')
            .addSubcommand(subcommand => source(subcommand.setName('resize').setDescription('Resize an image')
                .addIntegerOption(option => option.setName('width').setDescription('Maximum width').setRequired(true).setMinValue(1).setMaxValue(4096))
                .addIntegerOption(option => option.setName('height').setDescription('Optional maximum height').setMinValue(1).setMaxValue(4096))))
            .addSubcommand(subcommand => source(subcommand.setName('rotate').setDescription('Rotate an image')
                .addNumberOption(option => option.setName('angle').setDescription('Angle in degrees').setRequired(true).setMinValue(-360).setMaxValue(360))))
            .addSubcommand(subcommand => source(subcommand.setName('compress').setDescription('Compress an image as WebP'))
                .addIntegerOption(option => option.setName('quality').setDescription('Quality from 1 to 100').setMinValue(1).setMaxValue(100)))
            .addSubcommand(subcommand => source(subcommand.setName('convert').setDescription('Convert an image format')
                .addStringOption(option => option.setName('format').setDescription('Output format').setRequired(true).addChoices(
                    { name: 'PNG', value: 'png' }, { name: 'JPEG', value: 'jpeg' },
                    { name: 'WebP', value: 'webp' }, { name: 'GIF', value: 'gif' }
                )))))
        .addSubcommandGroup(group => group.setName('effect').setDescription('Apply a local image effect')
            .addSubcommand(subcommand => source(subcommand.setName('apply').setDescription('Apply a named effect')
                .addStringOption(option => option.setName('effect').setDescription('Effect to apply').setRequired(true)
                    .addChoices(...[...EFFECTS].sort().map(choice))))))
        .addSubcommandGroup(group => group.setName('meme').setDescription('Create a ByteBot-owned meme layout')
            .addSubcommand(subcommand => source(subcommand.setName('caption').setDescription('Add caption bands')
                .addStringOption(option => option.setName('top').setDescription('Top caption').setRequired(true).setMaxLength(120))
                .addStringOption(option => option.setName('bottom').setDescription('Optional bottom caption').setMaxLength(120))))
            .addSubcommand(subcommand => source(subcommand.setName('compare').setDescription('Create a two-text comparison card')
                .addStringOption(option => option.setName('first').setDescription('First label').setRequired(true).setMaxLength(120))
                .addStringOption(option => option.setName('second').setDescription('Second label').setRequired(true).setMaxLength(120)))))
        .addSubcommandGroup(group => group.setName('inspect').setDescription('Inspect image properties')
            .addSubcommand(subcommand => source(subcommand.setName('dominant').setDescription('Show the dominant color')))),

    cooldown: 3,
    longRunning: true,
    botPermissions: [PermissionFlagsBits.AttachFiles],

    async execute(interaction, client) {
        const attachment = interaction.options.getAttachment('image');
        const user = interaction.options.getUser('user');
        const url = interaction.options.getString('url');
        if ([attachment, user, url].filter(Boolean).length > 1) throw new Error('Provide only one image, user, or URL.');
        const input = resolveImageInput({ attachment, member: user, url, user: interaction.user });
        const limit = Math.min(interaction.attachmentSizeLimit || MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES);
        const group = interaction.options.getSubcommandGroup();
        const action = interaction.options.getSubcommand();
        const service = client.imageManipulationService || (client.imageManipulationService = new ImageManipulationService({
            queue: client.imageProcessingQueue
        }));
        let result;

        if (group === 'transform') {
            const options = action === 'resize'
                ? { width: interaction.options.getInteger('width'), height: interaction.options.getInteger('height') }
                : action === 'rotate'
                    ? { angle: interaction.options.getNumber('angle') }
                    : action === 'compress'
                        ? { quality: interaction.options.getInteger('quality') }
                        : { format: interaction.options.getString('format') };
            result = await service.transform(input, action, options, limit);
        } else if (group === 'effect') {
            result = await service.effect(input, interaction.options.getString('effect'), limit);
        } else if (group === 'meme') {
            result = await service.meme(input, action, action === 'caption'
                ? { first: interaction.options.getString('top'), second: interaction.options.getString('bottom') }
                : { first: interaction.options.getString('first'), second: interaction.options.getString('second') }, limit);
        } else {
            result = await service.dominant(input, limit);
        }

        return interaction.editReply({
            content: result.hex ? `Dominant color: \`${result.hex}\`` : undefined,
            files: [{ attachment: result.buffer, name: result.filename }],
            allowedMentions: { parse: [] }
        });
    }
};
