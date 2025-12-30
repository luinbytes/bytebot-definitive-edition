const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const { getUserPreference, setUserPreference } = require('../../utils/ephemeralHelper');

module.exports = {
    category: 'Utility',
    data: new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Manage your personal ByteBot settings')
        .addSubcommand(subcommand =>
            subcommand
                .setName('privacy')
                .setDescription('Configure when command responses are visible only to you')
                .addStringOption(option =>
                    option
                        .setName('preference')
                        .setDescription('Your ephemeral preference')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Default (Smart)', value: 'default' },
                            { name: 'Always Private', value: 'always' },
                            { name: 'Always Public', value: 'public' }
                        )
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View your current settings')
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'privacy') {
            return await handlePrivacy(interaction);
        } else if (subcommand === 'view') {
            return await handleView(interaction);
        }
    }
};

/**
 * Handle /settings privacy subcommand
 */
async function handlePrivacy(interaction) {
    const preference = interaction.options.getString('preference');

    // Update user's preference
    const success = await setUserPreference(
        interaction.user.id,
        interaction.guildId,
        preference
    );

    if (!success) {
        return await interaction.reply({
            embeds: [embeds.error(
                'Settings Update Failed',
                'There was an error saving your preferences. Please try again.'
            )],
            flags: [MessageFlags.Ephemeral]
        });
    }

    // Build confirmation message
    let description = '';
    switch (preference) {
        case 'always':
            description = '🔒 All personal command responses will now be **visible only to you** (across all servers).\n\nYou can still override this per-command using the `private` parameter.';
            break;
        case 'public':
            description = '🌐 All personal command responses will now be **public** (across all servers).\n\nYou can still override this per-command using the `private` parameter.';
            break;
        case 'default':
            description = '🤖 Command responses will use **smart defaults** (across all servers):\n\n' +
                '• Viewing your own data → Private\n' +
                '• Viewing others\' data → Public (social context)\n' +
                '• Admin/mod commands → Always appropriate visibility\n\n' +
                'You can still override per-command using the `private` parameter.';
            break;
    }

    const embed = embeds.success('Privacy Settings Updated', description)
        .addFields({
            name: 'Current Preference',
            value: getPreferenceLabel(preference),
            inline: false
        });

    return await interaction.reply({
        embeds: [embed],
        flags: [MessageFlags.Ephemeral]
    });
}

/**
 * Handle /settings view subcommand
 */
async function handleView(interaction) {
    const preference = await getUserPreference(interaction.user.id);

    const embed = embeds.brand('Your ByteBot Settings', 'Global settings across all servers')
        .addFields(
            {
                name: 'Privacy Preference',
                value: getPreferenceLabel(preference),
                inline: false
            },
            {
                name: 'How It Works',
                value: getPreferenceDescription(preference),
                inline: false
            },
            {
                name: 'Commands with Privacy Control',
                value: '• `/streak view` - Activity stats\n' +
                    '• `/stats server` - Server statistics\n' +
                    '• `/serverinfo` - Server information\n' +
                    '• `/birthday view` - Birthday information\n' +
                    '• `/userinfo` - User profile\n' +
                    '• And more...\n\n' +
                    '*Add `private:True` to any command to force private mode.*',
                inline: false
            }
        );

    return await interaction.reply({
        embeds: [embed],
        flags: [MessageFlags.Ephemeral]
    });
}

/**
 * Get human-readable preference label
 */
function getPreferenceLabel(preference) {
    switch (preference) {
        case 'always':
            return '🔒 **Always Private** - All responses visible only to you';
        case 'public':
            return '🌐 **Always Public** - All responses visible to everyone';
        case 'default':
            return '🤖 **Default (Smart)** - Context-aware visibility';
        default:
            return '❓ Unknown';
    }
}

/**
 * Get detailed preference description
 */
function getPreferenceDescription(preference) {
    switch (preference) {
        case 'always':
            return 'Every command response will be private (ephemeral), visible only to you across all servers. ' +
                'Perfect for users who prefer maximum privacy.';
        case 'public':
            return 'Every command response will be public, visible to everyone across all servers. ' +
                'Great for social interaction and sharing.';
        case 'default':
            return 'ByteBot intelligently decides visibility based on context across all servers:\n' +
                '• **Private** when viewing your own data\n' +
                '• **Public** when viewing others (social context)\n' +
                '• Admin/mod commands use appropriate defaults';
        default:
            return 'Unknown preference setting.';
    }
}
