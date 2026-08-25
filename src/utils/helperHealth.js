const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function executableHealth(executable, args, run) {
    const result = run(executable, args, {
        encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024, shell: false
    });
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim().split('\n')[0].slice(0, 120);
    return result.status === 0 && !result.error
        ? { ready: true, detail: output || 'ready' }
        : { ready: false, detail: result.error?.code || result.error?.message || `exit ${result.status}` };
}

function inspectHelpers(options = {}) {
    const run = options.spawnSync || spawnSync;
    const paths = options.paths || {
        tesseract: process.env.TESSERACT_PATH || 'tesseract',
        espeak: process.env.ESPEAK_NG_PATH || 'espeak-ng',
        ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
        ffprobe: process.env.FFPROBE_PATH || 'ffprobe'
    };
    const resolve = options.resolve || require.resolve;
    let sharp;
    try {
        const version = options.sharpVersion
            ? options.sharpVersion()
            : JSON.parse(fs.readFileSync(path.join(path.dirname(resolve('sharp')), '..', 'package.json'))).version;
        sharp = { ready: true, detail: version };
    } catch (error) {
        sharp = { ready: false, detail: error.code || error.message };
    }
    const tesseract = executableHealth(paths.tesseract, ['--version'], run);
    const espeak = executableHealth(paths.espeak, ['--version'], run);
    const ffmpeg = executableHealth(paths.ffmpeg, ['-version'], run);
    const ffprobe = executableHealth(paths.ffprobe, ['-version'], run);
    let voiceReady = true;
    try {
        resolve('@discordjs/voice');
        resolve('opusscript');
    } catch {
        voiceReady = false;
    }
    return {
        sharp, tesseract, espeak, ffmpeg, ffprobe,
        music: { ready: ffmpeg.ready && ffprobe.ready && voiceReady, detail: voiceReady ? 'runtime ready' : 'voice dependencies unavailable' }
    };
}

module.exports = { inspectHelpers };
