const fs = require('fs');

const png = (width = 2, height = 3) => {
    const buffer = Buffer.alloc(24);
    Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(buffer);
    buffer.writeUInt32BE(width, 16);
    buffer.writeUInt32BE(height, 20);
    return buffer;
};

describe('media service', () => {
    test('resolves the documented image-source order', () => {
        const { resolveImageInput } = require('../src/services/mediaService');
        const attachment = { url: 'https://cdn.discordapp.com/direct.png' };
        const member = { displayAvatarURL: () => 'https://cdn.discordapp.com/member.png' };
        const message = {
            attachments: { first: () => ({ url: 'https://cdn.discordapp.com/reply.png' }) },
            stickers: { first: () => null }, embeds: []
        };
        const user = { displayAvatarURL: () => 'https://cdn.discordapp.com/self.png' };

        expect(resolveImageInput({ attachment, member, message, url: 'https://example.com/url.png', user })).toBe(attachment);
        expect(resolveImageInput({ member, message, url: 'https://example.com/url.png', user })).toEqual({ url: 'https://cdn.discordapp.com/member.png' });
        expect(resolveImageInput({ message, url: 'https://example.com/url.png', user })).toEqual({ url: 'https://cdn.discordapp.com/reply.png' });
        expect(resolveImageInput({ url: 'https://example.com/url.png', user })).toEqual({ url: 'https://example.com/url.png' });
        expect(resolveImageInput({ user })).toEqual({ url: 'https://cdn.discordapp.com/self.png' });
        expect(() => resolveImageInput({})).toThrow('image');
    });

    test('pins public downloads and verifies bytes, dimensions, and declared metadata', async () => {
        const { MediaService } = require('../src/services/mediaService');
        const body = png();
        const fetch = jest.fn(async () => ({
            statusCode: 200,
            headers: { 'content-type': 'image/png', 'content-length': String(body.length) },
            arrayBuffer: async () => body
        }));
        const service = new MediaService({
            fetch,
            lookup: jest.fn(async () => [{ address: '93.184.216.34', family: 4 }])
        });

        await expect(service.image({
            url: 'https://example.com/image.png', contentType: 'image/png', size: body.length,
            width: 2, height: 3
        })).resolves.toEqual({ buffer: body, format: 'png', contentType: 'image/png', width: 2, height: 3 });
        expect(fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ address: '93.184.216.34', family: 4 }));

        await expect(service.image({ url: 'https://example.com/image.png', width: 5000, height: 3 })).rejects.toThrow('dimensions');
        await expect(service.image('http://127.0.0.1/image.png')).rejects.toThrow('public address');
        await expect(service.image('http://[::ffff:127.0.0.1]/image.png')).rejects.toThrow('public address');
        await expect(service.image('http://[0:0:0:0:0:0:0:1]/image.png')).rejects.toThrow('public address');

        fetch.mockResolvedValueOnce({
            statusCode: 200,
            headers: { 'content-type': 'image/jpeg', 'content-length': String(body.length) },
            arrayBuffer: async () => body
        });
        await expect(service.image('https://example.com/wrong.jpg')).rejects.toThrow('match');
    });

    test('bounds timed metadata before processing', () => {
        const { validateMediaMetadata } = require('../src/services/mediaService');
        expect(() => validateMediaMetadata({ size: 10, duration: 601 }, { maxDurationSeconds: 600 })).toThrow('duration');
        expect(() => validateMediaMetadata({ size: 10 }, { maxDurationSeconds: 600, requireDuration: true })).toThrow('duration');
    });

    test('serializes processing and removes each temporary workspace', async () => {
        const { ProcessingQueue } = require('../src/services/mediaService');
        const queue = new ProcessingQueue(1);
        const order = [];
        let release;
        let markStarted;
        const gate = new Promise(resolve => { release = resolve; });
        const started = new Promise(resolve => { markStarted = resolve; });

        const first = queue.run(async directory => {
            order.push('first-start');
            markStarted();
            expect(fs.existsSync(directory)).toBe(true);
            await gate;
            order.push('first-end');
            return directory;
        });
        const second = queue.run(async directory => {
            order.push('second');
            return directory;
        });
        await started;
        expect(order).toEqual(['first-start']);
        release();
        const [firstDirectory, secondDirectory] = await Promise.all([first, second]);

        expect(order).toEqual(['first-start', 'first-end', 'second']);
        expect(fs.existsSync(firstDirectory)).toBe(false);
        expect(fs.existsSync(secondDirectory)).toBe(false);
    });
});
