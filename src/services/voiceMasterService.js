const { ChannelType, PermissionFlagsBits } = require('discord.js');
const embeds = require('../utils/embeds');
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
}

module.exports = { VoiceMasterService };
