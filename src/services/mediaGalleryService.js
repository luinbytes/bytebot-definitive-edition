const { db } = require('../database/index');
const { mediaGalleryConfig } = require('../database/schema');
const { eq } = require('drizzle-orm');
const logger = require('../utils/logger');
const mediaUtil = require('../utils/mediaUtil');
const { dbLog } = require('../utils/dbLogger');

class MediaGalleryService {
    constructor(client) {
        this.client = client;
        this.configCache = new Map(); // channelId -> config object
        this.cacheExpiry = new Map(); // channelId -> expiry timestamp

        // Cleanup stale cache every 5 minutes
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            for (const [channelId, expiry] of this.cacheExpiry.entries()) {
                if (expiry < now) {
                    this.configCache.delete(channelId);
                    this.cacheExpiry.delete(channelId);
                }
            }
        }, 300000); // 5 min
    }

    cleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    /**
     * Check message for media attachments and auto-capture if configured
     * @param {Message} message - Discord.js Message object
     */
    async checkMessage(message) {
        // No attachments = skip
        if (message.attachments.size === 0) return;

        // Get channel config (cached)
        const config = await this.getChannelConfig(message.channel.id);

        // Debug logging
        if (!config) {
            logger.debug(`No media config found for channel ${message.channel.id} (#${message.channel.name})`);
            return;
        }
        if (!config.enabled) {
            logger.debug(`Media gallery disabled for channel ${message.channel.id}`);
            return;
        }
        if (!config.autoCapture) {
            logger.debug(`Auto-capture disabled for channel ${message.channel.id}`);
            return;
        }

        logger.debug(`Processing ${message.attachments.size} attachment(s) in #${message.channel.name}`);

        // Check role whitelist
        if (config.whitelistRoleIds) {
            const allowedRoles = config.whitelistRoleIds.split(',');
            const member = await message.guild.members.fetch(message.author.id).catch(() => null);
            if (!member) return;

            const hasRole = allowedRoles.some(roleId => member.roles.cache.has(roleId));
            if (!hasRole) return; // User not whitelisted
        }

        // Wait 5 seconds before processing (gives CDN time to process original)
        logger.debug('⏳ Waiting 1 second before reposting...');
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Process each attachment
        const capturedItems = [];
        for (const attachment of message.attachments.values()) {
            // First, capture to DB
            const captureResult = await this.captureMedia(message, attachment, config, 'auto');
            if (captureResult.success) {
                capturedItems.push({
                    attachment,
                    media: captureResult.media
                });
            }
        }

        // If nothing was captured, return early
        if (capturedItems.length === 0) return;

        // Ask user if they want to add details (ephemeral prompt)
        const { tags, description } = await this.promptForDetails(message, capturedItems.length);

        // Now repost each item with the details
        for (const { attachment, media } of capturedItems) {
            await this.repostMedia(message, attachment, media, tags, description);
        }

        // Delete original message if any items were captured
        if (capturedItems.length > 0) {
            try {
                // Wait 1 second for Discord CDN to cache the media
                logger.debug('⏳ Waiting 1 second before deleting original...');
                await new Promise(resolve => setTimeout(resolve, 1000));

                await message.delete();
                logger.debug(`🗑️ Deleted original message with ${capturedItems.length} captured item(s)`);
            } catch (error) {
                logger.error(`Failed to delete original message: ${error.message}`);
            }
        }
    }

    /**
     * Prompt user to add tags/description before reposting
     * @param {Message} message - Original message
     * @param {number} count - Number of items captured
     * @returns {Object} { tags: string[], description: string }
     */
    async promptForDetails(message, count) {
        const { ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

        try {
            // Send ephemeral prompt
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`media_add_details_${message.id}`)
                    .setLabel('Add Details')
                    .setEmoji('✏️')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`media_skip_details_${message.id}`)
                    .setLabel('Skip')
                    .setEmoji('⏭️')
                    .setStyle(ButtonStyle.Secondary)
            );

            const promptMsg = await message.reply({
                content: `📸 Captured ${count} item(s)! Would you like to add tags or a description?`,
                components: [row],
                flags: [64] // Ephemeral
            });

            // Wait for button click (30 second timeout)
            const filter = i => i.user.id === message.author.id && i.message.id === promptMsg.id;
            const buttonInteraction = await promptMsg.awaitMessageComponent({ filter, time: 30000 }).catch(() => null);

            if (!buttonInteraction) {
                // Timeout - skip
                await promptMsg.delete().catch(() => {});
                return { tags: [], description: null };
            }

            if (buttonInteraction.customId.startsWith('media_skip_details')) {
                await buttonInteraction.update({ content: '⏭️ Skipped adding details!', components: [] });
                setTimeout(() => promptMsg.delete().catch(() => {}), 2000);
                return { tags: [], description: null };
            }

            // Show modal for details
            const modal = new ModalBuilder()
                .setCustomId(`media_details_modal_${message.id}`)
                .setTitle('Add Media Details');

            const tagsInput = new TextInputBuilder()
                .setCustomId('tags')
                .setLabel('Tags (comma-separated)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('gaming, funny, epic')
                .setRequired(false)
                .setMaxLength(200);

            const descInput = new TextInputBuilder()
                .setCustomId('description')
                .setLabel('Description')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Add a description...')
                .setRequired(false)
                .setMaxLength(1000);

            modal.addComponents(
                new ActionRowBuilder().addComponents(tagsInput),
                new ActionRowBuilder().addComponents(descInput)
            );

            await buttonInteraction.showModal(modal);

            // Wait for modal submission (60 second timeout)
            const modalSubmit = await buttonInteraction.awaitModalSubmit({ time: 60000 }).catch(() => null);

            if (!modalSubmit) {
                await promptMsg.delete().catch(() => {});
                return { tags: [], description: null };
            }

            const tagsStr = modalSubmit.fields.getTextInputValue('tags') || '';
            const desc = modalSubmit.fields.getTextInputValue('description') || null;

            const tags = tagsStr
                .split(',')
                .map(t => t.trim())
                .filter(t => t.length > 0);

            await modalSubmit.reply({ content: '✅ Details saved!', flags: [64] });
            await promptMsg.delete().catch(() => {});

            return { tags, description: desc };
        } catch (error) {
            logger.error(`Error prompting for details: ${error.message}`);
            return { tags: [], description: null };
        }
    }

    /**
     * Repost media with tags and description
     * @param {Message} message - Original message
     * @param {Attachment} attachment - Attachment object
     * @param {Object} media - Media DB record
     * @param {string[]} tags - Tags to add
     * @param {string} description - Description to add
     */
    async repostMedia(message, attachment, media, tags, description) {
        const mediaUtil = require('../utils/mediaUtil');

        try {
            // Add tags to database
            if (tags && tags.length > 0) {
                for (const tag of tags) {
                    await mediaUtil.addTag(media.id, tag, false);
                }
            }

            // Add description to database
            if (description) {
                await mediaUtil.updateDescription(message.author.id, media.id, description);
            }

            // Fetch updated media with tags
            const fullMedia = await mediaUtil.getMediaById(message.author.id, media.id);

            // Build and send the message
            const messagePayload = this.buildMediaMessage(fullMedia, attachment, message, message.author.id);
            const repostMessage = await message.channel.send(messagePayload);

            // Update DB with message ID
            const { mediaItems } = require('../database/schema');
            const { eq } = require('drizzle-orm');
            const { db } = require('../database/index');

            await dbLog.update('mediaItems',
                () => db.update(mediaItems)
                    .set({ messageId: repostMessage.id })
                    .where(eq(mediaItems.id, media.id)),
                { mediaId: media.id, messageId: repostMessage.id }
            );

            logger.debug(`📤 Reposted media with tags/description (ID: ${repostMessage.id})`);
        } catch (error) {
            logger.error(`Failed to repost media: ${error.message}`);
        }
    }

    /**
     * Build message payload for media repost (with tags and description)
     * @param {Object} mediaData - Media item with tags
     * @param {Object} attachment - Discord attachment
     * @param {Object} message - Original message
     * @param {string} authorId - Author user ID
     * @returns {Object} Message payload
     */
    buildMediaMessage(mediaData, attachment, message, authorId) {
        const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const configData = require('../utils/config');

        const fileType = this.categorizeFileType(attachment.contentType || mediaData.mimeType);
        const sizeMB = ((attachment.size || mediaData.fileSize) / (1024 * 1024)).toFixed(2);
        const dimensions = (attachment.width || mediaData.width) && (attachment.height || mediaData.height)
            ? `${attachment.width || mediaData.width}x${attachment.height || mediaData.height}`
            : null;

        const username = message.author?.username || authorId;

        // Delete button
        const deleteButton = new ButtonBuilder()
            .setCustomId(`media_delete_${mediaData.id}_${authorId}`)
            .setLabel('Delete')
            .setEmoji('🗑️')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(deleteButton);

        if (fileType === 'video') {
            // For videos, use plain text format
            let videoText = message.content
                ? `**${username}**: ${message.content}\n${mediaData.mediaUrl}`
                : `**${username}** posted:\n${mediaData.mediaUrl}`;

            videoText += `\n*${sizeMB} MB`;
            if (dimensions) videoText += ` • ${dimensions}`;
            videoText += ` • ID: \`${mediaData.id}\`*`;

            // Add description if exists
            if (mediaData.description) {
                videoText += `\n\n📝 ${mediaData.description}`;
            }

            // Add tags if exist
            if (mediaData.tags && mediaData.tags.length > 0) {
                const tagList = mediaData.tags.map(t => `#${t.tag}`).join(' ');
                videoText += `\n🏷️ ${tagList}`;
            }

            return {
                content: videoText,
                components: [row]
            };
        } else {
            // For images/audio, use embed
            const embed = new EmbedBuilder()
                .setColor(configData.brand.color)
                .setAuthor({
                    name: username,
                    iconURL: message.author?.displayAvatarURL() || null
                });

            if (message.content) {
                embed.setDescription(message.content);
            }

            if (fileType === 'image') {
                embed.setImage(mediaData.mediaUrl);
            } else if (fileType === 'audio') {
                embed.addFields({ name: '🎵 Audio', value: `[Click to play](${mediaData.mediaUrl})`, inline: false });
            }

            // Add description field if exists
            if (mediaData.description) {
                embed.addFields({ name: '📝 Description', value: mediaData.description, inline: false });
            }

            // Add tags field if exist
            if (mediaData.tags && mediaData.tags.length > 0) {
                const tagList = mediaData.tags.map(t => `#${t.tag}`).join(' ');
                embed.addFields({ name: '🏷️ Tags', value: tagList, inline: false });
            }

            let footerText = `📎 ${attachment.name || mediaData.fileName} • ${sizeMB} MB`;
            if (dimensions) footerText += ` • ${dimensions}`;
            footerText += ` • ID: ${mediaData.id}`;
            embed.setFooter({ text: footerText });
            embed.setTimestamp();

            return {
                embeds: [embed],
                components: [row]
            };
        }
    }

    /**
     * Capture media, save to DB, repost as embed, return new message
     * @param {Message} message - Discord message
     * @param {Attachment} attachment - Discord attachment
     * @param {Object} config - Channel config
     * @param {string} method - 'auto' or 'manual'
     * @returns {Object} { success: boolean, error?: string, media?: Object, repostMessage?: Message }
     */
    async captureAndRepost(message, attachment, config, method = 'auto') {
        // First, capture to database
        const captureResult = await this.captureMedia(message, attachment, config, method);
        if (!captureResult.success) {
            return captureResult;
        }

        try {
            // Build message with tags/description (initially empty)
            const mediaData = {
                id: captureResult.media.id,
                mimeType: attachment.contentType,
                fileSize: attachment.size,
                width: attachment.width,
                height: attachment.height,
                fileName: attachment.name,
                mediaUrl: attachment.url,
                description: null,
                tags: []
            };

            const messagePayload = this.buildMediaMessage(mediaData, attachment, message, message.author.id);

            // Post the message
            const repostMessage = await message.channel.send(messagePayload);

            // Update database with new message ID
            const { mediaItems } = require('../database/schema');
            const { eq } = require('drizzle-orm');
            await dbLog.update('mediaItems',
                () => db.update(mediaItems)
                    .set({ messageId: repostMessage.id })
                    .where(eq(mediaItems.id, captureResult.media.id)),
                { mediaId: captureResult.media.id, messageId: repostMessage.id }
            );

            logger.debug(`📤 Reposted media as embed (ID: ${repostMessage.id})`);

            return {
                success: true,
                media: captureResult.media,
                repostMessage
            };
        } catch (error) {
            logger.error(`Failed to repost media: ${error.message}`);
            if (error.rawError) {
                logger.error('Discord API Error:', JSON.stringify(error.rawError, null, 2));
            }
            if (error.stack) {
                logger.debug(error.stack);
            }
            return { success: false, error: 'Failed to repost media.' };
        }
    }

    /**
     * Capture a single media attachment (DB only, no repost)
     * @param {Message} message - Discord message
     * @param {Attachment} attachment - Discord attachment
     * @param {Object} config - Channel config
     * @param {string} method - 'auto' or 'manual'
     * @returns {Object} { success: boolean, error?: string, media?: Object }
     */
    async captureMedia(message, attachment, config, method = 'auto') {
        try {
            // Extract file type category
            const fileType = this.categorizeFileType(attachment.contentType);

            // Check if type is allowed
            const allowedTypes = config.fileTypes.split(',');
            if (!allowedTypes.includes(fileType)) {
                return { success: false, error: `File type ${fileType} not allowed in this channel.` };
            }

            // Check file size limit
            const sizeMB = attachment.size / (1024 * 1024);
            if (sizeMB > config.maxFileSizeMB) {
                return { success: false, error: `File size (${sizeMB.toFixed(1)} MB) exceeds limit (${config.maxFileSizeMB} MB).` };
            }

            // Check user's media count (500 limit)
            const userCount = await mediaUtil.getMediaCount(message.author.id);
            if (userCount >= 500) {
                return { success: false, error: 'Media limit reached (500 items).' };
            }

            // Build metadata with original URL first (archive happens after DB insert)
            const metadata = {
                userId: message.author.id,
                guildId: message.guild.id,
                channelId: message.channel.id,
                messageId: message.id,
                mediaUrl: attachment.url, // Original URL, will be updated after archiving
                fileName: attachment.name,
                fileType: fileType,
                mimeType: attachment.contentType,
                fileSize: attachment.size,
                width: attachment.width || null,
                height: attachment.height || null,
                duration: attachment.duration || null,
                contentPreview: message.content ? message.content.substring(0, 500) : null,
                authorId: message.author.id,
                captureMethod: method,
                storageMethod: 'discord', // Default, updated after archiving
                localFilePath: null,
                fileHash: null,
                archiveMessageId: null
            };

            // Save to DB first to get mediaId
            const result = await mediaUtil.saveMedia(metadata);

            if (result.success) {
                logger.debug(`✅ Captured media: ${attachment.name} (${fileType}, ${sizeMB.toFixed(1)} MB) from #${message.channel.name}`);

                // Archive media to persistent storage (prevents URL expiration)
                // Size limits: 100MB for local storage, 25MB for Discord archive channel
                const botConfig = require('../../config.json');
                const storageMethod = botConfig.media?.storageMethod || 'discord';
                const MAX_LOCAL_SIZE = 100 * 1024 * 1024; // 100 MB
                const MAX_DISCORD_ARCHIVE_SIZE = 25 * 1024 * 1024; // 25 MB (Discord upload limit)
                const sizeLimit = storageMethod === 'local' ? MAX_LOCAL_SIZE : MAX_DISCORD_ARCHIVE_SIZE;

                if (attachment.size <= sizeLimit) {
                    logger.debug(`📦 Archiving ${attachment.name} to ${storageMethod} storage...`);
                    const archiveResult = await mediaUtil.archiveMedia(
                        attachment.url,
                        attachment.name,
                        message.guild,
                        message.author.id,
                        result.media.id
                    );

                    if (archiveResult.success) {
                        // Update DB record with archive info
                        const { db } = require('../database/index');
                        const { mediaItems } = require('../database/schema');
                        const { eq } = require('drizzle-orm');

                        await db.update(mediaItems)
                            .set({
                                mediaUrl: archiveResult.url,
                                storageMethod: archiveResult.storageMethod,
                                localFilePath: archiveResult.localFilePath,
                                fileHash: archiveResult.fileHash,
                                archiveMessageId: archiveResult.archiveMessageId
                            })
                            .where(eq(mediaItems.id, result.media.id));

                        logger.debug(`✅ Archived to ${storageMethod} storage`);
                    } else {
                        logger.warn(`Failed to archive ${attachment.name}: ${archiveResult.error}. Using original URL (may expire).`);
                    }
                } else {
                    const sizeMBFormatted = (attachment.size / (1024 * 1024)).toFixed(1);
                    const limitMB = (sizeLimit / (1024 * 1024)).toFixed(0);
                    logger.warn(`⚠️ Skipping archive for ${attachment.name} (${sizeMBFormatted} MB) - exceeds ${limitMB} MB limit for ${storageMethod} storage. Using original URL (may expire).`);
                }

                // Auto-tag with channel name if enabled
                if (config.autoTagChannel && message.channel?.name) {
                    const channelName = message.channel.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (channelName) {
                        await mediaUtil.addTag(result.media.id, channelName, true);
                    }
                }
            } else {
                logger.debug(`❌ Failed to capture ${attachment.name}: ${result.error}`);
            }

            return result;
        } catch (error) {
            logger.error(`Media capture error: ${error}`);
            return { success: false, error: 'Failed to capture media.' };
        }
    }

    /**
     * Categorize MIME type into broad category
     * @param {string} mimeType - MIME type
     * @returns {string} Category
     */
    categorizeFileType(mimeType) {
        if (!mimeType) return 'other';

        if (mimeType.startsWith('image/')) return 'image';
        if (mimeType.startsWith('video/')) return 'video';
        if (mimeType.startsWith('audio/')) return 'audio';
        if (mimeType === 'application/pdf' || mimeType.startsWith('application/vnd')) return 'document';

        return 'other';
    }

    /**
     * Get channel config with caching
     * @param {string} channelId - Channel ID
     * @returns {Object|null} Channel config
     */
    async getChannelConfig(channelId) {
        // Check cache
        const cached = this.configCache.get(channelId);
        const expiry = this.cacheExpiry.get(channelId) || 0;

        if (cached && Date.now() < expiry) {
            return cached;
        }

        // Fetch from DB
        try {
            const config = await dbLog.select('mediaGalleryConfig',
                () => db.select()
                    .from(mediaGalleryConfig)
                    .where(eq(mediaGalleryConfig.channelId, channelId))
                    .get(),
                { channelId }
            );

            // Cache for 5 minutes
            if (config) {
                this.configCache.set(channelId, config);
                this.cacheExpiry.set(channelId, Date.now() + 300000);
            }

            return config;
        } catch (error) {
            logger.error(`Failed to get channel config: ${error}`);
            return null;
        }
    }

    /**
     * Clear cache for a specific channel (call after config updates)
     * @param {string} channelId - Channel ID
     */
    clearChannelCache(channelId) {
        this.configCache.delete(channelId);
        this.cacheExpiry.delete(channelId);
    }
}

module.exports = MediaGalleryService;
