const { ChannelType, MessageFlags, PermissionFlagsBits, Routes } = require('discord.js');
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
        this.cleanupRunning = false;
        this.cleanupTimer = null;
        this.accessLocks = new Map();
        this.roleLocks = new Map();
    }

    startCleanup() {
        if (!this.client || this.cleanupTimer) return;
        this.cleanupTimer = setInterval(async () => {
            if (this.cleanupRunning) return;
            this.cleanupRunning = true;
            try {
                await this.retryScheduledCleanup();
            } catch (error) {
                logger.warn(`VoiceMaster cleanup sweep failed: ${error.message}`);
            } finally {
                this.cleanupRunning = false;
            }
        }, 5000);
        this.cleanupTimer?.unref?.();
    }

    config(guildId) {
        return this.sqlite.prepare('SELECT * FROM voice_master_configs WHERE guild_id = ?').get(guildId) || null;
    }

    reserveSetup(guildId) {
        return this.sqlite.transaction(() => {
            const now = this.now();
            const inserted = this.sqlite.prepare(`INSERT INTO voice_master_configs
                (guild_id, state, generation, updated_at) VALUES (?, 'creating', 1, ?)
                ON CONFLICT (guild_id) DO NOTHING`).run(guildId, now);
            if (inserted.changes) return 1;
            return null;
        })();
    }

    configIs(guildId, state, generation) {
        return Boolean(this.sqlite.prepare(`SELECT 1 FROM voice_master_configs
            WHERE guild_id = ? AND state = ? AND generation = ?`).get(guildId, state, generation));
    }

    assertConfig(guildId, state, generation) {
        if (!this.configIs(guildId, state, generation)) throw new Error('VoiceMaster configuration changed during this operation.');
    }

    recordSetupResource(guildId, generation, column, id) {
        const changed = this.sqlite.prepare(`UPDATE voice_master_configs SET ${column} = ?, updated_at = ?
            WHERE guild_id = ? AND state = 'creating' AND generation = ?`)
            .run(id, this.now(), guildId, generation);
        if (!changed.changes) throw new Error('VoiceMaster setup was cancelled.');
    }

    async fetchChannel(guild, channelId) {
        if (!channelId) return null;
        const cached = guild.channels.cache.get(channelId);
        if (cached) return cached;
        try {
            return await guild.channels.fetch(channelId);
        } catch (error) {
            if (error.code === 10003) return null;
            throw error;
        }
    }

    async fetchMember(guild, memberId) {
        const cached = guild.members.cache?.get(memberId);
        if (cached) return cached;
        try {
            return await guild.members.fetch(memberId);
        } catch (error) {
            if (error.code === 10007) return null;
            throw error;
        }
    }

    async fetchMessage(channel, messageId) {
        try {
            return await channel.messages.fetch(messageId);
        } catch (error) {
            if (error.code === 10008) return null;
            throw error;
        }
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
        let context;
        try {
            context = this.validateComponent(interaction, scopeId);
        } catch (error) {
            return interaction.reply({ content: error.message, flags: [MessageFlags.Ephemeral] });
        }
        if (interaction.isButton() && action === 'rename') {
            return interaction.showModal(voiceMasterRenameModal(context.pod.channel_id));
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

    validateComponent(interaction, scopeId) {
        const currentChannelId = interaction.member.voice?.channel?.id || interaction.member.voice?.channelId;
        const pod = currentChannelId && this.sqlite.prepare(`SELECT * FROM bytepods
            WHERE guild_id = ? AND channel_id = ? AND source_channel_id IS NOT NULL
            AND state = 'active' AND bot_owned = 1`)
            .get(interaction.guildId, currentChannelId);
        if (!pod) throw new Error('You are not in an active VoiceMaster channel.');
        if (interaction.isModalSubmit()) {
            if (scopeId !== pod.channel_id) throw new Error('This VoiceMaster form is stale. Open the interface again.');
            return { pod };
        }
        const source = this.sqlite.prepare(`SELECT * FROM voice_master_sources
            WHERE guild_id = ? AND channel_id = ? AND state = 'active'`).get(interaction.guildId, scopeId);
        const expectedMessageId = source?.interface_message_id
            || (scopeId === pod.channel_id ? pod.panel_message_id : null);
        if (!expectedMessageId || interaction.message?.id !== expectedMessageId) {
            throw new Error('This VoiceMaster interface is stale. Ask an administrator to send it again.');
        }
        return { pod };
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
            const generation = this.reserveSetup(interaction.guildId);
            if (!generation) {
                const guidance = existing?.state === 'failed'
                    ? 'VoiceMaster is in a failed state. Run `/voicemaster reset`, then setup again.'
                    : 'VoiceMaster is already configured or being changed for this server.';
                return interaction.editReply({ embeds: [embeds.warn('Already Setup', guidance)] });
            }
            const now = this.now();

            let category = null;
            let channel = null;
            try {
                category = await interaction.guild.channels.create({ name: 'VoiceMaster', type: ChannelType.GuildCategory });
                this.recordSetupResource(interaction.guildId, generation, 'category_id', category.id);
                channel = await interaction.guild.channels.create({
                    name: 'Join to Create', type: ChannelType.GuildVoice, parent: category.id
                });
                this.recordSetupResource(interaction.guildId, generation, 'primary_channel_id', channel.id);
                const message = await channel.send(voiceMasterInterface(channel.id));
                this.recordSetupResource(interaction.guildId, generation, 'interface_message_id', message.id);
                this.sqlite.transaction(() => {
                    const activated = this.sqlite.prepare(`UPDATE voice_master_configs SET state = 'active', category_id = ?,
                        primary_channel_id = ?, interface_message_id = ?, updated_at = ?
                        WHERE guild_id = ? AND state = 'creating' AND generation = ?`)
                        .run(category.id, channel.id, message.id, now, interaction.guildId, generation);
                    if (!activated.changes) throw new Error('VoiceMaster setup was cancelled.');
                    this.sqlite.prepare(`INSERT INTO voice_master_sources
                        (channel_id, guild_id, category_id, interface_message_id, is_primary, owned, created_at)
                        VALUES (?, ?, ?, ?, 1, 1, ?)`)
                        .run(channel.id, interaction.guildId, category.id, message.id, now);
                })();
                return interaction.editReply({ embeds: [embeds.success('VoiceMaster Setup', `Created ${channel} in ${category}.`)] });
            } catch (error) {
                if (channel) await channel.delete('VoiceMaster setup failed').catch(() => null);
                if (category?.delete) await category.delete('VoiceMaster setup failed').catch(() => null);
                this.sqlite.prepare(`UPDATE voice_master_configs SET state = 'failed', updated_at = ?
                    WHERE guild_id = ? AND state = 'creating' AND generation = ?`)
                    .run(this.now(), interaction.guildId, generation);
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
            try {
                this.sqlite.transaction(() => {
                    const changed = this.sqlite.prepare(`UPDATE voice_master_configs SET interface_message_id = ?, updated_at = ?
                        WHERE guild_id = ? AND state = 'active' AND generation = ? AND interface_message_id = ?`)
                        .run(message.id, this.now(), interaction.guildId, config.generation, config.interface_message_id);
                    if (!changed.changes) throw new Error('Another VoiceMaster interface replaced this one.');
                    this.sqlite.prepare('UPDATE voice_master_sources SET interface_message_id = ? WHERE channel_id = ? AND guild_id = ?')
                        .run(message.id, channel.id, interaction.guildId);
                })();
            } catch (error) {
                if (message.delete) await message.delete().catch(() => null);
                throw error;
            }
            if (config.interface_message_id && config.interface_message_id !== message.id) {
                const previous = await channel.messages?.fetch?.(config.interface_message_id).catch(() => null);
                if (previous) await previous.delete().catch(() => previous.edit({ components: [] }).catch(() => null));
            }
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
                    WHERE guild_id = ? AND is_primary = 0 AND state = 'active'
                    ORDER BY created_at, channel_id LIMIT 25`)
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
                this.sqlite.transaction(() => {
                    const count = this.sqlite.prepare(`SELECT COUNT(*) count FROM voice_master_sources
                        WHERE guild_id = ? AND is_primary = 0 AND state IN ('pending','active')`)
                        .get(interaction.guildId).count;
                    if (count >= 25) throw new Error('This server already has 25 secondary join channels.');
                    this.sqlite.prepare(`INSERT INTO voice_master_sources
                        (channel_id, guild_id, category_id, state, is_primary, owned, created_at)
                        VALUES (?, ?, ?, 'pending', 0, 0, ?)`)
                        .run(channel.id, interaction.guildId, channel.parentId || config.category_id, this.now());
                })();
                let message;
                try {
                    message = await channel.send(voiceMasterInterface(channel.id));
                    const recorded = this.sqlite.prepare(`UPDATE voice_master_sources SET interface_message_id = ?
                        WHERE guild_id = ? AND channel_id = ? AND state = 'pending'`)
                        .run(message.id, interaction.guildId, channel.id);
                    if (!recorded.changes) throw new Error('Secondary VoiceMaster setup was cancelled.');
                    const activated = this.sqlite.prepare(`UPDATE voice_master_sources SET state = 'active'
                        WHERE guild_id = ? AND channel_id = ? AND state = 'pending' AND interface_message_id = ?`)
                        .run(interaction.guildId, channel.id, message.id);
                    if (!activated.changes) throw new Error('Secondary VoiceMaster setup changed before completion.');
                } catch (error) {
                    this.sqlite.prepare(`DELETE FROM voice_master_sources
                        WHERE guild_id = ? AND channel_id = ? AND state = 'pending'`)
                        .run(interaction.guildId, channel.id);
                    if (message?.delete) await message.delete().catch(async () => {
                        if (message.edit) await message.edit({ components: [] }).catch(() => null);
                    });
                    throw error;
                }
            } else if (action === 'category') {
                const category = interaction.options.getChannel('category');
                if (!category || category.type !== ChannelType.GuildCategory) throw new Error('Choose a server category.');
                if ((category.children?.cache?.size || 0) >= 50) throw new Error('That category already has Discord’s maximum of 50 channels.');
                const changed = this.sqlite.prepare(`UPDATE voice_master_sources SET category_id = ?
                    WHERE guild_id = ? AND channel_id = ? AND is_primary = 0 AND state = 'active'`)
                    .run(category.id, interaction.guildId, channel.id);
                if (!changed.changes) throw new Error('That secondary join channel is not configured.');
            } else if (action === 'remove') {
                const source = this.sqlite.prepare(`SELECT * FROM voice_master_sources
                    WHERE guild_id = ? AND channel_id = ? AND is_primary = 0 AND owned = 0 AND state = 'active'`)
                    .get(interaction.guildId, channel.id);
                const removed = this.sqlite.prepare(`DELETE FROM voice_master_sources
                    WHERE guild_id = ? AND channel_id = ? AND is_primary = 0 AND owned = 0 AND state = 'active'`)
                    .run(interaction.guildId, channel.id);
                if (!removed.changes) throw new Error('That secondary join channel is not configured.');
                if (source.interface_message_id && channel.messages?.fetch) {
                    const message = await channel.messages.fetch(source.interface_message_id).catch(() => null);
                    if (message) await message.delete().catch(() => message.edit({ components: [] }).catch(() => null));
                }
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
            if (!config || !['active', 'failed', 'resetting'].includes(config.state)) throw new Error('VoiceMaster is not setup for this server.');
            const generation = config.state === 'resetting' ? config.generation : config.generation + 1;
            if (config.state !== 'resetting') {
                const reserved = this.sqlite.prepare(`UPDATE voice_master_configs SET state = 'resetting', generation = ?, updated_at = ?
                    WHERE guild_id = ? AND state IN ('active','failed') AND generation = ?`)
                    .run(generation, this.now(), interaction.guildId, config.generation);
                if (!reserved.changes) throw new Error('VoiceMaster configuration changed before reset.');
            }
            this.sqlite.prepare(`UPDATE voice_master_creations SET state = 'deleting',
                error = 'VoiceMaster was reset during creation.', updated_at = ?
                WHERE guild_id = ? AND state = 'pending'`).run(this.now(), interaction.guildId);
            const primary = this.sqlite.prepare(`SELECT * FROM voice_master_sources
                WHERE guild_id = ? AND is_primary = 1 AND owned = 1`).get(interaction.guildId);
            const primaryChannelId = primary?.channel_id || config.primary_channel_id;
            if (primaryChannelId) {
                const channel = await this.fetchChannel(interaction.guild, primaryChannelId);
                if (channel) {
                    if (channel.type !== ChannelType.GuildVoice
                        || (channel.guildId && channel.guildId !== interaction.guildId)) {
                        throw new Error('The tracked VoiceMaster join channel changed type or server; reset stopped for operator review.');
                    }
                    await channel.delete('VoiceMaster reset');
                }
            }
            if (config.category_id) {
                const category = await this.fetchChannel(interaction.guild, config.category_id);
                if (category) {
                    if (category.type !== ChannelType.GuildCategory
                        || (category.guildId && category.guildId !== interaction.guildId)) {
                        throw new Error('The tracked VoiceMaster category changed type or server; reset stopped for operator review.');
                    }
                    await category.delete('VoiceMaster reset');
                }
            }
            this.sqlite.transaction(() => {
                this.sqlite.prepare('DELETE FROM voice_master_sources WHERE guild_id = ?').run(interaction.guildId);
                this.sqlite.prepare(`DELETE FROM voice_master_configs
                    WHERE guild_id = ? AND state = 'resetting' AND generation = ?`).run(interaction.guildId, generation);
            })();
            return interaction.editReply({ embeds: [embeds.success('VoiceMaster Reset', 'VoiceMaster setup resources were removed.')] });
        } catch (error) {
            return interaction.editReply({ embeds: [embeds.error('VoiceMaster Reset Failed', error.message)] });
        }
    }

    source(guildId, channelId) {
        return this.sqlite.prepare(`SELECT source.*, config.name_template, config.default_role_id,
            config.default_bitrate, config.default_region, config.send_interface,
            config.temporary_enabled, config.join_role_id, config.generation AS config_generation
            FROM voice_master_sources source
            JOIN voice_master_configs config ON config.guild_id = source.guild_id
            WHERE source.guild_id = ? AND source.channel_id = ?
            AND source.state = 'active' AND config.state = 'active'`)
            .get(guildId, channelId) || null;
    }

    reserveCreation(guildId, sourceChannelId, memberId) {
        return this.sqlite.transaction(() => {
            const existing = this.sqlite.prepare(`SELECT * FROM voice_master_creations
                WHERE guild_id = ? AND source_channel_id = ? AND member_id = ?`)
                .get(guildId, sourceChannelId, memberId);
            if (['active', 'pending', 'deleting'].includes(existing?.state)) {
                return { acquired: false, creation: existing };
            }
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
        const currentVoice = guild.voiceStates.cache.get(member.id);
        if (!currentVoice || currentVoice.channelId !== creation.source_channel_id) return true;
        const channel = guild.channels.cache.get(creation.channel_id)
            || await guild.channels.fetch(creation.channel_id).catch(() => null);
        const owned = this.sqlite.prepare(`SELECT 1 FROM bytepods
            WHERE guild_id = ? AND channel_id = ? AND owner_id = ? AND source_channel_id IS NOT NULL
            AND state = 'active' AND bot_owned = 1`)
            .get(guild.id, creation.channel_id, member.id);
        if (!channel || channel.type !== ChannelType.GuildVoice || !owned) {
            this.sqlite.prepare(`UPDATE voice_master_creations SET state = 'failed', channel_id = NULL,
                error = 'Reserved channel is unavailable.', updated_at = ?
                WHERE guild_id = ? AND source_channel_id = ? AND member_id = ? AND state = 'active'`)
                .run(this.now(), guild.id, creation.source_channel_id, member.id);
            return false;
        }
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
        if (newState.channelId && oldState.channelId !== newState.channelId) {
            await this.handleOwnerReturn(guild, member, newState.channelId);
            await this.addJoinRole(guild, member, newState.channelId);
        }
        const source = this.source(guild.id, newState.channelId);
        if (!source || !source.temporary_enabled || oldState.channelId === newState.channelId) return handled;

        let reservation = this.reserveCreation(guild.id, source.channel_id, member.id);
        if (!reservation.acquired) {
            if (await this.reuseCreation(guild, member, reservation.creation)) return true;
            reservation = this.reserveCreation(guild.id, source.channel_id, member.id);
            if (!reservation.acquired) return true;
        }
        const currentVoice = guild.voiceStates.cache.get(member.id);
        if (!currentVoice || currentVoice.channelId !== source.channel_id) {
            this.failCreation(reservation.creation, 'Member left the join channel before creation.');
            return true;
        }

        let channel = null;
        try {
            this.requireBotPermissions(guild);
            this.assertConfig(guild.id, 'active', source.config_generation);
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
            const category = await this.fetchChannel(guild, source.category_id);
            if (!category || category.type !== ChannelType.GuildCategory) throw new Error('The VoiceMaster category is missing.');
            if ((category.children?.cache?.size || 0) >= 50) throw new Error('The VoiceMaster category already has Discord’s maximum of 50 channels.');
            channel = await guild.channels.create({
                name,
                type: ChannelType.GuildVoice,
                parent: source.category_id,
                bitrate: source.default_bitrate || undefined,
                rtcRegion: source.default_region || null,
                permissionOverwrites,
                reason: `VoiceMaster channel for ${member.user.username}`
            });
            const recorded = this.sqlite.prepare(`UPDATE voice_master_creations SET channel_id = ?, updated_at = ?
                WHERE guild_id = ? AND source_channel_id = ? AND member_id = ? AND generation = ? AND state = 'pending'`)
                .run(channel.id, this.now(), guild.id, source.channel_id, member.id, reservation.creation.generation);
            if (!recorded.changes) throw new Error('VoiceMaster creation was cancelled.');
            this.assertConfig(guild.id, 'active', source.config_generation);

            const freshVoice = guild.voiceStates.cache.get(member.id);
            if (!freshVoice || freshVoice.channelId !== source.channel_id) {
                throw new Error('Member left the join channel before move.');
            }

            let panelMessage = null;
            if (source.send_interface) {
                panelMessage = await channel.send(voiceMasterInterface(channel.id));
            }
            this.assertConfig(guild.id, 'active', source.config_generation);
            const now = this.now();
            this.sqlite.transaction(() => {
                this.assertConfig(guild.id, 'active', source.config_generation);
                this.sqlite.prepare(`INSERT INTO bytepods
                    (channel_id, guild_id, owner_id, original_owner_id, source_channel_id,
                     panel_message_id, state, generation, bot_owned, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 1, ?)`)
                    .run(channel.id, guild.id, member.id, member.id, source.channel_id,
                        panelMessage?.id || null, reservation.creation.generation, now);
                const activated = this.sqlite.prepare(`UPDATE voice_master_creations SET channel_id = ?, state = 'active',
                    error = NULL, updated_at = ? WHERE guild_id = ? AND source_channel_id = ?
                    AND member_id = ? AND generation = ? AND state = 'pending'`)
                    .run(channel.id, now, guild.id, source.channel_id, member.id, reservation.creation.generation);
                if (!activated.changes) throw new Error('VoiceMaster creation was cancelled.');
            })();

            this.assertConfig(guild.id, 'active', source.config_generation);
            await member.voice.setChannel(channel);
            if (source.join_role_id) {
                await this.grantJoinRole(guild, member, channel.id, source.join_role_id);
            }
            return true;
        } catch (error) {
            let deletionConfirmed = !channel;
            if (channel) {
                try {
                    await channel.delete('VoiceMaster creation failed');
                    deletionConfirmed = true;
                } catch (deleteError) {
                    deletionConfirmed = deleteError.code === 10003;
                }
            }
            this.sqlite.prepare('DELETE FROM bytepods WHERE guild_id = ? AND channel_id = ? AND source_channel_id IS NOT NULL')
                .run(guild.id, channel?.id || '');
            if (deletionConfirmed) this.failCreation(reservation.creation, error.message);
            else this.sqlite.prepare(`UPDATE voice_master_creations SET state = 'deleting', channel_id = ?,
                    error = ?, updated_at = ? WHERE guild_id = ? AND source_channel_id = ?
                    AND member_id = ? AND generation = ? AND state IN ('pending','deleting','active')`)
                .run(channel.id, `Cleanup pending: ${error.message}`.slice(0, 500), this.now(), guild.id,
                    source.channel_id, member.id, reservation.creation.generation);
            logger.warn(`VoiceMaster creation failed in ${guild.id}: ${error.message}`);
            return true;
        }
    }

    failCreation(creation, error) {
        this.sqlite.prepare(`UPDATE voice_master_creations SET channel_id = NULL, state = 'failed',
            error = ?, updated_at = ? WHERE guild_id = ? AND source_channel_id = ?
            AND member_id = ? AND generation = ? AND state IN ('pending','deleting','active')`)
            .run(String(error).slice(0, 500), this.now(), creation.guild_id,
                creation.source_channel_id, creation.member_id, creation.generation);
    }

    async handleOwnedLeave(guild, channelId, memberId) {
        const initial = this.sqlite.prepare(`SELECT * FROM bytepods
            WHERE guild_id = ? AND channel_id = ? AND source_channel_id IS NOT NULL
            AND state = 'active' AND bot_owned = 1`)
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
            AND source_channel_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM voice_master_creations
                WHERE guild_id = ? AND channel_id = ? AND state = 'pending')`)
            .run(guild.id, channelId, guild.id, channelId);
        if (!won.changes) return true;

        try {
            await this.revokeChannelJoinRoles(guild, channelId);
            if (channel.members.size > 0) {
                this.sqlite.prepare(`UPDATE bytepods SET state = 'active', cleanup_after = NULL
                    WHERE guild_id = ? AND channel_id = ? AND state = 'deleting'`)
                    .run(guild.id, channelId);
                return true;
            }
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

    removeJoinRoleAfterExit(guild, member, oldChannelId, newChannelId) {
        return this.withRoleLock(guild.id, member.id,
            () => this.performRemoveJoinRoleAfterExit(guild, member, oldChannelId, newChannelId));
    }

    async performRemoveJoinRoleAfterExit(guild, member, oldChannelId, newChannelId) {
        const oldOwned = this.sqlite.prepare(`SELECT 1 FROM bytepods
            WHERE guild_id = ? AND channel_id = ? AND source_channel_id IS NOT NULL AND bot_owned = 1`)
            .get(guild.id, oldChannelId);
        if (!oldOwned) return;
        const grant = this.sqlite.prepare(`SELECT * FROM voice_master_join_roles
            WHERE guild_id = ? AND channel_id = ? AND member_id = ?`).get(guild.id, oldChannelId, member.id);
        if (!grant) return;
        const nextOwned = newChannelId && this.sqlite.prepare(`SELECT 1 FROM bytepods
            WHERE guild_id = ? AND channel_id = ? AND source_channel_id IS NOT NULL
            AND state = 'active' AND bot_owned = 1`)
            .get(guild.id, newChannelId);
        const nextRole = nextOwned && this.config(guild.id)?.join_role_id;
        if (nextRole === grant.role_id) {
            this.sqlite.transaction(() => {
                this.sqlite.prepare(`DELETE FROM voice_master_join_roles
                    WHERE guild_id = ? AND channel_id = ? AND member_id = ?`)
                    .run(guild.id, oldChannelId, member.id);
                this.sqlite.prepare(`INSERT INTO voice_master_join_roles
                    (guild_id, channel_id, member_id, role_id, state, added_by_bot, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (guild_id, channel_id, member_id) DO UPDATE SET
                        role_id = excluded.role_id, state = excluded.state,
                        added_by_bot = excluded.added_by_bot, updated_at = excluded.updated_at`)
                    .run(guild.id, newChannelId, member.id, grant.role_id,
                        grant.state, grant.added_by_bot, this.now());
            })();
            return;
        }
        try {
            if (grant.added_by_bot) await member.roles.remove(grant.role_id, 'VoiceMaster channel left');
        } catch (error) {
            logger.warn(`VoiceMaster join role removal failed for ${member.id}: ${error.message}`);
            return;
        }
        this.sqlite.prepare(`DELETE FROM voice_master_join_roles
            WHERE guild_id = ? AND channel_id = ? AND member_id = ?`).run(guild.id, oldChannelId, member.id);
    }

    async handleOwnerReturn(guild, member, channelId) {
        const pod = this.sqlite.prepare(`SELECT * FROM bytepods
            WHERE guild_id = ? AND channel_id = ? AND owner_id = ? AND bot_owned = 1
            AND source_channel_id IS NOT NULL
            AND state IN ('active','claiming')`).get(guild.id, channelId, member.id);
        if (!pod?.owner_left_at) return;
        if (pod.state === 'claiming') {
            this.sqlite.prepare(`UPDATE bytepods SET state = 'claim_cancelled', generation = generation + 1
                WHERE guild_id = ? AND channel_id = ? AND owner_id = ? AND state = 'claiming' AND generation = ?`)
                .run(guild.id, channelId, member.id, pod.generation);
        } else {
            this.sqlite.prepare(`UPDATE bytepods SET owner_left_at = NULL, generation = generation + 1
                WHERE guild_id = ? AND channel_id = ? AND owner_id = ? AND state = 'active' AND generation = ?`)
                .run(guild.id, channelId, member.id, pod.generation);
        }
    }

    async addJoinRole(guild, member, channelId) {
        const pod = this.sqlite.prepare(`SELECT 1 FROM bytepods
            WHERE guild_id = ? AND channel_id = ? AND source_channel_id IS NOT NULL
            AND state = 'active' AND bot_owned = 1`).get(guild.id, channelId);
        const config = pod && this.config(guild.id);
        if (config?.join_role_id) await this.grantJoinRole(guild, member, channelId, config.join_role_id);
    }

    grantJoinRole(guild, member, channelId, roleId) {
        return this.withRoleLock(guild.id, member.id,
            () => this.performGrantJoinRole(guild, member, channelId, roleId));
    }

    async performGrantJoinRole(guild, member, channelId, roleId) {
        const existing = this.sqlite.prepare(`SELECT * FROM voice_master_join_roles
            WHERE guild_id = ? AND channel_id = ? AND member_id = ?`).get(guild.id, channelId, member.id);
        let roleAdded = false;
        try {
            if (existing?.role_id === roleId && existing.state === 'active'
                && member.roles.cache?.has(roleId)) return;
            if (existing && existing.role_id !== roleId) {
                if (existing.added_by_bot) await member.roles.remove(existing.role_id, 'VoiceMaster join role changed');
                this.sqlite.prepare(`DELETE FROM voice_master_join_roles
                    WHERE guild_id = ? AND channel_id = ? AND member_id = ?`)
                    .run(guild.id, channelId, member.id);
            }
            const alreadyHadRole = Boolean(member.roles.cache?.has(roleId));
            const addedByBot = existing?.role_id === roleId
                ? existing.added_by_bot
                : Number(!alreadyHadRole);
            this.sqlite.prepare(`INSERT INTO voice_master_join_roles
                (guild_id, channel_id, member_id, role_id, state, added_by_bot, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (guild_id, channel_id, member_id) DO UPDATE SET
                    role_id = excluded.role_id, state = excluded.state,
                    added_by_bot = excluded.added_by_bot, updated_at = excluded.updated_at`)
                .run(guild.id, channelId, member.id, roleId,
                    alreadyHadRole ? 'active' : 'pending', addedByBot, this.now());
            if (alreadyHadRole) return;
            await member.roles.add(roleId, 'VoiceMaster channel joined');
            roleAdded = true;
            this.sqlite.prepare(`UPDATE voice_master_join_roles SET state = 'active', updated_at = ?
                WHERE guild_id = ? AND channel_id = ? AND member_id = ? AND role_id = ? AND state = 'pending'`)
                .run(this.now(), guild.id, channelId, member.id, roleId);
        } catch (error) {
            if (!roleAdded) this.sqlite.prepare(`DELETE FROM voice_master_join_roles
                WHERE guild_id = ? AND channel_id = ? AND member_id = ? AND role_id = ? AND state = 'pending'`)
                .run(guild.id, channelId, member.id, roleId);
            logger.warn(`VoiceMaster join role failed for ${member.id}: ${error.message}`);
        }
    }

    async revokeChannelJoinRoles(guild, channelId) {
        const grants = this.sqlite.prepare(`SELECT * FROM voice_master_join_roles
            WHERE guild_id = ? AND channel_id = ?`).all(guild.id, channelId);
        for (const grant of grants) {
            await this.withRoleLock(guild.id, grant.member_id, async () => {
                const current = this.sqlite.prepare(`SELECT * FROM voice_master_join_roles
                    WHERE guild_id = ? AND channel_id = ? AND member_id = ?`)
                    .get(guild.id, channelId, grant.member_id);
                if (!current) return;
                const member = await this.fetchMember(guild, current.member_id);
                if (member && current.added_by_bot) {
                    await member.roles.remove(current.role_id, 'VoiceMaster channel removed');
                }
                this.sqlite.prepare(`DELETE FROM voice_master_join_roles
                    WHERE guild_id = ? AND channel_id = ? AND member_id = ?`)
                    .run(guild.id, channelId, current.member_id);
            });
        }
    }

    withRoleLock(guildId, memberId, action) {
        const key = `${guildId}:${memberId}`;
        const previous = this.roleLocks.get(key) || Promise.resolve();
        const operation = previous.catch(() => null).then(action);
        this.roleLocks.set(key, operation);
        return operation.finally(() => {
            if (this.roleLocks.get(key) === operation) this.roleLocks.delete(key);
        });
    }

    ownerContext(interaction, allowClaim = false) {
        const channel = interaction.member.voice?.channel;
        if (!channel || channel.type !== ChannelType.GuildVoice) throw new Error('You are not in a VoiceMaster channel.');
        const pod = this.sqlite.prepare(`SELECT * FROM bytepods
            WHERE guild_id = ? AND channel_id = ? AND source_channel_id IS NOT NULL
            AND state = 'active' AND bot_owned = 1`)
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

    permissionSnapshot(channel, id) {
        const overwrite = channel.permissionOverwrites.cache?.get(id);
        if (!overwrite) return { exists: false };
        const permissions = {};
        for (const [name, bit] of Object.entries(PermissionFlagsBits)) {
            permissions[name] = overwrite.allow.has(bit) ? true : overwrite.deny.has(bit) ? false : null;
        }
        return { exists: true, permissions };
    }

    async restorePermission(channel, id, snapshot) {
        if (!snapshot?.exists) {
            if (channel.permissionOverwrites.delete) return channel.permissionOverwrites.delete(id);
            return channel.permissionOverwrites.edit(id, {
                ViewChannel: null, Connect: null, ManageChannels: null, MoveMembers: null
            });
        }
        return channel.permissionOverwrites.edit(id, snapshot.permissions);
    }

    updateAccess(channel, guildId, userId, effect, permissions) {
        return this.withAccessLock(guildId, channel.id, userId,
            () => this.performAccessUpdate(channel, guildId, userId, effect, permissions));
    }

    withAccessLock(guildId, channelId, userId, action) {
        const key = `${guildId}:${channelId}:${userId}`;
        const previous = this.accessLocks.get(key) || Promise.resolve();
        const operation = previous.catch(() => null).then(action);
        this.accessLocks.set(key, operation);
        return operation.finally(() => {
            if (this.accessLocks.get(key) === operation) this.accessLocks.delete(key);
        });
    }

    async performAccessUpdate(channel, guildId, userId, effect, permissions) {
        const snapshot = this.permissionSnapshot(channel, userId);
        const { previous, generation } = this.sqlite.transaction(() => {
            const prior = this.sqlite.prepare(`SELECT * FROM voice_master_access
                WHERE guild_id = ? AND channel_id = ? AND user_id = ?`).get(guildId, channel.id, userId);
            const nextGeneration = (prior?.generation || 0) + 1;
            this.persistAccess(guildId, channel.id, userId, effect, 'pending', nextGeneration);
            return { previous: prior, generation: nextGeneration };
        })();
        try {
            await channel.permissionOverwrites.edit(userId, permissions);
            const completed = this.sqlite.prepare(`UPDATE voice_master_access SET state = 'active', updated_at = ?
                WHERE guild_id = ? AND channel_id = ? AND user_id = ? AND effect = ?
                AND state = 'pending' AND generation = ?`)
                .run(this.now(), guildId, channel.id, userId, effect, generation);
            if (!completed.changes) throw new Error('VoiceMaster access changed before completion.');
        } catch (error) {
            try {
                await this.restorePermission(channel, userId, snapshot);
                if (previous) this.persistAccess(guildId, channel.id, userId,
                    previous.effect, previous.state, previous.generation);
                else this.sqlite.prepare(`DELETE FROM voice_master_access
                        WHERE guild_id = ? AND channel_id = ? AND user_id = ?
                        AND state = 'pending' AND generation = ?`)
                    .run(guildId, channel.id, userId, generation);
            } catch (restoreError) {
                logger.warn(`VoiceMaster access compensation failed for ${channel.id}/${userId}: ${restoreError.message}`);
            }
            throw error;
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
                await channel.client.rest.put(Routes.channelVoiceStatus(channel.id), { body: { status } });
                break;
            }
            case 'permit': {
                const target = await this.targetMember(interaction);
                if (target.id === interaction.user.id) throw new Error('You already have access to your channel.');
                this.requireChannelPermissions(interaction.guild, channel, [PermissionFlagsBits.ManageRoles]);
                await this.updateAccess(channel, interaction.guildId, target.id, 'permit', { ViewChannel: true, Connect: true });
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
                await this.updateAccess(channel, interaction.guildId, target.id, 'reject', { Connect: false });
                if (target.voice?.channelId === channel.id) await target.voice.disconnect('Rejected from VoiceMaster channel');
                break;
            }
            case 'information':
                {
                    const everyone = channel.permissionOverwrites.cache?.get(interaction.guild.id);
                    const locked = Boolean(everyone?.deny.has(PermissionFlagsBits.Connect));
                    const hidden = Boolean(everyone?.deny.has(PermissionFlagsBits.ViewChannel));
                return interaction.editReply({
                    embeds: [embeds.info('VoiceMaster Information', [
                        `Owner: <@${pod.owner_id}>`,
                        `Members: ${channel.members.size}`,
                        `Locked: ${locked ? 'Yes' : 'No'}`,
                        `Hidden: ${hidden ? 'Yes' : 'No'}`,
                        `Limit: ${channel.userLimit || 'Unlimited'}`,
                        `Bitrate: ${channel.bitrate}`,
                        `Region: ${channel.rtcRegion || 'Automatic'}`
                    ].join('\n'))],
                    allowedMentions: { parse: [] }
                });
                }
            case 'claim': {
                if (pod.owner_id === interaction.user.id) throw new Error('You already own this voice channel.');
                if (channel.members.has(pod.owner_id)) throw new Error('The current owner is still in this voice channel.');
                this.requireChannelPermissions(interaction.guild, channel, [PermissionFlagsBits.ManageRoles]);
                const snapshot = JSON.stringify({
                    previous: this.permissionSnapshot(channel, pod.owner_id),
                    next: this.permissionSnapshot(channel, interaction.user.id)
                });
                const won = this.sqlite.prepare(`UPDATE bytepods SET state = 'claiming', pending_owner_id = ?, claim_snapshot = ?
                    WHERE guild_id = ? AND channel_id = ? AND owner_id = ? AND generation = ?
                    AND state = 'active' AND owner_left_at IS NOT NULL AND bot_owned = 1
                    AND source_channel_id IS NOT NULL`)
                    .run(interaction.user.id, snapshot, interaction.guildId, channel.id, pod.owner_id, pod.generation);
                if (!won.changes) throw new Error('Another member claimed this channel first.');
                try {
                    await channel.permissionOverwrites.edit(pod.owner_id, {
                        ManageChannels: null, MoveMembers: null
                    });
                    this.assertClaim(interaction.guildId, channel.id, pod, interaction.user.id);
                    await channel.permissionOverwrites.edit(interaction.user.id, {
                        ViewChannel: true, Connect: true, ManageChannels: true, MoveMembers: true
                    });
                    this.assertClaim(interaction.guildId, channel.id, pod, interaction.user.id);
                    const completed = this.sqlite.prepare(`UPDATE bytepods SET owner_id = pending_owner_id,
                        pending_owner_id = NULL, claim_snapshot = NULL, owner_left_at = NULL,
                        reclaim_request_pending = 0, state = 'active', generation = generation + 1
                        WHERE guild_id = ? AND channel_id = ? AND owner_id = ?
                        AND pending_owner_id = ? AND generation = ? AND state = 'claiming' AND owner_left_at IS NOT NULL`)
                        .run(interaction.guildId, channel.id, pod.owner_id, interaction.user.id, pod.generation);
                    if (!completed.changes) throw new Error('VoiceMaster claim changed before completion.');
                } catch (error) {
                    try {
                        const parsed = JSON.parse(snapshot);
                        await this.restorePermission(channel, pod.owner_id, parsed.previous);
                        await this.restorePermission(channel, interaction.user.id, parsed.next);
                        this.completeClaimCompensation({
                            ...pod, guild_id: interaction.guildId, channel_id: channel.id,
                            pending_owner_id: interaction.user.id, state: 'claiming'
                        });
                    } catch (restoreError) {
                        logger.warn(`VoiceMaster claim compensation failed for ${channel.id}: ${restoreError.message}`);
                    }
                    throw error;
                }
                break;
            }
            case 'delete': {
                const won = this.sqlite.prepare(`UPDATE bytepods SET state = 'deleting', generation = generation + 1
                    WHERE guild_id = ? AND channel_id = ? AND owner_id = ? AND state = 'active'
                    AND bot_owned = 1 AND source_channel_id IS NOT NULL`)
                    .run(interaction.guildId, channel.id, interaction.user.id);
                if (!won.changes) throw new Error('This channel changed before it could be deleted.');
                try {
                    await this.revokeChannelJoinRoles(interaction.guild, channel.id);
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
            this.sqlite.prepare(`DELETE FROM bytepods WHERE guild_id = ? AND channel_id = ?
                AND bot_owned = 1 AND source_channel_id IS NOT NULL`)
                .run(guildId, channelId);
        })();
    }

    assertClaim(guildId, channelId, pod, nextOwnerId) {
        const active = this.sqlite.prepare(`SELECT 1 FROM bytepods WHERE guild_id = ? AND channel_id = ?
            AND owner_id = ? AND pending_owner_id = ? AND generation = ? AND state = 'claiming'
            AND owner_left_at IS NOT NULL AND source_channel_id IS NOT NULL`)
            .get(guildId, channelId, pod.owner_id, nextOwnerId, pod.generation);
        if (!active) throw new Error('The channel owner returned before the claim completed.');
    }

    completeClaimCompensation(pod) {
        const current = this.sqlite.prepare(`SELECT * FROM bytepods
            WHERE guild_id = ? AND channel_id = ? AND owner_id = ? AND pending_owner_id = ?
            AND state IN ('claiming','claim_cancelled')`).get(
            pod.guild_id, pod.channel_id, pod.owner_id, pod.pending_owner_id
        );
        if (!current) return false;
        const expectedGeneration = current.state === 'claim_cancelled' && pod.state === 'claiming'
            ? pod.generation + 1
            : pod.generation;
        if (current.generation !== expectedGeneration) return false;
        return Boolean(this.sqlite.prepare(`UPDATE bytepods SET state = 'active', pending_owner_id = NULL,
            claim_snapshot = NULL,
            owner_left_at = CASE WHEN state = 'claim_cancelled' THEN NULL ELSE owner_left_at END
            WHERE guild_id = ? AND channel_id = ? AND owner_id = ? AND pending_owner_id = ?
            AND state = ? AND generation = ?`).run(
            current.guild_id, current.channel_id, current.owner_id, current.pending_owner_id,
            current.state, current.generation
        ).changes);
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

    persistAccess(guildId, channelId, userId, effect, state = 'active', generation = 0) {
        this.sqlite.prepare(`INSERT INTO voice_master_access
            (guild_id, channel_id, user_id, effect, state, generation, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (guild_id, channel_id, user_id) DO UPDATE SET
                effect = excluded.effect, state = excluded.state,
                generation = excluded.generation, updated_at = excluded.updated_at`)
            .run(guildId, channelId, userId, effect, state, generation, this.now());
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
            const config = this.activeConfig(interaction);
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
            const changed = this.sqlite.prepare(`UPDATE voice_master_configs SET ${column} = ?, updated_at = ?
                WHERE guild_id = ? AND state = 'active' AND generation = ?`)
                .run(value, this.now(), interaction.guildId, config.generation);
            if (!changed.changes) throw new Error('VoiceMaster configuration changed before the update completed.');
            return interaction.editReply({ embeds: [embeds.success('VoiceMaster Updated', `Updated ${action}.`)] });
        } catch (error) {
            return interaction.editReply({ embeds: [embeds.error('VoiceMaster Configuration Failed', error.message)] });
        }
    }

    async executeDefaults(interaction, action) {
        try {
            const config = this.activeConfig(interaction);
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
            const changed = this.sqlite.prepare(`UPDATE voice_master_configs SET ${column} = ?, updated_at = ?
                WHERE guild_id = ? AND state = 'active' AND generation = ?`)
                .run(value, this.now(), interaction.guildId, config.generation);
            if (!changed.changes) throw new Error('VoiceMaster configuration changed before the update completed.');
            return interaction.editReply({ embeds: [embeds.success('VoiceMaster Defaults Updated', `Updated default ${action}.`)] });
        } catch (error) {
            return interaction.editReply({ embeds: [embeds.error('VoiceMaster Configuration Failed', error.message)] });
        }
    }

    async reconcile() {
        const result = { active: 0, deleted: 0, lost: 0, ambiguous: 0, failures: [] };
        const interrupted = this.sqlite.prepare("SELECT * FROM voice_master_configs WHERE state IN ('creating','resetting')").all();
        for (const config of interrupted) {
            try {
                await this.reconcileInterruptedConfig(config);
            } catch (error) {
                result.failures.push({ guildId: config.guild_id, channelId: config.primary_channel_id, error: error.message });
            }
        }
        await this.reconcilePendingCreations(result);
        await this.reconcilePendingSources(result);
        const configs = this.sqlite.prepare("SELECT * FROM voice_master_configs WHERE state = 'active'").all();
        for (const config of configs) {
            try {
                const guild = await this.client.guilds.fetch(config.guild_id);
                const category = guild.channels.cache.get(config.category_id)
                    || await guild.channels.fetch(config.category_id).catch(error => {
                        if (error.code === 10003) return null;
                        throw error;
                    });
                if (!category) {
                    this.sqlite.prepare("UPDATE voice_master_configs SET state = 'failed', updated_at = ? WHERE guild_id = ? AND generation = ?")
                        .run(this.now(), config.guild_id, config.generation);
                    result.lost++;
                } else if (category.type !== ChannelType.GuildCategory) {
                    result.ambiguous++;
                }
            } catch (error) {
                result.failures.push({ guildId: config.guild_id, channelId: config.category_id, error: error.message });
            }
        }
        const sources = this.sqlite.prepare("SELECT * FROM voice_master_sources WHERE state = 'active'").all();
        for (const source of sources) {
            let guild;
            try {
                guild = await this.client.guilds.fetch(source.guild_id);
                const channel = guild.channels.cache.get(source.channel_id)
                    || await guild.channels.fetch(source.channel_id).catch(error => {
                        if (error.code === 10003) return null;
                        throw error;
                    });
                if (!channel) {
                    this.markSourceLost(source);
                    result.lost++;
                } else if (channel.type !== ChannelType.GuildVoice) {
                    result.ambiguous++;
                } else if (source.interface_message_id && channel.messages?.fetch) {
                    const message = await this.fetchMessage(channel, source.interface_message_id);
                    if (!message) {
                        const replacement = await channel.send(voiceMasterInterface(channel.id));
                        this.sqlite.transaction(() => {
                            this.sqlite.prepare(`UPDATE voice_master_sources SET interface_message_id = ?
                                WHERE guild_id = ? AND channel_id = ? AND interface_message_id = ?`)
                                .run(replacement.id, source.guild_id, source.channel_id, source.interface_message_id);
                            if (source.is_primary) this.sqlite.prepare(`UPDATE voice_master_configs
                                SET interface_message_id = ?, updated_at = ? WHERE guild_id = ? AND interface_message_id = ?`)
                                .run(replacement.id, this.now(), source.guild_id, source.interface_message_id);
                        })();
                    }
                }
            } catch (error) {
                result.failures.push({ guildId: source.guild_id, channelId: source.channel_id, error: error.message });
            }
        }

        const pods = this.sqlite.prepare(`SELECT * FROM bytepods
            WHERE source_channel_id IS NOT NULL AND bot_owned = 1 AND state IN ('active','deleting')`).all();
        for (const pod of pods) {
            try {
                const guild = await this.client.guilds.fetch(pod.guild_id);
                const channel = guild.channels.cache.get(pod.channel_id)
                    || await guild.channels.fetch(pod.channel_id).catch(error => {
                        if (error.code === 10003) return null;
                        throw error;
                    });
                if (!channel) {
                    this.sqlite.prepare("UPDATE bytepods SET state = 'lost', cleanup_after = NULL WHERE guild_id = ? AND channel_id = ?")
                        .run(pod.guild_id, pod.channel_id);
                    this.sqlite.prepare(`UPDATE voice_master_creations SET state = 'failed',
                        error = 'Owned channel is missing.', updated_at = ? WHERE guild_id = ? AND channel_id = ?`)
                        .run(this.now(), pod.guild_id, pod.channel_id);
                    result.lost++;
                } else if (channel.type !== ChannelType.GuildVoice || (channel.guildId && channel.guildId !== pod.guild_id)) {
                    result.ambiguous++;
                } else if (channel.members.size === 0) {
                    const won = this.sqlite.prepare(`UPDATE bytepods SET state = 'deleting', generation = generation + 1
                        WHERE guild_id = ? AND channel_id = ? AND state IN ('active','deleting') AND bot_owned = 1`)
                        .run(pod.guild_id, pod.channel_id);
                    if (won.changes) {
                        try {
                            await this.revokeChannelJoinRoles(guild, channel.id);
                            if (channel.members.size > 0) {
                                this.sqlite.prepare(`UPDATE bytepods SET state = 'active', cleanup_after = NULL
                                    WHERE guild_id = ? AND channel_id = ? AND state = 'deleting'`)
                                    .run(pod.guild_id, pod.channel_id);
                                continue;
                            }
                            await channel.delete('VoiceMaster restart cleanup');
                            this.clearOwnedChannel(pod.guild_id, pod.channel_id);
                            result.deleted++;
                        } catch (error) {
                            if (error.code === 10003) {
                                this.clearOwnedChannel(pod.guild_id, pod.channel_id);
                                result.deleted++;
                            } else {
                                this.sqlite.prepare("UPDATE bytepods SET state = 'active', cleanup_after = ? WHERE guild_id = ? AND channel_id = ?")
                                    .run(this.now() + 5000, pod.guild_id, pod.channel_id);
                                throw error;
                            }
                        }
                    }
                } else {
                    if (pod.state === 'deleting') {
                        this.sqlite.prepare(`UPDATE bytepods SET state = 'active', cleanup_after = NULL
                            WHERE guild_id = ? AND channel_id = ? AND state = 'deleting'`)
                            .run(pod.guild_id, pod.channel_id);
                    }
                    const config = this.config(pod.guild_id);
                    if (config?.join_role_id) {
                        for (const member of channel.members.values()) {
                            if (!member.user?.bot && !member.roles.cache?.has(config.join_role_id)) {
                                await this.grantJoinRole(guild, member, channel.id, config.join_role_id);
                            }
                        }
                    }
                    result.active++;
                }
            } catch (error) {
                result.failures.push({ guildId: pod.guild_id, channelId: pod.channel_id, error: error.message });
            }
        }
        this.sqlite.prepare(`UPDATE voice_master_creations SET state = 'failed',
            error = 'Creation timed out during restart.', updated_at = ?
            WHERE state = 'pending' AND channel_id IS NULL AND updated_at < ?`)
            .run(this.now(), this.now() - 300000);
        await this.reconcilePendingOperations(result);
        await this.reconcileJoinRoleGrants(result);
        return result;
    }

    async reconcileInterruptedConfig(config) {
        const guild = await this.client.guilds.fetch(config.guild_id);
        const primary = await this.fetchChannel(guild, config.primary_channel_id);
        if (primary) {
            if (primary.type !== ChannelType.GuildVoice
                || (primary.guildId && primary.guildId !== config.guild_id)) {
                throw new Error('Interrupted VoiceMaster join channel is ambiguous.');
            }
            await primary.delete('VoiceMaster interrupted setup recovery');
        }
        const category = await this.fetchChannel(guild, config.category_id);
        if (category) {
            if (category.type !== ChannelType.GuildCategory
                || (category.guildId && category.guildId !== config.guild_id)) {
                throw new Error('Interrupted VoiceMaster category is ambiguous.');
            }
            await category.delete('VoiceMaster interrupted setup recovery');
        }
        this.sqlite.transaction(() => {
            this.sqlite.prepare('DELETE FROM voice_master_sources WHERE guild_id = ?').run(config.guild_id);
            this.sqlite.prepare(`DELETE FROM voice_master_configs WHERE guild_id = ?
                AND state IN ('creating','resetting') AND generation = ?`).run(config.guild_id, config.generation);
        })();
    }

    async reconcilePendingCreations(result) {
        const pending = this.sqlite.prepare("SELECT * FROM voice_master_creations WHERE state IN ('pending','deleting')").all();
        for (const snapshot of pending) {
            try {
                if (snapshot.state === 'pending') {
                    const claimed = this.sqlite.prepare(`UPDATE voice_master_creations SET state = 'deleting', updated_at = ?
                        WHERE guild_id = ? AND source_channel_id = ? AND member_id = ?
                        AND generation = ? AND state = 'pending'`)
                        .run(this.now(), snapshot.guild_id, snapshot.source_channel_id,
                            snapshot.member_id, snapshot.generation);
                    if (!claimed.changes) continue;
                }
                const creation = { ...snapshot, state: 'deleting' };
                await this.cleanupPendingCreation(creation, 'VoiceMaster interrupted creation recovery');
            } catch (error) {
                result.failures.push({ guildId: snapshot.guild_id, channelId: snapshot.channel_id, error: error.message });
            }
        }
    }

    async cleanupPendingCreation(creation, reason) {
        const current = this.sqlite.prepare(`SELECT * FROM voice_master_creations
            WHERE guild_id = ? AND source_channel_id = ? AND member_id = ?
            AND channel_id IS ? AND generation = ? AND state = 'deleting'`)
            .get(creation.guild_id, creation.source_channel_id, creation.member_id,
                creation.channel_id, creation.generation);
        if (!current) return;
        if (current.channel_id) {
            const guild = await this.client.guilds.fetch(current.guild_id);
            const channel = await this.fetchChannel(guild, current.channel_id);
            if (channel) {
                if (channel.type !== ChannelType.GuildVoice
                    || (channel.guildId && channel.guildId !== current.guild_id)) {
                    throw new Error('Pending VoiceMaster channel is ambiguous.');
                }
                try {
                    await channel.delete(reason);
                } catch (error) {
                    if (error.code !== 10003) throw error;
                }
            }
        }
        this.failCreation(current, 'Creation cleanup completed.');
    }

    async reconcilePendingSources(result) {
        const pending = this.sqlite.prepare("SELECT * FROM voice_master_sources WHERE state = 'pending'").all();
        for (const source of pending) {
            try {
                if (source.interface_message_id) {
                    const guild = await this.client.guilds.fetch(source.guild_id);
                    const channel = await this.fetchChannel(guild, source.channel_id);
                    if (channel?.messages?.fetch) {
                        const message = await this.fetchMessage(channel, source.interface_message_id);
                        if (message) {
                            try {
                                await message.delete();
                            } catch (error) {
                                if (error.code !== 10008) throw error;
                            }
                        }
                    }
                }
                this.sqlite.prepare(`DELETE FROM voice_master_sources
                    WHERE guild_id = ? AND channel_id = ? AND state = 'pending'`)
                    .run(source.guild_id, source.channel_id);
            } catch (error) {
                result.failures.push({ guildId: source.guild_id, channelId: source.channel_id, error: error.message });
            }
        }
    }

    async reconcileJoinRoleGrants(result) {
        const grants = this.sqlite.prepare('SELECT * FROM voice_master_join_roles').all();
        for (const snapshot of grants) {
            try {
                await this.withRoleLock(snapshot.guild_id, snapshot.member_id,
                    () => this.reconcileJoinRoleGrant(snapshot));
            } catch (error) {
                result.failures.push({ guildId: snapshot.guild_id, channelId: snapshot.channel_id, error: error.message });
            }
        }
    }

    async reconcileJoinRoleGrant(snapshot) {
        const grant = this.sqlite.prepare(`SELECT * FROM voice_master_join_roles
            WHERE guild_id = ? AND channel_id = ? AND member_id = ?`)
            .get(snapshot.guild_id, snapshot.channel_id, snapshot.member_id);
        if (!grant) return;
        const guild = await this.client.guilds.fetch(grant.guild_id);
        const member = await this.fetchMember(guild, grant.member_id);
        if (!member) {
            this.sqlite.prepare(`DELETE FROM voice_master_join_roles
                WHERE guild_id = ? AND channel_id = ? AND member_id = ?`)
                .run(grant.guild_id, grant.channel_id, grant.member_id);
            return;
        }
        if (grant.state === 'pending') {
            if (!member.roles.cache?.has(grant.role_id)) {
                await member.roles.add(grant.role_id, 'VoiceMaster join role recovery');
            }
            this.sqlite.prepare(`UPDATE voice_master_join_roles SET state = 'active', updated_at = ?
                WHERE guild_id = ? AND channel_id = ? AND member_id = ? AND role_id = ? AND state = 'pending'`)
                .run(this.now(), grant.guild_id, grant.channel_id, grant.member_id, grant.role_id);
            grant.state = 'active';
        }
        if (member.voice?.channelId) {
            const currentPod = this.sqlite.prepare(`SELECT 1 FROM bytepods
                WHERE guild_id = ? AND channel_id = ? AND source_channel_id IS NOT NULL
                AND state = 'active' AND bot_owned = 1`).get(grant.guild_id, member.voice.channelId);
            if (currentPod && this.config(grant.guild_id)?.join_role_id === grant.role_id) {
                if (member.voice.channelId !== grant.channel_id) {
                    this.sqlite.transaction(() => {
                        this.sqlite.prepare(`DELETE FROM voice_master_join_roles
                            WHERE guild_id = ? AND channel_id = ? AND member_id = ?`)
                            .run(grant.guild_id, grant.channel_id, grant.member_id);
                        this.sqlite.prepare(`INSERT INTO voice_master_join_roles
                            (guild_id, channel_id, member_id, role_id, state, added_by_bot, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT (guild_id, channel_id, member_id) DO UPDATE SET
                                role_id = excluded.role_id, state = excluded.state,
                                added_by_bot = excluded.added_by_bot, updated_at = excluded.updated_at`)
                            .run(grant.guild_id, member.voice.channelId, grant.member_id,
                                grant.role_id, grant.state, grant.added_by_bot, this.now());
                    })();
                }
                return;
            }
        }
        const pod = this.sqlite.prepare(`SELECT 1 FROM bytepods
            WHERE guild_id = ? AND channel_id = ? AND source_channel_id IS NOT NULL
            AND state = 'active' AND bot_owned = 1`).get(grant.guild_id, grant.channel_id);
        const channel = pod ? await this.fetchChannel(guild, grant.channel_id) : null;
        if (channel?.members.has(grant.member_id)) return;
        if (grant.added_by_bot) await member.roles.remove(grant.role_id, 'VoiceMaster role reconciliation');
        this.sqlite.prepare(`DELETE FROM voice_master_join_roles
            WHERE guild_id = ? AND channel_id = ? AND member_id = ?`)
            .run(grant.guild_id, grant.channel_id, grant.member_id);
    }

    async reconcilePendingOperations(result) {
        const claims = this.sqlite.prepare(`SELECT * FROM bytepods WHERE state IN ('claiming','claim_cancelled')
            AND bot_owned = 1 AND source_channel_id IS NOT NULL`).all();
        for (const pod of claims) {
            try {
                const guild = await this.client.guilds.fetch(pod.guild_id);
                const channel = await this.fetchChannel(guild, pod.channel_id);
                if (!channel) {
                    this.clearOwnedChannel(pod.guild_id, pod.channel_id);
                    continue;
                }
                if (channel.type !== ChannelType.GuildVoice
                    || (channel.guildId && channel.guildId !== pod.guild_id)) {
                    throw new Error('Pending VoiceMaster claim channel is ambiguous.');
                }
                const snapshot = JSON.parse(pod.claim_snapshot);
                await this.restorePermission(channel, pod.owner_id, snapshot.previous);
                await this.restorePermission(channel, pod.pending_owner_id, snapshot.next);
                this.completeClaimCompensation(pod);
            } catch (error) {
                result.failures.push({ guildId: pod.guild_id, channelId: pod.channel_id, error: error.message });
            }
        }
        const accessRows = this.sqlite.prepare("SELECT * FROM voice_master_access WHERE state = 'pending'").all();
        for (const access of accessRows) {
            try {
                await this.withAccessLock(access.guild_id, access.channel_id, access.user_id, async () => {
                    const current = this.sqlite.prepare(`SELECT * FROM voice_master_access
                        WHERE guild_id = ? AND channel_id = ? AND user_id = ?
                        AND state = 'pending' AND generation = ?`)
                        .get(access.guild_id, access.channel_id, access.user_id, access.generation);
                    if (!current) return;
                    const pod = this.sqlite.prepare(`SELECT state FROM bytepods
                        WHERE guild_id = ? AND channel_id = ? AND source_channel_id IS NOT NULL
                        AND bot_owned = 1`).get(current.guild_id, current.channel_id);
                    if (!pod) {
                        this.sqlite.prepare(`DELETE FROM voice_master_access
                            WHERE guild_id = ? AND channel_id = ? AND user_id = ?
                            AND state = 'pending' AND generation = ?`)
                            .run(current.guild_id, current.channel_id, current.user_id, current.generation);
                        return;
                    }
                    if (pod.state !== 'active') return;
                    const guild = await this.client.guilds.fetch(current.guild_id);
                    const channel = await this.fetchChannel(guild, current.channel_id);
                    if (!channel) {
                        this.clearOwnedChannel(current.guild_id, current.channel_id);
                        return;
                    }
                    if (channel.type !== ChannelType.GuildVoice
                        || (channel.guildId && channel.guildId !== current.guild_id)) {
                        throw new Error('Pending VoiceMaster access channel is ambiguous.');
                    }
                    const permissions = current.effect === 'permit'
                        ? { ViewChannel: true, Connect: true }
                        : { Connect: false };
                    await channel.permissionOverwrites.edit(current.user_id, permissions);
                    this.sqlite.prepare(`UPDATE voice_master_access SET state = 'active', updated_at = ?
                        WHERE guild_id = ? AND channel_id = ? AND user_id = ?
                        AND state = 'pending' AND generation = ?`)
                        .run(this.now(), current.guild_id, current.channel_id, current.user_id, current.generation);
                });
            } catch (error) {
                result.failures.push({ guildId: access.guild_id, channelId: access.channel_id, error: error.message });
            }
        }
    }

    markSourceLost(source) {
        this.sqlite.prepare("UPDATE voice_master_sources SET state = 'lost' WHERE guild_id = ? AND channel_id = ?")
            .run(source.guild_id, source.channel_id);
        if (source.is_primary) {
            this.sqlite.prepare(`UPDATE voice_master_configs SET state = 'failed', updated_at = ?
                WHERE guild_id = ? AND state = 'active'`)
                .run(this.now(), source.guild_id);
        }
    }

    handleChannelDelete(channel) {
        const source = this.sqlite.prepare('SELECT * FROM voice_master_sources WHERE guild_id = ? AND channel_id = ?')
            .get(channel.guildId, channel.id);
        if (source) this.markSourceLost(source);
        const pod = this.sqlite.prepare(`SELECT * FROM bytepods WHERE guild_id = ? AND channel_id = ?
            AND bot_owned = 1 AND source_channel_id IS NOT NULL`)
            .get(channel.guildId, channel.id);
        if (pod) {
            this.sqlite.prepare(`UPDATE bytepods SET state = 'lost', cleanup_after = NULL
                WHERE guild_id = ? AND channel_id = ? AND source_channel_id IS NOT NULL`)
                .run(channel.guildId, channel.id);
            this.sqlite.prepare(`UPDATE voice_master_creations SET state = 'failed',
                error = 'Owned channel was deleted.', updated_at = ?
                WHERE guild_id = ? AND channel_id = ?`).run(this.now(), channel.guildId, channel.id);
        }
    }

    handleChannelEvent(channel) {
        if (!channel?.guildId || channel.type === ChannelType.GuildVoice) return;
        const source = this.sqlite.prepare("SELECT * FROM voice_master_sources WHERE guild_id = ? AND channel_id = ? AND state = 'active'")
            .get(channel.guildId, channel.id);
        if (source) logger.warn(`VoiceMaster source ${channel.id} changed to an unsupported channel type; leaving it for operator review.`);
        const pod = this.sqlite.prepare(`SELECT 1 FROM bytepods WHERE guild_id = ? AND channel_id = ?
            AND state = 'active' AND bot_owned = 1 AND source_channel_id IS NOT NULL`)
            .get(channel.guildId, channel.id);
        if (pod) logger.warn(`VoiceMaster owned channel ${channel.id} changed type; refusing automatic cleanup.`);
    }

    cleanup() {
        if (this.cleanupTimer) clearInterval(this.cleanupTimer);
        this.cleanupTimer = null;
    }

    async retryScheduledCleanup() {
        const creations = this.sqlite.prepare(`SELECT * FROM voice_master_creations
            WHERE state = 'deleting' AND channel_id IS NOT NULL ORDER BY updated_at LIMIT 25`).all();
        for (const creation of creations) {
            try {
                await this.cleanupPendingCreation(creation, 'VoiceMaster scheduled creation cleanup');
            } catch (error) {
                logger.warn(`VoiceMaster creation cleanup failed for ${creation.channel_id}: ${error.message}`);
            }
        }
        const due = this.sqlite.prepare(`SELECT * FROM bytepods WHERE source_channel_id IS NOT NULL
            AND bot_owned = 1 AND state = 'active' AND cleanup_after IS NOT NULL AND cleanup_after <= ?
            ORDER BY cleanup_after LIMIT 25`).all(this.now());
        for (const pod of due) {
            try {
                const guild = await this.client.guilds.fetch(pod.guild_id);
                const channel = await this.fetchChannel(guild, pod.channel_id);
                if (!channel) {
                    this.clearOwnedChannel(pod.guild_id, pod.channel_id);
                    continue;
                }
                if (channel.type !== ChannelType.GuildVoice || channel.members.size > 0) {
                    this.sqlite.prepare(`UPDATE bytepods SET cleanup_after = NULL
                        WHERE guild_id = ? AND channel_id = ? AND source_channel_id IS NOT NULL`)
                        .run(pod.guild_id, pod.channel_id);
                    continue;
                }
                const won = this.sqlite.prepare(`UPDATE bytepods SET state = 'deleting', generation = generation + 1
                    WHERE guild_id = ? AND channel_id = ? AND state = 'active' AND generation = ?
                    AND source_channel_id IS NOT NULL`).run(pod.guild_id, pod.channel_id, pod.generation);
                if (!won.changes) continue;
                await this.revokeChannelJoinRoles(guild, channel.id);
                if (channel.members.size > 0) {
                    this.sqlite.prepare(`UPDATE bytepods SET state = 'active', cleanup_after = NULL
                        WHERE guild_id = ? AND channel_id = ? AND state = 'deleting'`)
                        .run(pod.guild_id, pod.channel_id);
                    continue;
                }
                await channel.delete('VoiceMaster scheduled cleanup retry');
                this.clearOwnedChannel(pod.guild_id, pod.channel_id);
            } catch (error) {
                this.sqlite.prepare(`UPDATE bytepods SET state = 'active', cleanup_after = ?
                    WHERE guild_id = ? AND channel_id = ? AND state = 'deleting' AND source_channel_id IS NOT NULL`)
                    .run(this.now() + 5000, pod.guild_id, pod.channel_id);
                if (error.code === 10003) this.clearOwnedChannel(pod.guild_id, pod.channel_id);
                else logger.warn(`VoiceMaster scheduled cleanup failed for ${pod.channel_id}: ${error.message}`);
            }
        }
    }

    purgeGuild(guildId) {
        this.sqlite.transaction(() => {
            this.sqlite.prepare('DELETE FROM voice_master_access WHERE guild_id = ?').run(guildId);
            this.sqlite.prepare('DELETE FROM voice_master_join_roles WHERE guild_id = ?').run(guildId);
            this.sqlite.prepare('DELETE FROM voice_master_creations WHERE guild_id = ?').run(guildId);
            this.sqlite.prepare('DELETE FROM bytepods WHERE guild_id = ? AND source_channel_id IS NOT NULL').run(guildId);
            this.sqlite.prepare('DELETE FROM voice_master_sources WHERE guild_id = ?').run(guildId);
            this.sqlite.prepare('DELETE FROM voice_master_configs WHERE guild_id = ?').run(guildId);
        })();
    }

    async autocomplete(interaction) {
        try {
            const focused = interaction.options.getFocused();
            const regions = await interaction.guild.fetchVoiceRegions();
            const choices = [{ name: 'Automatic', value: 'auto' }, ...[...regions.values()]
                .filter(region => !region.deprecated)
                .map(region => ({ name: region.name || region.id, value: region.id }))]
                .filter(choice => choice.name.toLowerCase().includes(String(focused || '').toLowerCase()))
                .slice(0, 25);
            return interaction.respond(choices);
        } catch {
            return interaction.respond([]);
        }
    }
}

module.exports = { VoiceMasterService };
