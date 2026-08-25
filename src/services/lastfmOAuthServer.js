const express = require('express');

class LastfmOAuthServer {
    constructor(service, options = {}) {
        this.service = service;
        this.port = Number(options.port ?? process.env.LASTFM_OAUTH_PORT);
        this.host = options.host || '127.0.0.1';
        this.server = null;
    }

    async start() {
        if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535 || !this.service.oauthReady()) return false;
        const path = new URL(this.service.callbackUrl).pathname;
        const app = express();
        app.disable('x-powered-by');
        app.get(path, async (request, response) => {
            response.set('Cache-Control', 'no-store');
            response.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
            try {
                await this.service.completeOAuth(request.query.state, request.query.token);
                response.status(200).type('html').send('<!doctype html><title>Last.fm linked</title><p>Last.fm linked. You may close this page.</p>');
            } catch {
                response.status(400).type('html').send('<!doctype html><title>Link failed</title><p>This Last.fm link is invalid or expired. Return to Discord and try again.</p>');
            }
        });
        return new Promise((resolve, reject) => {
            this.server = app.listen(this.port, this.host, () => {
                this.server.unref?.();
                resolve(true);
            });
            this.server.once('error', reject);
        });
    }

    close() {
        return new Promise(resolve => this.server ? this.server.close(resolve) : resolve());
    }
}

module.exports = { LastfmOAuthServer };
