const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { db } = require('../../database/index');
const { moderationLogs } = require('../../database/schema');
const { eq, and } = require('drizzle-orm');
const embeds = require('../../utils/embeds');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unwarn')
        .setDescription('Remove a warning from a user.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user to unwarn')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('id')
                .setDescription('The Warning ID to remove')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers), // Match warn permission

    async execute(interaction) {
        const target = interaction.options.getUser('target');
        const id = interaction.options.getInteger('id');

        try {
            // Check if warning exists and matches target
            const warning = await db.select()
                .from(moderationLogs)
                .where(and(
                    eq(moderationLogs.id, id),
                    eq(moderationLogs.guildId, interaction.guild.id)
                ))
                .get();

            if (!warning) {
                return interaction.reply({
                    embeds: [embeds.error('Not Found', `Warning ID **${id}** was not found in this server.`)],
                    flags: [MessageFlags.Ephemeral]
                });
            }

            if (warning.targetId !== target.id) {
                return interaction.reply({
                    embeds: [embeds.error('Mismatch', `Warning ID **${id}** does not belong to ${target}.`)],
                    flags: [MessageFlags.Ephemeral]
                });
            }

            // Delete warning
            await db.delete(moderationLogs)
                .where(eq(moderationLogs.id, id));

            // Log the unwarn action? Optional, but good practice. For now, just confirming.

            return interaction.reply({
                embeds: [embeds.success('Warning Removed', `Successfully removed Warning ID **${id}** from ${target}.`)]
            });

        } catch (error) {
            console.error(error);
            return interaction.reply({
                embeds: [embeds.error('Error', 'An error occurred while removing the warning.')],
                flags: [MessageFlags.Ephemeral]
            });
        }
    },
};
