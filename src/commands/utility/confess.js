const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder().setName('confess').setDescription('Submit an anonymous server confession').setDMPermission(false)
        .addStringOption(option => option.setName('category').setDescription('Optional configured category').setAutocomplete(true)),
    cooldown: 2,
    async execute(interaction, client) {
        if (!client.communityUtilityService) throw new Error('Community utilities are unavailable.');
        const categoryName = interaction.options.getString('category');
        const category = categoryName && client.communityUtilityService.confessionCategories(interaction.guildId)
            .find(row => row.name_key === categoryName.toLocaleLowerCase());
        if (categoryName && !category) throw new Error('That confession category no longer exists.');
        return client.communityUtilityService.openConfession(interaction, category?.id || 0);
    },
    autocomplete(interaction, client) {
        const query = interaction.options.getFocused().toLocaleLowerCase();
        return interaction.respond((client.communityUtilityService?.confessionCategories(interaction.guildId) || [])
            .filter(row => row.name_key.includes(query)).slice(0, 25).map(row => ({ name: row.name, value: row.name })));
    }
};
