const { SlashCommandBuilder } = require('discord.js');
const { REST, Routes } = require('discord.js');
const embeds = require('../../utils/embeds');
const logger = require('../../utils/logger');
const { handleCommandError } = require('../../utils/errorHandlerUtil');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unregister')
        .setDescription('Clear slash command registrations (Bot Owner only)')
        .addStringOption(opt => opt
            .setName('scope')
            .setDescription('What to clear')
            .setRequired(true)
            .addChoices(
                { name: 'Global Commands', value: 'global' },
                { name: 'Guild Commands (Current Server)', value: 'guild' },
                { name: 'Both Global & Guild', value: 'both' }
            )),

    devOnly: true,
    cooldown: 10,
    longRunning: true,

    async execute(interaction) {
        const scope = interaction.options.getString('scope');
        const rest = new REST().setToken(process.env.DISCORD_TOKEN);

        // Confirm action
        const confirmEmbed = embeds.warn(
            'Clear Command Registrations',
            `⚠️ **Warning:** You are about to clear **${scope}** command registrations.\n\n` +
            '**This will:**\n' +
            `• Remove all slash commands from Discord\n` +
            `• Commands will disappear from the UI\n` +
            `• You'll need to re-deploy after clearing\n\n` +
            '**To fix duplicates:**\n' +
            '1. Clear both global and guild commands\n' +
            '2. Choose ONE deployment strategy:\n' +
            '   • Global: `/deploy scope:Global` (production)\n' +
            '   • Guild: `/deploy scope:Guild` (development)\n\n' +
            'Are you sure you want to proceed?'
        );

        await interaction.editReply({
            embeds: [confirmEmbed],
            components: [{
                type: 1, // Action Row
                components: [{
                    type: 2, // Button
                    style: 4, // Danger
                    label: 'Clear Commands',
                    custom_id: 'clear_confirm'
                }, {
                    type: 2, // Button
                    style: 2, // Secondary
                    label: 'Cancel',
                    custom_id: 'clear_cancel'
                }]
            }]
        });

        // Wait for button interaction
        const filter = i => i.user.id === interaction.user.id && i.customId.startsWith('clear_');
        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 30000, max: 1 });

        collector.on('collect', async i => {
            if (i.customId === 'clear_cancel') {
                await i.update({
                    embeds: [embeds.info('Operation Cancelled', 'Command clearing was cancelled.')],
                    components: []
                });
                return;
            }

            // Proceed with clearing
            await i.update({
                embeds: [embeds.info('Clearing...', 'Clearing command registrations. This may take a moment...')],
                components: []
            });

            const results = [];
            let hasErrors = false;

            try {
                // Clear global commands
                if (scope === 'global' || scope === 'both') {
                    try {
                        const globalBefore = await rest.get(
                            Routes.applicationCommands(process.env.CLIENT_ID)
                        );

                        await rest.put(
                            Routes.applicationCommands(process.env.CLIENT_ID),
                            { body: [] }
                        );

                        results.push(`✅ Cleared **${globalBefore.length}** global commands`);
                        logger.success(`Cleared ${globalBefore.length} global commands`);
                    } catch (err) {
                        results.push(`❌ Failed to clear global commands: ${err.message}`);
                        logger.error(`Failed to clear global commands: ${err.message}`);
                        hasErrors = true;
                    }
                }

                // Clear guild commands
                if (scope === 'guild' || scope === 'both') {
                    try {
                        const guildBefore = await rest.get(
                            Routes.applicationGuildCommands(process.env.CLIENT_ID, interaction.guild.id)
                        );

                        await rest.put(
                            Routes.applicationGuildCommands(process.env.CLIENT_ID, interaction.guild.id),
                            { body: [] }
                        );

                        results.push(`✅ Cleared **${guildBefore.length}** guild commands from **${interaction.guild.name}**`);
                        logger.success(`Cleared ${guildBefore.length} guild commands from ${interaction.guild.name}`);
                    } catch (err) {
                        results.push(`❌ Failed to clear guild commands: ${err.message}`);
                        logger.error(`Failed to clear guild commands: ${err.message}`);
                        hasErrors = true;
                    }
                }

                // Build result embed
                const resultEmbed = hasErrors
                    ? embeds.warn('Partially Completed', results.join('\n\n'))
                    : embeds.success('Commands Cleared', results.join('\n\n') + '\n\n**Next Step:** Re-deploy using `/deploy scope:<Global|Guild>`');

                await i.editReply({ embeds: [resultEmbed] });

            } catch (error) {
                await handleCommandError(error, i, 'clearing command registrations');
            }
        });

        collector.on('end', collected => {
            if (collected.size === 0) {
                interaction.editReply({
                    embeds: [embeds.warn('Operation Timed Out', 'Command clearing confirmation timed out after 30 seconds.')],
                    components: []
                }).catch(() => {});
            }
        });
    }
};
