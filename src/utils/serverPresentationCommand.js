const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { sqlite } = require('../database');
const { ServerPresentationService } = require('../services/serverPresentationService');

function addPresentationGroups(builder) {
    builder.addSubcommandGroup(group => group
        .setName('customize')
        .setDescription('Customize ByteBot in this server')
        .addSubcommand(sub => sub.setName('name').setDescription('Set ByteBot nickname in this server')
            .addStringOption(opt => opt.setName('nickname').setDescription('Server nickname').setRequired(true).setMinLength(1).setMaxLength(32)))
        .addSubcommand(sub => sub.setName('avatar').setDescription('Set ByteBot avatar in this server')
            .addAttachmentOption(opt => opt.setName('image').setDescription('PNG, JPG, GIF, or WebP up to 8 MB'))
            .addStringOption(opt => opt.setName('url').setDescription('Public image URL')))
        .addSubcommand(sub => sub.setName('banner').setDescription('Set ByteBot banner in this server')
            .addAttachmentOption(opt => opt.setName('image').setDescription('PNG, JPG, GIF, or WebP up to 8 MB'))
            .addStringOption(opt => opt.setName('url').setDescription('Public image URL')))
        .addSubcommand(sub => sub.setName('bio').setDescription('Set ByteBot bio in this server')
            .addStringOption(opt => opt.setName('bio').setDescription('Server bio').setRequired(true).setMinLength(1).setMaxLength(190)))
        .addSubcommand(sub => sub.setName('reset').setDescription('Reset ByteBot appearance in this server')
            .addBooleanOption(opt => opt.setName('confirm').setDescription('Confirm reset').setRequired(true)))
        .addSubcommand(sub => sub.setName('preset').setDescription('Manage server profile presets')
            .addStringOption(opt => opt.setName('action').setDescription('Preset action').setRequired(true).addChoices(
                { name: 'Create', value: 'create' }, { name: 'List', value: 'list' },
                { name: 'Apply', value: 'apply' }, { name: 'Remove', value: 'remove' }
            ))
            .addStringOption(opt => opt.setName('name_or_id').setDescription('Preset name or ID').setMaxLength(50))
            .addBooleanOption(opt => opt.setName('confirm').setDescription('Confirm apply or removal'))));

    return builder.addSubcommandGroup(group => group
        .setName('discovery')
        .setDescription('Opt-in ByteBot server directory')
        .addSubcommand(sub => sub.setName('publish').setDescription('Publish or update this server listing')
            .addStringOption(opt => opt.setName('invite').setDescription('Discord invite for this server').setRequired(true))
            .addStringOption(opt => opt.setName('description').setDescription('Public listing description').setMaxLength(500))
            .addStringOption(opt => opt.setName('tags').setDescription('Up to five comma-separated tags').setMaxLength(104))
            .addAttachmentOption(opt => opt.setName('banner').setDescription('Optional public listing banner')))
        .addSubcommand(sub => sub.setName('list').setDescription('Browse opted-in ByteBot servers')
            .addStringOption(opt => opt.setName('query').setDescription('Search name, description, or tags').setMaxLength(100)))
        .addSubcommand(sub => sub.setName('view').setDescription('View this server listing'))
        .addSubcommand(sub => sub.setName('bump').setDescription('Bump this server listing'))
        .addSubcommand(sub => sub.setName('remove').setDescription('Withdraw this server from ByteBot discovery')
            .addBooleanOption(opt => opt.setName('confirm').setDescription('Confirm listing removal').setRequired(true))));
}

async function respond(interaction, content, ephemeral = true) {
    const payload = { content, allowedMentions: { parse: [] } };
    if (ephemeral && !interaction.deferred) payload.flags = [MessageFlags.Ephemeral];
    return interaction.deferred || interaction.replied ? interaction.editReply(payload) : interaction.reply(payload);
}

function presetText(preset) {
    return `\`${preset.id}\` **${preset.name}** · nickname: ${preset.nickname || 'default'} · avatar: ${preset.avatar ? 'custom' : 'default'} · banner: ${preset.banner ? 'custom' : 'default'} · bio: ${preset.bio || 'default'}`;
}

function listingText(listing) {
    return `**${listing.name}** · ${listing.memberCount.toLocaleString()} members\n${listing.description || 'No description.'}\n${listing.tags.map(tag => `\`${tag}\``).join(' ') || 'No tags'} · ${listing.invite}`;
}

async function executeCustomize(interaction) {
    if (interaction.guild.ownerId !== interaction.user.id) {
        return respond(interaction, 'Only the server owner can customize ByteBot in this server.');
    }
    const service = new ServerPresentationService({ sqlite });
    const action = interaction.options.getSubcommand();
    try {
        if (action === 'name') {
            await service.customize(interaction.guild, { nickname: interaction.options.getString('nickname', true) });
            return respond(interaction, 'Updated ByteBot nickname for this server.');
        }
        if (action === 'avatar' || action === 'banner') {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            const image = interaction.options.getAttachment('image') || interaction.options.getString('url');
            if (!image) throw new Error('Provide an image attachment or URL.');
            await service.customize(interaction.guild, { [action]: image });
            return respond(interaction, `Updated ByteBot ${action} for this server.`);
        }
        if (action === 'bio') {
            await service.customize(interaction.guild, { bio: interaction.options.getString('bio', true) });
            return respond(interaction, 'Updated ByteBot bio for this server.');
        }
        if (action === 'reset') {
            if (!interaction.options.getBoolean('confirm', true)) return respond(interaction, 'Customization reset cancelled.');
            await service.reset(interaction.guild);
            return respond(interaction, 'Reset ByteBot appearance for this server.');
        }

        const presetAction = interaction.options.getString('action', true);
        const selector = interaction.options.getString('name_or_id');
        if (presetAction === 'list') {
            const presets = service.listPresets(interaction.guild.id);
            return respond(interaction, presets.length ? presets.map(presetText).join('\n') : 'This server has no customization presets.');
        }
        if (!selector) throw new Error('name_or_id is required for this preset action.');
        if (presetAction === 'create') {
            const preset = service.createPreset(interaction.guild, selector, interaction.user.id);
            return respond(interaction, `Created preset ${presetText(preset)}`);
        }
        const preset = service.previewPreset(interaction.guild.id, selector);
        if (!preset) throw new Error('Customization preset not found.');
        if (!interaction.options.getBoolean('confirm')) {
            return respond(interaction, `${presetText(preset)}\nRun again with \`confirm:True\` to ${presetAction} it.`);
        }
        if (presetAction === 'apply') await service.applyPreset(interaction.guild, selector, true);
        else service.removePreset(interaction.guild.id, selector);
        return respond(interaction, `${presetAction === 'apply' ? 'Applied' : 'Removed'} preset **${preset.name}**.`);
    } catch (error) {
        return respond(interaction, `Customization failed: ${error.message}`);
    }
}

async function executeDiscovery(interaction) {
    const service = new ServerPresentationService({ sqlite });
    const action = interaction.options.getSubcommand();
    const canManage = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
    try {
        if (action === 'list') {
            const listings = service.listListings(interaction.options.getString('query'));
            return respond(interaction, listings.length ? listings.map(listingText).join('\n\n') : 'No public ByteBot server listings matched.', false);
        }
        if (action === 'view') {
            const listing = service.getListing(interaction.guild.id);
            return respond(interaction, listing ? listingText(listing) : 'This server is not listed in ByteBot discovery.', false);
        }
        if (!canManage) return respond(interaction, 'You need **Manage Server** to change this discovery listing.');
        if (action === 'publish') {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            const inviteUrl = interaction.options.getString('invite', true);
            const invite = await interaction.client.fetchInvite(inviteUrl);
            const banner = interaction.options.getAttachment('banner');
            const listing = await service.publish(interaction.guild, {
                invite: inviteUrl,
                inviteGuildId: invite.guild?.id,
                description: interaction.options.getString('description'),
                tags: (interaction.options.getString('tags') || '').split(','),
                banner: banner?.url
            }, interaction.user.id);
            return respond(interaction, `Published this opt-in ByteBot listing.\n${listingText(listing)}`);
        }
        if (action === 'bump') {
            const listing = service.bump(interaction.guild.id, interaction.user.id);
            return respond(interaction, `Bumped **${listing.name}** in ByteBot discovery.`);
        }
        if (!interaction.options.getBoolean('confirm', true)) return respond(interaction, 'Discovery removal cancelled.');
        if (!service.removeListing(interaction.guild.id)) throw new Error('This server is not listed.');
        return respond(interaction, 'Removed this server from ByteBot discovery.');
    } catch (error) {
        return respond(interaction, `Discovery failed: ${error.message}`);
    }
}

module.exports = { addPresentationGroups, executeCustomize, executeDiscovery };
