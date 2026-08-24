const sharp = require('sharp');
const { MAX_IMAGE_PIXELS, MediaService } = require('./mediaService');

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const FORMATS = new Set(['png', 'jpeg', 'webp', 'gif']);
const EFFECTS = new Set([
    'blur', 'deepfry', 'flip', 'flop', 'grayscale', 'half-invert', 'invert',
    'normalize', 'pixelate', 'saturate', 'sepia', 'sharpen', 'shear',
    'stretch', 'threshold', 'tint'
]);

sharp.cache(false);
sharp.concurrency(1);

function outputLimit(value) {
    if (!Number.isFinite(value) || value <= 0) throw new Error('Image output limit must be positive.');
    return Math.min(value, MAX_OUTPUT_BYTES);
}

function integer(value, name, minimum, maximum) {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        throw new Error(`Image ${name} must be ${minimum}-${maximum}.`);
    }
    return value;
}

function image(buffer) {
    return sharp(buffer, { failOn: 'warning', limitInputPixels: MAX_IMAGE_PIXELS, sequentialRead: true });
}

function encoder(pipeline, format, quality = 88) {
    switch (format) {
        case 'png': return pipeline.png({ compressionLevel: 9, palette: true, quality });
        case 'jpeg': return pipeline.jpeg({ quality, mozjpeg: true });
        case 'webp': return pipeline.webp({ quality, effort: 4 });
        case 'gif': return pipeline.gif({ effort: 3, colours: 256 });
        default: throw new Error('Unsupported image output format.');
    }
}

async function buffered(pipeline, signal) {
    signal?.throwIfAborted();
    pipeline.timeout({ seconds: 29 });
    const abort = () => pipeline.destroy(new Error('Image processing cancelled.'));
    signal?.addEventListener('abort', abort, { once: true });
    try {
        return await pipeline.toBuffer({ resolveWithObject: true });
    } finally {
        signal?.removeEventListener('abort', abort);
    }
}

async function bounded(pipeline, format, limit, signal, quality = 88) {
    limit = outputLimit(limit);
    let result = await buffered(encoder(pipeline, format, quality), signal);
    for (let attempt = 0; result.data.length > limit && attempt < 8; attempt++) {
        const width = Math.max(1, Math.floor(result.info.width * 0.75));
        if (width === result.info.width) break;
        result = await buffered(encoder(image(result.data).resize({ width }), format,
            Math.max(35, quality - ((attempt + 1) * 8))), signal);
    }
    if (result.data.length > limit) throw new Error('Processed image exceeds Discord\'s upload limit.');
    return {
        buffer: result.data,
        filename: `bytebot.${format === 'jpeg' ? 'jpg' : format}`,
        contentType: `image/${format}`,
        format,
        width: result.info.width,
        height: result.info.height
    };
}

function escapeXml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
    })[character]);
}

function text(value, name) {
    value = String(value || '').trim();
    if (!value || value.length > 120) throw new Error(`${name} text must be 1-120 characters.`);
    return value;
}

function lines(value, width) {
    const maximum = Math.max(8, Math.floor(width / 18));
    const words = String(value).split(/\s+/);
    const result = [];
    for (const word of words) {
        if (!result.length || `${result.at(-1)} ${word}`.length > maximum) result.push(word);
        else result[result.length - 1] += ` ${word}`;
    }
    return result.slice(0, 5);
}

function labelSvg(value, width, height, background = '#000000') {
    const rows = lines(value, width);
    const fontSize = Math.max(18, Math.min(52, Math.floor(width / 11)));
    const start = Math.max(fontSize, (height - ((rows.length - 1) * fontSize * 1.15)) / 2);
    const spans = rows.map((row, index) =>
        `<tspan x="50%" y="${Math.round(start + (index * fontSize * 1.15))}">${escapeXml(row)}</tspan>`).join('');
    return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="${background}"/>
        <text text-anchor="middle" font-family="sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff">${spans}</text>
    </svg>`);
}

async function normalized(buffer, width, height, signal) {
    return (await buffered(image(buffer).autoOrient().resize({
        width, height, fit: height ? 'cover' : 'inside', withoutEnlargement: false
    }).png(), signal)).data;
}

class ImageManipulationService {
    constructor(options = {}) {
        this.media = options.media || new MediaService(options);
    }

    async transform(input, operation, options = {}, maxBytes = MAX_OUTPUT_BYTES) {
        outputLimit(maxBytes);
        let format = 'png';
        let quality = 88;
        if (operation === 'resize') {
            integer(options.width, 'width', 1, 4096);
            if (options.height != null) integer(options.height, 'height', 1, 4096);
        } else if (operation === 'rotate') {
            if (!Number.isFinite(options.angle) || options.angle < -360 || options.angle > 360) {
                return Promise.reject(new Error('Image angle must be between -360 and 360.'));
            }
        } else if (operation === 'compress') {
            format = 'webp';
            quality = options.quality == null ? 75 : integer(options.quality, 'quality', 1, 100);
        } else if (operation === 'convert') {
            format = String(options.format || '').replace('jpg', 'jpeg');
            if (!FORMATS.has(format)) return Promise.reject(new Error('Unsupported image output format.'));
        } else {
            return Promise.reject(new Error('Unknown image transform.'));
        }

        return this.media.processImage(input, async (source, _directory, signal) => {
            let pipeline = image(source.buffer).autoOrient();
            if (operation === 'resize') pipeline = pipeline.resize({
                width: options.width, height: options.height || undefined,
                fit: 'inside', withoutEnlargement: true
            });
            if (operation === 'rotate') pipeline = pipeline.rotate(options.angle, { background: '#00000000' });
            return bounded(pipeline, format, maxBytes, signal, quality);
        });
    }

    async effect(input, effect, maxBytes = MAX_OUTPUT_BYTES) {
        outputLimit(maxBytes);
        if (!EFFECTS.has(effect)) return Promise.reject(new Error('Unknown image effect.'));
        return this.media.processImage(input, async (source, _directory, signal) => {
            let pipeline = image(source.buffer).autoOrient();
            switch (effect) {
                case 'blur': pipeline.blur(4); break;
                case 'deepfry': pipeline.modulate({ saturation: 2 }).linear(1.4, -20).sharpen(); break;
                case 'flip': pipeline.flip(); break;
                case 'flop': pipeline.flop(); break;
                case 'grayscale': pipeline.grayscale(); break;
                case 'invert': pipeline.negate({ alpha: false }); break;
                case 'normalize': pipeline.normalize(); break;
                case 'saturate': pipeline.modulate({ saturation: 1.8 }); break;
                case 'sepia': pipeline.recomb([
                    [0.393, 0.769, 0.189], [0.349, 0.686, 0.168], [0.272, 0.534, 0.131]
                ]); break;
                case 'sharpen': pipeline.sharpen(); break;
                case 'shear': pipeline.affine([[1, 0.25], [0, 1]], { background: '#00000000' }); break;
                case 'stretch': pipeline.resize({ width: Math.min(4096, Math.round(source.width * 1.5)), height: source.height, fit: 'fill' }); break;
                case 'threshold': pipeline.threshold(128); break;
                case 'tint': pipeline.tint('#ff69b4'); break;
                case 'pixelate': {
                    const small = await buffered(pipeline.resize({ width: Math.min(48, source.width), kernel: 'nearest' }).png(), signal);
                    pipeline = image(small.data).resize({ width: source.width, height: source.height, kernel: 'nearest', fit: 'fill' });
                    break;
                }
                case 'half-invert': {
                    const base = await buffered(pipeline.png(), signal);
                    const halfWidth = Math.max(1, Math.floor(base.info.width / 2));
                    const inverted = await buffered(image(base.data).extract({ left: 0, top: 0, width: halfWidth, height: base.info.height }).negate({ alpha: false }).png(), signal);
                    pipeline = image(base.data).composite([{ input: inverted.data, left: 0, top: 0 }]);
                    break;
                }
            }
            return bounded(pipeline, 'png', maxBytes, signal);
        });
    }

    async meme(input, kind, options = {}, maxBytes = MAX_OUTPUT_BYTES) {
        outputLimit(maxBytes);
        if (!['caption', 'compare'].includes(kind)) return Promise.reject(new Error('Unknown image meme.'));
        const first = text(options.first, 'First');
        const second = kind === 'caption' && !options.second ? null : text(options.second, 'Second');
        return this.media.processImage(input, async (source, _directory, signal) => {
            if (kind === 'compare') {
                const tile = await normalized(source.buffer, 320, 320, signal);
                const labels = Buffer.from(`<svg width="640" height="80" xmlns="http://www.w3.org/2000/svg">
                    <rect width="320" height="80" fill="#b42318"/><rect x="320" width="320" height="80" fill="#067647"/>
                    <text x="160" y="50" text-anchor="middle" font-family="sans-serif" font-size="28" font-weight="700" fill="white">${escapeXml(first)}</text>
                    <text x="480" y="50" text-anchor="middle" font-family="sans-serif" font-size="28" font-weight="700" fill="white">${escapeXml(second)}</text>
                </svg>`);
                const pipeline = sharp({ create: { width: 640, height: 400, channels: 4, background: '#111111' } })
                    .composite([{ input: labels, left: 0, top: 0 }, { input: tile, left: 0, top: 80 }, { input: tile, left: 320, top: 80 }]);
                return bounded(pipeline, 'png', maxBytes, signal);
            }
            const width = Math.max(320, Math.min(1024, source.width));
            const base = await normalized(source.buffer, width, null, signal);
            const metadata = await image(base).metadata();
            const topHeight = Math.max(72, lines(first, metadata.width).length * 44 + 24);
            const bottomHeight = second ? Math.max(72, lines(second, metadata.width).length * 44 + 24) : 0;
            const pipeline = image(base).extend({ top: topHeight, bottom: bottomHeight, background: '#000000' })
                .composite([
                    { input: labelSvg(first, metadata.width, topHeight), left: 0, top: 0 },
                    ...(second ? [{ input: labelSvg(second, metadata.width, bottomHeight), left: 0, top: topHeight + metadata.height }] : [])
                ]);
            return bounded(pipeline, 'png', maxBytes, signal);
        });
    }

    async dominant(input, maxBytes = MAX_OUTPUT_BYTES) {
        outputLimit(maxBytes);
        return this.media.processImage(input, async (source, _directory, signal) => {
            const pipeline = image(source.buffer).autoOrient().timeout({ seconds: 29 });
            signal.throwIfAborted();
            const { dominant } = await pipeline.stats();
            signal.throwIfAborted();
            const hex = `#${[dominant.r, dominant.g, dominant.b].map(value => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
            return {
                ...await bounded(sharp({ create: { width: 128, height: 128, channels: 3, background: dominant } }), 'png', maxBytes, signal),
                hex
            };
        });
    }
}

module.exports = { EFFECTS, ImageManipulationService, MAX_OUTPUT_BYTES, bounded, escapeXml };
