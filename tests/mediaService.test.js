const fs = require('fs');

const VALID_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlS4AAAAASUVORK5CYII=', 'base64');

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
        const body = VALID_PNG;
        const fetch = jest.fn(async () => ({
            statusCode: 200,
            headers: { 'content-type': 'image/png', 'content-length': String(body.length) },
            async *[Symbol.asyncIterator]() { yield body; }
        }));
        const service = new MediaService({
            fetch,
            lookup: jest.fn(async () => [{ address: '93.184.216.34', family: 4 }])
        });

        await expect(service.image({
            url: 'https://example.com/image.png', contentType: 'image/png', size: body.length,
            width: 1, height: 1
        })).resolves.toEqual({ buffer: body, format: 'png', contentType: 'image/png', width: 1, height: 1 });
        expect(fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ address: '93.184.216.34', family: 4 }));

        await expect(service.image({ url: 'https://example.com/image.png', width: 5000, height: 3 })).rejects.toThrow('dimensions');
        await expect(service.image('http://127.0.0.1/image.png')).rejects.toThrow('public address');
        await expect(service.image('http://[::ffff:127.0.0.1]/image.png')).rejects.toThrow('public address');
        await expect(service.image('http://[0:0:0:0:0:0:0:1]/image.png')).rejects.toThrow('public address');
        await expect(service.image('http://192.0.0.1/image.png')).rejects.toThrow('public address');
        await expect(service.image('http://[2001:2::1]/image.png')).rejects.toThrow('public address');
        await expect(service.image('http://[2001:10::1]/image.png')).rejects.toThrow('public address');

        fetch.mockResolvedValueOnce({
            statusCode: 200,
            headers: { 'content-type': 'image/jpeg', 'content-length': String(body.length) },
            async *[Symbol.asyncIterator]() { yield body; }
        });
        await expect(service.image('https://example.com/wrong.jpg')).rejects.toThrow('match');
    });

    test('bounds timed metadata before processing', () => {
        const { validateMediaMetadata } = require('../src/services/mediaService');
        expect(() => validateMediaMetadata({ size: 10, duration: 601 }, { maxDurationSeconds: 600 })).toThrow('duration');
        expect(() => validateMediaMetadata({ size: 10 }, { maxDurationSeconds: 600, requireDuration: true })).toThrow('duration');
        expect(() => validateMediaMetadata({ size: 10 }, { maxBytes: 0 })).toThrow('positive');
    });

    test('rejects redirects, private DNS answers, and streamed overflow', async () => {
        const { MAX_IMAGE_BYTES, MediaService } = require('../src/services/mediaService');
        const destroy = jest.fn();
        const fetch = jest.fn(async () => ({ statusCode: 302, headers: {}, destroy }));
        const lookup = jest.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
        const service = new MediaService({ fetch, lookup });
        await expect(service.image('https://example.com/image.png')).rejects.toThrow('download failed');
        expect(destroy).toHaveBeenCalled();

        lookup.mockResolvedValueOnce([
            { address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }
        ]);
        await expect(service.image('https://example.com/image.png')).rejects.toThrow('public address');

        fetch.mockResolvedValueOnce({
            statusCode: 200, headers: { 'content-type': 'image/png' }, destroy,
            async *[Symbol.asyncIterator]() { yield Buffer.alloc(MAX_IMAGE_BYTES + 1); }
        });
        await expect(service.image('https://example.com/image.png')).rejects.toThrow('8 MB');
        expect(destroy).toHaveBeenCalledTimes(2);
    });

    test('applies the download deadline to DNS resolution', async () => {
        const { MediaService } = require('../src/services/mediaService');
        const service = new MediaService({ lookup: () => new Promise(() => {}), timeoutMs: 20 });
        await expect(service.image('https://example.com/image.png')).rejects.toThrow('timed out');
    });

    test('rejects non-streaming responses before buffering them', async () => {
        const { MediaService } = require('../src/services/mediaService');
        const arrayBuffer = jest.fn();
        const service = new MediaService({
            lookup: async () => [{ address: '93.184.216.34', family: 4 }],
            fetch: async () => ({
                statusCode: 200, headers: { 'content-type': 'image/png' }, arrayBuffer
            })
        });
        await expect(service.image('https://example.com/image.png')).rejects.toThrow('bounded response stream');
        expect(arrayBuffer).not.toHaveBeenCalled();
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

    test('processImage applies the queue and passes validated media, workspace, and signal', async () => {
        const { MediaService } = require('../src/services/mediaService');
        const service = new MediaService({
            lookup: async () => [{ address: '93.184.216.34', family: 4 }],
            fetch: async () => ({
                statusCode: 200,
                headers: { 'content-type': 'image/png', 'content-length': String(VALID_PNG.length) },
                async *[Symbol.asyncIterator]() { yield VALID_PNG; }
            })
        });
        let workspace;
        await expect(service.processImage('https://example.com/image.png', (image, directory, signal) => {
            workspace = directory;
            expect(image).toMatchObject({ format: 'png', width: 1, height: 1 });
            expect(fs.existsSync(directory)).toBe(true);
            expect(signal.aborted).toBe(false);
            return 'processed';
        })).resolves.toBe('processed');
        expect(fs.existsSync(workspace)).toBe(false);
    });

    test('rejects excess queued work and aborts a timed-out processor', async () => {
        const { ProcessingQueue } = require('../src/services/mediaService');
        const queue = new ProcessingQueue(1, { maxPending: 2, timeoutMs: 1000 });
        let observedSignal;
        const blocked = queue.run((_directory, signal) => {
            observedSignal = signal;
            return new Promise(resolve => setTimeout(resolve, 1100));
        });
        const queuedTask = jest.fn();
        const queued = queue.run(queuedTask);
        await expect(queue.run(() => {})).rejects.toThrow('full');
        const [blockedResult, queuedResult] = await Promise.allSettled([blocked, queued]);
        expect(blockedResult.reason.message).toContain('restart ByteBot');
        expect(queuedResult.reason.message).toContain('restart ByteBot');
        await expect(queue.run(() => {})).rejects.toThrow('restart ByteBot');
        expect(queuedTask).not.toHaveBeenCalled();
        expect(observedSignal.aborted).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 150));
    });
});
