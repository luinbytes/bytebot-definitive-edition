const { AttachmentBuilder, SlashCommandBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');
const { evaluateExpression } = require('../../services/informationLookupService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lookup')
        .setDescription('Calculate, translate, and look up public information')
        .setDMPermission(true)
        .addSubcommand(sub => sub.setName('calculate').setDescription('Evaluate a mathematical expression')
            .addStringOption(option => option.setName('expression').setDescription('Arithmetic expression').setRequired(true).setMaxLength(500)))
        .addSubcommand(sub => sub.setName('qr').setDescription('Generate a QR code for a website URL')
            .addStringOption(option => option.setName('url').setDescription('HTTP or HTTPS website URL').setRequired(true).setMaxLength(2048)))
        .addSubcommand(sub => sub.setName('screenshot').setDescription('Capture a screenshot of a public HTTPS website')
            .addStringOption(option => option.setName('url').setDescription('Public HTTPS website URL').setRequired(true).setMaxLength(2048)))
        .addSubcommand(sub => sub.setName('weather').setDescription('Check current weather for a location')
            .addStringOption(option => option.setName('location').setDescription('City or place').setRequired(true).setMaxLength(100)))
        .addSubcommand(sub => sub.setName('definition').setDescription('Look up an Urban Dictionary definition')
            .addStringOption(option => option.setName('word').setDescription('Word or phrase').setRequired(true).setMaxLength(100)))
        .addSubcommand(sub => sub.setName('translate').setDescription('Translate text to another language')
            .addStringOption(option => option.setName('language').setDescription('Language code or full name').setRequired(true).setMaxLength(50))
            .addStringOption(option => option.setName('text').setDescription('Text to translate').setRequired(true).setMaxLength(2000))),

    longRunning: true,
    sourceCategories: ['Information', 'Utility'],

    async execute(interaction, client) {
        const action = interaction.options.getSubcommand();
        const service = client.informationLookupService;
        if (!service) throw new Error('Lookup service is temporarily unavailable.');

        if (action === 'calculate') {
            const expression = interaction.options.getString('expression', true);
            return interaction.editReply({
                embeds: [embeds.brand('Calculation', `**${expression}** = **${evaluateExpression(expression)}**`)],
                allowedMentions: { parse: [] }
            });
        }
        if (action === 'qr' || action === 'screenshot') {
            const image = await service[action](interaction.options.getString('url', true));
            const name = `${action}.png`;
            return interaction.editReply({
                embeds: [embeds.brand(action === 'qr' ? 'QR Code' : 'Website Screenshot').setImage(`attachment://${name}`)],
                files: [new AttachmentBuilder(image, { name })],
                allowedMentions: { parse: [] }
            });
        }
        if (action === 'weather') {
            const weather = await service.weather(interaction.options.getString('location', true));
            return interaction.editReply({ embeds: [embeds.brand(`Weather: ${weather.location}`)
                .addFields(
                    { name: 'Temperature', value: `${weather.temperature} °C`, inline: true },
                    { name: 'Wind', value: `${weather.wind} km/h`, inline: true },
                    { name: 'Humidity', value: `${weather.humidity}%`, inline: true },
                    { name: 'Sun Rise', value: weather.sunrise, inline: true },
                    { name: 'Sun Set', value: weather.sunset, inline: true },
                    { name: 'Visibility', value: `${weather.visibility} m`, inline: true }
                )] });
        }
        if (action === 'definition') {
            const word = interaction.options.getString('word', true);
            const definitions = await service.define(word);
            const embed = embeds.brand(`Definitions: ${word}`);
            let remaining = 5500;
            definitions.forEach((entry, index) => {
                if (remaining <= 0) return;
                const votes = `👍 ${entry.up} · 👎 ${entry.down}`;
                const body = `${entry.definition}${entry.example ? `\n\n*${entry.example}*` : ''}\n${votes}`.slice(0, Math.min(1024, remaining));
                remaining -= body.length;
                embed.addFields({ name: `Definition ${index + 1}`, value: body });
            });
            return interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
        }

        const original = interaction.options.getString('text', true);
        const translated = await service.translate(interaction.options.getString('language', true), original);
        const body = `**Original:** ${original}\n\n**Translation:** ${translated}`;
        if (body.length <= 4000) {
            return interaction.editReply({ embeds: [embeds.brand('Translation', body)], allowedMentions: { parse: [] } });
        }
        return interaction.editReply({
            embeds: [embeds.brand('Translation', 'The complete translation is attached.')],
            files: [new AttachmentBuilder(Buffer.from(`Original:\n${original}\n\nTranslation:\n${translated}`), { name: 'translation.txt' })],
            allowedMentions: { parse: [] }
        });
    }
};
