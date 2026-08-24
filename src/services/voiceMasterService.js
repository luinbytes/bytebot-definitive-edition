const { ChannelType, PermissionFlagsBits } = require('discord.js');
const embeds = require('../utils/embeds');
const logger = require('../utils/logger');
const { voiceMasterInterface } = require('../components/voiceMasterControls');

const SETUP_PERMISSIONS = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.MoveMembers
];

class VoiceMasterService {
    constructor({ client = null, sqlite, now = Date.now }) {
        this.client = client;
        this.sqlite = sqlite;
        this.now = now;
    }

    config(guildId) {
        return this.sqlite.prepare('SELECT * FROM voice_master_configs WHERE guild_id = ?').get(guildId) || null;
    }

    async execute(interaction) {
        const group = interaction.options.getSubcommandGroup(false);
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'setup') return this.setup(interaction);
        if (subcommand === 'sendinterface') return this.sendInterface(interaction);
        return interaction.editReply({ embeds: [embeds.error('Not Available', `VoiceMaster ${group ? `${group} ` : ''}${subcommand} is not available yet.`)] });
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

    source(guildId, channelId) {
        return this.sqlite.prepare(`SELECT source.*, config.name_template, config.default_role_id,
            config.default_bitrate, config.default_region, config.send_interface, config.temporary_enabled
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
        const source = this.source(guild.id, newState.channelId);
        if (!source || !source.temporary_enabled || oldState.channelId === newState.channelId) return false;

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
}

module.exports = { VoiceMasterService };
