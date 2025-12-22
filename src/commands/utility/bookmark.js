const { SlashCommandBuilder, MessageFlags, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');
const bookmarkUtil = require('../../utils/bookmarkUtil');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bookmark')
        .setDescription('Manage your saved message bookmarks')
        .setDMPermission(true)
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('View your bookmarks')
                .addIntegerOption(option =>
                    option.setName('page')
                        .setDescription('Page number (10 bookmarks per page)')
                        .setMinValue(1)
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('search')
                .setDescription('Search your bookmarks by content')
                .addStringOption(option =>
                    option.setName('query')
                        .setDescription('Search query')
                        .setRequired(true)
                        .setMinLength(2)
                        .setMaxLength(100)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View a specific bookmark in detail')
                .addIntegerOption(option =>
                    option.setName('id')
                        .setDescription('Bookmark ID')
                        .setRequired(true)
                        .setMinValue(1)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete')
                .setDescription('Delete a specific bookmark')
                .addIntegerOption(option =>
                    option.setName('id')
                        .setDescription('Bookmark ID')
                        .setRequired(true)
                        .setMinValue(1)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Delete ALL your bookmarks (requires confirmation)')),

    cooldown: 3,
    longRunning: true,

    async execute(interaction, client) {
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        switch (subcommand) {
            case 'list':
                await handleList(interaction, userId);
                break;
            case 'search':
                await handleSearch(interaction, userId);
                break;
            case 'view':
                await handleView(interaction, userId, client);
                break;
            case 'delete':
                await handleDelete(interaction, userId);
                break;
            case 'clear':
                await handleClear(interaction, userId);
                break;
        }
    },

    // Handler for button interactions (clear confirmation)
    async handleInteraction(interaction, client) {
        const customId = interaction.customId;

        if (customId === 'bookmark_clear_confirm') {
            await handleClearConfirm(interaction);
        } else if (customId === 'bookmark_clear_cancel') {
            await handleClearCancel(interaction);
        }
    }
};

/**
 * /bookmark list [page]
 */
async function handleList(interaction, userId) {
    const page = interaction.options.getInteger('page') || 1;
    const perPage = 10;
    const offset = (page - 1) * perPage;

    // Get bookmarks for this page
    const bookmarksData = await bookmarkUtil.getBookmarks(userId, {
        limit: perPage,
        offset: offset
    });

    // Get total count for pagination info
    const totalCount = await bookmarkUtil.getBookmarkCount(userId);
    const totalPages = Math.ceil(totalCount / perPage);

    if (totalCount === 0) {
        return interaction.editReply({
            embeds: [embeds.info('No Bookmarks', 'You haven\'t saved any bookmarks yet.\n\nTo bookmark a message, right-click it and select **Apps > Bookmark Message**.')],
            flags: [MessageFlags.Ephemeral]
        });
    }

    if (page > totalPages) {
        return interaction.editReply({
            embeds: [embeds.error('Invalid Page', `Page ${page} doesn't exist. You have ${totalPages} page(s) of bookmarks.`)],
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Build embed
    const listEmbed = embeds.brand('Your Bookmarks', `Showing page ${page} of ${totalPages} (${totalCount} total bookmarks)`);

    for (const bookmark of bookmarksData) {
        // Format content preview
        let content = bookmark.content;
        if (content.length > 150) {
            content = content.substring(0, 147) + '...';
        }

        // Build field value with metadata
        let fieldValue = `${content}\n`;
        fieldValue += `**ID:** \`${bookmark.id}\` | **Channel:** <#${bookmark.channelId}> | **Author:** <@${bookmark.authorId}>`;

        if (bookmark.messageDeleted) {
            fieldValue += '\n⚠️ *Original message was deleted*';
        }

        listEmbed.addFields([{
            name: `Bookmark #${bookmark.id} - <t:${Math.floor(bookmark.savedAt.getTime() / 1000)}:R>`,
            value: fieldValue
        }]);
    }

    // Add navigation hint
    if (totalPages > 1) {
        listEmbed.setFooter({
            text: `Use /bookmark list page:${page + 1} to view the next page`
        });
    }

    return interaction.editReply({
        embeds: [listEmbed],
        flags: [MessageFlags.Ephemeral]
    });
}

/**
 * /bookmark search <query>
 */
async function handleSearch(interaction, userId) {
    const query = interaction.options.getString('query');

    // Search bookmarks
    const searchResults = await bookmarkUtil.searchBookmarks(userId, query, {
        limit: 10,
        offset: 0
    });

    if (searchResults.total === 0) {
        return interaction.editReply({
            embeds: [embeds.info('No Results', `No bookmarks found matching **"${query}"**.`)],
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Build results embed
    const searchEmbed = embeds.brand('Search Results', `Found ${searchResults.total} bookmark(s) matching **"${query}"**`);

    for (const bookmark of searchResults.results) {
        // Highlight search term in content (simple approach)
        let content = bookmark.content;
        if (content.length > 150) {
            // Find query position and show context around it
            const queryPos = content.toLowerCase().indexOf(query.toLowerCase());
            if (queryPos !== -1) {
                const start = Math.max(0, queryPos - 50);
                const end = Math.min(content.length, queryPos + query.length + 100);
                content = (start > 0 ? '...' : '') + content.substring(start, end) + (end < content.length ? '...' : '');
            } else {
                content = content.substring(0, 147) + '...';
            }
        }

        let fieldValue = `${content}\n`;
        fieldValue += `**ID:** \`${bookmark.id}\` | **Channel:** <#${bookmark.channelId}> | **Author:** <@${bookmark.authorId}>`;

        if (bookmark.messageDeleted) {
            fieldValue += '\n⚠️ *Original message was deleted*';
        }

        searchEmbed.addFields([{
            name: `Bookmark #${bookmark.id} - <t:${Math.floor(bookmark.savedAt.getTime() / 1000)}:R>`,
            value: fieldValue
        }]);
    }

    if (searchResults.total > 10) {
        searchEmbed.setFooter({
            text: `Showing first 10 results of ${searchResults.total} matches`
        });
    }

    return interaction.editReply({
        embeds: [searchEmbed],
        flags: [MessageFlags.Ephemeral]
    });
}

/**
 * /bookmark view <id>
 */
async function handleView(interaction, userId, client) {
    const bookmarkId = interaction.options.getInteger('id');

    // Get bookmark
    const bookmark = await bookmarkUtil.getBookmarkById(userId, bookmarkId);

    if (!bookmark) {
        return interaction.editReply({
            embeds: [embeds.error('Bookmark Not Found', `Bookmark #${bookmarkId} doesn't exist or doesn't belong to you.`)],
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Build detailed view embed
    const viewEmbed = embeds.brand(`Bookmark #${bookmark.id}`, bookmark.content);

    viewEmbed.addFields([
        { name: 'Author', value: `<@${bookmark.authorId}>`, inline: true },
        { name: 'Channel', value: `<#${bookmark.channelId}>`, inline: true },
        { name: 'Saved', value: `<t:${Math.floor(bookmark.savedAt.getTime() / 1000)}:R>`, inline: true }
    ]);

    // Add server info if not DM
    if (bookmark.guildId !== 'DM') {
        try {
            const guild = await client.guilds.fetch(bookmark.guildId);
            viewEmbed.addFields([
                { name: 'Server', value: guild.name, inline: true }
            ]);
        } catch (e) {
            // Guild no longer accessible
            viewEmbed.addFields([
                { name: 'Server', value: '*Server no longer accessible*', inline: true }
            ]);
        }
    }

    // Add attachment info
    if (bookmark.attachmentUrls) {
        const urls = bookmark.attachmentUrls.split(',');
        const attachmentLinks = urls.map((url, index) => `[Attachment ${index + 1}](${url})`).join(' • ');
        viewEmbed.addFields([
            { name: 'Attachments', value: attachmentLinks }
        ]);
    }

    // Add deleted warning
    if (bookmark.messageDeleted) {
        viewEmbed.addFields([
            { name: '⚠️ Notice', value: 'The original message has been deleted. This is a cached copy.' }
        ]);
    } else {
        // Add jump link if message still exists
        const jumpUrl = `https://discord.com/channels/${bookmark.guildId}/${bookmark.channelId}/${bookmark.messageId}`;
        viewEmbed.addFields([
            { name: 'Jump to Message', value: `[Click here to view original](${jumpUrl})` }
        ]);
    }

    return interaction.editReply({
        embeds: [viewEmbed],
        flags: [MessageFlags.Ephemeral]
    });
}

/**
 * /bookmark delete <id>
 */
async function handleDelete(interaction, userId) {
    const bookmarkId = interaction.options.getInteger('id');

    // Delete bookmark
    const result = await bookmarkUtil.deleteBookmark(userId, bookmarkId);

    if (!result.success) {
        return interaction.editReply({
            embeds: [embeds.error('Delete Failed', result.error)],
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Get updated count
    const count = await bookmarkUtil.getBookmarkCount(userId);

    return interaction.editReply({
        embeds: [embeds.success('Bookmark Deleted', `Bookmark #${bookmarkId} has been removed.\n\nYou now have ${count}/${bookmarkUtil.MAX_BOOKMARKS_PER_USER} bookmarks.`)],
        flags: [MessageFlags.Ephemeral]
    });
}

/**
 * /bookmark clear
 */
async function handleClear(interaction, userId) {
    const count = await bookmarkUtil.getBookmarkCount(userId);

    if (count === 0) {
        return interaction.editReply({
            embeds: [embeds.info('No Bookmarks', 'You have no bookmarks to clear.')],
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Build confirmation embed
    const confirmEmbed = embeds.warn(
        'Confirm Deletion',
        `You are about to delete **${count} bookmark(s)**.\n\nThis action **cannot be undone**.`
    );

    // Build confirmation buttons
    const confirmButton = new ButtonBuilder()
        .setCustomId('bookmark_clear_confirm')
        .setLabel(`Delete ${count} Bookmark(s)`)
        .setStyle(ButtonStyle.Danger);

    const cancelButton = new ButtonBuilder()
        .setCustomId('bookmark_clear_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

    return interaction.editReply({
        embeds: [confirmEmbed],
        components: [row],
        flags: [MessageFlags.Ephemeral]
    });
}

/**
 * Handle clear confirmation button
 */
async function handleClearConfirm(interaction) {
    const userId = interaction.user.id;

    // Delete all bookmarks
    const result = await bookmarkUtil.deleteAllBookmarks(userId);

    // Disable buttons
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('bookmark_clear_confirm_disabled')
            .setLabel('Deleted')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId('bookmark_clear_cancel_disabled')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
    );

    if (!result.success) {
        return interaction.update({
            embeds: [embeds.error('Clear Failed', result.error)],
            components: [row]
        });
    }

    return interaction.update({
        embeds: [embeds.success('Bookmarks Cleared', `Successfully deleted ${result.count} bookmark(s).`)],
        components: [row]
    });
}

/**
 * Handle clear cancellation button
 */
async function handleClearCancel(interaction) {
    // Disable buttons
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('bookmark_clear_confirm_disabled')
            .setLabel('Delete All')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId('bookmark_clear_cancel_disabled')
            .setLabel('Cancelled')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
    );

    return interaction.update({
        embeds: [embeds.info('Cancelled', 'Your bookmarks have not been deleted.')],
        components: [row]
    });
}
