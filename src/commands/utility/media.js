const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { db } = require('../../database');
const { mediaGalleryConfig } = require('../../database/schema');
const { eq, and } = require('drizzle-orm');
const embeds = require('../../utils/embeds');
const mediaUtil = require('../../utils/mediaUtil');
const { handleCommandError } = require('../../utils/errorHandlerUtil');
const { sendPaginatedMessage } = require('../../utils/paginationUtil');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('media')
        .setDescription('Manage your media gallery')
        .setDMPermission(false)

        // Setup subcommand (Admin only)
        .addSubcommand(sub => sub
            .setName('setup')
            .setDescription('Configure auto-capture for a channel (requires ManageChannels)')
            .addChannelOption(opt => opt
                .setName('channel')
                .setDescription('Channel to auto-capture media from')
                .setRequired(true))
            .addStringOption(opt => opt
                .setName('types')
                .setDescription('File types to capture')
                .setRequired(false)
                .addChoices(
                    { name: 'Images only', value: 'image' },
                    { name: 'Videos only', value: 'video' },
                    { name: 'Images + Videos', value: 'image,video' },
                    { name: 'All media', value: 'image,video,audio' },
                    { name: 'All files', value: 'image,video,audio,document' }
                ))
            .addIntegerOption(opt => opt
                .setName('max_size')
                .setDescription('Max file size in MB (default: 50)')
                .setMinValue(1)
                .setMaxValue(100))
            .addRoleOption(opt => opt
                .setName('whitelist_role')
                .setDescription('Only capture media from users with this role (optional)')))

        // List subcommand
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('Browse your saved media')
            .addIntegerOption(opt => opt
                .setName('page')
                .setDescription('Page number (10 items per page)')
                .setMinValue(1))
            .addStringOption(opt => opt
                .setName('type')
                .setDescription('Filter by file type')
                .addChoices(
                    { name: 'Images', value: 'image' },
                    { name: 'Videos', value: 'video' },
                    { name: 'Audio', value: 'audio' },
                    { name: 'Documents', value: 'document' }
                ))
            .addChannelOption(opt => opt
                .setName('channel')
                .setDescription('Filter by source channel')))

        // Delete subcommand
        .addSubcommand(sub => sub
            .setName('delete')
            .setDescription('Delete a media item from your gallery')
            .addIntegerOption(opt => opt
                .setName('id')
                .setDescription('Media ID')
                .setRequired(true)
                .setMinValue(1)))

        // Search subcommand
        .addSubcommand(sub => sub
            .setName('search')
            .setDescription('Search your media by description or filename')
            .addStringOption(opt => opt
                .setName('query')
                .setDescription('Search query')
                .setRequired(true)
                .setMinLength(2)))

        // View subcommand
        .addSubcommand(sub => sub
            .setName('view')
            .setDescription('View detailed info for a media item')
            .addIntegerOption(opt => opt
                .setName('id')
                .setDescription('Media ID')
                .setRequired(true)
                .setMinValue(1)))

        // Tag subcommand
        .addSubcommand(sub => sub
            .setName('tag')
            .setDescription('Add tags to a media item')
            .addIntegerOption(opt => opt
                .setName('id')
                .setDescription('Media ID')
                .setRequired(true)
                .setMinValue(1))
            .addStringOption(opt => opt
                .setName('tags')
                .setDescription('Tags to add (comma-separated)')
                .setRequired(true)))

        // Describe subcommand
        .addSubcommand(sub => sub
            .setName('describe')
            .setDescription('Add or update description for a media item')
            .addIntegerOption(opt => opt
                .setName('id')
                .setDescription('Media ID')
                .setRequired(true)
                .setMinValue(1))
            .addStringOption(opt => opt
                .setName('description')
                .setDescription('Description/caption (max 1000 chars)')
                .setRequired(true)
                .setMaxLength(1000)))

        // Disable subcommand
        .addSubcommand(sub => sub
            .setName('disable')
            .setDescription('Disable auto-capture for a channel (requires ManageChannels)')
            .addChannelOption(opt => opt
                .setName('channel')
                .setDescription('Channel to disable auto-capture for')
                .setRequired(true)))

        // Help subcommand
        .addSubcommand(sub => sub
            .setName('help')
            .setDescription('Learn how to use the media gallery system')),

    permissions: [],
    cooldown: 3,

    async execute(interaction, client) {
        // Defer as ephemeral for all subcommands
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'setup':
                await handleSetup(interaction, client);
                break;
            case 'list':
                await handleList(interaction);
                break;
            case 'delete':
                await handleDelete(interaction);
                break;
            case 'search':
                await handleSearch(interaction);
                break;
            case 'view':
                await handleView(interaction);
                break;
            case 'tag':
                await handleTag(interaction);
                break;
            case 'describe':
                await handleDescribe(interaction);
                break;
            case 'disable':
                await handleDisable(interaction, client);
                break;
            case 'help':
                await handleHelp(interaction);
                break;
        }
    },

    async handleInteraction(interaction, client) {
        // Handle delete button (from reposted embeds)
        if (interaction.isButton() && interaction.customId.startsWith('media_delete_')) {
            // Parse: media_delete_{mediaId}_{authorId}
            const parts = interaction.customId.split('_');
            const mediaId = parseInt(parts[2]);
            const authorId = parts[3];

            // Verify user is the original author
            if (interaction.user.id !== authorId) {
                return interaction.reply({
                    embeds: [embeds.error('Permission Denied', 'Only the original poster can delete this media.')],
                    flags: [MessageFlags.Ephemeral]
                });
            }

            try {
                // Get media details for archive deletion
                const media = await mediaUtil.getMediaById(authorId, mediaId);

                // Delete archive message if it exists
                if (media?.archiveMessageId) {
                    try {
                        const { guilds } = require('../../database/schema');
                        const guildData = await db.select().from(guilds)
                            .where(eq(guilds.id, interaction.guild.id))
                            .get();

                        if (guildData?.mediaArchiveChannelId) {
                            const archiveChannel = await interaction.guild.channels.fetch(guildData.mediaArchiveChannelId);
                            if (archiveChannel) {
                                const archiveMessage = await archiveChannel.messages.fetch(media.archiveMessageId);
                                await archiveMessage.delete();
                                logger.debug(`Deleted archive message ${media.archiveMessageId} for media ${mediaId}`);
                            }
                        }
                    } catch (err) {
                        logger.debug(`Could not delete archive message: ${err.message}`);
                        // Continue anyway
                    }
                }

                // Delete from database
                const result = await mediaUtil.deleteMedia(authorId, mediaId);

                if (result.success) {
                    // Delete the embed message
                    await interaction.message.delete();

                    // Send ephemeral confirmation
                    await interaction.reply({
                        embeds: [embeds.success('Media Deleted', 'Your media has been removed from the gallery and archive.')],
                        flags: [MessageFlags.Ephemeral]
                    });
                } else {
                    await interaction.reply({
                        embeds: [embeds.error('Delete Failed', 'Could not delete this media.')],
                        flags: [MessageFlags.Ephemeral]
                    });
                }
            } catch (error) {
                logger.error(`Delete button error: ${error}`);
                await interaction.reply({
                    embeds: [embeds.error('Error', 'An error occurred while deleting.')],
                    flags: [MessageFlags.Ephemeral]
                });
            }
            return;
        }

        // Note: Pagination buttons are now handled automatically by paginationUtil
    }
};

/**
 * /media setup - Configure auto-capture
 */
async function handleSetup(interaction, client) {
    // Check ManageChannels permission
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.editReply({
            embeds: [embeds.error('Permission Denied', 'You need **Manage Channels** permission.')],
            flags: [MessageFlags.Ephemeral]
        });
    }

    const channel = interaction.options.getChannel('channel');
    const types = interaction.options.getString('types') || 'image,video,audio';
    const maxSize = interaction.options.getInteger('max_size') || 50;
    const whitelistRole = interaction.options.getRole('whitelist_role');

    // Validate channel is a text channel
    if (channel.type !== ChannelType.GuildText) {
        return interaction.editReply({
            embeds: [embeds.error('Invalid Channel', 'Please select a text channel.')],
            flags: [MessageFlags.Ephemeral]
        });
    }

    try {
        // Check if config exists
        const existing = await db.select().from(mediaGalleryConfig)
            .where(and(
                eq(mediaGalleryConfig.guildId, interaction.guild.id),
                eq(mediaGalleryConfig.channelId, channel.id)
            ))
            .get();

        if (existing) {
            // Update
            await db.update(mediaGalleryConfig)
                .set({
                    fileTypes: types,
                    maxFileSizeMB: maxSize,
                    whitelistRoleIds: whitelistRole ? whitelistRole.id : null,
                    updatedAt: new Date()
                })
                .where(eq(mediaGalleryConfig.id, existing.id));
        } else {
            // Insert
            await db.insert(mediaGalleryConfig).values({
                guildId: interaction.guild.id,
                channelId: channel.id,
                enabled: true,
                autoCapture: true,
                fileTypes: types,
                maxFileSizeMB: maxSize,
                autoTagChannel: true,
                whitelistRoleIds: whitelistRole ? whitelistRole.id : null,
                createdBy: interaction.user.id,
                createdAt: new Date(),
                updatedAt: new Date()
            });
        }

        // Clear service cache
        if (client.mediaGalleryService) {
            client.mediaGalleryService.clearChannelCache(channel.id);
        }

        // Create archive channel now (so admins can see it immediately)
        const archiveResult = await mediaUtil.getOrCreateArchiveChannel(interaction.guild);
        let archiveInfo = '';
        if (archiveResult.success) {
            archiveInfo = `📦 **Archive Channel:** ${archiveResult.channel} (hidden from members)\n` +
                         `💡 **Note:** Files ≤25 MB are archived permanently. Larger files use original URLs.\n`;
        } else {
            archiveInfo = `⚠️ **Archive:** Will be created automatically on first media save.\n`;
        }

        const successEmbed = embeds.success(
            'Media Gallery Configured',
            `Auto-capture enabled for ${channel}\n\n` +
            `**File Types:** ${types.split(',').join(', ')}\n` +
            `**Max Size:** ${maxSize} MB\n` +
            `**Whitelist:** ${whitelistRole ? whitelistRole.name : 'All members'}\n\n` +
            archiveInfo +
            `Media from this channel will now be automatically saved to user galleries.`
        );

        return interaction.editReply({
            embeds: [successEmbed],
            flags: [MessageFlags.Ephemeral]
        });
    } catch (error) {
        await handleCommandError(error, interaction, 'configuring media gallery');
    }
}

/**
 * /media disable - Disable auto-capture for a channel
 */
async function handleDisable(interaction, client) {
    // Check ManageChannels permission
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.editReply({
            embeds: [embeds.error('Permission Denied', 'You need **Manage Channels** permission.')],
            flags: [MessageFlags.Ephemeral]
        });
    }

    const channel = interaction.options.getChannel('channel');

    try {
        // Check if config exists
        const existing = await db.select().from(mediaGalleryConfig)
            .where(and(
                eq(mediaGalleryConfig.guildId, interaction.guild.id),
                eq(mediaGalleryConfig.channelId, channel.id)
            ))
            .get();

        if (!existing) {
            return interaction.editReply({
                embeds: [embeds.error(
                    'Not Configured',
                    `${channel} does not have media gallery auto-capture enabled.`
                )],
                flags: [MessageFlags.Ephemeral]
            });
        }

        // Delete the configuration
        await db.delete(mediaGalleryConfig)
            .where(eq(mediaGalleryConfig.id, existing.id));

        // Clear service cache
        if (client.mediaGalleryService) {
            client.mediaGalleryService.clearChannelCache(channel.id);
        }

        // Check if guild has an archive channel
        const { guilds } = require('../../database/schema');
        const guildData = await db.select().from(guilds)
            .where(eq(guilds.id, interaction.guild.id))
            .get();

        if (guildData?.mediaArchiveChannelId) {
            // Ask if they want to delete the archive channel too
            const confirmEmbed = embeds.warn(
                'Auto-Capture Disabled',
                `Media gallery auto-capture has been disabled for ${channel}.\n\n` +
                `Do you also want to delete the **archive channel**? This will permanently remove all archived media files.\n\n` +
                `⚠️ **Warning:** Deleting the archive channel will break all existing media gallery items - their URLs will no longer work!`
            );

            const confirmButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('delete_archive_yes')
                        .setLabel('Yes, Delete Archive')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🗑️'),
                    new ButtonBuilder()
                        .setCustomId('delete_archive_no')
                        .setLabel('No, Keep Archive')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('✅')
                );

            await interaction.editReply({
                embeds: [confirmEmbed],
                components: [confirmButtons],
                flags: [MessageFlags.Ephemeral]
            });

            // Wait for button click (30 second timeout)
            const filter = i => i.user.id === interaction.user.id;
            const buttonInteraction = await interaction.channel.awaitMessageComponent({
                filter,
                time: 30000
            }).catch(() => null);

            if (!buttonInteraction) {
                // Timeout - keep archive
                return interaction.editReply({
                    embeds: [embeds.info('Timed Out', 'Archive channel was kept (no action taken).')],
                    components: [],
                    flags: [MessageFlags.Ephemeral]
                });
            }

            if (buttonInteraction.customId === 'delete_archive_yes') {
                // Delete the archive channel
                try {
                    const archiveChannel = await interaction.guild.channels.fetch(guildData.mediaArchiveChannelId);
                    if (archiveChannel) {
                        await archiveChannel.delete('Media gallery disabled - archive deleted by admin');
                    }

                    // Clear from database
                    await db.update(guilds)
                        .set({ mediaArchiveChannelId: null })
                        .where(eq(guilds.id, interaction.guild.id));

                    await buttonInteraction.update({
                        embeds: [embeds.success(
                            'Archive Deleted',
                            `Auto-capture disabled for ${channel} and archive channel deleted.\n\n` +
                            `⚠️ All existing media gallery items will have broken URLs.`
                        )],
                        components: [],
                        flags: [MessageFlags.Ephemeral]
                    });
                } catch (error) {
                    logger.error('Failed to delete archive channel:', error);
                    await buttonInteraction.update({
                        embeds: [embeds.error(
                            'Delete Failed',
                            'Could not delete archive channel. It may have been deleted already.'
                        )],
                        components: [],
                        flags: [MessageFlags.Ephemeral]
                    });
                }
            } else {
                // Keep archive
                await buttonInteraction.update({
                    embeds: [embeds.success(
                        'Auto-Capture Disabled',
                        `Auto-capture disabled for ${channel}.\n\n` +
                        `Archive channel was kept - existing media will continue to work.`
                    )],
                    components: [],
                    flags: [MessageFlags.Ephemeral]
                });
            }
        } else {
            // No archive channel exists, just show success
            const successEmbed = embeds.success(
                'Auto-Capture Disabled',
                `Media gallery auto-capture has been disabled for ${channel}.\n\n` +
                `Existing saved media will not be affected.`
            );

            return interaction.editReply({
                embeds: [successEmbed],
                flags: [MessageFlags.Ephemeral]
            });
        }
    } catch (error) {
        await handleCommandError(error, interaction, 'disabling auto-capture');
    }
}

/**
 * /media list - Browse media with filters
 */
async function handleList(interaction) {
    const page = interaction.options.getInteger('page') || 1;
    const fileType = interaction.options.getString('type');
    const channel = interaction.options.getChannel('channel');

    const perPage = 10;
    const userId = interaction.user.id;

    try {
        const totalCount = await mediaUtil.getMediaCount(userId);

        if (totalCount === 0) {
            return interaction.editReply({
                embeds: [embeds.info(
                    'No Media',
                    'Your gallery is empty.\n\n' +
                    'Right-click a message with media and select **Apps > Save Media** to start collecting.'
                )],
                flags: [MessageFlags.Ephemeral]
            });
        }

        // Encode filters in customId prefix
        const customIdPrefix = `media_list_${fileType || 'all'}_${channel?.id || 'all'}`;

        // Render function for each page
        const renderPage = async (pageNum) => {
            const offset = (pageNum - 1) * perPage;

            const filterOptions = {
                limit: perPage,
                offset,
                fileType: fileType || undefined,
                channelId: channel?.id || undefined
            };

            const mediaList = await mediaUtil.getMedia(userId, filterOptions);
            const totalPages = Math.ceil(totalCount / perPage);

            if (mediaList.length === 0) {
                return embeds.info('No Results', 'No media matches your filters.');
            }

            // Build embed
            const listEmbed = embeds.brand(
                'Media Gallery',
                `Showing page ${pageNum} of ${totalPages} (${totalCount} total items)`
            );

            for (const media of mediaList) {
                const icon = getFileTypeIcon(media.fileType);
                const sizeKB = Math.round(media.fileSize / 1024);
                const dimensions = media.width && media.height ? `${media.width}x${media.height}` : 'N/A';

                let fieldValue = `${icon} **${media.fileName}**\n`;
                fieldValue += `**ID:** \`${media.id}\` | **Size:** ${sizeKB} KB`;

                if (media.fileType === 'image' || media.fileType === 'video') {
                    fieldValue += ` | **Dimensions:** ${dimensions}`;
                }

                fieldValue += `\n**Channel:** <#${media.channelId}>`;

                if (media.messageDeleted) {
                    fieldValue += '\n⚠️ *Original message deleted*';
                }

                listEmbed.addFields([{
                    name: `<t:${Math.floor(media.savedAt.getTime() / 1000)}:R>`,
                    value: fieldValue
                }]);
            }

            // Add thumbnail (first image in the list with valid URL)
            const firstImage = mediaList.find(m => m.fileType === 'image' && !m.messageDeleted && !m.urlExpired);
            if (firstImage) {
                listEmbed.setThumbnail(firstImage.mediaUrl);
            }

            // Calculate stats
            const totalSizeMB = mediaList.reduce((sum, m) => sum + (m.fileSize || 0), 0) / (1024 * 1024);

            // Add footer with stats
            let footerText = `Page ${pageNum}/${totalPages} | ${totalCount}/500 items | ~${totalSizeMB.toFixed(1)} MB on this page`;
            if (fileType || channel) {
                footerText += ' | Filters active';
            }
            listEmbed.setFooter({ text: footerText });

            return listEmbed;
        };

        const totalPages = Math.ceil(totalCount / perPage);

        // Use pagination utility
        await sendPaginatedMessage({
            interaction,
            renderPage,
            totalPages,
            customIdPrefix,
            timeout: 300000,
            initialPage: page - 1, // Convert to 0-indexed
            deferred: true
        });
    } catch (error) {
        logger.error('Media list error:', error);
        return interaction.editReply({
            embeds: [embeds.error('List Failed', 'An error occurred while fetching your media.')],
            flags: [MessageFlags.Ephemeral]
        });
    }
}

/**
 * /media delete - Delete a media item
 */
async function handleDelete(interaction) {
    const mediaId = interaction.options.getInteger('id');

    try {
        // Check if media exists and belongs to user
        const media = await mediaUtil.getMediaById(interaction.user.id, mediaId);

        if (!media) {
            return interaction.editReply({
                embeds: [embeds.error(
                    'Not Found',
                    `Media item \`${mediaId}\` not found or you don't have permission to delete it.`
                )],
                flags: [MessageFlags.Ephemeral]
            });
        }

        // Try to delete the Discord message (reposted embed) if it exists
        if (media.messageId && media.channelId) {
            try {
                const channel = await interaction.client.channels.fetch(media.channelId).catch(() => null);
                if (channel) {
                    const message = await channel.messages.fetch(media.messageId).catch(() => null);
                    if (message) {
                        await message.delete();
                        logger.debug(`Deleted embed message ${media.messageId} for media ${mediaId}`);
                    }
                }
            } catch (err) {
                logger.debug(`Could not delete embed message: ${err.message}`);
                // Continue anyway - we still want to delete from DB
            }
        }

        // Delete archive message if it exists
        if (media.archiveMessageId) {
            try {
                const { guilds } = require('../../database/schema');
                const guildData = await db.select().from(guilds)
                    .where(eq(guilds.id, interaction.guild.id))
                    .get();

                if (guildData?.mediaArchiveChannelId) {
                    const archiveChannel = await interaction.guild.channels.fetch(guildData.mediaArchiveChannelId);
                    if (archiveChannel) {
                        const archiveMessage = await archiveChannel.messages.fetch(media.archiveMessageId);
                        await archiveMessage.delete();
                        logger.debug(`Deleted archive message ${media.archiveMessageId} for media ${mediaId}`);
                    }
                }
            } catch (err) {
                logger.debug(`Could not delete archive message: ${err.message}`);
                // Continue anyway - we still want to delete from DB
            }
        }

        // Delete from database
        const result = await mediaUtil.deleteMedia(interaction.user.id, mediaId);

        if (result.success) {
            const successEmbed = embeds.success(
                'Media Deleted',
                `Successfully deleted **${media.fileName}** (ID: \`${mediaId}\`).\nThe reposted embed and archived file have been removed.`
            );

            return interaction.editReply({
                embeds: [successEmbed],
                flags: [MessageFlags.Ephemeral]
            });
        } else {
            return interaction.editReply({
                embeds: [embeds.error('Delete Failed', result.error || 'An error occurred.')],
                flags: [MessageFlags.Ephemeral]
            });
        }
    } catch (error) {
        logger.error('Media delete error:', error);
        return interaction.editReply({
            embeds: [embeds.error('Delete Failed', 'An error occurred while deleting the media.')],
            flags: [MessageFlags.Ephemeral]
        });
    }
}

/**
 * Helper: Get emoji icon for file type
 */
function getFileTypeIcon(type) {
    const icons = {
        image: '🖼️',
        video: '🎥',
        audio: '🎵',
        document: '📄',
        other: '📎'
    };
    return icons[type] || icons.other;
}

/**
 * /media search - Search media by query
 */
async function handleSearch(interaction) {
    const query = interaction.options.getString('query');

    try {
        const { results, total } = await mediaUtil.searchMedia(interaction.user.id, query);

        if (total === 0) {
            return interaction.editReply({
                embeds: [embeds.info(
                    'No Results',
                    `No media found matching **"${query}"**.`
                )],
                flags: [MessageFlags.Ephemeral]
            });
        }

        // Build embed
        const searchEmbed = embeds.brand(
            'Search Results',
            `Found **${total}** item(s) matching **"${query}"**` + (total > 10 ? ` (showing first 10)` : '')
        );

        for (const media of results) {
            const icon = getFileTypeIcon(media.fileType);
            const sizeKB = Math.round(media.fileSize / 1024);

            let fieldValue = `${icon} **${media.fileName}**\n`;
            fieldValue += `**ID:** \`${media.id}\` | **Size:** ${sizeKB} KB`;
            fieldValue += `\n**Channel:** <#${media.channelId}>`;

            if (media.description) {
                const preview = media.description.substring(0, 100);
                fieldValue += `\n*${preview}${media.description.length > 100 ? '...' : ''}*`;
            }

            if (media.messageDeleted) {
                fieldValue += '\n⚠️ *Original message deleted*';
            }

            searchEmbed.addFields([{
                name: `<t:${Math.floor(media.savedAt.getTime() / 1000)}:R>`,
                value: fieldValue
            }]);
        }

        // Add thumbnail (first image in search results with valid URL)
        const firstImage = results.find(m => m.fileType === 'image' && !m.messageDeleted && !m.urlExpired);
        if (firstImage) {
            searchEmbed.setThumbnail(firstImage.mediaUrl);
        }

        searchEmbed.setFooter({ text: `${total} total result(s)` });

        return interaction.editReply({
            embeds: [searchEmbed],
            flags: [MessageFlags.Ephemeral]
        });
    } catch (error) {
        logger.error('Media search error:', error);
        return interaction.editReply({
            embeds: [embeds.error('Search Failed', 'An error occurred while searching.')],
            flags: [MessageFlags.Ephemeral]
        });
    }
}

/**
 * /media view - View detailed media info
 */
async function handleView(interaction) {
    const mediaId = interaction.options.getInteger('id');

    try {
        const media = await mediaUtil.getMediaById(interaction.user.id, mediaId);

        if (!media) {
            return interaction.editReply({
                embeds: [embeds.error(
                    'Not Found',
                    `Media item \`${mediaId}\` not found or you don't have permission to view it.`
                )],
                flags: [MessageFlags.Ephemeral]
            });
        }

        const icon = getFileTypeIcon(media.fileType);
        const sizeKB = Math.round(media.fileSize / 1024);
        const sizeMB = (media.fileSize / (1024 * 1024)).toFixed(2);

        // Build detailed embed
        const viewEmbed = embeds.brand(
            `${icon} ${media.fileName}`,
            media.description || '*No description*'
        );

        // Basic info
        let infoValue = `**ID:** \`${media.id}\`\n`;
        infoValue += `**Type:** ${media.fileType}\n`;
        infoValue += `**Size:** ${sizeKB} KB (${sizeMB} MB)\n`;
        if (media.mimeType) {
            infoValue += `**MIME:** ${media.mimeType}\n`;
        }
        viewEmbed.addFields([{ name: 'Info', value: infoValue, inline: true }]);

        // Dimensions (if applicable)
        if (media.width && media.height) {
            let dimValue = `${media.width} x ${media.height} px`;
            if (media.duration) {
                dimValue += `\n**Duration:** ${Math.floor(media.duration)}s`;
            }
            viewEmbed.addFields([{ name: 'Dimensions', value: dimValue, inline: true }]);
        }

        // Source info
        let sourceValue = `**Channel:** <#${media.channelId}>\n`;
        sourceValue += `**Author:** <@${media.authorId}>\n`;
        sourceValue += `**Saved:** <t:${Math.floor(media.savedAt.getTime() / 1000)}:F>\n`;
        sourceValue += `**Method:** ${media.captureMethod}`;
        viewEmbed.addFields([{ name: 'Source', value: sourceValue, inline: false }]);

        // Tags
        if (media.tags && media.tags.length > 0) {
            const tagList = media.tags.map(t => `\`${t.tag}\`${t.autoGenerated ? ' (auto)' : ''}`).join(', ');
            viewEmbed.addFields([{ name: 'Tags', value: tagList, inline: false }]);
        }

        // Original message preview
        if (media.contentPreview) {
            const preview = media.contentPreview.substring(0, 200);
            viewEmbed.addFields([{
                name: 'Message Preview',
                value: preview + (media.contentPreview.length > 200 ? '...' : ''),
                inline: false
            }]);
        }

        // Status warnings
        if (media.messageDeleted || media.urlExpired) {
            let statusText = '';
            if (media.messageDeleted) {
                statusText = 'Original message has been deleted';
            }
            if (media.urlExpired) {
                statusText += (statusText ? ' - ' : '') + 'Media URL no longer available';
            }
            viewEmbed.addFields([{
                name: '⚠️ Status',
                value: statusText,
                inline: false
            }]);
        }

        // Media URL link (with warning if expired)
        const urlText = media.urlExpired
            ? `~~[View Media](${media.mediaUrl})~~ *(URL expired)*`
            : `[View Media](${media.mediaUrl})`;
        viewEmbed.addFields([{
            name: 'Links',
            value: urlText,
            inline: false
        }]);

        // Add image/video as thumbnail or image (only if URL is valid)
        if (media.fileType === 'image' && !media.messageDeleted && !media.urlExpired) {
            viewEmbed.setImage(media.mediaUrl);
        } else if (media.fileType === 'video' && !media.messageDeleted && !media.urlExpired) {
            viewEmbed.setThumbnail(media.mediaUrl);
        }

        return interaction.editReply({
            embeds: [viewEmbed],
            flags: [MessageFlags.Ephemeral]
        });
    } catch (error) {
        logger.error('Media view error:', error);
        return interaction.editReply({
            embeds: [embeds.error('View Failed', 'An error occurred while fetching media details.')],
            flags: [MessageFlags.Ephemeral]
        });
    }
}

/**
 * /media tag - Add tags to media
 */
async function handleTag(interaction) {
    const mediaId = interaction.options.getInteger('id');
    const tagsInput = interaction.options.getString('tags');

    try {
        // Verify ownership
        const media = await mediaUtil.getMediaById(interaction.user.id, mediaId);

        if (!media) {
            return interaction.editReply({
                embeds: [embeds.error(
                    'Not Found',
                    `Media item \`${mediaId}\` not found or you don't have permission to tag it.`
                )],
                flags: [MessageFlags.Ephemeral]
            });
        }

        // Parse tags (comma-separated)
        const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t.length > 0);

        if (tags.length === 0) {
            return interaction.editReply({
                embeds: [embeds.error('Invalid Tags', 'Please provide at least one tag.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        // Add tags
        const results = [];
        for (const tag of tags) {
            const result = await mediaUtil.addTag(mediaId, tag, false);
            if (result.success) {
                results.push(`✓ ${tag}`);
            } else if (result.error.includes('already exists')) {
                results.push(`⚠️ ${tag} (already exists)`);
            } else {
                results.push(`✗ ${tag} (${result.error})`);
            }
        }

        // Update the Discord message to show new tags
        await updateMediaMessage(interaction.client, media);

        const successEmbed = embeds.success(
            'Tags Updated',
            `Tags for **${media.fileName}** (ID: \`${mediaId}\`):\n\n${results.join('\n')}\n\n✨ The posted message has been updated!`
        );

        return interaction.editReply({
            embeds: [successEmbed],
            flags: [MessageFlags.Ephemeral]
        });
    } catch (error) {
        logger.error('Media tag error:', error);
        return interaction.editReply({
            embeds: [embeds.error('Tag Failed', 'An error occurred while adding tags.')],
            flags: [MessageFlags.Ephemeral]
        });
    }
}

/**
 * /media describe - Add/update description
 */
async function handleDescribe(interaction) {
    const mediaId = interaction.options.getInteger('id');
    const description = interaction.options.getString('description');

    try {
        // Verify ownership
        const media = await mediaUtil.getMediaById(interaction.user.id, mediaId);

        if (!media) {
            return interaction.editReply({
                embeds: [embeds.error(
                    'Not Found',
                    `Media item \`${mediaId}\` not found or you don't have permission to edit it.`
                )],
                flags: [MessageFlags.Ephemeral]
            });
        }

        // Update description
        const result = await mediaUtil.updateDescription(interaction.user.id, mediaId, description);

        if (result.success) {
            // Update the Discord message to show new description
            media.description = description; // Update local object
            await updateMediaMessage(interaction.client, media);

            const successEmbed = embeds.success(
                'Description Updated',
                `Updated description for **${media.fileName}** (ID: \`${mediaId}\`):\n\n*${description}*\n\n✨ The posted message has been updated!`
            );

            return interaction.editReply({
                embeds: [successEmbed],
                flags: [MessageFlags.Ephemeral]
            });
        } else {
            return interaction.editReply({
                embeds: [embeds.error('Update Failed', 'An error occurred while updating the description.')],
                flags: [MessageFlags.Ephemeral]
            });
        }
    } catch (error) {
        logger.error('Media describe error:', error);
        return interaction.editReply({
            embeds: [embeds.error('Update Failed', 'An error occurred while updating the description.')],
            flags: [MessageFlags.Ephemeral]
        });
    }
}

/**
 * /media help - Show comprehensive user guide
 */
async function handleHelp(interaction) {
    const helpEmbed = embeds.brand(
        '📸 Media Gallery - User Guide',
        'Learn how to use the media gallery system to save, organize, and browse your media!'
    );

    helpEmbed.addFields([
        {
            name: '💾 Saving Media',
            value: '**Auto-Capture:** Media posted in configured channels is automatically saved to your gallery.\n' +
                   '**Manual Save:** Right-click any message → Apps → "Save Media" to manually save attachments.\n' +
                   '**Archive System:** Media ≤25 MB is archived permanently. Larger files use original URLs (may expire if message is deleted).',
            inline: false
        },
        {
            name: '🗂️ Browsing Your Gallery',
            value: '`/media list` - Browse all your saved media\n' +
                   '`/media list type:Images` - Filter by file type\n' +
                   '`/media list channel:#photos` - Filter by source channel\n' +
                   '`/media view id:123` - View detailed info for a specific item',
            inline: false
        },
        {
            name: '🔍 Searching & Organizing',
            value: '`/media search query:vacation` - Search by description, filename, or message content\n' +
                   '`/media tag id:123 tags:funny, epic` - Add tags to organize your media\n' +
                   '`/media describe id:123` - Add a description/caption to your media',
            inline: false
        },
        {
            name: '🗑️ Managing Media',
            value: '`/media delete id:123` - Delete a media item from your gallery\n' +
                   '**Delete Button:** Click the 🗑️ button on any auto-posted media to remove it\n' +
                   '**Limit:** You can save up to 500 media items',
            inline: false
        },
        {
            name: '⚙️ For Server Admins',
            value: '`/media setup channel:#photos` - Enable auto-capture for a channel\n' +
                   '`/media disable channel:#photos` - Disable auto-capture (doesn\'t affect existing media)\n' +
                   '**Options:** File types, max size (1-100MB), role whitelist\n' +
                   '**Archive:** The bot creates a hidden archive channel to store media permanently',
            inline: false
        },
        {
            name: '💡 Pro Tips',
            value: '• Media IDs are shown in the footer of list/search results\n' +
                   '• Tags help you find media faster - use common keywords!\n' +
                   '• Descriptions are searchable and show up in embeds\n' +
                   '• Archived media never expires, even if deleted from chat\n' +
                   '• Use filters in `/media list` to quickly find specific content',
            inline: false
        }
    ]);

    helpEmbed.setFooter({
        text: `${await mediaUtil.getMediaCount(interaction.user.id)}/500 media items saved`
    });

    return interaction.editReply({
        embeds: [helpEmbed],
        flags: [MessageFlags.Ephemeral]
    });
}

/**
 * Update the Discord message for a media item (when tags/description change)
 * @param {Client} client - Discord client
 * @param {Object} media - Media item with potential tags
 */
async function updateMediaMessage(client, media) {
    try {
        // Fetch full media data with tags
        const fullMedia = await mediaUtil.getMediaById(media.userId || media.authorId, media.id);
        if (!fullMedia || !fullMedia.messageId || !fullMedia.channelId) {
            logger.debug('Cannot update message: missing messageId or channelId');
            return;
        }

        // Fetch the Discord channel and message
        const channel = await client.channels.fetch(fullMedia.channelId).catch(() => null);
        if (!channel) {
            logger.debug('Cannot update message: channel not found');
            return;
        }

        const message = await channel.messages.fetch(fullMedia.messageId).catch(() => null);
        if (!message) {
            logger.debug('Cannot update message: message not found');
            return;
        }

        // Rebuild the message using the service's builder
        if (!client.mediaGalleryService) {
            logger.debug('Cannot update message: service not available');
            return;
        }

        // Create a mock attachment and message object for the builder
        const mockAttachment = {
            url: fullMedia.mediaUrl,
            name: fullMedia.fileName,
            contentType: fullMedia.mimeType,
            size: fullMedia.fileSize,
            width: fullMedia.width,
            height: fullMedia.height
        };

        const mockMessage = {
            content: fullMedia.contentPreview,
            author: {
                username: media.userId || media.authorId, // Fallback to ID if username not available
                displayAvatarURL: () => null
            }
        };

        const payload = client.mediaGalleryService.buildMediaMessage(
            fullMedia,
            mockAttachment,
            mockMessage,
            fullMedia.authorId
        );

        // Edit the message
        await message.edit(payload);
        logger.debug(`Updated Discord message ${fullMedia.messageId} with new tags/description`);
    } catch (error) {
        logger.error(`Failed to update media message: ${error.message}`);
    }
}
