const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { db } = require('../../database/index');
const { guilds } = require('../../database/schema');
const { eq } = require('drizzle-orm');
const embeds = require('../../utils/embeds');
const { handleCommandError } = require('../../utils/errorHandlerUtil');
const { dbLog } = require('../../utils/dbLogger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Manage server configuration.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('logs')
                .setDescription('Set the moderation log channel.')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('The channel to send logs to')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View current server configuration.')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'logs') {
            const channel = interaction.options.getChannel('channel');

            try {
                await dbLog.update('guilds',
                    () => db.update(guilds)
                        .set({ logChannel: channel.id })
                        .where(eq(guilds.id, interaction.guild.id)),
                    { guildId: interaction.guild.id, logChannel: channel.id }
                );

                return interaction.editReply({
                    embeds: [embeds.success('Configuration Updated', `Moderation logs will now be sent to ${channel}.`)]
                });
            } catch (error) {
                await handleCommandError(error, interaction, 'updating configuration');
            }
        }

        if (subcommand === 'view') {
            const [config] = await dbLog.select('guilds',
                () => db.select().from(guilds).where(eq(guilds.id, interaction.guild.id)),
                { guildId: interaction.guild.id }
            );

            if (!config) {
                return interaction.editReply({
                    embeds: [embeds.error('Error', 'Configuration not found for this server.')]
                });
            }

            const embed = embeds.brand(`${interaction.guild.name} Configuration`, null)
                .addFields(
                    { name: 'Prefix', value: `\`${config.prefix}\``, inline: true },
                    { name: 'Log Channel', value: config.logChannel ? `<#${config.logChannel}>` : 'Not set', inline: true },
                    { name: 'Welcome Channel', value: config.welcomeChannel ? `<#${config.welcomeChannel}>` : 'Not set', inline: true },
                    { name: 'Welcome Messages', value: config.welcomeEnabled ? '✅ Enabled' : '❌ Disabled', inline: true }
                );

            return interaction.editReply({
                embeds: [embed]
            });
        }
    },

    permissions: [PermissionFlagsBits.Administrator],
    longRunning: true,
    deferEphemeral: true
};
