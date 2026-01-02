const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

const STORAGE_BASE = process.env.MEDIA_STORAGE_PATH || './media-storage';
const STORAGE_LIMIT_BYTES = (process.env.MEDIA_STORAGE_LIMIT_GB || 8) * 1024 * 1024 * 1024;

/**
 * Calculate SHA256 hash of buffer for deduplication
 * @param {Buffer} buffer - File buffer
 * @returns {string} - Hex hash
 */
function calculateHash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Get relative file path for media item
 * @param {string} guildId
 * @param {string} userId
 * @param {number} mediaId
 * @param {string} extension - e.g., 'jpg', 'mp4'
 * @returns {string} - Relative path like 'guilds/123/456/789.jpg'
 */
function getRelativePath(guildId, userId, mediaId, extension) {
    return path.join('guilds', guildId, userId, `${mediaId}.${extension}`);
}

/**
 * Get absolute file path from relative path
 * SECURITY: Path traversal prevention via normalize + startsWith validation
 * @param {string} relativePath
 * @returns {string}
 */
function getAbsolutePath(relativePath) {
    const absolute = path.join(STORAGE_BASE, relativePath);
    const normalized = path.normalize(absolute);
    const normalizedBase = path.normalize(STORAGE_BASE);

    // CRITICAL: Prevent directory traversal attacks
    if (!normalized.startsWith(normalizedBase)) {
        throw new Error('Invalid file path: path traversal detected');
    }

    return normalized;
}

/**
 * Check if storage has enough space
 * @param {number} requiredBytes - Size of file to save
 * @returns {Promise<{hasSpace: boolean, currentUsage: number, limit: number, currentUsageGB: string, limitGB: string}>}
 */
async function checkDiskSpace(requiredBytes) {
    try {
        const usage = await calculateStorageUsage();
        const hasSpace = (usage + requiredBytes) <= STORAGE_LIMIT_BYTES;

        return {
            hasSpace,
            currentUsage: usage,
            limit: STORAGE_LIMIT_BYTES,
            currentUsageGB: (usage / (1024 ** 3)).toFixed(2),
            limitGB: (STORAGE_LIMIT_BYTES / (1024 ** 3)).toFixed(2),
        };
    } catch (error) {
        logger.error('Failed to check disk space:', error);
        return {
            hasSpace: false,
            currentUsage: 0,
            limit: STORAGE_LIMIT_BYTES,
            currentUsageGB: '0.00',
            limitGB: (STORAGE_LIMIT_BYTES / (1024 ** 3)).toFixed(2)
        };
    }
}

/**
 * Calculate total storage usage by walking directory tree
 * @returns {Promise<number>} - Bytes used
 */
async function calculateStorageUsage() {
    const guildsPath = path.join(STORAGE_BASE, 'guilds');

    if (!fsSync.existsSync(guildsPath)) {
        return 0;
    }

    let totalSize = 0;

    async function walkDir(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                await walkDir(fullPath);
            } else {
                const stats = await fs.stat(fullPath);
                totalSize += stats.size;
            }
        }
    }

    await walkDir(guildsPath);
    return totalSize;
}

/**
 * Save buffer to filesystem
 * @param {Buffer} buffer - File data
 * @param {string} guildId
 * @param {string} userId
 * @param {number} mediaId
 * @param {string} extension
 * @returns {Promise<{success: boolean, filePath?: string, size?: number, error?: string}>}
 */
async function saveToFilesystem(buffer, guildId, userId, mediaId, extension) {
    try {
        // Check disk space
        const spaceCheck = await checkDiskSpace(buffer.length);
        if (!spaceCheck.hasSpace) {
            return {
                success: false,
                error: `Storage limit exceeded (${spaceCheck.currentUsageGB}GB / ${spaceCheck.limitGB}GB). Cannot save ${(buffer.length / (1024 ** 2)).toFixed(2)}MB file.`
            };
        }

        // Generate paths
        const relativePath = getRelativePath(guildId, userId, mediaId, extension);
        const absolutePath = getAbsolutePath(relativePath);
        const directory = path.dirname(absolutePath);

        // Create directory structure
        await fs.mkdir(directory, { recursive: true });

        // Write file
        await fs.writeFile(absolutePath, buffer);

        logger.success(`Saved media ${mediaId} to ${relativePath} (${(buffer.length / 1024).toFixed(2)}KB)`);

        return {
            success: true,
            filePath: relativePath,
            size: buffer.length
        };
    } catch (error) {
        logger.error(`Failed to save media ${mediaId}:`, error);
        return {
            success: false,
            error: `Filesystem error: ${error.message}`
        };
    }
}

/**
 * Delete file from filesystem
 * @param {string} relativePath - Path from database
 * @returns {Promise<boolean>}
 */
async function deleteFile(relativePath) {
    try {
        const absolutePath = getAbsolutePath(relativePath);

        if (!fsSync.existsSync(absolutePath)) {
            logger.warn(`File not found for deletion: ${relativePath}`);
            return true; // Already gone
        }

        await fs.unlink(absolutePath);
        logger.success(`Deleted file: ${relativePath}`);

        // Cleanup empty directories
        await cleanupEmptyDirs(path.dirname(absolutePath));

        return true;
    } catch (error) {
        logger.error(`Failed to delete file ${relativePath}:`, error);
        return false;
    }
}

/**
 * Remove empty parent directories after file deletion
 * @param {string} dirPath
 */
async function cleanupEmptyDirs(dirPath) {
    try {
        // Don't delete base storage directory
        const normalizedBase = path.normalize(STORAGE_BASE);
        const normalizedGuilds = path.normalize(path.join(STORAGE_BASE, 'guilds'));
        const normalizedDir = path.normalize(dirPath);

        if (normalizedDir === normalizedBase || normalizedDir === normalizedGuilds) {
            return;
        }

        const entries = await fs.readdir(dirPath);
        if (entries.length === 0) {
            await fs.rmdir(dirPath);
            logger.debug(`Removed empty directory: ${dirPath}`);

            // Recursively cleanup parent
            await cleanupEmptyDirs(path.dirname(dirPath));
        }
    } catch (error) {
        // Ignore errors (directory might have files added concurrently)
    }
}

/**
 * Check if file exists on disk
 * @param {string} relativePath
 * @returns {boolean}
 */
function fileExists(relativePath) {
    try {
        const absolutePath = getAbsolutePath(relativePath);
        return fsSync.existsSync(absolutePath);
    } catch (error) {
        return false;
    }
}

module.exports = {
    calculateHash,
    getRelativePath,
    getAbsolutePath,
    checkDiskSpace,
    calculateStorageUsage,
    saveToFilesystem,
    deleteFile,
    fileExists,
    STORAGE_BASE,
    STORAGE_LIMIT_BYTES,
};
