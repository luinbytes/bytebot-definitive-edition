const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const { getTopStarboardEmbed } = require('../administration/starboard');

const PAGES = {
    progress: {
        title: '📈 Your Progress',
        description: 'Continue your ByteBot journey with your activity and achievement progress.',
        fields: [
            { name: 'Activity & Streaks', value: '`/me streak view` — view your activity streak\n`/me achievement progress` — view milestone and chain progress', inline: false },
            { name: 'Achievements', value: '`/me achievement browse` — browse achievements\n`/me achievement progress` — see progress and achievement chains', inline: false }
        ]
    },
    community: {
        title: '🤝 Community Features',
        description: 'Take part in the server using the existing community commands.',
        fields: [
            { name: 'BytePods & Birthdays', value: '`/pod panel` — open BytePod controls\n`/me birthday view` — view a birthday\n`/server birthday upcoming` — see upcoming birthdays', inline: false },
            { name: 'Reminders & Bookmarks', value: '`/me reminder list` — manage reminders\n`/me bookmark list` — view saved messages', inline: false },
            { name: 'Suggestions', value: '`/server suggestion submit` — share an idea\n`/server suggestion list` — browse community ideas', inline: false }
        ]
    },
    starboard: {
        title: '⭐ Starboard',
        description: 'Browse the server’s most-starred messages.',
        fields: []
    },
    explore: {
        title: '🧭 Explore',
        description: 'Discover games and shared server activity without changing existing command paths.',
        fields: [
            { name: 'Games', value: '`/game f1 schedule` — upcoming Formula 1 races\n`/game warthunder stats` — War Thunder statistics', inline: false },
            { name: 'Server Activity', value: '`/server stats` — server statistics\n`/server streak top` — activity streak rankings\n`/server birthday upcoming` — upcoming member birthdays', inline: false },
            { name: 'Need More Detail?', value: 'Use `/help command:community` or `/help command:me` to browse the existing command paths.', inline: false }
        ]
    }
};

function buildButtons() {
    return new ActionRowBuilder().addComponents(
        ...Object.entries(PAGES).map(([id, page]) => new ButtonBuilder()
            .setCustomId(`community_page_${id}`)
            .setLabel(page.title.replace(/^\S+\s/, ''))
            .setStyle(ButtonStyle.Primary))
    );
}

function buildEmbed(page) {
    return embeds.brand(page.title, page.description).addFields(page.fields);
}

function buildOverviewEmbed() {
    return embeds.brand('🤝 Community Hub', 'Find member-facing ByteBot community features without replacing the existing commands.')
        .addFields(
            {
                name: 'Your Progress',
                value: '`/me achievement progress` — milestones and achievement chains\n`/me achievement browse` — achievements\n`/me streak view` — activity streak',
                inline: false
            },
            {
                name: 'Community Features',
                value: '`/pod panel` • `/me birthday view` • `/me reminder list`\n`/server suggestion submit` • `/server suggestion list` • `/me bookmark list`\n**Starboard**: choose the Starboard section below to browse starred messages',
                inline: false
            },
            {
                name: 'Explore',
                value: '`/game f1 schedule` • `/game warthunder stats`\n`/server stats` • `/server streak top`',
                inline: false
            }
        )
        .setFooter({ text: 'Choose a section below for paths to the existing features.' });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('community')
        .setDescription('Browse member community features and existing command paths')
        .setDMPermission(false),

    cooldown: 3,

    async execute(interaction) {
        return interaction.reply({
            embeds: [buildOverviewEmbed()],
            components: [buildButtons()],
            flags: [MessageFlags.Ephemeral]
        });
    },

    async handleInteraction(interaction, client) {
        if (!interaction.isButton() || !interaction.customId.startsWith('community_page_')) return;

        const pageId = interaction.customId.slice('community_page_'.length);
        const page = PAGES[pageId];
        if (!page) {
            return interaction.reply({
                embeds: [embeds.error('Destination Unavailable', 'That community destination is no longer available. Open `/community` again to choose a current option.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        await interaction.deferUpdate();
        if (pageId === 'starboard') {
            return interaction.editReply({
                embeds: [await getTopStarboardEmbed(interaction.guild, client, 10, interaction.member)],
                components: [buildButtons()]
            });
        }
        return interaction.editReply({
            embeds: [buildEmbed(page)],
            components: [buildButtons()]
        });
    }
};
