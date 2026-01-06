/**
 * Pagination Utilities
 * Reusable pagination system with button-based navigation
 */

const { ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags, ComponentType } = require('discord.js');
const embeds = require('./embeds');

/**
 * Create pagination buttons (Previous/Next)
 * @param {number} currentPage - Current page index (0-based)
 * @param {number} totalPages - Total number of pages
 * @param {string} customIdPrefix - Prefix for button custom IDs (e.g., 'bookmarks', 'achievements')
 * @returns {ActionRowBuilder} - Action row with prev/next buttons
 */
function createPaginationButtons(currentPage, totalPages, customIdPrefix = 'page') {
    const prevButton = new ButtonBuilder()
        .setCustomId(`${customIdPrefix}_prev`)
        .setLabel('Previous')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('⬅️')
        .setDisabled(currentPage === 0);

    const nextButton = new ButtonBuilder()
        .setCustomId(`${customIdPrefix}_next`)
        .setLabel('Next')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('➡️')
        .setDisabled(currentPage === totalPages - 1);

    return new ActionRowBuilder().addComponents(prevButton, nextButton);
}

/**
 * Handle pagination interaction collector
 * Automatically handles button clicks, user validation, page updates, and cleanup
 * @param {Object} options - Pagination options
 * @param {Message} options.message - The message with pagination buttons
 * @param {Interaction} options.interaction - Original interaction (for user validation)
 * @param {Function} options.renderPage - Async function that renders a page: (pageIndex) => Promise<EmbedBuilder>
 * @param {number} options.totalPages - Total number of pages
 * @param {string} options.customIdPrefix - Prefix for button custom IDs
 * @param {number} options.timeout - Collector timeout in milliseconds (default: 300000 = 5 min)
 * @param {Function} options.onPageChange - Optional callback when page changes: (newPage) => void
 * @returns {Promise<void>}
 */
async function handlePaginationInteraction({ message, interaction, renderPage, totalPages, customIdPrefix = 'page', timeout = 300000, onPageChange }) {
    let currentPage = 0;

    const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: timeout
    });

    collector.on('collect', async (buttonInteraction) => {
        // Validate user (only original command user can navigate)
        if (buttonInteraction.user.id !== interaction.user.id) {
            return buttonInteraction.reply({
                embeds: [embeds.error('Not Your Menu', 'This pagination belongs to someone else.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        // Handle navigation
        if (buttonInteraction.customId === `${customIdPrefix}_next`) {
            currentPage = Math.min(currentPage + 1, totalPages - 1);
        } else if (buttonInteraction.customId === `${customIdPrefix}_prev`) {
            currentPage = Math.max(currentPage - 1, 0);
        }

        // Optional callback
        if (onPageChange) {
            onPageChange(currentPage);
        }

        // Render new page
        const newEmbed = await renderPage(currentPage);
        const newButtons = createPaginationButtons(currentPage, totalPages, customIdPrefix);

        await buttonInteraction.update({
            embeds: [newEmbed],
            components: [newButtons]
        });
    });

    collector.on('end', () => {
        // Remove buttons when collector expires
        message.edit({ components: [] }).catch(() => {
            // Ignore errors (message might be deleted)
        });
    });
}

/**
 * Paginate an array into chunks
 * @param {Array} items - Items to paginate
 * @param {number} pageSize - Number of items per page
 * @returns {Array<Array>} - Array of pages (each page is an array of items)
 */
function paginateArray(items, pageSize) {
    const pages = [];
    for (let i = 0; i < items.length; i += pageSize) {
        pages.push(items.slice(i, i + pageSize));
    }
    return pages;
}

/**
 * Create and send a paginated message (convenience function)
 * Combines rendering, button creation, and collector setup
 * @param {Object} options - Pagination options
 * @param {Interaction} options.interaction - Discord interaction
 * @param {Function} options.renderPage - Async function: (pageIndex) => Promise<EmbedBuilder>
 * @param {number} options.totalPages - Total number of pages
 * @param {string} options.customIdPrefix - Prefix for button custom IDs
 * @param {number} options.timeout - Collector timeout (default: 5 min)
 * @param {number} options.initialPage - Starting page (default: 0)
 * @param {boolean} options.deferred - Whether interaction is already deferred (default: false)
 * @returns {Promise<Message>} - The paginated message
 */
async function sendPaginatedMessage({ interaction, renderPage, totalPages, customIdPrefix = 'page', timeout = 300000, initialPage = 0, deferred = false }) {
    const firstEmbed = await renderPage(initialPage);

    // Only show buttons if there are multiple pages
    const components = totalPages > 1 ? [createPaginationButtons(initialPage, totalPages, customIdPrefix)] : [];

    const message = deferred
        ? await interaction.editReply({ embeds: [firstEmbed], components })
        : await interaction.reply({ embeds: [firstEmbed], components });

    // Set up collector if multiple pages
    if (totalPages > 1) {
        await handlePaginationInteraction({
            message,
            interaction,
            renderPage,
            totalPages,
            customIdPrefix,
            timeout
        });
    }

    return message;
}

/**
 * Calculate pagination metadata
 * @param {number} totalItems - Total number of items
 * @param {number} pageSize - Items per page
 * @param {number} currentPage - Current page (1-based for user display)
 * @returns {Object} - { totalPages, offset, isLastPage, isFirstPage }
 */
function calculatePaginationMeta(totalItems, pageSize, currentPage) {
    const totalPages = Math.ceil(totalItems / pageSize);
    const offset = (currentPage - 1) * pageSize;
    const isLastPage = currentPage >= totalPages;
    const isFirstPage = currentPage === 1;

    return {
        totalPages,
        offset,
        isLastPage,
        isFirstPage
    };
}

module.exports = {
    createPaginationButtons,
    handlePaginationInteraction,
    paginateArray,
    sendPaginatedMessage,
    calculatePaginationMeta
};
