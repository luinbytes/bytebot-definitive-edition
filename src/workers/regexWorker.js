const { parentPort } = require('worker_threads');

parentPort.on('message', ({ id, patterns, text }) => {
    try {
        for (const { name, pattern } of patterns) {
            if (new RegExp(pattern, 'iu').test(text)) {
                parentPort.postMessage({ id, matched: true, name });
                return;
            }
        }
        parentPort.postMessage({ id, matched: false });
    } catch (error) {
        parentPort.postMessage({ id, matched: false, error: error.message });
    }
});
