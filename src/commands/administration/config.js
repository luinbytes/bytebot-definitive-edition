const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { db } = require('../../database/index');
const { guilds } = require('../../database/schema');
const { eq } = require('drizzle-orm');
const embeds = require('../../utils/embeds');

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
                await db.update(guilds)
                    .set({ logChannel: channel.id })
                    .where(eq(guilds.id, interaction.guild.id));

                return interaction.reply({
                    embeds: [embeds.success('Configuration Updated', `Moderation logs will now be sent to ${channel}.`)]
                });
            } catch (error) {
                console.error(error);
                return interaction.reply({
                    embeds: [embeds.error('Error', 'Failed to update configuration.')],
                    flags: [MessageFlags.Ephemeral]
                });
            }
        }

        if (subcommand === 'view') {
            const [config] = await db.select().from(guilds).where(eq(guilds.id, interaction.guild.id));

            if (!config) {
                return interaction.reply({
                    embeds: [embeds.error('Error', 'Configuration not found for this server.')],
                    flags: [MessageFlags.Ephemeral]
                });
            }

            const embed = embeds.brand(`${interaction.guild.name} Configuration`, '')
                .addFields(
                    { name: 'Prefix', value: `\`${config.prefix}\``, inline: true },
                    { name: 'Log Channel', value: config.logChannel ? `<#${config.logChannel}>` : 'Not set', inline: true },
                    { name: 'Welcome Channel', value: config.welcomeChannel ? `<#${config.welcomeChannel}>` : 'Not set', inline: true }
                );

            return interaction.reply({ embeds: [embed] });
        }
    },
};
