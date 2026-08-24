const { ChannelType, MessageFlags, PermissionFlagsBits } = require('discord.js');
const embeds = require('../utils/embeds');
const logger = require('../utils/logger');
const { voiceMasterInterface, voiceMasterRenameModal } = require('../components/voiceMasterControls');

const SETUP_PERMISSIONS = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.MoveMembers
];
const OWNER_ACTIONS = new Set([
    'bitrate', 'region', 'status', 'limit', 'rename', 'lock', 'unlock', 'hide',
    'reveal', 'claim', 'information', 'delete', 'drag', 'permit', 'reject'
]);

class VoiceMasterService {
    constructor({ client = null, sqlite, now = Date.now, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
        this.client = client;
        this.sqlite = sqlite;
        this.now = now;
        this.delay = delay;
    }

    config(guildId) {
        return this.sqlite.prepare('SELECT * FROM voice_master_configs WHERE guild_id = ?').get(guildId) || null;
    }

    async execute(interaction) {
        const group = interaction.options.getSubcommandGroup(false);
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'setup') return this.setup(interaction);
        if (subcommand === 'sendinterface') return this.sendInterface(interaction);
        if (subcommand === 'reset') return this.reset(interaction);
        if (group === 'secondary') return this.executeSecondary(interaction, subcommand);
        if (group === 'default') return this.executeDefaults(interaction, subcommand);
        if (['template', 'temporary', 'joinrole'].includes(subcommand)) {
            return this.executeConfiguration(interaction, subcommand);
        }
        if (!group && OWNER_ACTIONS.has(subcommand)) return this.executeOwnerAction(interaction, subcommand);
        return interaction.editReply({ embeds: [embeds.error('Not Available', `VoiceMaster ${group ? `${group} ` : ''}${subcommand} is not available yet.`)] });
    }

    async handleInteraction(interaction) {
        const [namespace, scopeId, action] = String(interaction.customId || '').split(':');
        if (namespace !== 'voicemaster' || !scopeId || !action) return;
        if (interaction.isButton() && action === 'rename') {
            return interaction.showModal(voiceMasterRenameModal(scopeId));
        }

        let mappedAction = action;
        const values = {};
        if (interaction.isModalSubmit() && action === 'rename-submit') {
            mappedAction = 'rename';
            values.name = interaction.fields.getTextInputValue('name');
        } else if (interaction.isButton() && (action === 'increase' || action === 'decrease')) {
            const current = interaction.member.voice?.channel?.userLimit || 0;
            values.limit = action === 'increase' ? Math.min(99, current + 1) : Math.max(0, current - 1);
            mappedAction = 'limit';
        }
        if (!OWNER_ACTIONS.has(mappedAction)) return;
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const commandInteraction = new Proxy(interaction, {
            get(target, property) {
                if (property === 'options') {
                    return {
                        getInteger: name => values[name] ?? null,
                        getString: name => values[name] ?? null,
                        getMember: () => null,
                        getUser: () => null
                    };
                }
                const value = target[property];
                return typeof value === 'function' ? value.bind(target) : value;
            }
        });
        return this.executeOwnerAction(commandInteraction, mappedAction);
    }

    requireAdmin(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            throw new Error('Only server administrators can configure VoiceMaster.');
        }
    }

    requireBotPermissions(guild, permissions = SETUP_PERMISSIONS) {
        const missing = permissions.filter(permission => !guild.members.me?.permissions?.has(permission));
        if (missing.length) throw new Error('ByteBot needs View Channel, Manage Channels, Manage Roles, and Move Members for VoiceMaster.');
    }

    async setup(interaction) {
        try {
            this.requireAdmin(interaction);
            this.requireBotPermissions(interaction.guild);
            const existing = this.config(interaction.guildId);
            if (existing?.state === 'active') {
                return interaction.editReply({ embeds: [embeds.warn('Already Setup', 'VoiceMaster is already configured for this server.')] });
            }

            const now = this.now();
            this.sqlite.prepare(`INSERT INTO voice_master_configs (guild_id, state, updated_at)
                VALUES (?, 'creating', ?)
                ON CONFLICT (guild_id) DO UPDATE SET state = 'creating', updated_at = excluded.updated_at`)
                .run(interaction.guildId, now);

            let category = null;
            let channel = null;
            try {
                category = await interaction.guild.channels.create({ name: 'VoiceMaster', type: ChannelType.GuildCategory });
                channel = await interaction.guild.channels.create({
                    name: 'Join to Create', type: ChannelType.GuildVoice, parent: category.id
                });
                const message = await channel.send(voiceMasterInterface(channel.id));
                this.sqlite.transaction(() => {
                    this.sqlite.prepare(`INSERT INTO voice_master_sources
                        (channel_id, guild_id, category_id, interface_message_id, is_primary, owned, created_at)
                        VALUES (?, ?, ?, ?, 1, 1, ?)`)
                        .run(channel.id, interaction.guildId, category.id, message.id, now);
                    this.sqlite.prepare(`UPDATE voice_master_configs SET state = 'active', category_id = ?,
                        primary_channel_id = ?, interface_message_id = ?, updated_at = ? WHERE guild_id = ?`)
                        .run(category.id, channel.id, message.id, now, interaction.guildId);
                })();
                return interaction.editReply({ embeds: [embeds.success('VoiceMaster Setup', `Created ${channel} in ${category}.`)] });
            } catch (error) {
                if (channel) await channel.delete('VoiceMaster setup failed').catch(() => null);
                if (category) await category.delete?.('VoiceMaster setup failed').catch(() => null);
                this.sqlite.prepare("UPDATE voice_master_configs SET state = 'failed', updated_at = ? WHERE guild_id = ?")
                    .run(this.now(), interaction.guildId);
                throw error;
            }
        } catch (error) {
            return interaction.editReply({ embeds: [embeds.error('VoiceMaster Setup Failed', error.message)] });
        }
    }

    async sendInterface(interaction) {
        try {
            this.requireAdmin(interaction);
            const config = this.config(interaction.guildId);
            if (!config || config.state !== 'active') throw new Error('VoiceMaster is not setup for this server.');
            const channel = interaction.guild.channels.cache.get(config.primary_channel_id)
                || await interaction.guild.channels.fetch(config.primary_channel_id);
            if (!channel || channel.type !== ChannelType.GuildVoice) throw new Error('The configured join channel is missing.');
            const message = await channel.send(voiceMasterInterface(channel.id));
            this.sqlite.transaction(() => {
                this.sqlite.prepare('UPDATE voice_master_configs SET interface_message_id = ?, updated_at = ? WHERE guild_id = ?')
                    .run(message.id, this.now(), interaction.guildId);
                this.sqlite.prepare('UPDATE voice_master_sources SET interface_message_id = ? WHERE channel_id = ? AND guild_id = ?')
                    .run(message.id, channel.id, interaction.guildId);
            })();
            return interaction.editReply({ embeds: [embeds.success('Interface Sent', `Sent the VoiceMaster interface in ${channel}.`)] });
        } catch (error) {
            return interaction.editReply({ embeds: [embeds.error('Interface Failed', error.message)] });
        }
    }

    async executeSecondary(interaction, action) {
        try {
            this.requireAdmin(interaction);
            const config = this.config(interaction.guildId);
            if (!config || config.state !== 'active') throw new Error('VoiceMaster is not setup for this server.');
            if (action === 'list') {
                const rows = this.sqlite.prepare(`SELECT channel_id, category_id FROM voice_master_sources
                    WHERE guild_id = ? AND is_primary = 0 ORDER BY created_at, channel_id LIMIT 25`)
                    .all(interaction.guildId);
                const description = rows.length
                    ? rows.map(row => `<#${row.channel_id}>${row.category_id ? ` → <#${row.category_id}>` : ''}`).join('\n')
                    : 'No secondary join-to-create channels.';
                return interaction.editReply({
                    embeds: [embeds.info('Secondary VoiceMaster Channels', description)],
                    allowedMentions: { parse: [] }
                });
            }

            const channel = interaction.options.getChannel('channel');
            if (!channel || channel.type !== ChannelType.GuildVoice) throw new Error('Choose a server voice channel.');
            if (action === 'add') {
                const count = this.sqlite.prepare(`SELECT COUNT(*) count FROM voice_master_sources
                    WHERE guild_id = ? AND is_primary = 0`).get(interaction.guildId).count;
                if (count >= 25) throw new Error('This server already has 25 secondary join channels.');
                this.sqlite.prepare(`INSERT INTO voice_master_sources
                    (channel_id, guild_id, category_id, is_primary, owned, created_at)
                    VALUES (?, ?, ?, 0, 0, ?)`)
                    .run(channel.id, interaction.guildId, channel.parentId || config.category_id, this.now());
            } else if (action === 'category') {
                const category = interaction.options.getChannel('category');
                if (!category || category.type !== ChannelType.GuildCategory) throw new Error('Choose a server category.');
                const changed = this.sqlite.prepare(`UPDATE voice_master_sources SET category_id = ?
                    WHERE guild_id = ? AND channel_id = ? AND is_primary = 0`)
                    .run(category.id, interaction.guildId, channel.id);
                if (!changed.changes) throw new Error('That secondary join channel is not configured.');
            } else if (action === 'remove') {
                const removed = this.sqlite.prepare(`DELETE FROM voice_master_sources
                    WHERE guild_id = ? AND channel_id = ? AND is_primary = 0 AND owned = 0`)
                    .run(interaction.guildId, channel.id);
                if (!removed.changes) throw new Error('That secondary join channel is not configured.');
            } else {
                throw new Error('Unknown secondary VoiceMaster action.');
            }
            return interaction.editReply({ embeds: [embeds.success('VoiceMaster Updated', `Updated secondary channel ${channel}.`)] });
        } catch (error) {
            return interaction.editReply({ embeds: [embeds.error('VoiceMaster Configuration Failed', error.message)] });
        }
    }

    async reset(interaction) {
        try {
            this.requireAdmin(interaction);
            const config = this.config(interaction.guildId);
            if (!config || config.state !== 'active') throw new Error('VoiceMaster is not setup for this server.');
            this.sqlite.prepare("UPDATE voice_master_configs SET state = 'resetting', updated_at = ? WHERE guild_id = ? AND state = 'active'")
                .run(this.now(), interaction.guildId);
            const primary = this.sqlite.prepare(`SELECT * FROM voice_master_sources
                WHERE guild_id = ? AND is_primary = 1 AND owned = 1`).get(interaction.guildId);
            if (primary) {
                const channel = interaction.guild.channels.cache.get(primary.channel_id)
                    || await interaction.guild.channels.fetch(primary.channel_id).catch(() => null);
                if (channel) await channel.delete('VoiceMaster reset');
            }
            if (config.category_id) {
                const category = interaction.guild.channels.cache.get(config.category_id)
                    || await interaction.guild.channels.fetch(config.category_id).catch(() => null);
                if (category?.type === ChannelType.GuildCategory) await category.delete('VoiceMaster reset');
            }
            this.sqlite.transaction(() => {
                this.sqlite.prepare('DELETE FROM voice_master_sources WHERE guild_id = ?').run(interaction.guildId);
                this.sqlite.prepare('DELETE FROM voice_master_configs WHERE guild_id = ?').run(interaction.guildId);
            })();
            return interaction.editReply({ embeds: [embeds.success('VoiceMaster Reset', 'VoiceMaster setup resources were removed.')] });
        } catch (error) {
            this.sqlite.prepare("UPDATE voice_master_configs SET state = 'active', updated_at = ? WHERE guild_id = ? AND state = 'resetting'")
                .run(this.now(), interaction.guildId);
            return interaction.editReply({ embeds: [embeds.error('VoiceMaster Reset Failed', error.message)] });
        }
    }

    source(guildId, channelId) {
        return this.sqlite.prepare(`SELECT source.*, config.name_template, config.default_role_id,
            config.default_bitrate, config.default_region, config.send_interface,
            config.temporary_enabled, config.join_role_id
            FROM voice_master_sources source
            JOIN voice_master_configs config ON config.guild_id = source.guild_id
            WHERE source.guild_id = ? AND source.channel_id = ? AND config.state = 'active'`)
            .get(guildId, channelId) || null;
    }

    reserveCreation(guildId, sourceChannelId, memberId) {
        return this.sqlite.transaction(() => {
            const existing = this.sqlite.prepare(`SELECT * FROM voice_master_creations
                WHERE guild_id = ? AND source_channel_id = ? AND member_id = ?`)
                .get(guildId, sourceChannelId, memberId);
            if (existing?.state === 'active' || existing?.state === 'pending') return { acquired: false, creation: existing };
            const generation = (existing?.generation || 0) + 1;
            this.sqlite.prepare(`INSERT INTO voice_master_creations
                (guild_id, source_channel_id, member_id, state, generation, updated_at)
                VALUES (?, ?, ?, 'pending', ?, ?)
                ON CONFLICT (guild_id, source_channel_id, member_id) DO UPDATE SET
                    channel_id = NULL, state = 'pending', generation = excluded.generation,
                    error = NULL, updated_at = excluded.updated_at`)
                .run(guildId, sourceChannelId, memberId, generation, this.now());
            return {
                acquired: true,
                creation: { guild_id: guildId, source_channel_id: sourceChannelId, member_id: memberId, generation }
            };
        })();
    }

    async reuseCreation(guild, member, creation) {
        if (creation?.state !== 'active' || !creation.channel_id) return false;
        const channel = guild.channels.cache.get(creation.channel_id)
            || await guild.channels.fetch(creation.channel_id).catch(() => null);
        const owned = this.sqlite.prepare(`SELECT 1 FROM bytepods
            WHERE guild_id = ? AND channel_id = ? AND owner_id = ? AND state = 'active' AND bot_owned = 1`)
            .get(guild.id, creation.channel_id, member.id);
        if (!channel || channel.type !== ChannelType.GuildVoice || !owned) return false;
        await member.voice.setChannel(channel);
        return true;
    }

    async handleVoiceState(oldState, newState) {
        const member = newState.member;
        const guild = newState.guild;
        if (!member || member.user?.bot || !guild) return false;
        let handled = false;
        if (oldState.channelId && oldState.channelId !== newState.channelId) {
            await this.removeJoinRoleAfterExit(guild, member, oldState.channelId, newState.channelId);
            handled = await this.handleOwnedLeave(guild, oldState.channelId, member.id);
        }
        const source = this.source(guild.id, newState.channelId);
        if (!source || !source.temporary_enabled || oldState.channelId === newState.channelId) return handled;

        const reservation = this.reserveCreation(guild.id, source.channel_id, member.id);
        if (!reservation.acquired) return this.reuseCreation(guild, member, reservation.creation);
        const currentVoice = guild.voiceStates.cache.get(member.id);
        if (!currentVoice || currentVoice.channelId !== source.channel_id) {
            this.failCreation(reservation.creation, 'Member left the join channel before creation.');
            return true;
        }

        let channel = null;
        try {
            this.requireBotPermissions(guild);
            const ownerName = member.displayName || member.user.username;
            const name = source.name_template.replaceAll('{owner}', ownerName).slice(0, 100);
            const permissionOverwrites = [{
                id: guild.id,
                deny: source.default_role_id && source.default_role_id !== guild.id ? [PermissionFlagsBits.Connect] : []
            }];
            if (source.default_role_id && source.default_role_id !== guild.id) {
                permissionOverwrites.push({
                    id: source.default_role_id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
                });
            }
            permissionOverwrites.push({
                id: member.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect,
                    PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers]
            });
            permissionOverwrites.push({
                id: guild.members.me.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect,
                    PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers]
            });
            channel = await guild.channels.create({
                name,
                type: ChannelType.GuildVoice,
                parent: source.category_id,
                bitrate: source.default_bitrate || undefined,
                rtcRegion: source.default_region || null,
                permissionOverwrites,
                reason: `VoiceMaster channel for ${member.user.username}`
            });

            const freshVoice = guild.voiceStates.cache.get(member.id);
            if (!freshVoice || freshVoice.channelId !== source.channel_id) {
                await channel.delete('VoiceMaster creator left before move').catch(() => null);
                this.failCreation(reservation.creation, 'Member left the join channel before move.');
                return true;
            }

            const now = this.now();
            this.sqlite.transaction(() => {
                this.sqlite.prepare(`INSERT INTO bytepods
                    (channel_id, guild_id, owner_id, original_owner_id, source_channel_id,
                     state, generation, bot_owned, created_at)
                    VALUES (?, ?, ?, ?, ?, 'active', ?, 1, ?)`)
                    .run(channel.id, guild.id, member.id, member.id, source.channel_id, reservation.creation.generation, now);
                this.sqlite.prepare(`UPDATE voice_master_creations SET channel_id = ?, state = 'active',
                    error = NULL, updated_at = ? WHERE guild_id = ? AND source_channel_id = ?
                    AND member_id = ? AND generation = ? AND state = 'pending'`)
                    .run(channel.id, now, guild.id, source.channel_id, member.id, reservation.creation.generation);
            })();

            await member.voice.setChannel(channel);
            if (source.join_role_id) {
                await member.roles.add(source.join_role_id, 'VoiceMaster channel joined').catch(error => {
                    logger.warn(`VoiceMaster join role failed for ${member.id}: ${error.message}`);
                });
            }
            if (source.send_interface) {
                await channel.send(voiceMasterInterface(channel.id)).catch(error => {
                    logger.warn(`VoiceMaster interface send failed for ${channel.id}: ${error.message}`);
                });
            }
            return true;
        } catch (error) {
            if (channel) await channel.delete('VoiceMaster creation failed').catch(() => null);
            this.sqlite.prepare('DELETE FROM bytepods WHERE guild_id = ? AND channel_id = ?')
                .run(guild.id, channel?.id || '');
            this.failCreation(reservation.creation, error.message);
            logger.warn(`VoiceMaster creation failed in ${guild.id}: ${error.message}`);
            return true;
        }
    }

    failCreation(creation, error) {
        this.sqlite.prepare(`UPDATE voice_master_creations SET channel_id = NULL, state = 'failed',
            error = ?, updated_at = ? WHERE guild_id = ? AND source_channel_id = ?
            AND member_id = ? AND generation = ?`)
            .run(String(error).slice(0, 500), this.now(), creation.guild_id,
                creation.source_channel_id, creation.member_id, creation.generation);
    }

    async handleOwnedLeave(guild, channelId, memberId) {
        const initial = this.sqlite.prepare(`SELECT * FROM bytepods
            WHERE guild_id = ? AND channel_id = ? AND state = 'active' AND bot_owned = 1`)
            .get(guild.id, channelId);
        if (!initial) return false;
        await this.delay(1000);
        const channel = guild.channels.cache.get(channelId)
            || await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || channel.type !== ChannelType.GuildVoice) return true;
        if (channel.members.size > 0) {
            if (initial.owner_id === memberId && !channel.members.has(memberId)) {
                this.sqlite.prepare(`UPDATE bytepods SET owner_left_at = ?, generation = generation + 1
                    WHERE guild_id = ? AND channel_id = ? AND owner_id = ? AND state = 'active'`)
                    .run(this.now(), guild.id, channelId, memberId);
            }
            return true;
        }
        const won = this.sqlite.prepare(`UPDATE bytepods SET state = 'deleting', generation = generation + 1
            WHERE guild_id = ? AND channel_id = ? AND state = 'active' AND bot_owned = 1
            AND NOT EXISTS (SELECT 1 FROM voice_master_creations
                WHERE guild_id = ? AND channel_id = ? AND state = 'pending')`)
            .run(guild.id, channelId, guild.id, channelId);
        if (!won.changes) return true;

        try {
            await channel.delete('VoiceMaster channel became empty');
            this.clearOwnedChannel(guild.id, channelId);
        } catch (error) {
            if (error.code === 10003) {
                this.clearOwnedChannel(guild.id, channelId);
            } else {
                this.sqlite.prepare(`UPDATE bytepods SET state = 'active', cleanup_after = ?
                    WHERE guild_id = ? AND channel_id = ? AND state = 'deleting'`)
                    .run(this.now() + 5000, guild.id, channelId);
                logger.warn(`VoiceMaster cleanup failed for ${channelId}: ${error.message}`);
            }
        }
        return true;
    }

    async removeJoinRoleAfterExit(guild, member, oldChannelId, newChannelId) {
        const oldOwned = this.sqlite.prepare(`SELECT 1 FROM bytepods
            WHERE guild_id = ? AND channel_id = ? AND state = 'active' AND bot_owned = 1`)
            .get(guild.id, oldChannelId);
        if (!oldOwned) return;
        const stillInside = newChannelId && this.sqlite.prepare(`SELECT 1 FROM bytepods
            WHERE guild_id = ? AND channel_id = ? AND state = 'active' AND bot_owned = 1`)
            .get(guild.id, newChannelId);
        if (stillInside) return;
        const config = this.config(guild.id);
        if (!config?.join_role_id) return;
        await member.roles.remove(config.join_role_id, 'VoiceMaster channel left').catch(error => {
            logger.warn(`VoiceMaster join role removal failed for ${member.id}: ${error.message}`);
        });
    }

    ownerContext(interaction, allowClaim = false) {
        const channel = interaction.member.voice?.channel;
        if (!channel || channel.type !== ChannelType.GuildVoice) throw new Error('You are not in a VoiceMaster channel.');
        const pod = this.sqlite.prepare(`SELECT * FROM bytepods
            WHERE guild_id = ? AND channel_id = ? AND state = 'active' AND bot_owned = 1`)
            .get(interaction.guildId, channel.id);
        if (!pod) throw new Error('You are not in a VoiceMaster channel.');
        if (!allowClaim && pod.owner_id !== interaction.user.id) throw new Error('You are not the owner of this voice channel.');
        return { channel, pod };
    }

    requireChannelPermissions(guild, channel, permissions) {
        const available = channel.permissionsFor?.(guild.members.me) || guild.members.me?.permissions;
        if (!available || permissions.some(permission => !available.has(permission))) {
            throw new Error('ByteBot is missing a required channel permission for this action.');
        }
    }

    async executeOwnerAction(interaction, action) {
        try {
            const { channel, pod } = this.ownerContext(interaction, action === 'claim');
            switch (action) {
            case 'lock':
                this.requireChannelPermissions(interaction.guild, channel, [PermissionFlagsBits.ManageRoles]);
                await channel.permissionOverwrites.edit(interaction.guild.id, { Connect: false });
                break;
            case 'unlock':
                this.requireChannelPermissions(interaction.guild, channel, [PermissionFlagsBits.ManageRoles]);
                await channel.permissionOverwrites.edit(interaction.guild.id, { Connect: null });
                break;
            case 'hide':
                this.requireChannelPermissions(interaction.guild, channel, [PermissionFlagsBits.ManageRoles]);
                await channel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: false });
                break;
            case 'reveal':
                this.requireChannelPermissions(interaction.guild, channel, [PermissionFlagsBits.ManageRoles]);
                await channel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: null });
                break;
            case 'limit': {
                const limit = interaction.options.getInteger('limit');
                if (!Number.isInteger(limit) || limit < 0 || limit > 99) throw new Error('The user limit must be between 0 and 99.');
                this.requireChannelPermissions(interaction.guild, channel, [PermissionFlagsBits.ManageChannels]);
                await channel.setUserLimit(limit);
                break;
            }
            case 'rename': {
                const name = String(interaction.options.getString('name') || '').trim();
                if (!name || name.length > 100) throw new Error('The channel name must be 1–100 characters.');
                this.requireChannelPermissions(interaction.guild, channel, [PermissionFlagsBits.ManageChannels]);
                await channel.setName(name);
                break;
            }
            case 'bitrate': {
                const bitrate = interaction.options.getInteger('bitrate');
                const maximum = interaction.guild.maximumBitrate || 96000;
                if (!Number.isInteger(bitrate) || bitrate < 8000 || bitrate > maximum) {
                    throw new Error(`The bitrate must be between 8000 and ${maximum}.`);
                }
                this.requireChannelPermissions(interaction.guild, channel, [PermissionFlagsBits.ManageChannels]);
                await channel.setBitrate(bitrate);
                break;
            }
            case 'region': {
                const requested = interaction.options.getString('region');
                let region = null;
                if (requested && requested !== 'auto') {
                    const regions = await interaction.guild.fetchVoiceRegions();
                    const match = regions.get?.(requested)
                        || [...regions.values()].find(item => item.id === requested);
                    if (!match || match.deprecated) throw new Error('That voice region is unavailable.');
                    region = match.id;
                }
                this.requireChannelPermissions(interaction.guild, channel, [PermissionFlagsBits.ManageChannels]);
                await channel.setRTCRegion(region);
                break;
            }
            case 'status': {
                const value = interaction.options.getString('status');
                const status = !value || value === 'clear' ? null : value;
                if (status && status.length > 500) throw new Error('Voice status must be at most 500 characters.');
                this.requireChannelPermissions(interaction.guild, channel, [PermissionFlagsBits.ManageChannels]);
                await channel.setStatus(status);
                break;
            }
            case 'permit': {
                const target = await this.targetMember(interaction);
                if (target.id === interaction.user.id) throw new Error('You already have access to your channel.');
                this.requireChannelPermissions(interaction.guild, channel, [PermissionFlagsBits.ManageRoles]);
                await channel.permissionOverwrites.edit(target.id, { ViewChannel: true, Connect: true });
                this.persistAccess(interaction.guildId, channel.id, target.id, 'permit');
                break;
            }
            case 'drag': {
                const target = await this.targetMember(interaction);
                if (!target.voice?.channelId) throw new Error('That user is not in a voice channel.');
                this.requireChannelPermissions(interaction.guild, channel, [PermissionFlagsBits.MoveMembers]);
                await target.voice.setChannel(channel);
                break;
            }
            case 'reject': {
                const target = await this.targetMember(interaction);
                if (target.id === interaction.user.id) throw new Error('You cannot reject yourself from your channel.');
                const permissions = [PermissionFlagsBits.ManageRoles];
                if (target.voice?.channelId === channel.id) permissions.push(PermissionFlagsBits.MoveMembers);
                this.requireChannelPermissions(interaction.guild, channel, permissions);
                await channel.permissionOverwrites.edit(target.id, { Connect: false });
                this.persistAccess(interaction.guildId, channel.id, target.id, 'reject');
                if (target.voice?.channelId === channel.id) await target.voice.disconnect('Rejected from VoiceMaster channel');
                break;
            }
            case 'information':
                return interaction.editReply({
                    embeds: [embeds.info('VoiceMaster Information', [
                        `Owner: <@${pod.owner_id}>`,
                        `Members: ${channel.members.size}`,
                        `Limit: ${channel.userLimit || 'Unlimited'}`,
                        `Bitrate: ${channel.bitrate}`,
                        `Region: ${channel.rtcRegion || 'Automatic'}`
                    ].join('\n'))],
                    allowedMentions: { parse: [] }
                });
            case 'claim': {
                if (pod.owner_id === interaction.user.id) throw new Error('You already own this voice channel.');
                if (channel.members.has(pod.owner_id)) throw new Error('The current owner is still in this voice channel.');
                this.requireChannelPermissions(interaction.guild, channel, [PermissionFlagsBits.ManageRoles]);
                const won = this.sqlite.prepare(`UPDATE bytepods SET owner_id = ?, owner_left_at = NULL,
                    reclaim_request_pending = 0, generation = generation + 1
                    WHERE guild_id = ? AND channel_id = ? AND owner_id = ? AND generation = ?
                    AND state = 'active' AND bot_owned = 1`)
                    .run(interaction.user.id, interaction.guildId, channel.id, pod.owner_id, pod.generation);
                if (!won.changes) throw new Error('Another member claimed this channel first.');
                try {
                    await channel.permissionOverwrites.edit(pod.owner_id, {
                        ManageChannels: null, MoveMembers: null
                    });
                    await channel.permissionOverwrites.edit(interaction.user.id, {
                        ViewChannel: true, Connect: true, ManageChannels: true, MoveMembers: true
                    });
                } catch (error) {
                    this.sqlite.prepare(`UPDATE bytepods SET owner_id = ?, generation = generation + 1
                        WHERE guild_id = ? AND channel_id = ? AND owner_id = ? AND generation = ?`)
                        .run(pod.owner_id, interaction.guildId, channel.id, interaction.user.id, pod.generation + 1);
                    throw error;
                }
                break;
            }
            case 'delete': {
                const won = this.sqlite.prepare(`UPDATE bytepods SET state = 'deleting', generation = generation + 1
                    WHERE guild_id = ? AND channel_id = ? AND owner_id = ? AND state = 'active' AND bot_owned = 1`)
                    .run(interaction.guildId, channel.id, interaction.user.id);
                if (!won.changes) throw new Error('This channel changed before it could be deleted.');
                try {
                    await channel.delete('VoiceMaster owner requested deletion');
                    this.clearOwnedChannel(interaction.guildId, channel.id);
                } catch (error) {
                    if (error.code === 10003) this.clearOwnedChannel(interaction.guildId, channel.id);
                    else {
                        this.sqlite.prepare("UPDATE bytepods SET state = 'active' WHERE guild_id = ? AND channel_id = ? AND state = 'deleting'")
                            .run(interaction.guildId, channel.id);
                        throw error;
                    }
                }
                break;
            }
            default:
                throw new Error(`VoiceMaster ${action} is not available yet.`);
            }
            return interaction.editReply({ embeds: [embeds.success('VoiceMaster Updated', `Updated ${action} for ${channel}.`)] });
        } catch (error) {
            return interaction.editReply({ embeds: [embeds.error('VoiceMaster Action Failed', error.message)] });
        }
    }

    clearOwnedChannel(guildId, channelId) {
        this.sqlite.transaction(() => {
            this.sqlite.prepare('DELETE FROM voice_master_access WHERE guild_id = ? AND channel_id = ?')
                .run(guildId, channelId);
            this.sqlite.prepare('DELETE FROM voice_master_creations WHERE guild_id = ? AND channel_id = ?')
                .run(guildId, channelId);
            this.sqlite.prepare('DELETE FROM bytepod_active_sessions WHERE guild_id = ? AND pod_id = ?')
                .run(guildId, channelId);
            this.sqlite.prepare('DELETE FROM bytepods WHERE guild_id = ? AND channel_id = ? AND bot_owned = 1')
                .run(guildId, channelId);
        })();
    }

    async targetMember(interaction) {
        const selected = interaction.options.getMember('user');
        if (selected) return selected;
        const user = interaction.options.getUser('user');
        if (!user) throw new Error('A user is required.');
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) throw new Error('That user was not found in this server.');
        return member;
    }

    persistAccess(guildId, channelId, userId, effect) {
        this.sqlite.prepare(`INSERT INTO voice_master_access (guild_id, channel_id, user_id, effect, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (guild_id, channel_id, user_id) DO UPDATE SET
                effect = excluded.effect, updated_at = excluded.updated_at`)
            .run(guildId, channelId, userId, effect, this.now());
    }

    activeConfig(interaction) {
        this.requireAdmin(interaction);
        const config = this.config(interaction.guildId);
        if (!config || config.state !== 'active') throw new Error('VoiceMaster is not setup for this server.');
        return config;
    }

    validateRole(interaction, role) {
        if (!role) return null;
        this.requireBotPermissions(interaction.guild, [PermissionFlagsBits.ManageRoles]);
        if (role.managed || role.editable === false) throw new Error('That role cannot be managed by ByteBot.');
        return role.id;
    }

    validateTemplate(value) {
        const template = String(value || "{owner}'s channel").trim();
        if (!template || template.length > 32) throw new Error('Voice channel templates must be 1–32 characters.');
        return template;
    }

    async validatedRegion(guild, requested) {
        if (!requested || requested === 'auto') return null;
        const regions = await guild.fetchVoiceRegions();
        const region = regions.get?.(requested) || [...regions.values()].find(item => item.id === requested);
        if (!region || region.deprecated) throw new Error('That voice region is unavailable.');
        return region.id;
    }

    async executeConfiguration(interaction, action) {
        try {
            this.activeConfig(interaction);
            let column;
            let value;
            if (action === 'template') {
                column = 'name_template';
                value = this.validateTemplate(interaction.options.getString('template'));
            } else if (action === 'temporary') {
                column = 'temporary_enabled';
                value = Number(Boolean(interaction.options.getBoolean('enabled')));
            } else if (action === 'joinrole') {
                column = 'join_role_id';
                value = this.validateRole(interaction, interaction.options.getRole('role'));
            }
            this.sqlite.prepare(`UPDATE voice_master_configs SET ${column} = ?, updated_at = ? WHERE guild_id = ?`)
                .run(value, this.now(), interaction.guildId);
            return interaction.editReply({ embeds: [embeds.success('VoiceMaster Updated', `Updated ${action}.`)] });
        } catch (error) {
            return interaction.editReply({ embeds: [embeds.error('VoiceMaster Configuration Failed', error.message)] });
        }
    }

    async executeDefaults(interaction, action) {
        try {
            this.activeConfig(interaction);
            let column;
            let value;
            if (action === 'role') {
                column = 'default_role_id';
                value = this.validateRole(interaction, interaction.options.getRole('role'));
            } else if (action === 'name') {
                column = 'name_template';
                value = this.validateTemplate(interaction.options.getString('template'));
            } else if (action === 'bitrate') {
                column = 'default_bitrate';
                value = interaction.options.getInteger('bitrate');
                const maximum = interaction.guild.maximumBitrate || 96000;
                if (!Number.isInteger(value) || value < 8000 || value > maximum) {
                    throw new Error(`The bitrate must be between 8000 and ${maximum}.`);
                }
            } else if (action === 'region') {
                column = 'default_region';
                value = await this.validatedRegion(interaction.guild, interaction.options.getString('region'));
            } else if (action === 'interface') {
                column = 'send_interface';
                value = Number(Boolean(interaction.options.getBoolean('enabled')));
            } else {
                throw new Error('Unknown VoiceMaster default setting.');
            }
            this.sqlite.prepare(`UPDATE voice_master_configs SET ${column} = ?, updated_at = ? WHERE guild_id = ?`)
                .run(value, this.now(), interaction.guildId);
            return interaction.editReply({ embeds: [embeds.success('VoiceMaster Defaults Updated', `Updated default ${action}.`)] });
        } catch (error) {
            return interaction.editReply({ embeds: [embeds.error('VoiceMaster Configuration Failed', error.message)] });
        }
    }
}

module.exports = { VoiceMasterService };
