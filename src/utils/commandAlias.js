const { MessageFlags } = require('discord.js');
const path = require('path');
const config = require('./config');
const embeds = require('./embeds');
const { checkUserPermissions } = require('./permissions');

function createCommandAliasInteraction(interaction, alias = {}) {
    const optionValues = alias.optionValues || {};
    const optionNames = new Set(Object.keys(optionValues));

    const options = new Proxy(interaction.options, {
        get(target, prop) {
            if (prop === 'getSubcommand') {
                return () => alias.subcommand ?? target.getSubcommand(false);
            }

            if (prop === 'getSubcommandGroup') {
                return () => alias.subcommandGroup ?? null;
            }

            if (prop === 'data' && alias.data) {
                return alias.data;
            }

            if (typeof prop === 'string' && prop.startsWith('get')) {
                return (name, required) => {
                    if (optionNames.has(name)) {
                        return optionValues[name];
                    }

                    const reader = target[prop];
                    if (typeof reader === 'function') {
                        return reader.call(target, name, required);
                    }

                    return null;
                };
            }

            const value = target[prop];
            return typeof value === 'function' ? value.bind(target) : value;
        }
    });

    return new Proxy(interaction, {
        get(target, prop) {
            if (prop === 'commandName') return alias.commandName ?? target.commandName;
            if (prop === 'options') return options;

            const value = target[prop];
            return typeof value === 'function' ? value.bind(target) : value;
        }
    });
}

async function executeAliasCommand(interaction, client, alias) {
    const command = client.commands?.get(alias.commandName) || require(path.resolve(process.cwd(), alias.requirePath));
    const aliasedInteraction = createCommandAliasInteraction(interaction, alias);

    if (command.devOnly && !config.developers.includes(interaction.user.id)) {
        return interaction.reply({
            embeds: [embeds.error('Access Denied', 'This command is restricted to bot developers.')],
            flags: [MessageFlags.Ephemeral]
        });
    }

    if (interaction.guild) {
        const { allowed, error } = await checkUserPermissions(aliasedInteraction, command);
        if (!allowed) {
            return interaction.reply({
                embeds: [error],
                flags: [MessageFlags.Ephemeral]
            });
        }
    }

    const cooldownResult = checkAliasCooldown(interaction, client, command);
    if (!cooldownResult.allowed) {
        return interaction.reply({
            embeds: [embeds.warn('Cooldown Active', `Please wait, you can use this command again <t:${cooldownResult.expiredTimestamp}:R>.`)],
            flags: [MessageFlags.Ephemeral]
        });
    }

    if (command.longRunning && !interaction.deferred && !interaction.replied) {
        await interaction.deferReply({
            flags: (command.deferEphemeral || command.devOnly) ? [MessageFlags.Ephemeral] : []
        });
    }

    return command.execute(aliasedInteraction, client);
}

module.exports = {
    createCommandAliasInteraction,
    executeAliasCommand
};

function checkAliasCooldown(interaction, client, command) {
    if (!client.cooldowns || command.data.name === interaction.commandName) {
        return { allowed: true };
    }

    if (!client.cooldowns.has(command.data.name)) {
        client.cooldowns.set(command.data.name, new Map());
    }

    const now = Date.now();
    const timestamps = client.cooldowns.get(command.data.name);
    const cooldownAmount = (command.cooldown ?? 3) * 1000;

    if (timestamps.has(interaction.user.id)) {
        const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;

        if (now < expirationTime) {
            return {
                allowed: false,
                expiredTimestamp: Math.round(expirationTime / 1000)
            };
        }
    }

    timestamps.set(interaction.user.id, now);
    const timeout = setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);
    if (timeout.unref) timeout.unref();

    return { allowed: true };
}
