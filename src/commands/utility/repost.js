const { SlashCommandBuilder } = require('discord.js');
const { UserFacingError } = require('../../utils/errorHandlerUtil');

const INVALID_URL = 'Please provide a valid URL\n-# Example: repost https://www.tiktok.com/@user/video/123';
const POST_URL_REQUIRED = 'Please provide a post/video URL\n-# Profile or username lookups are not supported in this command';
const UNSUPPORTED = 'Unsupported platform\n-# Supported: Instagram, TikTok, X/Twitter';

function canonicalPostUrl(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new UserFacingError(INVALID_URL);
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new UserFacingError(INVALID_URL);

    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    let match;
    if (host === 'tiktok.com') {
        match = url.pathname.match(/^\/@([A-Za-z0-9._]{2,24})\/video\/(\d+)\/?$/);
        if (match) return `https://www.tiktok.com/@${match[1]}/video/${match[2]}`;
        throw new UserFacingError(POST_URL_REQUIRED);
    }
    if (host === 'instagram.com') {
        match = url.pathname.match(/^\/(p|reel|tv)\/([A-Za-z0-9_-]+)\/?$/);
        if (match) return `https://www.instagram.com/${match[1]}/${match[2]}/`;
        throw new UserFacingError(POST_URL_REQUIRED);
    }
    if (host === 'x.com' || host === 'twitter.com') {
        match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/?$/);
        if (match) return `https://x.com/${match[1]}/status/${match[2]}`;
        throw new UserFacingError(POST_URL_REQUIRED);
    }
    throw new UserFacingError(UNSUPPORTED);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('repost')
        .setDescription('Repost a social media post from a link')
        .setDMPermission(true)
        .addStringOption(option => option
            .setName('url')
            .setDescription('Instagram, TikTok, or X/Twitter post URL')
            .setRequired(true)
            .setMaxLength(2048)),
    sourceCategories: ['Socials', 'Utility'],

    async execute(interaction) {
        return interaction.reply({
            content: canonicalPostUrl(interaction.options.getString('url', true)),
            allowedMentions: { parse: [] }
        });
    }
};
