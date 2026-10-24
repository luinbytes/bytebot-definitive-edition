const { parentPort } = require('worker_threads');

parentPort.on('message', ({ id, content, trigger, matchType }) => {
    try {
        const pattern = matchType === 'wildcard'
            ? '^' + trigger.toLowerCase()
                .replace(/[.+^${}()|[\]\\]/g, '\\$&')
                .replace(/\*/g, '.*')
                .replace(/\?/g, '.') + '$'
            : trigger;
        const matched = matchType === 'wildcard'
            ? new RegExp(pattern).test(content.toLowerCase())
            : new RegExp(pattern, 'i').test(content);
        parentPort.postMessage({ id, matched });
    } catch {
        parentPort.postMessage({ id, matched: false });
    }
});

parentPort.postMessage({ ready: true });
