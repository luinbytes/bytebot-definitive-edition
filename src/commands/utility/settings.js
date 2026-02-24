const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { db } = require('../../database');
const { users, bytepodUserSettings } = require('../../database/schema');
const { eq, and } = require('drizzle-orm');
const embeds = require('../../utils/embeds');
const { getUserPreference, setUserPreference } = require('../../utils/ephemeralHelper');
const logger = require('../../utils/logger');

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
                .setName('achievements')
                .setDescription('Enable or disable achievement tracking for yourself')
                .addBooleanOption(option =>
                    option
                        .setName('enabled')
                        .setDescription('Track achievements?')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('summaries')
                .setDescription('Enable or disable BytePod session summary DMs')
                .addBooleanOption(option =>
                    option
                        .setName('enabled')
                        .setDescription('Receive session summaries via DM when your pod ends?')
                        .setRequired(true)
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
        } else if (subcommand === 'achievements') {
            return await handleAchievements(interaction);
        } else if (subcommand === 'summaries') {
            return await handleSummaries(interaction);
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

    let description = '';
    switch (preference) {
        case 'always':
            description = '🔒 All personal command responses will now be **visible only to you** (across all servers).';
            break;
        case 'public':
            description = '🌐 All personal command responses will now be **public** (across all servers).';
            break;
        case 'default':
            description = '🤖 Command responses will use **smart defaults** (across all servers).';
            break;
    }

    return await interaction.reply({
        embeds: [embeds.success('Privacy Settings Updated', description)],
        flags: [MessageFlags.Ephemeral]
    });
}

/**
 * Handle /settings achievements subcommand
 */
async function handleAchievements(interaction) {
    const enabled = interaction.options.getBoolean('enabled');
    const optedOut = !enabled; // Inverted: enabled=true means optedOut=false

    try {
        await db.insert(users).values({
            id: interaction.user.id,
            guildId: interaction.guildId,
            achievementsOptedOut: optedOut,
            commandsRun: 0,
            lastSeen: new Date()
        }).onConflictDoUpdate({
            target: users.id,
            set: { achievementsOptedOut: optedOut }
        });

        const description = enabled
            ? '✅ Achievement tracking is now **enabled**. Your streaks and achievements will be tracked.'
            : '🔕 Achievement tracking is now **disabled**. You won\'t earn new achievements, but existing data is preserved.';

        return await interaction.reply({
            embeds: [embeds.success('Achievement Settings Updated', description)],
            flags: [MessageFlags.Ephemeral]
        });

    } catch (error) {
        logger.error(`Error updating achievement settings for ${interaction.user.id}:`, error);
        return await interaction.reply({
            embeds: [embeds.error('Settings Update Failed', 'There was an error saving your preferences. Please try again.')],
            flags: [MessageFlags.Ephemeral]
        });
    }
}

/**
 * Handle /settings summaries subcommand
 */
async function handleSummaries(interaction) {
    const enabled = interaction.options.getBoolean('enabled');

    try {
        // Upsert user settings (composite key: userId + guildId)
        await db.insert(bytepodUserSettings).values({
            userId: interaction.user.id,
            guildId: interaction.guildId,
            autoLock: false,
            summaryEnabled: enabled
        }).onConflictDoUpdate({
            target: [bytepodUserSettings.userId, bytepodUserSettings.guildId],
            set: { summaryEnabled: enabled }
        });

        const description = enabled
            ? '📊 BytePod session summaries are now **enabled**. You\'ll receive a DM with stats when your pod ends.'
            : '📊 BytePod session summaries are now **disabled**. You won\'t receive summary DMs.';

        return await interaction.reply({
            embeds: [embeds.success('Summary Settings Updated', description)],
            flags: [MessageFlags.Ephemeral]
        });

    } catch (error) {
        logger.error(`Error updating summary settings for ${interaction.user.id}:`, error);
        return await interaction.reply({
            embeds: [embeds.error('Settings Update Failed', 'There was an error saving your preferences. Please try again.')],
            flags: [MessageFlags.Ephemeral]
        });
    }
}

/**
 * Handle /settings view subcommand
 */
async function handleView(interaction) {
    try {
        // Get privacy preference
        const privacyPref = await getUserPreference(interaction.user.id);

        // Get achievement opt-out status
        const userData = await db.select()
            .from(users)
            .where(eq(users.id, interaction.user.id))
            .get();
        const achievementsEnabled = !userData?.achievementsOptedOut;

        // Get BytePod settings (per-guild)
        const bytepodSettings = await db.select()
            .from(bytepodUserSettings)
            .where(and(
                eq(bytepodUserSettings.userId, interaction.user.id),
                eq(bytepodUserSettings.guildId, interaction.guildId)
            ))
            .get();
        const autolock = bytepodSettings?.autoLock || false;
        const summariesEnabled = bytepodSettings?.summaryEnabled || false;

        const embed = embeds.brand('Your ByteBot Settings', 'Personal preferences')
            .addFields(
                {
                    name: 'Privacy',
                    value: getPreferenceLabel(privacyPref),
                    inline: false
                },
                {
                    name: 'Achievements',
                    value: achievementsEnabled
                        ? '✅ **Enabled** - Tracking streaks and achievements'
                        : '🔕 **Disabled** - Opted out of tracking',
                    inline: false
                },
                {
                    name: 'BytePod Auto-Lock',
                    value: (autolock
                        ? '🔒 **Enabled** - New pods lock automatically'
                        : '🔓 **Disabled** - New pods stay unlocked') + ' *(use `/bytepod autolock` to change)*',
                    inline: false
                },
                {
                    name: 'BytePod Summaries',
                    value: (summariesEnabled
                        ? '📊 **Enabled** - Receive DM with stats when pod ends'
                        : '📊 **Disabled** - No summary DMs') + ' *(use `/settings summaries` to change)*',
                    inline: false
                }
            );

        return await interaction.reply({
            embeds: [embed],
            flags: [MessageFlags.Ephemeral]
        });

    } catch (error) {
        logger.error(`Error viewing settings for ${interaction.user.id}:`, error);
        return await interaction.reply({
            embeds: [embeds.error('Error', 'Could not load your settings. Please try again.')],
            flags: [MessageFlags.Ephemeral]
        });
    }
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
