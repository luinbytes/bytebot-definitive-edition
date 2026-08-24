const { EmbedBuilder } = require('discord.js');
const { AsyncLocalStorage } = require('async_hooks');
const config = require('./config');
const context = new AsyncLocalStorage();

function color(type, fallback) {
    const current = context.getStore();
    return current?.client?.richContentService?.getEmbedColors(current.guildId)?.[type] || fallback;
}

/**
 * Centrally managed embed creator to ensure brand consistency.
 */
const embeds = {
    /**
     * Base embed template with branding
     */
    base: (title, description) => {
        const embed = new EmbedBuilder()
            .setColor(color('information', config.brand.color))
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
            .setColor(color('success', config.colors.success));
    },

    /**
     * Error response
     */
    error: (title, description) => {
        return embeds.base(`❌ ${title}`, description)
            .setColor(color('error', config.colors.error));
    },

    /**
     * Warning response
     */
    warn: (title, description) => {
        return embeds.base(`⚠️ ${title}`, description)
            .setColor(color('warning', config.colors.warning));
    },

    /**
     * Professional info/brand response
     */
    brand: (title, description) => {
        return embeds.base(title, description)
            .setColor(color('information', config.brand.color));
    },

    /**
     * Info response (Primary brand color, typically)
     */
    info: (title, description) => {
        return embeds.base(`ℹ️ ${title}`, description)
            .setColor(color('information', config.brand.color));
    },

    withGuild: (client, guildId, work) => context.run({ client, guildId }, work)
};

module.exports = embeds;
