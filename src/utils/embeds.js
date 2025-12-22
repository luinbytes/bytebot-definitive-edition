const { EmbedBuilder } = require('discord.js');
const config = require('../../config.json');

/**
 * Centrally managed embed creator to ensure brand consistency.
 */
const embeds = {
    /**
     * Base embed template with branding
     */
    base: (title, description) => {
        const embed = new EmbedBuilder()
            .setColor(config.brand.color)
            .setTitle(title)
            .setTimestamp()
            .setFooter({ text: config.brand.name });

        // Only set description if it has content
        if (description && description.length > 0) {
            embed.setDescription(description);
        }

        return embed;
    },

    /**
     * Success response
     */
    success: (title, description) => {
        return embeds.base(`✅ ${title}`, description)
            .setColor(config.colors.success);
    },

    /**
     * Error response
     */
    error: (title, description) => {
        return embeds.base(`❌ ${title}`, description)
            .setColor(config.colors.error);
    },

    /**
     * Warning response
     */
    warn: (title, description) => {
        return embeds.base(`⚠️ ${title}`, description)
            .setColor(config.colors.warning);
    },

    /**
     * Professional info/brand response
     */
    brand: (title, description) => {
        return embeds.base(title, description)
            .setColor(config.brand.color);
    },

    /**
     * Info response (Primary brand color, typically)
     */
    info: (title, description) => {
        return embeds.base(`ℹ️ ${title}`, description)
            .setColor(config.brand.color);
    }
};

module.exports = embeds;
