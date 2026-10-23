const { Worker } = require('worker_threads');
const path = require('path');

const MAX_PENDING_MATCHES = 32;
const MATCH_TIMEOUT_MS = 50;
const MATCH_DEADLINE_MS = 1000;

class AutoResponderMatcher {
    constructor() {
        this.worker = null;
        this.ready = false;
        this.active = null;
        this.queue = [];
        this.nextId = 0;
        this.stopping = null;
        this.closed = false;
    }

    match(content, trigger, matchType) {
        if (this.closed || this.queue.length + Number(Boolean(this.active)) >= MAX_PENDING_MATCHES) {
            return Promise.resolve(false);
        }
        return new Promise(resolve => {
            const job = { id: ++this.nextId, content, trigger, matchType, resolve };
            job.deadline = setTimeout(() => {
                if (this.active === job) this.retire(this.worker);
                else {
                    this.queue.splice(this.queue.indexOf(job), 1);
                    this.finish(job, false);
                }
            }, MATCH_DEADLINE_MS);
            this.queue.push(job);
            this.runNext();
        });
    }

    finish(job, matched) {
        clearTimeout(job.deadline);
        clearTimeout(job.timeout);
        job.resolve(matched);
    }

    runNext() {
        if (this.closed || this.stopping || this.active || !this.queue.length) return;
        this.active = this.queue.shift();
        if (this.worker) return this.sendActive();
        try {
            const worker = new Worker(path.join(__dirname, '../workers/autoResponderRegexWorker.js'), {
                resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8 }
            });
            this.worker = worker;
            worker.on('message', result => {
                if (this.worker !== worker) return;
                if (result.ready) {
                    this.ready = true;
                    this.sendActive();
                } else if (this.active?.id === result.id) {
                    this.finish(this.active, result.matched === true);
                    this.active = null;
                    this.runNext();
                }
            });
            worker.once('error', () => this.retire(worker));
            worker.once('exit', () => this.retire(worker));
            worker.unref();
        } catch {
            this.finish(this.active, false);
            this.active = null;
            for (const job of this.queue.splice(0)) this.finish(job, false);
        }
    }

    sendActive() {
        if (!this.ready || !this.active) return;
        const worker = this.worker;
        const { id, content, trigger, matchType } = this.active;
        this.active.timeout = setTimeout(() => this.retire(worker), MATCH_TIMEOUT_MS);
        try {
            worker.postMessage({ id, content, trigger, matchType });
        } catch {
            this.retire(worker);
        }
    }

    retire(worker) {
        if (!worker || this.worker !== worker) return this.stopping;
        this.worker = null;
        this.ready = false;
        if (this.active) {
            this.finish(this.active, false);
            this.active = null;
        }
        this.stopping = worker.terminate().catch(() => {}).then(() => {
            this.stopping = null;
            this.runNext();
        });
        return this.stopping;
    }

    close() {
        this.closed = true;
        for (const job of this.queue.splice(0)) this.finish(job, false);
        return this.retire(this.worker) || this.stopping || Promise.resolve();
    }
}

module.exports = AutoResponderMatcher;
