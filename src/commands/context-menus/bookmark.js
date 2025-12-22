const { ContextMenuCommandBuilder, ApplicationCommandType, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const bookmarkUtil = require('../../utils/bookmarkUtil');

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Bookmark Message')
        .setType(ApplicationCommandType.Message)
        .setDMPermission(true), // Allow in DMs

    cooldown: 3, // Prevent spam
    longRunning: true, // Auto-defer for database operation

    async execute(interaction, client) {
        const message = interaction.targetMessage;
        const userId = interaction.user.id;

        // Validate message has content or attachments
        if (!message.content && message.attachments.size === 0) {
            return interaction.editReply({
                embeds: [embeds.error('Cannot Bookmark', 'This message has no content or attachments to bookmark.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        // Save the bookmark
        const result = await bookmarkUtil.saveBookmark(userId, message);

        if (!result.success) {
            return interaction.editReply({
                embeds: [embeds.error('Bookmark Failed', result.error)],
                flags: [MessageFlags.Ephemeral]
            });
        }

        // Build success embed with bookmark details
        const successEmbed = embeds.success('Bookmark Saved', 'Message has been added to your bookmarks.')
            .addFields([
                { name: 'Author', value: `<@${message.author.id}>`, inline: true },
                { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
                { name: 'Bookmark ID', value: `#${result.bookmark.id}`, inline: true }
            ]);

        // Add content preview (limit to 200 chars)
        if (message.content) {
            let preview = message.content;
            if (preview.length > 200) {
                preview = preview.substring(0, 197) + '...';
            }
            successEmbed.addFields([
                { name: 'Content Preview', value: preview }
            ]);
        }

        // Add attachment count if present
        if (message.attachments.size > 0) {
            successEmbed.addFields([
                { name: 'Attachments', value: `${message.attachments.size} file(s) saved`, inline: true }
            ]);
        }

        // Add current bookmark count
        const count = await bookmarkUtil.getBookmarkCount(userId);
        successEmbed.setFooter({
            text: `You have ${count}/${bookmarkUtil.MAX_BOOKMARKS_PER_USER} bookmarks`
        });

        return interaction.editReply({
            embeds: [successEmbed],
            flags: [MessageFlags.Ephemeral]
        });
    }
};
