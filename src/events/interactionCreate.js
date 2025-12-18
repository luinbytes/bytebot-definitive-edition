const { Events, Collection, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');
const embeds = require('../utils/embeds');
const config = require('../../config.json');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction, client) {
        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.get(interaction.commandName);

        if (!command) {
            logger.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        // --- SECURITY & EDGE CASES ---

        // 1. Guild Only Restriction
        // Prevent the bot from crashing in DMs if the command isn't designed for it.
        if (!interaction.guild && !command.dmPermission) {
            return interaction.reply({
                embeds: [embeds.error('Guild Only', 'This command can only be used within a server.')],
                ephemeral: true
            });
        }

        // 2. Bot Permission Verification
        // Ensure the bot can actually send embeds before trying to do so.
        if (interaction.guild) {
            const botMember = interaction.guild.members.me;
            if (!botMember.permissionsIn(interaction.channel).has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
                // We can't use our embed utility here because we lack permissions!
                // Fallback to a plain text message if possible.
                try {
                    return await interaction.reply({
                        content: '❌ I do not have permission to send embeds in this channel. Please ensure I have "Send Messages" and "Embed Links" permissions.',
                        ephemeral: true
                    });
                } catch (e) {
                    logger.error(`Failed to notify about missing permissions in ${interaction.guild.id}: ${e}`);
                    return;
                }
            }
        }

        // 3. Developer Only Check
        if (command.devOnly && !config.developers.includes(interaction.user.id)) {
            return interaction.reply({
                embeds: [embeds.error('Access Denied', 'This command is restricted to bot developers.')],
                ephemeral: true
            });
        }

        // 4. Permission Checks (User)
        if (command.permissions && command.permissions.length > 0) {
            if (!interaction.member.permissions.has(command.permissions)) {
                return interaction.reply({
                    embeds: [embeds.error('Insufficient Permissions', `You need the following permissions: \`${command.permissions.join(', ')}\``)],
                    ephemeral: true
                });
            }
        }

        // 5. Cooldown Logic
        const { cooldowns } = client;
        if (!cooldowns.has(command.data.name)) {
            cooldowns.set(command.data.name, new Collection());
        }

        const now = Date.now();
        const timestamps = cooldowns.get(command.data.name);
        const defaultCooldownDuration = 3;
        const cooldownAmount = (command.cooldown ?? defaultCooldownDuration) * 1000;

        if (timestamps.has(interaction.user.id)) {
            const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;

            if (now < expirationTime) {
                const expiredTimestamp = Math.round(expirationTime / 1000);
                return interaction.reply({
                    embeds: [embeds.warn('Cooldown Active', `Please wait, you can use this command again <t:${expiredTimestamp}:R>.`)],
                    ephemeral: true
                });
            }
        }

        timestamps.set(interaction.user.id, now);
        setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

        // 6. Interaction Deferral
        // If a command is marked as 'longRunning', we defer it immediately.
        if (command.longRunning) {
            await interaction.deferReply({ ephemeral: command.ephemeral ?? false });
        }

        // 7. Execution
        try {
            await command.execute(interaction, client);
        } catch (error) {
            logger.error(`Error executing ${interaction.commandName}`);
            logger.error(error);

            const errorMessage = embeds.error('Critical Error', 'An unexpected error occurred while executing this command. The developers have been notified.');

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ embeds: [errorMessage], ephemeral: true });
            } else {
                await interaction.reply({ embeds: [errorMessage], ephemeral: true });
            }
        }
    },
};
