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
        return new EmbedBuilder()
            .setColor(config.brand.color)
            .setTitle(title)
            .setDescription(description)
            .setTimestamp()
            .setFooter({ text: config.brand.name });
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
    }
};

module.exports = embeds;
