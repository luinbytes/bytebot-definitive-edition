const { ApplicationCommandOptionType } = require('discord.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const command = require('../src/commands/utility/ai');

function interaction(action) {
    return {
        options: {
            getSubcommand: jest.fn().mockReturnValue(action),
            getAttachment: jest.fn().mockReturnValue({ url: 'https://cdn.discordapp.com/image.png', size: 100 }),
            getString: jest.fn().mockReturnValue('Hello from ByteBot')
        },
        editReply: jest.fn().mockResolvedValue()
    };
}

test('/ai exposes only bounded local OCR and TTS paths', async () => {
    const json = command.data.toJSON();
    expect(json).toMatchObject({ name: 'ai', dm_permission: true });
    expect(json.options.map(option => option.name)).toEqual(['ocr', 'tts']);
    expect(json.options[0].options[0]).toMatchObject({
        name: 'image', type: ApplicationCommandOptionType.Attachment, required: true
    });
    expect(json.options[1].options[0]).toMatchObject({ name: 'text', required: true, max_length: 2000 });
    expect(command.sourceCategories).toEqual(['Information', 'Utility']);
    expect(command.longRunning).toBe(true);

    const ocrInteraction = interaction('ocr');
    const ocr = jest.fn().mockResolvedValue('Read locally');
    await command.execute(ocrInteraction, { aiMediaService: { ocr } });
    expect(ocr).toHaveBeenCalledWith(expect.objectContaining({ size: 100 }));
    expect(ocrInteraction.editReply.mock.calls[0][0]).toMatchObject({ allowedMentions: { parse: [] } });
    expect(ocrInteraction.editReply.mock.calls[0][0].embeds[0].data).toMatchObject({
        title: 'Extracted Text', description: 'Read locally', footer: { text: 'Source: Local Tesseract OCR' }
    });

    const ttsInteraction = interaction('tts');
    const tts = jest.fn().mockResolvedValue(Buffer.from('RIFF----WAVE'));
    await command.execute(ttsInteraction, { aiMediaService: { tts } });
    expect(tts).toHaveBeenCalledWith('Hello from ByteBot');
    expect(ttsInteraction.editReply.mock.calls[0][0]).toMatchObject({
        content: 'Synthetic speech generated locally with eSpeak NG.',
        allowedMentions: { parse: [] }
    });
    expect(ttsInteraction.editReply.mock.calls[0][0].files[0].name).toBe('speech.wav');
});

test('local AI media tools invoke fixed binaries with bounded local output', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bytebot-ai-test-'));
    const executable = (name, source) => {
        const filename = path.join(directory, name);
        fs.writeFileSync(filename, `#!/bin/sh\n${source}`);
        fs.chmodSync(filename, 0o755);
        return filename;
    };
    const ocrPath = executable('ocr', "printf 'Read by Tesseract'");
    const ttsPath = executable('tts', "while [ \"$1\" != '-w' ]; do shift; done; shift; printf 'RIFF----WAVE' > \"$1\"; cat >/dev/null");
    const signal = new AbortController().signal;
    const media = { processImage: (_input, processor) => processor({ buffer: Buffer.from('image'), format: 'png' }, directory, signal) };
    const queue = { run: processor => processor(directory, signal) };
    const { LocalAiMediaService } = require('../src/services/localAiMediaService');
    const service = new LocalAiMediaService({ media, queue, ocrPath, ttsPath });

    await expect(service.ocr({ url: 'https://example.com/image.png' })).resolves.toBe('Read by Tesseract');
    await expect(service.tts('Hello')).resolves.toEqual(Buffer.from('RIFF----WAVE'));
    await expect(service.tts('x'.repeat(2001))).rejects.toThrow('2,000');

    fs.rmSync(directory, { recursive: true, force: true });
});
