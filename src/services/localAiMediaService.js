const { spawn } = require('node:child_process');
const fs = require('node:fs').promises;
const path = require('node:path');
const { MediaService, ProcessingQueue } = require('./mediaService');
const { UserFacingError } = require('../utils/errorHandlerUtil');

const MAX_LOG_BYTES = 64 * 1024;
const MAX_OCR_BYTES = 64 * 1024;
const MAX_WAV_BYTES = 8 * 1024 * 1024;

function runProcess(binary, args, input, signal) {
    return new Promise((resolve, reject) => {
        let child;
        try {
            child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        } catch (error) {
            reject(error);
            return;
        }

        const stdout = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let settled = false;
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener('abort', abort);
            if (error) reject(error);
            else resolve(value);
        };
        const abort = () => {
            child.kill('SIGKILL');
            finish(new Error('Local media processing timed out.'));
        };

        child.stdout.on('data', chunk => {
            stdoutBytes += chunk.length;
            if (stdoutBytes > MAX_OCR_BYTES) {
                child.kill('SIGKILL');
                finish(new Error('Local media output exceeded 64 KiB.'));
            } else stdout.push(Buffer.from(chunk));
        });
        child.stderr.on('data', chunk => {
            stderrBytes += chunk.length;
            if (stderrBytes > MAX_LOG_BYTES) {
                child.kill('SIGKILL');
                finish(new Error('Local media diagnostics exceeded 64 KiB.'));
            }
        });
        child.once('error', finish);
        child.once('close', code => finish(code === 0 ? null : new Error('Local media helper failed.'), Buffer.concat(stdout)));
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
        child.stdin.on('error', error => {
            if (error.code !== 'EPIPE') finish(error);
        });
        child.stdin.end(input);
    });
}

class LocalAiMediaService {
    constructor(options = {}) {
        this.queue = options.queue || new ProcessingQueue();
        this.media = options.media || new MediaService({ queue: this.queue });
        this.ocrPath = options.ocrPath || process.env.TESSERACT_PATH || 'tesseract';
        this.ttsPath = options.ttsPath || process.env.ESPEAK_NG_PATH || 'espeak-ng';
    }

    async ocr(input) {
        try {
            return await this.media.processImage(input, async (image, directory, signal) => {
                const filename = path.join(directory, `ocr-input.${image.format === 'jpeg' ? 'jpg' : image.format}`);
                await fs.writeFile(filename, image.buffer, { mode: 0o600 });
                const output = await runProcess(this.ocrPath, [filename, 'stdout', '-l', 'eng'], null, signal);
                return output.toString('utf8').trim();
            });
        } catch {
            throw new UserFacingError('Failed to extract text from image.');
        }
    }

    async tts(text) {
        if (typeof text !== 'string' || !text.trim() || text.length > 2000) {
            throw new UserFacingError('Text must be between 1 and 2,000 characters.');
        }
        try {
            return await this.queue.run(async (directory, signal) => {
                const filename = path.join(directory, 'speech.wav');
                await runProcess(this.ttsPath, ['--stdin', '-w', filename], Buffer.from(text), signal);
                const info = await fs.stat(filename);
                if (info.size > MAX_WAV_BYTES) throw new Error('Synthetic speech exceeds 8 MiB.');
                const output = await fs.readFile(filename);
                if (output.length < 12 || output.subarray(0, 4).toString() !== 'RIFF'
                    || output.subarray(8, 12).toString() !== 'WAVE') throw new Error('Synthetic speech is not WAV audio.');
                return output;
            });
        } catch (error) {
            if (error instanceof UserFacingError) throw error;
            throw new UserFacingError('Failed to generate local synthetic speech.');
        }
    }
}

module.exports = { LocalAiMediaService };
