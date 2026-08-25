const { spawn } = require('node:child_process');
const fs = require('node:fs').promises;
const path = require('node:path');
const { MediaService, ProcessingQueue } = require('./mediaService');
const { UserFacingError } = require('../utils/errorHandlerUtil');

const MAX_LOG_BYTES = 64 * 1024;
const MAX_OCR_BYTES = 64 * 1024;
const MAX_WAV_BYTES = 8 * 1024 * 1024;

function killProcess(child) {
    if (process.platform !== 'win32' && child.pid) {
        try {
            process.kill(-child.pid, 'SIGKILL');
            return;
        } catch { }
    }
    child.kill('SIGKILL');
}

function runProcess(binary, args, input, signal, active) {
    return new Promise((resolve, reject) => {
        let child;
        try {
            child = spawn(binary, args, {
                detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
            });
        } catch (error) {
            reject(error);
            return;
        }

        const stdout = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let settled = false;
        let terminationError = null;
        const record = {
            child,
            terminate(error) {
                terminationError ||= error;
                killProcess(child);
            }
        };
        active.add(record);
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            active.delete(record);
            signal?.removeEventListener('abort', abort);
            if (error) reject(error);
            else resolve(value);
        };
        const abort = () => record.terminate(new Error('Local media processing timed out.'));

        child.stdout.on('data', chunk => {
            stdoutBytes += chunk.length;
            if (stdoutBytes > MAX_OCR_BYTES) {
                record.terminate(new Error('Local media output exceeded 64 KiB.'));
            } else stdout.push(Buffer.from(chunk));
        });
        child.stderr.on('data', chunk => {
            stderrBytes += chunk.length;
            if (stderrBytes > MAX_LOG_BYTES) {
                record.terminate(new Error('Local media diagnostics exceeded 64 KiB.'));
            }
        });
        child.once('error', finish);
        child.once('close', code => finish(terminationError
            || (code === 0 ? null : new Error('Local media helper failed.')), Buffer.concat(stdout)));
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
        child.stdin.on('error', error => {
            if (error.code !== 'EPIPE') finish(error);
        });
        child.stdin.end(input);
    });
}

function validWav(buffer) {
    if (buffer.length < 44 || buffer.subarray(0, 4).toString() !== 'RIFF'
        || buffer.subarray(8, 12).toString() !== 'WAVE'
        || buffer.readUInt32LE(4) + 8 !== buffer.length) return false;
    let offset = 12;
    let format = false;
    let data = false;
    while (offset + 8 <= buffer.length) {
        const type = buffer.subarray(offset, offset + 4).toString();
        const size = buffer.readUInt32LE(offset + 4);
        const start = offset + 8;
        const end = start + size;
        if (end > buffer.length) return false;
        if (type === 'fmt ' && size >= 16 && buffer.readUInt16LE(start) === 1) format = true;
        if (type === 'data' && size > 0) data = true;
        offset = end + (size % 2);
    }
    return offset === buffer.length && format && data;
}

class LocalAiMediaService {
    constructor(options = {}) {
        this.queue = options.queue || new ProcessingQueue();
        this.media = options.media || new MediaService({ queue: this.queue });
        this.ocrPath = options.ocrPath || process.env.TESSERACT_PATH || 'tesseract';
        this.ttsPath = options.ttsPath || process.env.ESPEAK_NG_PATH || 'espeak-ng';
        this.active = new Set();
        this.closed = false;
    }

    async ocr(input) {
        try {
            return await this.media.processImage(input, async (image, directory, signal) => {
                if (this.closed) throw new Error('Local AI media tools are shutting down.');
                const filename = path.join(directory, `ocr-input.${image.format === 'jpeg' ? 'jpg' : image.format}`);
                await fs.writeFile(filename, image.buffer, { mode: 0o600 });
                const output = await runProcess(this.ocrPath, [filename, 'stdout', '-l', 'eng'], null, signal, this.active);
                return output.toString('utf8').trim();
            });
        } catch (error) {
            if (/^(?:Image bytes|Images must|Image content type|Image dimensions|Media cannot|Media dimensions)/.test(error.message)) {
                throw new UserFacingError('The attached file is not a valid image.');
            }
            throw new UserFacingError('Failed to extract text from image.');
        }
    }

    async tts(text) {
        if (this.closed) throw new UserFacingError('Local AI media tools are shutting down.');
        if (typeof text !== 'string' || !text.trim() || text.length > 2000) {
            throw new UserFacingError('Text must be between 1 and 2,000 characters.');
        }
        try {
            return await this.queue.run(async (directory, signal) => {
                if (this.closed) throw new Error('Local AI media tools are shutting down.');
                const filename = path.join(directory, 'speech.wav');
                await runProcess(this.ttsPath, ['--stdin', '-w', filename], Buffer.from(text), signal, this.active);
                const info = await fs.stat(filename);
                if (info.size > MAX_WAV_BYTES) throw new Error('Synthetic speech exceeds 8 MiB.');
                const output = await fs.readFile(filename);
                if (output.length > MAX_WAV_BYTES || !validWav(output)) throw new Error('Synthetic speech is not valid WAV audio.');
                return output;
            });
        } catch (error) {
            if (error instanceof UserFacingError) throw error;
            throw new UserFacingError('Failed to generate local synthetic speech.');
        }
    }

    async close() {
        if (this.closed) return;
        this.closed = true;
        for (const record of this.active) record.terminate(new Error('Local AI media tools are shutting down.'));
        await this.queue.tail;
    }
}

module.exports = { LocalAiMediaService };
