const sharp = require('sharp');
let PNG;

jest.mock('../src/database', () => ({
    db: {
        select: jest.fn(() => ({ from: () => ({ where: jest.fn().mockResolvedValue([]) }) })),
        insert: jest.fn(() => ({ values: jest.fn(() => ({ onConflictDoUpdate: jest.fn().mockResolvedValue(undefined) })) }))
    }
}));
jest.mock('../src/utils/dbLogger', () => ({
    dbLog: { select: jest.fn().mockResolvedValue([]), insert: jest.fn(async (_table, operation) => operation?.()) }
}));

beforeAll(async () => {
    PNG = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ff0000' } }).png().toBuffer();
});

async function expectEncoded(output) {
    const metadata = await sharp(output.buffer).metadata();
    expect(metadata).toMatchObject({ format: output.format, width: output.width, height: output.height });
    expect(output.width).toBeGreaterThan(0);
    expect(output.height).toBeGreaterThan(0);
    if (output.format === 'png') expect(output.buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    if (output.format === 'jpeg') expect(output.buffer.subarray(0, 2).toString('hex')).toBe('ffd8');
    if (output.format === 'gif') expect(output.buffer.subarray(0, 6).toString('ascii')).toMatch(/^GIF8[79]a$/);
    if (output.format === 'webp') {
        expect(output.buffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
        expect(output.buffer.subarray(8, 12).toString('ascii')).toBe('WEBP');
    }
}

function media() {
    return {
        processImage: jest.fn((input, processor) => processor({
            buffer: PNG, format: 'png', contentType: 'image/png', width: 2, height: 2
        }, '/tmp', new AbortController().signal))
    };
}

describe('image manipulation service', () => {
    test('runs transforms and named effects through the shared media queue', async () => {
        const { EFFECTS, ImageManipulationService } = require('../src/services/imageManipulationService');
        const shared = media();
        const service = new ImageManipulationService({ media: shared });

        const resized = await service.transform('source', 'resize', { width: 64, height: 64 }, 1024 * 1024);
        const outputs = [];
        for (const effect of EFFECTS) outputs.push(await service.effect('source', effect, 1024 * 1024));
        for (const format of ['png', 'jpeg', 'webp', 'gif']) {
            outputs.push(await service.transform('source', 'convert', { format }, 1024 * 1024));
        }
        outputs.push(await service.transform('source', 'rotate', { angle: 45 }, 1024 * 1024));
        outputs.push(await service.transform('source', 'compress', { quality: 60 }, 1024 * 1024));

        expect(shared.processImage).toHaveBeenCalledTimes(23);
        expect(resized).toMatchObject({ format: 'png', contentType: 'image/png', width: 2, height: 2 });
        expect(resized.buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
        expect(outputs.every(output => output.buffer.length <= 1024 * 1024)).toBe(true);
        expect(outputs.map(output => output.format)).toEqual(expect.arrayContaining(['png', 'jpeg', 'webp', 'gif']));
        for (const output of outputs) await expectEncoded(output);
        expect(resized.buffer.length).toBeLessThanOrEqual(1024 * 1024);
    });

    test('creates safe generic memes and extracts a dominant color', async () => {
        const { ImageManipulationService } = require('../src/services/imageManipulationService');
        const service = new ImageManipulationService({ media: media() });

        const caption = await service.meme('source', 'caption', {
            first: '<script>alert(1)</script>', second: 'bottom & text'
        }, 1024 * 1024);
        const compare = await service.meme('source', 'compare', {
            first: 'before', second: 'after'
        }, 1024 * 1024);
        const dominant = await service.dominant('source', 1024 * 1024);

        expect(caption).toMatchObject({ format: 'png', contentType: 'image/png' });
        expect(compare).toMatchObject({ format: 'png', contentType: 'image/png' });
        expect(dominant.hex).toMatch(/^#[0-9A-F]{6}$/);
        expect(dominant.buffer.length).toBeLessThanOrEqual(1024 * 1024);
        await expectEncoded(caption);
        await expectEncoded(compare);
        await expectEncoded(dominant);
    });

    test('rejects unknown work and invalid output bounds before processing', async () => {
        const { ImageManipulationService } = require('../src/services/imageManipulationService');
        const shared = media();
        const service = new ImageManipulationService({ media: shared });

        await expect(service.effect('source', 'not-real', 1024 * 1024)).rejects.toThrow('effect');
        await expect(service.transform('source', 'resize', { width: 0 }, 1024 * 1024)).rejects.toThrow('width');
        await expect(service.transform('source', 'rotate', { angle: 1 }, 0)).rejects.toThrow('output');
        expect(shared.processImage).not.toHaveBeenCalled();
    });
});

describe('/image command', () => {
    test('exposes grouped slash paths and the implemented effect choices', () => {
        const command = require('../src/commands/fun/image').data.toJSON();
        const groups = Object.fromEntries(command.options.map(group => [
            group.name, group.options.map(subcommand => subcommand.name)
        ]));

        expect(groups).toEqual({
            transform: ['resize', 'rotate', 'compress', 'convert'],
            effect: ['apply'],
            meme: ['caption', 'compare'],
            inspect: ['dominant']
        });
        const apply = command.options.find(option => option.name === 'effect').options[0];
        const effects = apply.options.find(option => option.name === 'effect').choices.map(choice => choice.value);
        expect(effects).toEqual([
            'blur', 'deepfry', 'flip', 'flop', 'grayscale', 'half-invert', 'invert',
            'normalize', 'pixelate', 'saturate', 'sepia', 'sharpen', 'shear',
            'stretch', 'threshold', 'tint'
        ]);
        for (const group of command.options) {
            for (const subcommand of group.options) {
                const firstOptional = subcommand.options.findIndex(option => !option.required);
                if (firstOptional >= 0) expect(subcommand.options.slice(firstOptional).every(option => !option.required)).toBe(true);
            }
        }
    });

    test('uses Discord-native sources and the interaction upload ceiling', async () => {
        const command = require('../src/commands/fun/image');
        const result = {
            buffer: PNG, filename: 'bytebot.png', contentType: 'image/png', format: 'png', width: 1, height: 1
        };
        const transform = jest.fn(async () => result);
        const attachment = { url: 'https://cdn.discordapp.com/image.png' };
        const values = { image: attachment, width: 50, height: 40 };
        const interaction = {
            attachmentSizeLimit: 5 * 1024 * 1024,
            options: {
                getSubcommandGroup: () => 'transform', getSubcommand: () => 'resize',
                getAttachment: name => values[name] || null,
                getUser: () => null,
                getString: name => values[name] || null,
                getInteger: name => values[name] ?? null,
                getNumber: name => values[name] ?? null
            },
            user: { displayAvatarURL: () => 'https://cdn.discordapp.com/self.png' },
            editReply: jest.fn()
        };

        await command.execute(interaction, { imageManipulationService: { transform } });

        expect(transform).toHaveBeenCalledWith(attachment, 'resize', { width: 50, height: 40 }, 5 * 1024 * 1024);
        expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
            files: [{ attachment: PNG, name: 'bytebot.png' }], allowedMentions: { parse: [] }
        }));
    });

    test('denies missing Attach Files before deferral or processing', async () => {
        const { PermissionFlagsBits } = require('discord.js');
        const interactionCreate = require('../src/events/interactionCreate');
        const command = require('../src/commands/fun/image');
        const execute = jest.spyOn(command, 'execute');
        const reply = jest.fn();
        const deferReply = jest.fn();
        const interaction = {
            id: 'image-attach-denial', commandName: 'image', guildId: 'guild-1', channel: {},
            guild: { id: 'guild-1', members: { me: { permissionsIn: () => ({
                has: permission => permission !== PermissionFlagsBits.AttachFiles
            }) } } },
            user: { id: 'user-1' }, member: { permissions: { has: () => false }, roles: { cache: new Map() } },
            options: { getSubcommandGroup: () => 'effect', getSubcommand: () => 'apply' },
            isAutocomplete: () => false, isButton: () => false, isAnySelectMenu: () => false,
            isModalSubmit: () => false, isUserContextMenuCommand: () => false,
            isMessageContextMenuCommand: () => false, isChatInputCommand: () => true,
            reply, deferReply
        };

        await interactionCreate.execute(interaction, { commands: new Map([['image', command]]), cooldowns: new Map() });

        expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Attach Files') }));
        expect(deferReply).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
        execute.mockRestore();
    });
});
