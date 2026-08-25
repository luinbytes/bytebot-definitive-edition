const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { createHash, randomInt } = require('crypto');
const embeds = require('../../utils/embeds');
const { handleCommandError } = require('../../utils/errorHandlerUtil');
const { checkUserPermissions } = require('../../utils/permissions');
const {
    getUwuLockState,
    listUwuLockMembers,
    removeUwuLockState,
    setUwuLockState,
    setUwuRoulette,
    uwuifyText
} = require('../../utils/uwuLockUtil');
const axios = require('axios');
const {
    ROLEPLAY_ACTIONS,
    POLICY_EXCLUDED_ROLEPLAY,
    VAPE_FLAVORS
} = require('../../services/funService');

const ROASTS = Object.freeze([
    'your loading screen has better timing than you do.',
    'you bring everyone so much joy when the typing indicator disappears.',
    'your strategy has a strong commitment to surprise, especially your own.',
    'you are proof that confidence does not require supporting evidence.',
    'your Wi-Fi has a more stable train of thought.'
]);

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
                .addUserOption(opt => opt.setName('member').setDescription('Member for add or remove')))
            .addSubcommand(sub => sub
                .setName('roulette')
                .setDescription('Set random UwU Lock chance; 0 disables it')
                .addIntegerOption(opt => opt.setName('percentage').setDescription('Chance from 0 to 100 percent').setMinValue(0).setMaxValue(100).setRequired(true))))
        .addSubcommandGroup(group => group
            .setName('snipe')
            .setDescription('View or control recent message events')
            .addSubcommand(sub => snipeIndexOption(sub.setName('deleted').setDescription('View a recently deleted message')))
            .addSubcommand(sub => snipeIndexOption(sub.setName('edited').setDescription('View a recently edited message')))
            .addSubcommand(sub => snipeIndexOption(sub.setName('reaction').setDescription('View a recently removed reaction')))
            .addSubcommand(sub => sub.setName('clear').setDescription('Manage Messages: clear this channel’s snipes'))
            .addSubcommand(sub => sub
                .setName('protect')
                .setDescription('Control whether your activity can be sniped')
                .addStringOption(opt => opt.setName('mode').setDescription('Protection mode').setRequired(true).addChoices(
                    { name: 'On', value: 'on' }, { name: 'Off', value: 'off' }, { name: 'Status', value: 'status' }
                ))))
        .addSubcommandGroup(group => group
            .setName('roleplay')
            .setDescription('Use and configure roleplay reactions')
            .addSubcommand(sub => sub
                .setName('action')
                .setDescription('Send a roleplay reaction')
                .addStringOption(opt => opt.setName('action').setDescription('Roleplay action').setRequired(true).setAutocomplete(true))
                .addUserOption(opt => opt.setName('member').setDescription('Member to interact with').setRequired(true)))
            .addSubcommand(sub => sub.setName('list').setDescription('List roleplay actions and status'))
            .addSubcommand(sub => sub
                .setName('toggle')
                .setDescription('Manage Server: enable or disable an action')
                .addStringOption(opt => opt.setName('action').setDescription('Roleplay action').setRequired(true).setAutocomplete(true))))
        .addSubcommandGroup(group => group
            .setName('game')
            .setDescription('Play lightweight social games')
            .addSubcommand(sub => sub.setName('rps').setDescription('Play rock paper scissors against ByteBot')
                .addStringOption(opt => opt.setName('choice').setDescription('Your choice').setRequired(true).addChoices(
                    { name: 'Rock', value: 'rock' }, { name: 'Paper', value: 'paper' }, { name: 'Scissors', value: 'scissors' }
                )))
            .addSubcommand(sub => sub.setName('tictactoe').setDescription('Challenge another member')
                .addUserOption(opt => opt.setName('member').setDescription('Opponent').setRequired(true)))
            .addSubcommand(sub => sub.setName('blacktea').setDescription('Start a multiplayer word game'))
            .addSubcommand(sub => sub.setName('flags').setDescription('Start a multiplayer flag game'))
            .addSubcommand(sub => sub.setName('flag').setDescription('Play a single-player flag game')
                .addStringOption(opt => opt.setName('difficulty').setDescription('Difficulty').addChoices(
                    { name: 'Easy', value: 'easy' }, { name: 'Medium', value: 'medium' }, { name: 'Hard', value: 'hard' }
                )))
            .addSubcommand(sub => sub.setName('wyr').setDescription('Get a Would You Rather question'))
            .addSubcommand(sub => sub.setName('end').setDescription('End this channel’s BlackTea or flags game')))
        .addSubcommandGroup(group => group
            .setName('meter')
            .setDescription('Run safe deterministic meters')
            .addSubcommand(sub => sub.setName('iq').setDescription('Check a member’s fictional IQ')
                .addUserOption(opt => opt.setName('member').setDescription('Member; defaults to you'))))
        .addSubcommandGroup(group => group
            .setName('blunt')
            .setDescription('Play the fictional blunt counter game')
            .addSubcommand(sub => sub.setName('spark').setDescription('Spark your fictional blunt'))
            .addSubcommand(sub => sub.setName('smoke').setDescription('Add one tap while it is active'))
            .addSubcommand(sub => sub.setName('taps').setDescription('Show a member’s tap count')
                .addUserOption(opt => opt.setName('member').setDescription('Member; defaults to you'))))
        .addSubcommandGroup(group => group
            .setName('vape')
            .setDescription('Play the fictional server vape game')
            .addSubcommand(sub => sub.setName('hit').setDescription('Hit the vape you hold'))
            .addSubcommand(sub => sub.setName('steal').setDescription('Claim or steal the server vape'))
            .addSubcommand(sub => sub.setName('flavor').setDescription('Set the held vape flavor')
                .addStringOption(opt => opt.setName('flavor').setDescription('Flavor').setRequired(true)
                    .addChoices(...VAPE_FLAVORS.map(value => ({ name: value[0].toUpperCase() + value.slice(1), value })))))
            .addSubcommand(sub => sub.setName('hits').setDescription('Show total server vape hits')))
        .addSubcommand(sub => sub.setName('roast').setDescription('Send a playful roast')
            .addUserOption(opt => opt.setName('member').setDescription('Member; defaults to you')))
        .addSubcommand(sub => sub.setName('randomhex').setDescription('Generate a random color')),

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
        if (group === 'snipe') return handleSnipe(interaction, subcommand);
        if (group === 'roleplay') return handleRoleplay(interaction, subcommand);
        if (group === 'game') return handleGame(interaction, subcommand);
        if (group === 'meter') return handleMeter(interaction, subcommand);
        if (group === 'blunt') return handleBlunt(interaction, subcommand);
        if (group === 'vape') return handleVape(interaction, subcommand);

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
            case 'roast':
                await handleRoast(interaction);
                break;
            case 'randomhex':
                await handleRandomHex(interaction);
                break;
        }
    },

    async autocomplete(interaction) {
        if (interaction.options.getSubcommandGroup(false) !== 'roleplay') return interaction.respond([]);
        const focused = interaction.options.getFocused(true);
        if (focused.name !== 'action') return interaction.respond([]);
        const query = String(focused.value || '').toLowerCase();
        const service = interaction.client.funService;
        const toggling = interaction.options.getSubcommand(false) === 'toggle';
        const choices = ROLEPLAY_ACTIONS
            .filter(action => action.includes(query)
                && (toggling || !interaction.guildId || service?.isRoleplayEnabled(interaction.guildId, action)))
            .slice(0, 25)
            .map(action => ({ name: action, value: action }));
        return interaction.respond(choices);
    }
};

function snipeIndexOption(subcommand) {
    return subcommand.addIntegerOption(opt => opt.setName('index').setDescription('1 is the most recent').setMinValue(1).setMaxValue(10));
}

function funService(interaction) {
    if (!interaction.client.funService) throw new Error('Fun service is unavailable');
    return interaction.client.funService;
}

async function handleSnipe(interaction, subcommand) {
    if (!interaction.guild) return serverOnly(interaction);
    const service = funService(interaction);
    if (subcommand === 'protect') {
        const mode = interaction.options.getString('mode');
        if (mode === 'status') {
            const enabled = service.getSnipeProtection(interaction.user.id);
            return interaction.reply({
                embeds: [embeds.brand('Snipe Protection', `Protection is **${enabled ? 'enabled' : 'disabled'}**.`)],
                flags: [MessageFlags.Ephemeral]
            });
        }
        const enabled = mode === 'on';
        service.setSnipeProtection(interaction.user.id, enabled);
        return interaction.reply({
            embeds: [embeds.success('Snipe Protection', enabled
                ? 'Your messages and reactions will not appear in snipe commands.'
                : 'Your future messages and reactions can appear in snipe commands.')],
            flags: [MessageFlags.Ephemeral]
        });
    }
    if (subcommand === 'clear') {
        const permission = await checkUserPermissions(interaction, {
            data: { name: 'fun' }, permissions: [PermissionFlagsBits.ManageMessages]
        });
        if (!permission.allowed) return interaction.reply({ embeds: [permission.error], flags: [MessageFlags.Ephemeral] });
        service.clearSnipes(interaction.channelId);
        return interaction.reply({ embeds: [embeds.success('Snipes Cleared', 'Cleared snipes for this channel.')], flags: [MessageFlags.Ephemeral] });
    }

    const kind = { deleted: 'deleted', edited: 'edited', reaction: 'reaction' }[subcommand];
    const index = interaction.options.getInteger('index') || 1;
    const total = service.getSnipeCount(interaction.channelId, kind);
    const entry = service.getSnipe(interaction.channelId, kind, index);
    if (!entry) {
        return interaction.reply({
            embeds: [embeds.error('Nothing to Snipe', total
                ? `Index must be between 1 and ${total}.`
                : `No ${kind === 'reaction' ? 'removed reactions' : `${kind} messages`} found in this channel.`)],
            flags: [MessageFlags.Ephemeral]
        });
    }
    const labels = { deleted: 'Deleted', edited: 'Edited', reaction: 'Unreacted' };
    const suffix = kind === 'reaction' ? 'reactions' : kind === 'edited' ? 'edits' : 'messages';
    const age = Math.max(0, Math.floor((Date.now() - entry.occurredAt) / 1000));
    const description = kind === 'edited'
        ? `**Before edit**\n${entry.content}`
        : kind === 'reaction'
            ? `${entry.emoji} removed by **${entry.actorName}**${entry.messageUrl ? `\n[Jump to message](${entry.messageUrl})` : ''}`
            : entry.content;
    const embed = embeds.brand(`${labels[kind]} by ${entry.authorName}`, description)
        .setFooter({ text: `${labels[kind]} ${age} seconds ago ∙ ${index}/${total} ${suffix}` });
    if (entry.avatarUrl) embed.setThumbnail(entry.avatarUrl);
    return interaction.reply({ embeds: [embed], allowedMentions: { parse: [], repliedUser: false } });
}

async function handleRoleplay(interaction, subcommand) {
    if (!interaction.guild) return serverOnly(interaction);
    const service = funService(interaction);
    if (subcommand === 'list') {
        const rows = service.listRoleplay(interaction.guildId)
            .map(({ action, enabled }) => `${enabled ? '✅' : '❌'} ${action}`);
        rows.push(...POLICY_EXCLUDED_ROLEPLAY.map(action => `🚫 ${action} — policy excluded`));
        return interaction.reply({
            embeds: [embeds.brand(`Roleplay Actions — ${ROLEPLAY_ACTIONS.length + POLICY_EXCLUDED_ROLEPLAY.length} total`, rows.join('\n'))],
            allowedMentions: { parse: [], repliedUser: false }
        });
    }
    const action = interaction.options.getString('action');
    if (subcommand === 'toggle') {
        const permission = await checkUserPermissions(interaction, {
            data: { name: 'fun' }, permissions: [PermissionFlagsBits.ManageGuild]
        });
        if (!permission.allowed) return interaction.reply({ embeds: [permission.error], flags: [MessageFlags.Ephemeral] });
        if (!ROLEPLAY_ACTIONS.includes(action)) {
            return interaction.reply({ embeds: [embeds.error('Invalid Action', 'Choose a supported roleplay action.')], flags: [MessageFlags.Ephemeral] });
        }
        const enabled = service.toggleRoleplay(interaction.guildId, action, interaction.user.id);
        return interaction.reply({
            embeds: [embeds.success('Roleplay Updated', `**${action}** is now **${enabled ? 'enabled' : 'disabled'}**.`)],
            flags: [MessageFlags.Ephemeral]
        });
    }
    const target = interaction.options.getUser('member');
    if (!ROLEPLAY_ACTIONS.includes(action) || !service.isRoleplayEnabled(interaction.guildId, action)) {
        return interaction.reply({ embeds: [embeds.error('Action Unavailable', `**${action || 'That action'}** is unavailable in this server.`)], flags: [MessageFlags.Ephemeral] });
    }
    if (target.bot || target.id === interaction.user.id) {
        return interaction.reply({ embeds: [embeds.error('Invalid Target', target.bot ? 'Bots cannot be targeted.' : 'You cannot target yourself.')], flags: [MessageFlags.Ephemeral] });
    }
    if (!service.consumeRoleplayQuota(interaction.guildId)) {
        return interaction.reply({ embeds: [embeds.error('Roleplay Rate Limited', 'This server is sending roleplay actions too quickly. Try again in a few seconds.')], flags: [MessageFlags.Ephemeral] });
    }
    await interaction.deferReply();
    try {
        const media = await service.fetchRoleplay(action);
        const count = service.recordRoleplay(interaction.guildId, interaction.user.id, target.id, action);
        const embed = embeds.brand(action[0].toUpperCase() + action.slice(1), `<@${interaction.user.id}> used **${action}** on <@${target.id}> for the **${ordinal(count)}** time.`)
            .setImage(media.url)
            .setFooter({ text: media.credit });
        return interaction.editReply({ embeds: [embed], allowedMentions: { users: [interaction.user.id, target.id], roles: [], repliedUser: false } });
    } catch {
        return interaction.editReply({
            embeds: [embeds.error('Roleplay Unavailable', 'The media provider could not return a valid reaction. Try again later.')],
            allowedMentions: { parse: [], repliedUser: false }
        });
    }
}

function ordinal(value) {
    const tens = value % 100;
    if (tens >= 11 && tens <= 13) return `${value}th`;
    return `${value}${{ 1: 'st', 2: 'nd', 3: 'rd' }[value % 10] || 'th'}`;
}

async function handleGame(interaction, subcommand) {
    const service = funService(interaction);
    if (subcommand === 'rps') {
        const choices = ['rock', 'paper', 'scissors'];
        const choice = interaction.options.getString('choice');
        const bot = choices[randomInt(choices.length)];
        const result = choice === bot ? 'It is a tie!' : (
            (choice === 'rock' && bot === 'scissors') || (choice === 'paper' && bot === 'rock') || (choice === 'scissors' && bot === 'paper')
                ? 'You win!' : 'ByteBot wins!'
        );
        return interaction.reply({ embeds: [embeds.brand('Rock Paper Scissors', `You chose **${choice}**; I chose **${bot}**. **${result}**`)] });
    }
    if (subcommand === 'wyr') return interaction.reply({ embeds: [embeds.brand('Would You Rather', service.randomWouldYouRather())] });
    if (!interaction.guild) return serverOnly(interaction);
    try {
        if (subcommand === 'tictactoe') return await service.startTicTacToe(interaction, interaction.options.getUser('member'));
        if (subcommand === 'blacktea' || subcommand === 'flags') return await service.startLobby(interaction, subcommand);
        if (subcommand === 'flag') return await service.startSingleFlag(interaction, interaction.options.getString('difficulty') || 'easy');
        if (subcommand === 'end') {
            if (!service.isGameParticipant(interaction.channelId, interaction.user.id)) {
                const permission = await checkUserPermissions(interaction, {
                    data: { name: 'fun' }, permissions: [PermissionFlagsBits.ManageMessages]
                });
                if (!permission.allowed) return interaction.reply({ embeds: [permission.error], flags: [MessageFlags.Ephemeral] });
            }
            return await service.endGame(interaction);
        }
    } catch (error) {
        return interaction.reply({ embeds: [embeds.error('Game Unavailable', error.message)], flags: [MessageFlags.Ephemeral] });
    }
}

async function handleMeter(interaction, subcommand) {
    if (subcommand !== 'iq') return;
    const target = interaction.options.getUser('member') || interaction.user;
    const digest = createHash('sha256').update(`${interaction.guildId || 'dm'}:${target.id}:iq`).digest();
    const score = digest.readUInt16BE(0) % 201;
    return interaction.reply({
        embeds: [embeds.brand('Fictional IQ Meter', `${target.id === interaction.user.id ? 'Your' : `**${target.globalName || target.username}’s**`} fictional IQ is **${score}**.`)],
        allowedMentions: { parse: [], repliedUser: false }
    });
}

async function handleBlunt(interaction, subcommand) {
    const service = funService(interaction);
    try {
        if (subcommand === 'spark') {
            service.sparkBlunt(interaction.user.id);
            return interaction.reply({ embeds: [embeds.success('Sparked', 'You sparked the fictional blunt.')] });
        }
        if (subcommand === 'smoke') {
            const state = service.smokeBlunt(interaction.user.id);
            return interaction.reply({ embeds: [embeds.brand('Blunt', `You smoked the fictional blunt. **${state.taps}** taps total.`)] });
        }
        const target = interaction.options.getUser('member') || interaction.user;
        return interaction.reply({ embeds: [embeds.brand('Blunt Taps', `${target.id === interaction.user.id ? 'You have' : `**${target.globalName || target.username}** has`} **${service.bluntTaps(target.id)}** taps.`)] });
    } catch (error) {
        return interaction.reply({ embeds: [embeds.error('Blunt Unavailable', error.message)], flags: [MessageFlags.Ephemeral] });
    }
}

async function handleVape(interaction, subcommand) {
    if (!interaction.guild) return serverOnly(interaction);
    const service = funService(interaction);
    try {
        if (subcommand === 'steal') {
            const state = service.stealVape(interaction.guildId, interaction.user.id);
            return interaction.reply({ embeds: [embeds.success('Vape Claimed', state.stolenFrom ? `You stole the fictional vape from <@${state.stolenFrom}>.` : 'You claimed the fictional vape.')], allowedMentions: { parse: [], repliedUser: false } });
        }
        if (subcommand === 'hit') {
            const state = service.hitVape(interaction.guildId, interaction.user.id);
            return interaction.reply({ embeds: [embeds.brand('Vape', `💨 **${state.flavor}** — **${state.hits}** total hits.`)] });
        }
        if (subcommand === 'flavor') {
            const state = service.setVapeFlavor(interaction.guildId, interaction.user.id, interaction.options.getString('flavor'));
            return interaction.reply({ embeds: [embeds.success('Flavor Updated', `The fictional vape flavor is now **${state.flavor}**.`)] });
        }
        return interaction.reply({ embeds: [embeds.brand('Vape Hits', `The fictional server vape has **${service.vapeHits(interaction.guildId)}** hits.`)] });
    } catch (error) {
        return interaction.reply({ embeds: [embeds.error('Vape Unavailable', error.message)], flags: [MessageFlags.Ephemeral] });
    }
}

async function handleRoast(interaction) {
    const target = interaction.options.getUser('member') || interaction.user;
    const roast = ROASTS[randomInt(ROASTS.length)];
    return interaction.reply({
        embeds: [embeds.brand('Playful Roast', `<@${target.id}>, ${roast}`)],
        allowedMentions: { users: [target.id], roles: [], repliedUser: false }
    });
}

async function handleRandomHex(interaction) {
    const value = randomInt(0x1000000);
    const hex = `#${value.toString(16).padStart(6, '0').toUpperCase()}`;
    const r = value >> 16;
    const g = (value >> 8) & 255;
    const b = value & 255;
    const websafe = `#${[r, g, b].map(channel => Math.round(channel / 51) * 51).map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    return interaction.reply({ embeds: [embeds.brand(`Random Color: ${hex}`, `**HEX:** \`${hex}\`\n**RGB:** \`rgb(${r}, ${g}, ${b})\`\n**Websafe:** \`${websafe}\``).setColor(value)] });
}

function serverOnly(interaction) {
    return interaction.reply({ embeds: [embeds.error('Server Only', 'This command can only be used in a server.')], flags: [MessageFlags.Ephemeral] });
}

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

    if (subcommand === 'roulette') {
        const percentage = interaction.options.getInteger('percentage', true);
        setUwuRoulette(interaction.guild.id, percentage);
        return interaction.reply({
            embeds: [embeds.success('UwU Roulette', percentage ? `Random UwU Lock set to ${percentage}%.` : 'Random UwU Lock disabled.')],
            flags: [MessageFlags.Ephemeral]
        });
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
    const response = EIGHT_BALL_RESPONSES[randomInt(EIGHT_BALL_RESPONSES.length)];

    await interaction.reply({
        embeds: [embeds.brand('Magic 8-Ball', `**Question:** ${question}\n**Answer:** ${response} 🎱`)]
    });
}

/**
 * Handle /fun coin
 */
async function handleCoin(interaction) {
    const result = randomInt(2) === 0 ? 'Heads' : 'Tails';

    await interaction.reply({
        embeds: [embeds.brand('Coin Flip', `The coin landed on: **${result}** 🪙`)]
    });
}

/**
 * Handle /fun dice
 */
async function handleDice(interaction) {
    const sides = interaction.options.getInteger('sides') ?? 6;
    const result = randomInt(1, sides + 1);

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
        const response = await axios.get('https://official-joke-api.appspot.com/random_joke', {
            timeout: 5000,
            maxContentLength: 32768,
            maxRedirects: 0
        });
        const joke = response.data;

        if (typeof joke?.setup !== 'string' || typeof joke?.punchline !== 'string') {
            throw new Error('Joke provider returned an invalid response');
        }

        await interaction.editReply({
            embeds: [embeds.brand('Random Joke', `**${joke.setup.slice(0, 1000)}**\n\n*${joke.punchline.slice(0, 1000)}*`)]
        });
    } catch (error) {
        await handleCommandError(error, interaction, 'fetching a joke', { ephemeral: false });
    }
}
