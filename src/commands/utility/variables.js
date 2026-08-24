const { SlashCommandBuilder, MessageFlags } = require('discord.js');

const VARIABLES = [
    '{user}', '{user.id}', '{user.name}', '{user.mention}', '{user.avatar}', '{user.banner}', '{user.tag}',
    '{user.created_at}', '{user.bot}', '{member.display_name}', '{member.nick}', '{member.roles}', '{member.boost}',
    '{guild.id}', '{guild.name}', '{guild.count}', '{guild.owner}', '{guild.icon}',
    '{channel.id}', '{channel.name}', '{channel.mention}', '{channel.topic}'
];

module.exports = {
    data: new SlashCommandBuilder().setName('variables').setDescription('List rich-content template variables'),
    permissions: [], cooldown: 3,
    async execute(interaction) {
        return interaction.reply({ content: `**Available variables**\n${VARIABLES.map(value => `\`${value}\``).join(' • ')}`,
            flags: [MessageFlags.Ephemeral], allowedMentions: { parse: [] } });
    }
};
