const { ContextMenuCommandBuilder, ApplicationCommandType, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');

module.exports = {
    data: new ContextMenuCommandBuilder()
        .setName('Save Media')
        .setType(ApplicationCommandType.Message)
        .setDMPermission(false),

    cooldown: 3,
    longRunning: true,

    async execute(interaction, client) {
        const message = interaction.targetMessage;
        const userId = interaction.user.id;

        // Validate message has attachments
        if (message.attachments.size === 0) {
            return interaction.editReply({
                embeds: [embeds.error('No Media', 'This message has no attachments to save.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        // Check if service is available
        if (!client.mediaGalleryService) {
            return interaction.editReply({
                embeds: [embeds.error('Service Unavailable', 'Media gallery service is not initialized.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        // Capture all attachments
        let savedCount = 0;
        const errors = [];

        // Config for manual saves (more permissive than auto-capture)
        const config = {
            fileTypes: 'image,video,audio,document', // Allow all types for manual saves
            maxFileSizeMB: 100, // Higher limit for manual saves
            autoTagChannel: false // No auto-tag for manual saves
        };

        for (const attachment of message.attachments.values()) {
            const result = await client.mediaGalleryService.captureMedia(
                message,
                attachment,
                config,
                'manual'
            );

            if (result && result.success) {
                savedCount++;
            } else if (result && result.error) {
                // Don't show duplicate errors (common when user saves multiple times)
                if (!result.error.includes('already saved')) {
                    errors.push(result.error);
                }
            }
        }

        // Build response
        if (savedCount > 0) {
            const successEmbed = embeds.success(
                'Media Saved',
                `Successfully saved **${savedCount}** item(s) to your gallery.\n\n` +
                `Use \`/media list\` to browse your collection.`
            );

            // Show quota
            const mediaUtil = require('../../utils/mediaUtil');
            const totalCount = await mediaUtil.getMediaCount(userId);
            successEmbed.setFooter({ text: `You have ${totalCount}/500 media items` });

            if (errors.length > 0) {
                successEmbed.addFields([
                    { name: 'Warnings', value: errors.slice(0, 3).join('\n') }
                ]);
            }

            return interaction.editReply({
                embeds: [successEmbed],
                flags: [MessageFlags.Ephemeral]
            });
        } else {
            // All saves failed
            let errorMessage = 'Could not save media.';
            if (errors.length > 0) {
                errorMessage = errors[0]; // Show first error
            }

            return interaction.editReply({
                embeds: [embeds.error('Save Failed', errorMessage)],
                flags: [MessageFlags.Ephemeral]
            });
        }
    }
};
