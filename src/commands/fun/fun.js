const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const embeds = require('../../utils/embeds');
const { handleCommandError } = require('../../utils/errorHandlerUtil');
const { checkUserPermissions } = require('../../utils/permissions');
const {
    getUwuLockState,
    listUwuLockMembers,
    removeUwuLockState,
    setUwuLockState,
    uwuifyText
} = require('../../utils/uwuLockUtil');
const axios = require('axios');

// 8-ball responses
const EIGHT_BALL_RESPONSES = [
    'It is certain.',
    'It is decidedly so.',
    'Without a doubt.',
    'Yes definitely.',
    'You may rely on it.',
    'As I see it, yes.',
    'Most likely.',
    'Outlook good.',
    'Yes.',
    'Signs point to yes.',
    'Reply hazy, try again.',
    'Ask again later.',
    'Better not tell you now.',
    'Cannot predict now.',
    'Concentrate and ask again.',
    "Don't count on it.",
    'My reply is no.',
    'My sources say no.',
    'Outlook not so good.',
    'Very doubtful.'
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fun')
        .setDescription('Fun commands and games')
        .addSubcommand(sub => sub
            .setName('8ball')
            .setDescription('Ask the magic 8-ball a question')
            .addStringOption(opt => opt
                .setName('question')
                .setDescription('The question you want to ask')
                .setRequired(true)))
        .addSubcommand(sub => sub
            .setName('coin')
            .setDescription('Flip a coin'))
        .addSubcommand(sub => sub
            .setName('dice')
            .setDescription('Roll a dice')
            .addIntegerOption(opt => opt
                .setName('sides')
                .setDescription('Number of sides (default: 6)')
                .setMinValue(2)
                .setMaxValue(100)))
        .addSubcommand(sub => sub
            .setName('joke')
            .setDescription('Get a random joke'))
        .addSubcommand(sub => sub
            .setName('uwuify')
            .setDescription('Make supplied text uwuified')
            .addStringOption(opt => opt
                .setName('text')
                .setDescription('Text to uwuify')
                .setRequired(true)
                .setMaxLength(2000)))
        .addSubcommand(sub => sub.setName('choose').setDescription('Choose one item from a comma-separated list')
            .addStringOption(opt => opt.setName('options').setDescription('Two or more comma-separated choices').setMinLength(3).setMaxLength(2000).setRequired(true)))
        .addSubcommand(sub => sub.setName('random-member').setDescription('Choose a random non-bot server member'))
        .addSubcommand(sub => sub.setName('quote').setDescription('Render a same-server text message as a quote image')
            .addStringOption(opt => opt.setName('message').setDescription('Message link or ID').setRequired(true)))
        .addSubcommandGroup(group => group.setName('poll').setDescription('Create and manage community polls')
            .addSubcommand(sub => sub.setName('create').setDescription('Create a timed multiple-choice poll')
                .addStringOption(opt => opt.setName('question').setDescription('Poll question').setMinLength(1).setMaxLength(300).setRequired(true))
                .addStringOption(opt => opt.setName('options').setDescription('2-10 comma-separated options').setMinLength(3).setMaxLength(600).setRequired(true))
                .addStringOption(opt => opt.setName('duration').setDescription('10s to 7d, such as 1h').setRequired(true)))
            .addSubcommand(sub => sub.setName('quick').setDescription('Create a yes-or-no poll')
                .addStringOption(opt => opt.setName('question').setDescription('Poll question').setMinLength(1).setMaxLength(300).setRequired(true)))
            .addSubcommand(sub => sub.setName('end').setDescription('End a poll you created')
                .addStringOption(opt => opt.setName('message').setDescription('Poll message link or ID').setRequired(true))))
        .addSubcommandGroup(group => group
            .setName('uwulock')
            .setDescription('Manage Server: control automatic UwU Lock')
            .addSubcommand(sub => sub
                .setName('add')
                .setDescription('Add a member to UwU Lock')
                .addUserOption(opt => opt.setName('member').setDescription('Member to target').setRequired(true)))
            .addSubcommand(sub => sub
                .setName('remove')
                .setDescription('Remove a member from UwU Lock')
                .addUserOption(opt => opt.setName('member').setDescription('Member to remove').setRequired(true)))
            .addSubcommand(sub => sub
                .setName('list')
                .setDescription('List UwU Lock targets'))
            .addSubcommand(sub => sub
                .setName('protect')
                .setDescription('Manage UwU-protected members')
                .addStringOption(opt => opt
                    .setName('action')
                    .setDescription('Protection action')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Add', value: 'add' },
                        { name: 'Remove', value: 'remove' },
                        { name: 'List', value: 'list' }
                    ))
                .addUserOption(opt => opt.setName('member').setDescription('Member for add or remove')))),

    cooldown: 3,

    async execute(interaction, client) {
        const group = interaction.options.getSubcommandGroup(false);
        const subcommand = interaction.options.getSubcommand();

        if (group === 'uwulock') {
            return handleUwuLock(interaction, subcommand);
        }
        if (group === 'poll') {
            if (!client.communityUtilityService) throw new Error('Community utilities are unavailable.');
            if (subcommand === 'create') return client.communityUtilityService.createPoll(interaction,
                interaction.options.getString('question', true), interaction.options.getString('options', true), interaction.options.getString('duration', true));
            if (subcommand === 'quick') return client.communityUtilityService.createPoll(interaction,
                interaction.options.getString('question', true), ['Yes', 'No'], null);
            return client.communityUtilityService.endPoll(interaction, interaction.options.getString('message', true));
        }

        switch (subcommand) {
            case '8ball':
                await handle8Ball(interaction);
                break;
            case 'coin':
                await handleCoin(interaction);
                break;
            case 'dice':
                await handleDice(interaction);
                break;
            case 'joke':
                await handleJoke(interaction);
                break;
            case 'uwuify':
                await interaction.reply({
                    content: uwuifyText(interaction.options.getString('text')),
                    allowedMentions: { parse: [], repliedUser: false }
                });
                break;
            case 'choose': {
                if (!client.communityUtilityService) throw new Error('Community utilities are unavailable.');
                const choice = client.communityUtilityService.choose(interaction.options.getString('options', true));
                await interaction.reply({ content: `I choose: **${choice}**`, allowedMentions: { parse: [], repliedUser: false } });
                break;
            }
            case 'random-member': {
                if (!client.communityUtilityService) throw new Error('Community utilities are unavailable.');
                const member = await client.communityUtilityService.randomMember(interaction.guild);
                await interaction.reply({ content: `Random member: <@${member.id}>`, allowedMentions: { parse: [], users: [member.id], repliedUser: false } });
                break;
            }
            case 'quote': {
                if (!client.communityUtilityService) throw new Error('Community utilities are unavailable.');
                await interaction.deferReply();
                const message = await client.communityUtilityService.resolveMessage(interaction, interaction.options.getString('message', true));
                const attachment = await client.communityUtilityService.quoteImage(message);
                await interaction.editReply({ content: `Quoted from ${message.url}`, files: [attachment], allowedMentions: { parse: [], repliedUser: false } });
                break;
            }
        }
    }
};

async function handleUwuLock(interaction, subcommand) {
    if (!interaction.guild) {
        return interaction.reply({
            embeds: [embeds.error('Server Only', 'UwU Lock can only be managed in a server.')],
            flags: [MessageFlags.Ephemeral]
        });
    }

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
            embeds: [embeds.error('Insufficient Permissions', 'You need Manage Server to manage UwU Lock.')],
            flags: [MessageFlags.Ephemeral]
        });
    }

    const permission = await checkUserPermissions(interaction, {
        data: { name: 'fun' },
        permissions: [PermissionFlagsBits.ManageGuild]
    });
    if (!permission.allowed) {
        return interaction.reply({ embeds: [permission.error], flags: [MessageFlags.Ephemeral] });
    }

    const target = interaction.options.getUser('member');

    if (subcommand === 'list') {
        return replyUwuList(interaction, 'target');
    }

    if (subcommand === 'add') {
        if (target.bot || target.id === interaction.guild.ownerId || target.id === interaction.client.user.id) {
            return interaction.reply({
                embeds: [embeds.error('Invalid Target', 'Owners, ByteBot, and bots cannot be targeted.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        if (getUwuLockState(interaction.guild.id, target.id)?.state === 'protected') {
            return interaction.reply({
                embeds: [embeds.error('Member Protected', 'Remove UwU protection before targeting this member.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        setUwuLockState(interaction.guild.id, target.id, 'target');
        return interaction.reply({
            embeds: [embeds.success('UwU Lock Added', `<@${target.id}> is now targeted by UwU Lock.`)],
            flags: [MessageFlags.Ephemeral]
        });
    }

    if (subcommand === 'remove') {
        removeUwuLockState(interaction.guild.id, target.id, 'target');
        return interaction.reply({
            embeds: [embeds.success('UwU Lock Removed', `<@${target.id}> is no longer targeted.`)],
            flags: [MessageFlags.Ephemeral]
        });
    }

    const protectAction = interaction.options.getString('action');
    if (subcommand === 'protect' && protectAction === 'list') {
        return replyUwuList(interaction, 'protected');
    }

    if (subcommand === 'protect' && protectAction === 'add') {
        if (!target) {
            return interaction.reply({
                embeds: [embeds.error('Member Required', 'Choose a member to protect.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        setUwuLockState(interaction.guild.id, target.id, 'protected');
        return interaction.reply({
            embeds: [embeds.success('UwU Protection Added', `<@${target.id}> is protected from UwU Lock.`)],
            flags: [MessageFlags.Ephemeral]
        });
    }

    if (subcommand === 'protect' && protectAction === 'remove') {
        if (!target) {
            return interaction.reply({
                embeds: [embeds.error('Member Required', 'Choose a member to unprotect.')],
                flags: [MessageFlags.Ephemeral]
            });
        }

        removeUwuLockState(interaction.guild.id, target.id, 'protected');
        return interaction.reply({
            embeds: [embeds.success('UwU Protection Removed', `<@${target.id}> can now be targeted.`)],
            flags: [MessageFlags.Ephemeral]
        });
    }
}

function replyUwuList(interaction, state) {
    const members = listUwuLockMembers(interaction.guild.id, state);
    const protectedList = state === 'protected';
    const title = protectedList ? 'UwU-Protected Members' : 'UwU Lock Targets';
    const empty = protectedList ? 'No members are protected.' : 'No members are targeted.';
    const description = members.length
        ? members.map(member => `<@${member.userId}>`).join('\n')
        : empty;

    return interaction.reply({
        embeds: [embeds.brand(title, description)],
        flags: [MessageFlags.Ephemeral]
    });
}

/**
 * Handle /fun 8ball
 */
async function handle8Ball(interaction) {
    const question = interaction.options.getString('question');
    const response = EIGHT_BALL_RESPONSES[Math.floor(Math.random() * EIGHT_BALL_RESPONSES.length)];

    await interaction.reply({
        embeds: [embeds.brand('Magic 8-Ball', `**Question:** ${question}\n**Answer:** ${response} 🎱`)]
    });
}

/**
 * Handle /fun coin
 */
async function handleCoin(interaction) {
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';

    await interaction.reply({
        embeds: [embeds.brand('Coin Flip', `The coin landed on: **${result}** 🪙`)]
    });
}

/**
 * Handle /fun dice
 */
async function handleDice(interaction) {
    const sides = interaction.options.getInteger('sides') ?? 6;
    const result = Math.floor(Math.random() * sides) + 1;

    await interaction.reply({
        embeds: [embeds.brand('Dice Roll', `You rolled a **${result}** on a **d${sides}** 🎲`)]
    });
}

/**
 * Handle /fun joke
 */
async function handleJoke(interaction) {
    await interaction.deferReply();

    try {
        const response = await axios.get('https://official-joke-api.appspot.com/random_joke');
        const joke = response.data;

        await interaction.editReply({
            embeds: [embeds.brand('Random Joke', `**${joke.setup}**\n\n*${joke.punchline}*`)]
        });
    } catch (error) {
        await handleCommandError(error, interaction, 'fetching a joke', { ephemeral: false });
    }
}
