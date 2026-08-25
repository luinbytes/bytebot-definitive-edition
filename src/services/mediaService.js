const dns = require('dns').promises;
const fs = require('fs').promises;
const http = require('http');
const https = require('https');
const net = require('net');
const os = require('os');
const path = require('path');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_EDGE = 4096;
const MAX_IMAGE_PIXELS = 16 * 1024 * 1024;
const MAX_MEDIA_DURATION_SECONDS = 600;
const IMAGE_FORMATS = new Set(['png', 'jpeg', 'gif', 'webp']);

function boundedLimit(value, ceiling, label) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive number.`);
    return Math.min(value, ceiling);
}

function privateAddress(address) {
    address = String(address).replace(/^\[|\]$/g, '');
    if (net.isIP(address) === 4) {
        const [a, b, c] = address.split('.').map(Number);
        return a === 0 || a === 10 || a === 127 || a >= 224
            || (a === 100 && b >= 64 && b <= 127)
            || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99)))
            || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
            || (a === 203 && b === 0 && c === 113);
    }
    if (net.isIP(address) !== 6) return false;
    const dotted = address.slice(address.lastIndexOf(':') + 1);
    if (net.isIP(dotted) === 4) return privateAddress(dotted);
    const halves = address.toLowerCase().split('::');
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves[1] ? halves[1].split(':') : [];
    const words = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
        .map(word => parseInt(word || '0', 16));
    if (words.slice(0, 5).every(word => word === 0) && words[5] === 0xFFFF) {
        return privateAddress(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`);
    }
    if ((words[0] & 0xE000) !== 0x2000) return true;
    if (words[0] === 0x2001 && (words[1] & 0xFE00) === 0) {
        const exactAnycast = words[1] === 1 && words.slice(2, 7).every(word => word === 0)
            && [1, 2, 3].includes(words[7]);
        const globalAllocation = words[1] === 3
            || (words[1] === 4 && words[2] === 0x0112)
            || (words[1] & 0xFFF0) === 0x0020
            || (words[1] & 0xFFF0) === 0x0030;
        if (!exactAnycast && !globalAllocation) return true;
    }
    return (words[0] === 0x2001 && words[1] === 0x0DB8)
        || words[0] === 0x2002
        || (words[0] === 0x3FFF && (words[1] & 0xF000) === 0);
}

function pinnedFetch(url, { address, family, signal }) {
    const transport = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        const request = transport.get(url, {
            signal,
            lookup: (_hostname, _options, callback) => callback(null, address, family)
        }, resolve);
        request.on('error', reject);
    });
}

function normalizeType(type) {
    const match = /^image\/(png|jpe?g|gif|webp)$/i.exec(String(type || '').split(';')[0].trim());
    if (!match) return null;
    return match[1].toLowerCase().replace('jpg', 'jpeg');
}

function imageMetadata(buffer) {
    if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        && buffer.subarray(12, 16).toString() === 'IHDR') {
        return { format: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    const gif = buffer.subarray(0, 6).toString('ascii');
    if (buffer.length >= 10 && (gif === 'GIF87a' || gif === 'GIF89a')) {
        return { format: 'gif', width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    if (buffer.length >= 30 && buffer.subarray(0, 2).equals(Buffer.from([0xFF, 0xD8]))) {
        let offset = 2;
        while (offset + 8 < buffer.length) {
            if (buffer[offset++] !== 0xFF) continue;
            const marker = buffer[offset++];
            if (marker === 0xD8 || marker === 0xD9) continue;
            const length = buffer.readUInt16BE(offset);
            if (length < 2 || offset + length > buffer.length) break;
            if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(marker)) {
                return { format: 'jpeg', width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
            }
            offset += length;
        }
    }
    if (buffer.length >= 30 && buffer.subarray(0, 4).toString() === 'RIFF'
        && buffer.subarray(8, 12).toString() === 'WEBP') {
        const chunk = buffer.subarray(12, 16).toString();
        if (chunk === 'VP8X') {
            return {
                format: 'webp',
                width: 1 + buffer.readUIntLE(24, 3),
                height: 1 + buffer.readUIntLE(27, 3)
            };
        }
        if (chunk === 'VP8L' && buffer[20] === 0x2F) {
            const bits = buffer.readUInt32LE(21);
            return { format: 'webp', width: 1 + (bits & 0x3FFF), height: 1 + ((bits >>> 14) & 0x3FFF) };
        }
        if (chunk === 'VP8 ' && buffer.subarray(23, 26).equals(Buffer.from([0x9D, 0x01, 0x2A]))) {
            return { format: 'webp', width: buffer.readUInt16LE(26) & 0x3FFF, height: buffer.readUInt16LE(28) & 0x3FFF };
        }
    }
    throw new Error('Image bytes are not a supported PNG, JPG, GIF, or WebP file.');
}

function validateMediaMetadata(input = {}, options = {}) {
    const maxBytes = boundedLimit(options.maxBytes ?? MAX_IMAGE_BYTES, MAX_IMAGE_BYTES, 'Media byte limit');
    const maxEdge = boundedLimit(options.maxEdge ?? MAX_IMAGE_EDGE, MAX_IMAGE_EDGE, 'Media edge limit');
    const maxPixels = boundedLimit(options.maxPixels ?? MAX_IMAGE_PIXELS, MAX_IMAGE_PIXELS, 'Media pixel limit');
    const maxDuration = boundedLimit(options.maxDurationSeconds ?? MAX_MEDIA_DURATION_SECONDS,
        MAX_MEDIA_DURATION_SECONDS, 'Media duration limit');
    const size = input.size;
    const width = input.width;
    const height = input.height;
    const duration = input.duration ?? input.durationSecs ?? input.duration_secs;
    if (size != null && (!Number.isFinite(size) || size < 0 || size > maxBytes)) throw new Error('Media cannot exceed 8 MB.');
    if ((width == null) !== (height == null)) throw new Error('Media dimensions must include width and height.');
    if (width != null && (!Number.isFinite(width) || !Number.isFinite(height)
        || width < 1 || height < 1 || width > maxEdge || height > maxEdge || width * height > maxPixels)) {
        throw new Error('Media dimensions exceed the safe processing limit.');
    }
    if (duration == null && options.requireDuration) throw new Error('Media duration is required before processing.');
    if (duration != null && (!Number.isFinite(duration) || duration < 0 || duration > maxDuration)) {
        throw new Error('Media duration exceeds the safe processing limit.');
    }
}

function first(collection) {
    if (!collection) return null;
    if (typeof collection.first === 'function') return collection.first() || null;
    if (Array.isArray(collection)) return collection[0] || null;
    return null;
}

function avatar(subject) {
    const owner = typeof subject?.displayAvatarURL === 'function' ? subject : subject?.user;
    return owner?.displayAvatarURL?.({ extension: 'png', size: MAX_IMAGE_EDGE }) || null;
}

function resolveImageInput({ attachment, member, message, url, user } = {}) {
    if (attachment) return attachment;
    const memberAvatar = avatar(member);
    if (memberAvatar) return { url: memberAvatar };
    const messageMedia = first(message?.attachments) || first(message?.stickers);
    if (messageMedia?.url) return messageMedia;
    const embed = first(message?.embeds);
    const embedUrl = embed?.image?.url || embed?.thumbnail?.url;
    if (embedUrl) return { url: embedUrl };
    if (url != null) return { url };
    const selfAvatar = avatar(user);
    if (selfAvatar) return { url: selfAvatar };
    throw new Error('Provide an image attachment, member, reply, URL, or avatar.');
}

function discard(response) {
    response.destroy?.();
    const cancellation = response.body?.cancel?.();
    cancellation?.catch?.(() => {});
}

function untilAbort(signal) {
    return new Promise((_, reject) => {
        const fail = () => reject(new Error('Media download timed out.'));
        if (signal.aborted) fail();
        else signal.addEventListener('abort', fail, { once: true });
    });
}

async function responseBuffer(response, maxBytes) {
    if (response.body?.getReader) {
        const reader = response.body.getReader();
        const chunks = [];
        let total = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > maxBytes) {
                await reader.cancel();
                throw new Error('Media cannot exceed 8 MB.');
            }
            chunks.push(Buffer.from(value));
        }
        return Buffer.concat(chunks, total);
    }
    if (response[Symbol.asyncIterator]) {
        const chunks = [];
        let total = 0;
        for await (const chunk of response) {
            total += chunk.length;
            if (total > maxBytes) {
                response.destroy?.();
                throw new Error('Media cannot exceed 8 MB.');
            }
            chunks.push(Buffer.from(chunk));
        }
        return Buffer.concat(chunks, total);
    }
    discard(response);
    throw new Error('Media downloads require a bounded response stream.');
}

class MediaService {
    constructor(options = {}) {
        this.fetch = options.fetch || pinnedFetch;
        this.lookup = options.lookup || (hostname => dns.lookup(hostname, { all: true, verbatim: true }));
        this.timeoutMs = boundedLimit(options.timeoutMs ?? 10000, 10000, 'Media download timeout');
        this.queue = options.queue || new ProcessingQueue(options.concurrency);
    }

    async image(input, options = {}) {
        validateMediaMetadata(typeof input === 'object' ? input : {}, options);
        const url = new URL(typeof input === 'string' ? input : input?.url);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
            throw new Error('Images must use a public HTTP or HTTPS URL.');
        }
        if (net.isIP(url.hostname.replace(/^\[|\]$/g, '')) && privateAddress(url.hostname)) {
            throw new Error('Images must be hosted at a public address.');
        }
        const allowedFormats = new Set((options.formats || [...IMAGE_FORMATS])
            .map(format => String(format).toLowerCase().replace('jpg', 'jpeg')));
        const declaredFormat = normalizeType(input?.contentType ?? input?.content_type);
        if ((input?.contentType || input?.content_type) && (!declaredFormat || !allowedFormats.has(declaredFormat))) {
            throw new Error('Images must use an allowed PNG, JPG, GIF, or WebP format.');
        }
        const signal = AbortSignal.timeout(this.timeoutMs);
        const addresses = await Promise.race([this.lookup(url.hostname), untilAbort(signal)]);
        const resolved = Array.isArray(addresses) ? addresses : [addresses];
        if (!resolved.length || resolved.some(entry => privateAddress(entry.address || entry))) {
            throw new Error('Images must be hosted at a public address.');
        }
        const destination = resolved[0];
        const address = destination.address || destination;
        const response = await this.fetch(url, {
            address,
            family: destination.family || net.isIP(address),
            signal
        });
        const status = response.status ?? response.statusCode;
        if (response.ok === false || (status != null && (status < 200 || status >= 300))) {
            discard(response);
            throw new Error('Image download failed.');
        }
        const header = name => response.headers.get?.(name) ?? response.headers[name];
        const responseFormat = normalizeType(header('content-type'));
        if (!responseFormat || !allowedFormats.has(responseFormat)) {
            discard(response);
            throw new Error('Images must use an allowed PNG, JPG, GIF, or WebP format.');
        }
        const maxBytes = boundedLimit(options.maxBytes ?? MAX_IMAGE_BYTES, MAX_IMAGE_BYTES, 'Media byte limit');
        const length = Number(header('content-length') || 0);
        if (!Number.isFinite(length) || length < 0 || length > maxBytes) {
            discard(response);
            throw new Error('Media cannot exceed 8 MB.');
        }
        const buffer = await responseBuffer(response, maxBytes);
        const metadata = imageMetadata(buffer);
        if (metadata.format !== responseFormat || (declaredFormat && metadata.format !== declaredFormat)) {
            throw new Error('Image content type does not match its bytes.');
        }
        validateMediaMetadata({ ...metadata, size: buffer.length }, options);
        if (input?.width != null && input?.height != null
            && (input.width !== metadata.width || input.height !== metadata.height)) {
            throw new Error('Image dimensions do not match the downloaded bytes.');
        }
        return { buffer, ...metadata, contentType: `image/${metadata.format}` };
    }

    processImage(input, processor, options = {}) {
        return this.queue.run(async (directory, signal) => {
            const image = await this.image(input, options);
            return processor(image, directory, signal);
        });
    }
}

class ProcessingQueue {
    constructor(concurrency = Number(process.env.MEDIA_PROCESSING_CONCURRENCY ?? 1), options = {}) {
        if (![0, 1].includes(concurrency)) throw new Error('Media processing concurrency must be 0 or 1.');
        const maxPending = options.maxPending ?? 4;
        const timeoutMs = options.timeoutMs ?? 30000;
        if (!Number.isInteger(maxPending) || maxPending < 1 || maxPending > 4) throw new Error('Media queue limit must be 1-4.');
        if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) throw new Error('Media task timeout must be 1-60 seconds.');
        this.enabled = concurrency === 1;
        this.maxPending = maxPending;
        this.timeoutMs = timeoutMs;
        this.pending = 0;
        this.failed = null;
        this.waiting = new Set();
        this.tail = Promise.resolve();
        this.controller = null;
    }

    run(task) {
        if (!this.enabled) return Promise.reject(new Error('Media processing is disabled.'));
        if (this.failed) return Promise.reject(this.failed);
        if (this.pending >= this.maxPending) return Promise.reject(new Error('Media processing queue is full.'));
        this.pending++;
        let resolveResult;
        let rejectResult;
        let settled = false;
        const result = new Promise((resolve, reject) => {
            resolveResult = resolve;
            rejectResult = reject;
        });
        const fail = error => {
            if (!settled) {
                settled = true;
                rejectResult(error);
            }
        };
        this.waiting.add(fail);
        const completion = this.tail.then(async () => {
            if (this.failed) return fail(this.failed);
            const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bytebot-media-'));
            const controller = new AbortController();
            this.controller = controller;
            const timeout = setTimeout(() => {
                controller.abort();
                this.failed = new Error('Media worker is unavailable after a processing timeout; restart ByteBot.');
                for (const reject of this.waiting) reject(this.failed);
            }, this.timeoutMs);
            timeout.unref?.();
            let value;
            let error;
            try {
                value = await task(directory, controller.signal);
            } catch (taskError) {
                error = taskError;
            } finally {
                clearTimeout(timeout);
                if (this.controller === controller) this.controller = null;
                await fs.rm(directory, { recursive: true, force: true });
            }
            if (!settled) {
                settled = true;
                if (error) rejectResult(error);
                else resolveResult(value);
            }
        }).catch(error => {
            fail(error);
        }).finally(() => {
            this.waiting.delete(fail);
            this.pending--;
        });
        this.tail = completion.catch(() => {});
        return result;
    }

    async close() {
        this.failed ||= new Error('Media processing queue is closed.');
        this.controller?.abort();
        for (const reject of this.waiting) reject(this.failed);
        await this.tail;
    }
}

module.exports = {
    IMAGE_FORMATS,
    MAX_IMAGE_BYTES,
    MAX_IMAGE_EDGE,
    MAX_IMAGE_PIXELS,
    MAX_MEDIA_DURATION_SECONDS,
    MediaService,
    ProcessingQueue,
    imageMetadata,
    pinnedFetch,
    privateAddress,
    resolveImageInput,
    validateMediaMetadata
};
