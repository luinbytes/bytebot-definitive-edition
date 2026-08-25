const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const { shouldBeEphemeral } = require('../../utils/ephemeralHelper');
const { resolveServer } = require('../../utils/informationCommand');

module.exports = {
    register: false,
    data: new SlashCommandBuilder()
        .setName('serverinfo')
        .setDescription('Displays information about the server.')
        .addStringOption(option => option.setName('server').setDescription('Server ID, invite, or vanity URL').setMaxLength(2048))
        .addBooleanOption(option =>
            option
                .setName('private')
                .setDescription('Make response visible only to you')
                .setRequired(false)),

    async execute(interaction, client) {
        const guild = await resolveServer(interaction, client, interaction.options.getString('server'));
        const fields = [];
        if (guild.ownerId) fields.push({ name: 'Owner', value: `<@${guild.ownerId}>`, inline: true });
        fields.push({ name: 'ID', value: guild.id, inline: true });
        if (Number.isFinite(guild.createdTimestamp)) fields.push({
            name: 'Created At', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true
        });
        const count = guild.memberCount ?? guild.approximateMemberCount ?? guild.members?.cache?.size;
        if (Number.isInteger(count)) fields.push({ name: 'Members', value: String(count), inline: true });
        if (guild.channels?.cache) fields.push({ name: 'Channels', value: String(guild.channels.cache.size), inline: true });
        if (guild.roles?.cache) fields.push({ name: 'Roles', value: String(guild.roles.cache.size), inline: true });
        if (guild.emojis?.cache) fields.push({ name: 'Emojis', value: String(guild.emojis.cache.size), inline: true });
        if (guild.premiumTier != null) fields.push({ name: 'Boost Level', value: `Level ${guild.premiumTier}`, inline: true });
        if (guild.verificationLevel != null) fields.push({ name: 'Verification', value: String(guild.verificationLevel), inline: true });

        const embed = embeds.brand(`${guild.name} Info`, null).addFields(fields);

        if (guild.iconURL()) {
            embed.setThumbnail(guild.iconURL({ dynamic: true }));
        }

        if (guild.description) {
            embed.setDescription(guild.description);
        }

        const isEphemeral = await shouldBeEphemeral(interaction, {
            commandDefault: false, // Server info defaults to public
            userOverride: interaction.options.getBoolean('private')
        });

        await interaction.reply({
            embeds: [embed],
            flags: isEphemeral ? [MessageFlags.Ephemeral] : []
        });
    },
};
