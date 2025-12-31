const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const { db } = require('../../database');
const { autoResponses } = require('../../database/schema');
const { eq, and, count } = require('drizzle-orm');
const config = require('../../../config.json');
const { dbLog } = require('../../utils/dbLogger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autorespond')
        .setDescription('Manage automated keyword responses')
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Create a new auto-response')
                .addStringOption(option =>
                    option.setName('trigger')
                        .setDescription('Trigger keyword or pattern')
                        .setRequired(true)
                        .setMinLength(1)
                        .setMaxLength(100))
                .addStringOption(option =>
                    option.setName('response')
                        .setDescription('Response message (use {user} {server} {channel} variables)')
                        .setRequired(true)
                        .setMinLength(1)
                        .setMaxLength(2000))
                .addStringOption(option =>
                    option.setName('match_type')
                        .setDescription('How to match the trigger')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Contains (default)', value: 'contains' },
                            { name: 'Exact Match', value: 'exact' },
                            { name: 'Wildcard (*)', value: 'wildcard' },
                            { name: 'Regex (dev only)', value: 'regex' }
                        ))
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Restrict to specific channel (optional)')
                        .setRequired(false))
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('Require user to have this role (optional)')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('cooldown')
                        .setDescription('Cooldown in seconds (default: 60)')
                        .setRequired(false)
                        .setMinValue(5)
                        .setMaxValue(3600)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Delete an auto-response')
                .addIntegerOption(option =>
                    option.setName('id')
                        .setDescription('Auto-response ID')
                        .setRequired(true)
                        .setAutocomplete(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('View all auto-responses'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('toggle')
                .setDescription('Enable/disable an auto-response')
                .addIntegerOption(option =>
                    option.setName('id')
                        .setDescription('Auto-response ID')
                        .setRequired(true)
                        .setAutocomplete(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('edit')
                .setDescription('Update an auto-response message')
                .addIntegerOption(option =>
                    option.setName('id')
                        .setDescription('Auto-response ID')
                        .setRequired(true)
                        .setAutocomplete(true))
                .addStringOption(option =>
                    option.setName('new_response')
                        .setDescription('New response message')
                        .setRequired(true)
                        .setMinLength(1)
                        .setMaxLength(2000))),

    permissions: [PermissionFlagsBits.ManageGuild],
    cooldown: 3,
    longRunning: true,

    async execute(interaction, client) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'add':
                await handleAdd(interaction, client);
                break;
            case 'remove':
                await handleRemove(interaction, client);
                break;
            case 'list':
                await handleList(interaction);
                break;
            case 'toggle':
                await handleToggle(interaction, client);
                break;
            case 'edit':
                await handleEdit(interaction, client);
                break;
        }
    },

    async autocomplete(interaction, client) {
        const focusedOption = interaction.options.getFocused(true);

        if (focusedOption.name === 'id') {
            // Get guild's auto-responses
            const responses = await dbLog.select('autoResponses',
                () => db.select()
                    .from(autoResponses)
                    .where(eq(autoResponses.guildId, interaction.guild.id))
                    .orderBy(autoResponses.trigger)
                    .limit(25)
                    .all(),
                { guildId: interaction.guild.id }
            );

            const choices = responses.map(r => ({
                name: `#${r.id} - ${r.trigger} ${r.enabled ? '✅' : '❌'}`,
                value: r.id
            }));

            return interaction.respond(choices);
        }
    }
};

/**
 * /autorespond add
 */
async function handleAdd(interaction, client) {
    const trigger = interaction.options.getString('trigger');
    const response = interaction.options.getString('response');
    const matchType = interaction.options.getString('match_type') || 'contains';
    const channel = interaction.options.getChannel('channel');
    const role = interaction.options.getRole('role');
    const cooldown = interaction.options.getInteger('cooldown') || 60;

    // Check limit (50 per guild)
    const countResult = await dbLog.select('autoResponses',
        () => db.select({ count: count() })
            .from(autoResponses)
            .where(eq(autoResponses.guildId, interaction.guild.id))
            .get(),
        { guildId: interaction.guild.id, operation: 'count' }
    );

    if (countResult.count >= 50) {
        return interaction.editReply({
            embeds: [embeds.error(
                'Limit Reached',
                'This server has reached the maximum of 50 auto-responses. Delete some with `/autorespond remove` first.'
            )],
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Validate regex (dev only for security)
    if (matchType === 'regex') {
        if (!config.developers.includes(interaction.user.id)) {
            return interaction.editReply({
                embeds: [embeds.error(
                    'Permission Denied',
                    'Regex matching is restricted to bot developers due to security risks (ReDoS attacks).\n\nUse **wildcard** or **contains** instead.'
                )],
                flags: [MessageFlags.Ephemeral]
            });
        }

        try {
            new RegExp(trigger);
        } catch (error) {
            return interaction.editReply({
                embeds: [embeds.error('Invalid Regex', `The regex pattern is invalid: ${error.message}`)],
                flags: [MessageFlags.Ephemeral]
            });
        }
    }

    // Insert
    const result = await dbLog.insert('autoResponses',
        () => db.insert(autoResponses).values({
            guildId: interaction.guild.id,
            trigger,
            response,
            channelId: channel?.id || null,
            creatorId: interaction.user.id,
            enabled: true,
            cooldown,
            matchType,
            requireRoleId: role?.id || null,
            useCount: 0,
            createdAt: new Date(),
            lastUsed: null
        }).returning(),
        { guildId: interaction.guild.id, trigger, matchType }
    );

    // Invalidate cache
    client.autoResponderService.invalidateCache(interaction.guild.id);

    // Confirmation
    const embed = embeds.success(
        'Auto-Response Created',
        `Auto-response #${result[0].id} has been created.`
    );

    embed.addFields([
        { name: 'Trigger', value: `\`${trigger}\``, inline: true },
        { name: 'Match Type', value: matchType, inline: true },
        { name: 'Cooldown', value: `${cooldown}s`, inline: true },
        { name: 'Response', value: response.length > 100 ? response.substring(0, 97) + '...' : response, inline: false },
        { name: 'Channel', value: channel ? channel.toString() : 'All channels', inline: true },
        { name: 'Role Required', value: role ? role.toString() : 'None', inline: true }
    ]);

    embed.setFooter({ text: `Variables: {user} {server} {channel} {username}` });

    return interaction.editReply({
        embeds: [embed],
        flags: [MessageFlags.Ephemeral]
    });
}

/**
 * /autorespond remove
 */
async function handleRemove(interaction, client) {
    const id = interaction.options.getInteger('id');

    // Get response
    const response = await dbLog.select('autoResponses',
        () => db.select()
            .from(autoResponses)
            .where(and(
                eq(autoResponses.id, id),
                eq(autoResponses.guildId, interaction.guild.id)
            ))
            .get(),
        { id, guildId: interaction.guild.id }
    );

    if (!response) {
        return interaction.editReply({
            embeds: [embeds.error('Not Found', `Auto-response #${id} doesn't exist in this server.`)],
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Delete
    await dbLog.delete('autoResponses',
        () => db.delete(autoResponses)
            .where(eq(autoResponses.id, id)),
        { id, guildId: interaction.guild.id }
    );

    // Invalidate cache
    client.autoResponderService.invalidateCache(interaction.guild.id);

    return interaction.editReply({
        embeds: [embeds.success(
            'Auto-Response Deleted',
            `Auto-response #${id} (**${response.trigger}**) has been removed.`
        )],
        flags: [MessageFlags.Ephemeral]
    });
}

/**
 * /autorespond list
 */
async function handleList(interaction) {
    const responses = await dbLog.select('autoResponses',
        () => db.select()
            .from(autoResponses)
            .where(eq(autoResponses.guildId, interaction.guild.id))
            .orderBy(autoResponses.id)
            .all(),
        { guildId: interaction.guild.id }
    );

    if (responses.length === 0) {
        return interaction.editReply({
            embeds: [embeds.info(
                'No Auto-Responses',
                'This server has no auto-responses set up.\n\nCreate one with `/autorespond add`'
            )],
            flags: [MessageFlags.Ephemeral]
        });
    }

    const embed = embeds.brand(
        'Auto-Responses',
        `This server has ${responses.length}/50 auto-responses.`
    );

    for (const response of responses.slice(0, 25)) {
        const status = response.enabled ? '✅' : '❌';
        const channel = response.channelId ? `<#${response.channelId}>` : 'All channels';
        const uses = response.useCount;

        let fieldValue = `**Trigger:** \`${response.trigger}\`\n`;
        fieldValue += `**Match:** ${response.matchType} | **Cooldown:** ${response.cooldown}s\n`;
        fieldValue += `**Channel:** ${channel} | **Uses:** ${uses}`;

        if (response.requireRoleId) {
            fieldValue += `\n**Role Required:** <@&${response.requireRoleId}>`;
        }

        embed.addFields({
            name: `${status} #${response.id} - ${response.enabled ? 'Enabled' : 'Disabled'}`,
            value: fieldValue,
            inline: false
        });
    }

    if (responses.length > 25) {
        embed.setFooter({ text: `Showing first 25 of ${responses.length}` });
    }

    return interaction.editReply({
        embeds: [embed],
        flags: [MessageFlags.Ephemeral]
    });
}

/**
 * /autorespond toggle
 */
async function handleToggle(interaction, client) {
    const id = interaction.options.getInteger('id');

    // Get response
    const response = await dbLog.select('autoResponses',
        () => db.select()
            .from(autoResponses)
            .where(and(
                eq(autoResponses.id, id),
                eq(autoResponses.guildId, interaction.guild.id)
            ))
            .get(),
        { id, guildId: interaction.guild.id }
    );

    if (!response) {
        return interaction.editReply({
            embeds: [embeds.error('Not Found', `Auto-response #${id} doesn't exist in this server.`)],
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Toggle
    const newState = !response.enabled;
    await dbLog.update('autoResponses',
        () => db.update(autoResponses)
            .set({ enabled: newState })
            .where(eq(autoResponses.id, id)),
        { id, guildId: interaction.guild.id, newState }
    );

    // Invalidate cache
    client.autoResponderService.invalidateCache(interaction.guild.id);

    return interaction.editReply({
        embeds: [embeds.success(
            `Auto-Response ${newState ? 'Enabled' : 'Disabled'}`,
            `Auto-response #${id} (**${response.trigger}**) is now **${newState ? 'enabled' : 'disabled'}**.`
        )],
        flags: [MessageFlags.Ephemeral]
    });
}

/**
 * /autorespond edit
 */
async function handleEdit(interaction, client) {
    const id = interaction.options.getInteger('id');
    const newResponse = interaction.options.getString('new_response');

    // Get response
    const response = await dbLog.select('autoResponses',
        () => db.select()
            .from(autoResponses)
            .where(and(
                eq(autoResponses.id, id),
                eq(autoResponses.guildId, interaction.guild.id)
            ))
            .get(),
        { id, guildId: interaction.guild.id }
    );

    if (!response) {
        return interaction.editReply({
            embeds: [embeds.error('Not Found', `Auto-response #${id} doesn't exist in this server.`)],
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Update
    await dbLog.update('autoResponses',
        () => db.update(autoResponses)
            .set({ response: newResponse })
            .where(eq(autoResponses.id, id)),
        { id, guildId: interaction.guild.id }
    );

    // Invalidate cache
    client.autoResponderService.invalidateCache(interaction.guild.id);

    return interaction.editReply({
        embeds: [embeds.success(
            'Auto-Response Updated',
            `Auto-response #${id} (**${response.trigger}**) has been updated.\n\n**New Response:**\n${newResponse}`
        )],
        flags: [MessageFlags.Ephemeral]
    });
}
