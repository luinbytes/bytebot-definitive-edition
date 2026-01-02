const express = require('express');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const { db } = require('../database');
const { mediaItems } = require('../database/schema');
const { eq, and } = require('drizzle-orm');
const logger = require('../utils/logger');
const { getAbsolutePath, fileExists } = require('../utils/fileStorageUtil');

const app = express();
const PORT = process.env.MEDIA_SERVER_PORT || 3000;
const DOMAIN = process.env.MEDIA_SERVER_DOMAIN || `http://localhost:${PORT}`;

/**
 * Generate public URL for media item
 * @param {number} mediaId
 * @param {string} guildId
 * @param {string} fileName - Original filename for cosmetic URL
 * @returns {string}
 */
function generateMediaUrl(mediaId, guildId, fileName) {
    // Sanitize filename for URL
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${DOMAIN}/media/${guildId}/${mediaId}/${safeName}`;
}

/**
 * Route: GET /media/:guildId/:mediaId/:filename
 * Serves media file with proper headers and streaming
 */
app.get('/media/:guildId/:mediaId/:filename', async (req, res) => {
    const { guildId, mediaId, filename } = req.params;

    try {
        // SECURITY: Validate mediaId is integer
        const mediaIdInt = parseInt(mediaId, 10);
        if (isNaN(mediaIdInt) || mediaIdInt < 1) {
            logger.warn(`Invalid media ID attempted: ${mediaId}`);
            return res.status(400).json({ error: 'Invalid media ID' });
        }

        // SECURITY: Sanitize filename - prevent path traversal
        const filenameSafe = path.basename(filename); // Removes ../
        if (!/^[a-zA-Z0-9._-]+$/.test(filenameSafe)) {
            logger.warn(`Invalid filename attempted: ${filename}`);
            return res.status(400).json({ error: 'Invalid filename' });
        }

        // Lookup media item in database
        const [item] = await db
            .select()
            .from(mediaItems)
            .where(and(
                eq(mediaItems.id, mediaIdInt),
                eq(mediaItems.guildId, guildId),
                eq(mediaItems.storageMethod, 'local')
            ))
            .limit(1);

        if (!item) {
            logger.warn(`Media not found: ${mediaIdInt} (guild: ${guildId})`);
            return res.status(404).json({ error: 'Media not found' });
        }

        // Check if file exists on disk
        if (!item.localFilePath || !fileExists(item.localFilePath)) {
            logger.error(`File missing for media ${mediaIdInt}: ${item.localFilePath}`);

            // Mark as expired in database
            await db
                .update(mediaItems)
                .set({ urlExpired: true })
                .where(eq(mediaItems.id, item.id));

            return res.status(410).json({ error: 'File no longer available' });
        }

        const absolutePath = getAbsolutePath(item.localFilePath);
        const stats = fs.statSync(absolutePath);
        const mimeType = mime.lookup(absolutePath) || 'application/octet-stream';

        // Set response headers
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Content-Disposition', `inline; filename="${item.fileName}"`);
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year
        res.setHeader('Accept-Ranges', 'bytes');

        // Handle range requests (for video seeking)
        const range = req.headers.range;
        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
            const chunkSize = (end - start) + 1;

            res.status(206); // Partial Content
            res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
            res.setHeader('Content-Length', chunkSize);

            const stream = fs.createReadStream(absolutePath, { start, end });
            stream.pipe(res);
        } else {
            // Full file
            const stream = fs.createReadStream(absolutePath);
            stream.pipe(res);
        }

        logger.debug(`Served media ${mediaIdInt}: ${item.fileName} (${(stats.size / 1024).toFixed(2)}KB)`);

    } catch (error) {
        logger.error(`Error serving media ${mediaId}:`, error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
    });
});

/**
 * Start HTTP server
 * @param {Client} client - Discord client (for future auth)
 * @returns {Promise<Server>}
 */
async function startMediaServer(client) {
    return new Promise((resolve, reject) => {
        try {
            const server = app.listen(PORT, () => {
                logger.success(`Media server listening on ${DOMAIN}`);
                resolve(server);
            });

            server.on('error', (error) => {
                logger.error('Media server error:', error);
                reject(error);
            });
        } catch (error) {
            logger.error('Failed to start media server:', error);
            reject(error);
        }
    });
}

module.exports = {
    startMediaServer,
    generateMediaUrl,
    app, // Export for testing
};
