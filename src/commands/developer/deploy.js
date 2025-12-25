const { SlashCommandBuilder } = require('discord.js');
const { deployCommands, checkExistingRegistrations } = require('../../utils/commandDeployer');
const embeds = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('deploy')
        .setDescription('Manually deploy/sync slash commands (Bot Owner only)')
        .addStringOption(opt => opt
            .setName('scope')
            .setDescription('Deployment scope')
            .setRequired(true)
            .addChoices(
                { name: 'Current Guild', value: 'guild' },
                { name: 'Global (All Guilds)', value: 'global' }
            )),

    devOnly: true,
    cooldown: 10,
    longRunning: true,

    async execute(interaction) {
        const scope = interaction.options.getString('scope');

        // Check for existing registrations to detect duplicates
        const existing = await checkExistingRegistrations(interaction.guild.id);

        // Warn about potential duplicates
        if (existing.hasDuplicates) {
            const duplicateWarning = embeds.warn(
                'Duplicate Commands Detected',
                `⚠️ **Duplicate commands found!**\n\n` +
                `• **Global commands:** ${existing.global}\n` +
                `• **Guild commands (${interaction.guild.name}):** ${existing.guild}\n\n` +
                `**This causes commands to appear twice in Discord.**\n\n` +
                `**To fix:**\n` +
                `1. Use \`/clear scope:Both\` to remove all commands\n` +
                `2. Choose ONE deployment strategy:\n` +
                `   • Global (production): \`/deploy scope:Global\`\n` +
                `   • Guild (development): \`/deploy scope:Guild\`\n\n` +
                `Proceeding with \`${scope}\` deployment will **not** fix duplicates.`
            );

            await interaction.editReply({ embeds: [duplicateWarning] });
            return;
        }

        // Warn if deploying to scope where commands already exist
        if (scope === 'global' && existing.global > 0) {
            const warningMsg = embeds.info(
                'Updating Global Commands',
                `Found ${existing.global} existing global commands. They will be updated.`
            );
            await interaction.editReply({ embeds: [warningMsg] });
        } else if (scope === 'guild' && existing.guild > 0) {
            const warningMsg = embeds.info(
                'Updating Guild Commands',
                `Found ${existing.guild} existing guild commands. They will be updated.`
            );
            await interaction.editReply({ embeds: [warningMsg] });
        }

        // Additional safety check for global deployment
        if (scope === 'global') {
            const confirmEmbed = embeds.warn(
                'Global Deployment',
                '⚠️ **Warning:** Global deployment will register commands to **all guilds** the bot is in.\n\n' +
                '• Global commands take up to **1 hour** to propagate\n' +
                '• Guild commands update **instantly**\n' +
                '• This should only be used for production deployment\n\n' +
                'Are you sure you want to proceed?'
            );

            await interaction.editReply({
                embeds: [confirmEmbed],
                components: [{
                    type: 1, // Action Row
                    components: [{
                        type: 2, // Button
                        style: 4, // Danger
                        label: 'Deploy Globally',
                        custom_id: 'deploy_global_confirm'
                    }, {
                        type: 2, // Button
                        style: 2, // Secondary
                        label: 'Cancel',
                        custom_id: 'deploy_global_cancel'
                    }]
                }]
            });

            // Wait for button interaction
            const filter = i => i.user.id === interaction.user.id && i.customId.startsWith('deploy_global_');
            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 30000, max: 1 });

            collector.on('collect', async i => {
                if (i.customId === 'deploy_global_cancel') {
                    await i.update({
                        embeds: [embeds.info('Deployment Cancelled', 'Global deployment was cancelled.')],
                        components: []
                    });
                    return;
                }

                // Proceed with global deployment
                await i.update({
                    embeds: [embeds.info('Deploying...', 'Deploying commands globally. This may take a moment...')],
                    components: []
                });

                const result = await deployCommands('global');

                if (result.success) {
                    await i.editReply({
                        embeds: [embeds.success(
                            'Global Deployment Complete',
                            `Successfully deployed **${result.count}** commands globally.\n\n` +
                            '⏱️ Commands will propagate to all guilds within **1 hour**.\n' +
                            '✅ Commands are now registered worldwide.'
                        )]
                    });
                } else {
                    await i.editReply({
                        embeds: [embeds.error(
                            'Deployment Failed',
                            `Failed to deploy commands globally.\n\n**Error:** ${result.error || 'Unknown error'}`
                        )]
                    });
                }
            });

            collector.on('end', collected => {
                if (collected.size === 0) {
                    interaction.editReply({
                        embeds: [embeds.warn('Deployment Timed Out', 'Global deployment confirmation timed out after 30 seconds.')],
                        components: []
                    }).catch(() => {});
                }
            });

            return;
        }

        // Guild deployment
        const guildId = interaction.guild.id;
        const deployingEmbed = embeds.info(
            'Deploying Commands',
            `Deploying commands to **${interaction.guild.name}**...\n\nThis may take a moment.`
        );

        await interaction.editReply({ embeds: [deployingEmbed] });

        const result = await deployCommands('guild', guildId);

        if (result.success) {
            const successEmbed = embeds.success(
                'Deployment Complete',
                `Successfully deployed **${result.count}** commands to **${interaction.guild.name}**.\n\n` +
                '✅ Commands are now available in this server.\n' +
                '⚡ Guild commands update instantly.'
            )
                .setFooter({ text: `Guild ID: ${guildId}` });

            await interaction.editReply({ embeds: [successEmbed] });
        } else {
            const errorEmbed = embeds.error(
                'Deployment Failed',
                `Failed to deploy commands to **${interaction.guild.name}**.\n\n` +
                `**Error:** ${result.error || 'Unknown error'}\n\n` +
                '**Common Issues:**\n' +
                '• Rate limit reached (200 creates/day/guild)\n' +
                '• Invalid bot token or permissions\n' +
                '• Discord API is down\n' +
                '• Network connectivity issues'
            )
                .setFooter({ text: 'Check console logs for more details' });

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }
};
