const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const { achievementDefinitions } = require('../src/database/schema');
require('dotenv').config();

const sqlite = new Database(process.env.DATABASE_URL || 'sqlite.db');
const db = drizzle(sqlite);

/**
 * All 82 Core Achievement Definitions
 * Categories: streak (18), total (10), message (10), voice (10), command (8),
 *             special (12), social (8), combo (6), meta (5)
 *
 * Rarity Distribution:
 * - Common: 17 achievements
 * - Uncommon: 19 achievements
 * - Rare: 15 achievements
 * - Epic: 13 achievements
 * - Legendary: 11 achievements
 * - Mythic: 7 achievements
 *
 * Role Rewards: 39/82 achievements grant roles (🏆)
 */

const ACHIEVEMENTS = [
    // ==================== STREAK ACHIEVEMENTS (18) ====================
    {
        id: 'streak_3',
        title: 'Getting Started',
        description: 'Maintain a 3-day activity streak',
        emoji: '🔥',
        category: 'streak',
        rarity: 'common',
        checkType: 'exact',
        criteria: JSON.stringify({ streak: 3 }),
        grantRole: false,
        points: 3
    },
    {
        id: 'streak_5',
        title: 'Five Alive',
        description: 'Maintain a 5-day activity streak',
        emoji: '🔥',
        category: 'streak',
        rarity: 'common',
        checkType: 'exact',
        criteria: JSON.stringify({ streak: 5 }),
        grantRole: false,
        points: 5
    },
    {
        id: 'streak_7',
        title: 'Week Warrior',
        description: 'Maintain a 7-day activity streak',
        emoji: '⚡',
        category: 'streak',
        rarity: 'uncommon',
        checkType: 'exact',
        criteria: JSON.stringify({ streak: 7 }),
        grantRole: false,
        points: 10
    },
    {
        id: 'streak_10',
        title: 'Perfect Ten',
        description: 'Maintain a 10-day activity streak',
        emoji: '⚡',
        category: 'streak',
        rarity: 'uncommon',
        checkType: 'exact',
        criteria: JSON.stringify({ streak: 10 }),
        grantRole: false,
        points: 15
    },
    {
        id: 'streak_14',
        title: 'Two-Week Champion',
        description: 'Maintain a 14-day activity streak',
        emoji: '💪',
        category: 'streak',
        rarity: 'rare',
        checkType: 'exact',
        criteria: JSON.stringify({ streak: 14 }),
        grantRole: false,
        points: 21
    },
    {
        id: 'streak_21',
        title: 'Three-Week Master',
        description: 'Maintain a 21-day activity streak',
        emoji: '💪',
        category: 'streak',
        rarity: 'rare',
        checkType: 'exact',
        criteria: JSON.stringify({ streak: 21 }),
        grantRole: false,
        points: 30
    },
    {
        id: 'streak_30',
        title: 'Monthly Dedication',
        description: 'Maintain a 30-day activity streak',
        emoji: '🌟',
        category: 'streak',
        rarity: 'epic',
        checkType: 'exact',
        criteria: JSON.stringify({ streak: 30 }),
        grantRole: false,
        points: 50
    },
    {
        id: 'streak_45',
        title: 'Six-Week Legend',
        description: 'Maintain a 45-day activity streak',
        emoji: '🌟',
        category: 'streak',
        rarity: 'epic',
        checkType: 'exact',
        criteria: JSON.stringify({ streak: 45 }),
        grantRole: false,
        points: 70
    },
    {
        id: 'streak_60',
        title: 'Two-Month Elite',
        description: 'Maintain a 60-day activity streak',
        emoji: '🔱',
        category: 'streak',
        rarity: 'legendary',
        checkType: 'exact',
        criteria: JSON.stringify({ streak: 60 }),
        grantRole: false,
        points: 100
    },
    {
        id: 'streak_90',
        title: 'Quarter-Year Hero',
        description: 'Maintain a 90-day activity streak',
        emoji: '🔱',
        category: 'streak',
        rarity: 'legendary',
        checkType: 'exact',
        criteria: JSON.stringify({ streak: 90 }),
        grantRole: false,
        points: 150
    },
    {
        id: 'streak_120',
        title: 'Four-Month Titan',
        description: 'Maintain a 120-day activity streak',
        emoji: '👑',
        category: 'streak',
        rarity: 'legendary',
        checkType: 'exact',
        criteria: JSON.stringify({ streak: 120 }),
        grantRole: true,
        points: 200
    },
    {
        id: 'streak_150',
        title: 'Five-Month Champion',
        description: 'Maintain a 150-day activity streak',
        emoji: '👑',
        category: 'streak',
        rarity: 'legendary',
        checkType: 'exact',
        criteria: JSON.stringify({ streak: 150 }),
        grantRole: true,
        points: 250
    },
    {
        id: 'streak_180',
        title: 'Half-Year Immortal',
        description: 'Maintain a 180-day activity streak',
        emoji: '💎',
        category: 'streak',
        rarity: 'mythic',
        checkType: 'exact',
        criteria: JSON.stringify({ streak: 180 }),
        grantRole: false,
        points: 300
    },
    {
        id: 'streak_270',
        title: 'Nine-Month Deity',
        description: 'Maintain a 270-day activity streak',
        emoji: '💎',
        category: 'streak',
        rarity: 'mythic',
        checkType: 'exact',
        criteria: JSON.stringify({ streak: 270 }),
        grantRole: true,
        points: 450
    },
    {
        id: 'streak_365',
        title: 'Annual Legend',
        description: 'Maintain a 365-day activity streak',
        emoji: '🏆',
        category: 'streak',
        rarity: 'mythic',
        checkType: 'exact',
        criteria: JSON.stringify({ streak: 365 }),
        grantRole: false,
        points: 500
    },
    {
        id: 'streak_500',
        title: 'Unstoppable Force',
        description: 'Maintain a 500-day activity streak',
        emoji: '⭐',
        category: 'streak',
        rarity: 'mythic',
        checkType: 'exact',
        criteria: JSON.stringify({ streak: 500 }),
        grantRole: true,
        points: 750
    },
    {
        id: 'streak_730',
        title: 'Two-Year Immortal',
        description: 'Maintain a 730-day activity streak (2 years)',
        emoji: '⭐',
        category: 'streak',
        rarity: 'mythic',
        checkType: 'exact',
        criteria: JSON.stringify({ streak: 730 }),
        grantRole: true,
        points: 1000
    },
    {
        id: 'streak_1000',
        title: 'Millennium Veteran',
        description: 'Maintain a 1000-day activity streak',
        emoji: '🌌',
        category: 'streak',
        rarity: 'mythic',
        checkType: 'exact',
        criteria: JSON.stringify({ streak: 1000 }),
        grantRole: true,
        points: 1500
    },

    // ==================== TOTAL DAYS ACHIEVEMENTS (10) ====================
    {
        id: 'total_30',
        title: 'First Month',
        description: 'Reach 30 total active days',
        emoji: '📅',
        category: 'total',
        rarity: 'common',
        checkType: 'threshold',
        criteria: JSON.stringify({ totalDays: 30 }),
        grantRole: false,
        points: 30
    },
    {
        id: 'total_50',
        title: 'Fifty Days Strong',
        description: 'Reach 50 total active days',
        emoji: '📅',
        category: 'total',
        rarity: 'common',
        checkType: 'threshold',
        criteria: JSON.stringify({ totalDays: 50 }),
        grantRole: false,
        points: 50
    },
    {
        id: 'total_100',
        title: 'Century Club',
        description: 'Reach 100 total active days',
        emoji: '💯',
        category: 'total',
        rarity: 'uncommon',
        checkType: 'threshold',
        criteria: JSON.stringify({ totalDays: 100 }),
        grantRole: false,
        points: 100
    },
    {
        id: 'total_150',
        title: 'Sesquicentennial',
        description: 'Reach 150 total active days',
        emoji: '💯',
        category: 'total',
        rarity: 'uncommon',
        checkType: 'threshold',
        criteria: JSON.stringify({ totalDays: 150 }),
        grantRole: false,
        points: 150
    },
    {
        id: 'total_250',
        title: 'Quarter Thousand',
        description: 'Reach 250 total active days',
        emoji: '🎯',
        category: 'total',
        rarity: 'rare',
        checkType: 'threshold',
        criteria: JSON.stringify({ totalDays: 250 }),
        grantRole: true,
        points: 250
    },
    {
        id: 'total_365',
        title: 'Year of Service',
        description: 'Reach 365 total active days',
        emoji: '🎯',
        category: 'total',
        rarity: 'epic',
        checkType: 'threshold',
        criteria: JSON.stringify({ totalDays: 365 }),
        grantRole: false,
        points: 365
    },
    {
        id: 'total_500',
        title: 'Half Millennium',
        description: 'Reach 500 total active days',
        emoji: '🌟',
        category: 'total',
        rarity: 'epic',
        checkType: 'threshold',
        criteria: JSON.stringify({ totalDays: 500 }),
        grantRole: true,
        points: 500
    },
    {
        id: 'total_750',
        title: 'Veteran Member',
        description: 'Reach 750 total active days',
        emoji: '🔥',
        category: 'total',
        rarity: 'legendary',
        checkType: 'threshold',
        criteria: JSON.stringify({ totalDays: 750 }),
        grantRole: true,
        points: 750
    },
    {
        id: 'total_1000',
        title: 'Millennium Member',
        description: 'Reach 1000 total active days',
        emoji: '👑',
        category: 'total',
        rarity: 'legendary',
        checkType: 'threshold',
        criteria: JSON.stringify({ totalDays: 1000 }),
        grantRole: true,
        points: 1000
    },
    {
        id: 'total_1500',
        title: 'Eternal Presence',
        description: 'Reach 1500 total active days',
        emoji: '💎',
        category: 'total',
        rarity: 'mythic',
        checkType: 'threshold',
        criteria: JSON.stringify({ totalDays: 1500 }),
        grantRole: true,
        points: 1500
    },

    // ==================== MESSAGE ACHIEVEMENTS (10) ====================
    {
        id: 'message_100',
        title: 'First Words',
        description: 'Send 100 messages',
        emoji: '💬',
        category: 'message',
        rarity: 'common',
        checkType: 'threshold',
        criteria: JSON.stringify({ messageCount: 100 }),
        grantRole: false,
        points: 10
    },
    {
        id: 'message_500',
        title: 'Conversationalist',
        description: 'Send 500 messages',
        emoji: '💬',
        category: 'message',
        rarity: 'common',
        checkType: 'threshold',
        criteria: JSON.stringify({ messageCount: 500 }),
        grantRole: false,
        points: 25
    },
    {
        id: 'message_1000',
        title: 'Chatterbox',
        description: 'Send 1,000 messages',
        emoji: '💬',
        category: 'message',
        rarity: 'uncommon',
        checkType: 'threshold',
        criteria: JSON.stringify({ messageCount: 1000 }),
        grantRole: false,
        points: 50
    },
    {
        id: 'message_5000',
        title: 'Community Voice',
        description: 'Send 5,000 messages',
        emoji: '📣',
        category: 'message',
        rarity: 'rare',
        checkType: 'threshold',
        criteria: JSON.stringify({ messageCount: 5000 }),
        grantRole: true,
        points: 150
    },
    {
        id: 'message_10000',
        title: 'Megaphone Master',
        description: 'Send 10,000 messages',
        emoji: '📢',
        category: 'message',
        rarity: 'epic',
        checkType: 'threshold',
        criteria: JSON.stringify({ messageCount: 10000 }),
        grantRole: true,
        points: 300
    },
    {
        id: 'message_25000',
        title: 'Word Wizard',
        description: 'Send 25,000 messages',
        emoji: '🗣️',
        category: 'message',
        rarity: 'epic',
        checkType: 'threshold',
        criteria: JSON.stringify({ messageCount: 25000 }),
        grantRole: true,
        points: 500
    },
    {
        id: 'message_50000',
        title: 'Communication King',
        description: 'Send 50,000 messages',
        emoji: '👑',
        category: 'message',
        rarity: 'legendary',
        checkType: 'threshold',
        criteria: JSON.stringify({ messageCount: 50000 }),
        grantRole: true,
        points: 750
    },
    {
        id: 'message_100000',
        title: 'Legendary Linguist',
        description: 'Send 100,000 messages',
        emoji: '💎',
        category: 'message',
        rarity: 'mythic',
        checkType: 'threshold',
        criteria: JSON.stringify({ messageCount: 100000 }),
        grantRole: true,
        points: 1000
    },
    {
        id: 'message_perfect_day',
        title: 'Perfect Day',
        description: 'Send messages in all 24 hours of a single day',
        emoji: '🕐',
        category: 'message',
        rarity: 'rare',
        checkType: 'special',
        criteria: JSON.stringify({ type: 'all_hours_active', hourCount: 24 }),
        grantRole: false,
        points: 200
    },
    {
        id: 'message_night_owl',
        title: 'Night Owl',
        description: 'Send 1,000 messages between midnight and 6 AM',
        emoji: '🦉',
        category: 'message',
        rarity: 'epic',
        checkType: 'special',
        criteria: JSON.stringify({ type: 'night_messages', count: 1000, hours: [0, 1, 2, 3, 4, 5] }),
        grantRole: true,
        points: 250
    },

    // ==================== VOICE ACHIEVEMENTS (10) ====================
    {
        id: 'voice_10hrs',
        title: 'Voice Beginner',
        description: 'Spend 10 hours in voice channels',
        emoji: '🎤',
        category: 'voice',
        rarity: 'common',
        checkType: 'threshold',
        criteria: JSON.stringify({ voiceHours: 10 }),
        grantRole: false,
        points: 20
    },
    {
        id: 'voice_50hrs',
        title: 'Voice Regular',
        description: 'Spend 50 hours in voice channels',
        emoji: '🎤',
        category: 'voice',
        rarity: 'common',
        checkType: 'threshold',
        criteria: JSON.stringify({ voiceHours: 50 }),
        grantRole: false,
        points: 50
    },
    {
        id: 'voice_100hrs',
        title: 'Voice Enthusiast',
        description: 'Spend 100 hours in voice channels',
        emoji: '🎧',
        category: 'voice',
        rarity: 'uncommon',
        checkType: 'threshold',
        criteria: JSON.stringify({ voiceHours: 100 }),
        grantRole: false,
        points: 100
    },
    {
        id: 'voice_250hrs',
        title: 'Voice Champion',
        description: 'Spend 250 hours in voice channels',
        emoji: '🎧',
        category: 'voice',
        rarity: 'rare',
        checkType: 'threshold',
        criteria: JSON.stringify({ voiceHours: 250 }),
        grantRole: true,
        points: 250
    },
    {
        id: 'voice_500hrs',
        title: 'Voice Master',
        description: 'Spend 500 hours in voice channels',
        emoji: '🔊',
        category: 'voice',
        rarity: 'epic',
        checkType: 'threshold',
        criteria: JSON.stringify({ voiceHours: 500 }),
        grantRole: true,
        points: 500
    },
    {
        id: 'voice_1000hrs',
        title: 'Voice Legend',
        description: 'Spend 1,000 hours in voice channels',
        emoji: '📻',
        category: 'voice',
        rarity: 'epic',
        checkType: 'threshold',
        criteria: JSON.stringify({ voiceHours: 1000 }),
        grantRole: true,
        points: 750
    },
    {
        id: 'voice_2500hrs',
        title: 'Voice Deity',
        description: 'Spend 2,500 hours in voice channels',
        emoji: '🎙️',
        category: 'voice',
        rarity: 'legendary',
        checkType: 'threshold',
        criteria: JSON.stringify({ voiceHours: 2500 }),
        grantRole: true,
        points: 1000
    },
    {
        id: 'voice_5000hrs',
        title: 'Voice Immortal',
        description: 'Spend 5,000 hours in voice channels',
        emoji: '👑',
        category: 'voice',
        rarity: 'mythic',
        checkType: 'threshold',
        criteria: JSON.stringify({ voiceHours: 5000 }),
        grantRole: true,
        points: 1500
    },
    {
        id: 'voice_marathon',
        title: 'Voice Marathon',
        description: 'Spend 12 continuous hours in a voice channel',
        emoji: '🏃',
        category: 'voice',
        rarity: 'rare',
        checkType: 'special',
        criteria: JSON.stringify({ type: 'continuous_session', hours: 12 }),
        grantRole: false,
        points: 200
    },
    {
        id: 'voice_early_bird',
        title: 'Early Bird',
        description: 'Spend 500 hours in voice between 6 AM and 10 AM',
        emoji: '🐦',
        category: 'voice',
        rarity: 'epic',
        checkType: 'special',
        criteria: JSON.stringify({ type: 'morning_voice', hours: 500, timeRange: [6, 7, 8, 9] }),
        grantRole: true,
        points: 300
    },

    // ==================== COMMAND ACHIEVEMENTS (8) ====================
    {
        id: 'command_50',
        title: 'Command Novice',
        description: 'Run 50 bot commands',
        emoji: '⚙️',
        category: 'command',
        rarity: 'common',
        checkType: 'threshold',
        criteria: JSON.stringify({ commandCount: 50 }),
        grantRole: false,
        points: 15
    },
    {
        id: 'command_250',
        title: 'Command User',
        description: 'Run 250 bot commands',
        emoji: '⚙️',
        category: 'command',
        rarity: 'uncommon',
        checkType: 'threshold',
        criteria: JSON.stringify({ commandCount: 250 }),
        grantRole: false,
        points: 50
    },
    {
        id: 'command_500',
        title: 'Command Regular',
        description: 'Run 500 bot commands',
        emoji: '🔧',
        category: 'command',
        rarity: 'uncommon',
        checkType: 'threshold',
        criteria: JSON.stringify({ commandCount: 500 }),
        grantRole: false,
        points: 100
    },
    {
        id: 'command_1000',
        title: 'Command Expert',
        description: 'Run 1,000 bot commands',
        emoji: '🔧',
        category: 'command',
        rarity: 'rare',
        checkType: 'threshold',
        criteria: JSON.stringify({ commandCount: 1000 }),
        grantRole: true,
        points: 200
    },
    {
        id: 'command_2500',
        title: 'Command Master',
        description: 'Run 2,500 bot commands',
        emoji: '🛠️',
        category: 'command',
        rarity: 'epic',
        checkType: 'threshold',
        criteria: JSON.stringify({ commandCount: 2500 }),
        grantRole: true,
        points: 400
    },
    {
        id: 'command_5000',
        title: 'Command Virtuoso',
        description: 'Run 5,000 bot commands',
        emoji: '⚡',
        category: 'command',
        rarity: 'legendary',
        checkType: 'threshold',
        criteria: JSON.stringify({ commandCount: 5000 }),
        grantRole: true,
        points: 750
    },
    {
        id: 'command_10000',
        title: 'Command Deity',
        description: 'Run 10,000 bot commands',
        emoji: '💎',
        category: 'command',
        rarity: 'mythic',
        checkType: 'threshold',
        criteria: JSON.stringify({ commandCount: 10000 }),
        grantRole: true,
        points: 1000
    },
    {
        id: 'command_explorer',
        title: 'Command Explorer',
        description: 'Use 50 different bot commands',
        emoji: '🗺️',
        category: 'command',
        rarity: 'rare',
        checkType: 'special',
        criteria: JSON.stringify({ type: 'unique_commands', count: 50 }),
        grantRole: false,
        points: 150
    },

    // ==================== SPECIAL/RARE ACHIEVEMENTS (12) ====================
    {
        id: 'special_first_message',
        title: 'Pioneer',
        description: 'Send the first message in the server',
        emoji: '🏁',
        category: 'special',
        rarity: 'legendary',
        checkType: 'special',
        criteria: JSON.stringify({ type: 'first_message' }),
        grantRole: true,
        points: 500
    },
    {
        id: 'special_first_voice',
        title: 'Voice Pioneer',
        description: 'Be the first to join voice in the server',
        emoji: '🎤',
        category: 'special',
        rarity: 'legendary',
        checkType: 'special',
        criteria: JSON.stringify({ type: 'first_voice' }),
        grantRole: true,
        points: 500
    },
    {
        id: 'special_perfect_week',
        title: 'Perfect Week',
        description: 'Be active in all 168 hours of a week',
        emoji: '📆',
        category: 'special',
        rarity: 'epic',
        checkType: 'special',
        criteria: JSON.stringify({ type: 'perfect_week', hours: 168 }),
        grantRole: false,
        points: 400
    },
    {
        id: 'special_perfect_month',
        title: 'Perfect Month',
        description: 'Be active every single day for an entire month (30 days)',
        emoji: '📅',
        category: 'special',
        rarity: 'legendary',
        checkType: 'special',
        criteria: JSON.stringify({ type: 'perfect_month', days: 30 }),
        grantRole: true,
        points: 600
    },
    {
        id: 'special_comeback_kid',
        title: 'Comeback Kid',
        description: 'Return after 30+ days of inactivity and rebuild a 7-day streak',
        emoji: '🔄',
        category: 'special',
        rarity: 'rare',
        checkType: 'special',
        criteria: JSON.stringify({ type: 'comeback', inactiveDays: 30, newStreak: 7 }),
        grantRole: false,
        points: 150
    },
    {
        id: 'special_freeze_master',
        title: 'Freeze Master',
        description: 'Use 12 streak freezes',
        emoji: '❄️',
        category: 'special',
        rarity: 'rare',
        checkType: 'special',
        criteria: JSON.stringify({ type: 'freeze_count', count: 12 }),
        grantRole: false,
        points: 100
    },
    {
        id: 'special_early_adopter',
        title: 'Early Adopter',
        description: 'Join the server within its first week',
        emoji: '🌟',
        category: 'special',
        rarity: 'epic',
        checkType: 'special',
        criteria: JSON.stringify({ type: 'early_adopter', days: 7 }),
        grantRole: true,
        points: 250
    },
    {
        id: 'special_anniversary_1y',
        title: 'First Anniversary',
        description: 'Be active on the server\'s 1-year anniversary',
        emoji: '🎂',
        category: 'special',
        rarity: 'epic',
        checkType: 'special',
        criteria: JSON.stringify({ type: 'server_anniversary', years: 1 }),
        grantRole: true,
        points: 300
    },
    {
        id: 'special_anniversary_2y',
        title: 'Second Anniversary',
        description: 'Be active on the server\'s 2-year anniversary',
        emoji: '🎉',
        category: 'special',
        rarity: 'legendary',
        checkType: 'special',
        criteria: JSON.stringify({ type: 'server_anniversary', years: 2 }),
        grantRole: true,
        points: 500
    },
    {
        id: 'special_weekend_warrior',
        title: 'Weekend Warrior',
        description: 'Be more active on weekends than weekdays for 4 weeks',
        emoji: '🎮',
        category: 'special',
        rarity: 'uncommon',
        checkType: 'special',
        criteria: JSON.stringify({ type: 'weekend_warrior', weeks: 4 }),
        grantRole: false,
        points: 75
    },
    {
        id: 'special_midnight_caller',
        title: 'Midnight Caller',
        description: 'Send 100 messages within 1 minute of midnight (23:59-00:01)',
        emoji: '🕛',
        category: 'special',
        rarity: 'rare',
        checkType: 'special',
        criteria: JSON.stringify({ type: 'midnight_messages', count: 100 }),
        grantRole: false,
        points: 125
    },
    {
        id: 'special_jack_of_all_trades',
        title: 'Jack of All Trades',
        description: 'Reach milestones in all activity types (message, voice, commands)',
        emoji: '🎯',
        category: 'special',
        rarity: 'epic',
        checkType: 'special',
        criteria: JSON.stringify({ type: 'all_milestones', messages: 5000, voice: 100, commands: 500 }),
        grantRole: true,
        points: 500
    },

    // ==================== SOCIAL ACHIEVEMENTS (8) ====================
    {
        id: 'social_bytepod_creator',
        title: 'BytePod Creator',
        description: 'Create your first BytePod',
        emoji: '🎙️',
        category: 'social',
        rarity: 'common',
        checkType: 'threshold',
        criteria: JSON.stringify({ bytepodsCreated: 1 }),
        grantRole: false,
        points: 10
    },
    {
        id: 'social_bytepod_host',
        title: 'BytePod Host',
        description: 'Create 50 BytePods',
        emoji: '🎙️',
        category: 'social',
        rarity: 'uncommon',
        checkType: 'threshold',
        criteria: JSON.stringify({ bytepodsCreated: 50 }),
        grantRole: false,
        points: 100
    },
    {
        id: 'social_bytepod_master',
        title: 'BytePod Master',
        description: 'Create 200 BytePods',
        emoji: '🎙️',
        category: 'social',
        rarity: 'rare',
        checkType: 'threshold',
        criteria: JSON.stringify({ bytepodsCreated: 200 }),
        grantRole: true,
        points: 300
    },
    {
        id: 'social_bookmark_collector',
        title: 'Bookmark Collector',
        description: 'Save 100 bookmarks',
        emoji: '🔖',
        category: 'social',
        rarity: 'uncommon',
        checkType: 'special',
        criteria: JSON.stringify({ type: 'bookmarks_saved', count: 100 }),
        grantRole: false,
        points: 75
    },
    {
        id: 'social_media_archivist',
        title: 'Media Archivist',
        description: 'Save 500 media items to the gallery',
        emoji: '📸',
        category: 'social',
        rarity: 'rare',
        checkType: 'special',
        criteria: JSON.stringify({ type: 'media_saved', count: 500 }),
        grantRole: true,
        points: 250
    },
    {
        id: 'social_suggestion_maker',
        title: 'Suggestion Maker',
        description: 'Submit 10 suggestions',
        emoji: '💡',
        category: 'social',
        rarity: 'common',
        checkType: 'special',
        criteria: JSON.stringify({ type: 'suggestions_made', count: 10 }),
        grantRole: false,
        points: 50
    },
    {
        id: 'social_birthday_sharer',
        title: 'Birthday Sharer',
        description: 'Add your birthday to the server',
        emoji: '🎂',
        category: 'social',
        rarity: 'common',
        checkType: 'special',
        criteria: JSON.stringify({ type: 'birthday_set' }),
        grantRole: false,
        points: 25
    },
    {
        id: 'social_template_designer',
        title: 'Template Designer',
        description: 'Create 5 BytePod templates',
        emoji: '📐',
        category: 'social',
        rarity: 'uncommon',
        checkType: 'special',
        criteria: JSON.stringify({ type: 'templates_created', count: 5 }),
        grantRole: false,
        points: 100
    },

    // ==================== COMBO ACHIEVEMENTS (6) ====================
    {
        id: 'combo_balanced_user',
        title: 'Balanced User',
        description: 'Reach 1,000 messages, 100 hours voice, and 500 commands',
        emoji: '⚖️',
        category: 'combo',
        rarity: 'epic',
        checkType: 'combo',
        criteria: JSON.stringify({ messages: 1000, voiceHours: 100, commands: 500 }),
        grantRole: true,
        points: 400
    },
    {
        id: 'combo_super_active',
        title: 'Super Active',
        description: 'Maintain a 30-day streak while having 100 total days',
        emoji: '🚀',
        category: 'combo',
        rarity: 'rare',
        checkType: 'combo',
        criteria: JSON.stringify({ streak: 30, totalDays: 100 }),
        grantRole: true,
        points: 350
    },
    {
        id: 'combo_ultimate_member',
        title: 'Ultimate Member',
        description: 'Reach 10,000 messages, 500 hours voice, and 1,000 commands',
        emoji: '👑',
        category: 'combo',
        rarity: 'legendary',
        checkType: 'combo',
        criteria: JSON.stringify({ messages: 10000, voiceHours: 500, commands: 1000 }),
        grantRole: true,
        points: 1000
    },
    {
        id: 'combo_triple_threat',
        title: 'Triple Threat',
        description: 'Have a 100-day streak, 500 total days, and 5,000 messages',
        emoji: '⚡',
        category: 'combo',
        rarity: 'epic',
        checkType: 'combo',
        criteria: JSON.stringify({ streak: 100, totalDays: 500, messages: 5000 }),
        grantRole: false,
        points: 750
    },
    {
        id: 'combo_consistency_king',
        title: 'Consistency King',
        description: 'Maintain a 180-day streak with 365+ total days',
        emoji: '🔥',
        category: 'combo',
        rarity: 'legendary',
        checkType: 'combo',
        criteria: JSON.stringify({ streak: 180, totalDays: 365 }),
        grantRole: true,
        points: 900
    },
    {
        id: 'combo_endurance_champion',
        title: 'Endurance Champion',
        description: 'Reach 1,000 total days, 50,000 messages, and 1,000 hours voice',
        emoji: '💎',
        category: 'combo',
        rarity: 'mythic',
        checkType: 'combo',
        criteria: JSON.stringify({ totalDays: 1000, messages: 50000, voiceHours: 1000 }),
        grantRole: true,
        points: 2000
    },

    // ==================== META ACHIEVEMENTS (5) ====================
    {
        id: 'meta_achievement_hunter',
        title: 'Achievement Hunter',
        description: 'Unlock 10 achievements',
        emoji: '🏅',
        category: 'meta',
        rarity: 'uncommon',
        checkType: 'meta',
        criteria: JSON.stringify({ achievementCount: 10 }),
        grantRole: false,
        points: 100
    },
    {
        id: 'meta_achievement_master',
        title: 'Achievement Master',
        description: 'Unlock 25 achievements',
        emoji: '🏆',
        category: 'meta',
        rarity: 'rare',
        checkType: 'meta',
        criteria: JSON.stringify({ achievementCount: 25 }),
        grantRole: true,
        points: 300
    },
    {
        id: 'meta_achievement_legend',
        title: 'Achievement Legend',
        description: 'Unlock 50 achievements',
        emoji: '⭐',
        category: 'meta',
        rarity: 'epic',
        checkType: 'meta',
        criteria: JSON.stringify({ achievementCount: 50 }),
        grantRole: true,
        points: 750
    },
    {
        id: 'meta_achievement_god',
        title: 'Achievement God',
        description: 'Unlock 75 achievements',
        emoji: '👑',
        category: 'meta',
        rarity: 'legendary',
        checkType: 'meta',
        criteria: JSON.stringify({ achievementCount: 75 }),
        grantRole: true,
        points: 1500
    },
    {
        id: 'meta_completionist',
        title: 'Completionist',
        description: 'Unlock ALL achievements (excl. custom and seasonal)',
        emoji: '💎',
        category: 'meta',
        rarity: 'mythic',
        checkType: 'meta',
        criteria: JSON.stringify({ achievementCount: 82 }),
        grantRole: true,
        points: 5000
    }
];

/**
 * Seed all core achievement definitions into the database
 */
async function seedAchievements() {
    console.log('🌱 Starting achievement seeding...\n');

    let inserted = 0;
    let skipped = 0;

    for (const achievement of ACHIEVEMENTS) {
        try {
            // Check if achievement already exists
            const existing = sqlite.prepare(
                'SELECT id FROM achievement_definitions WHERE id = ?'
            ).get(achievement.id);

            if (existing) {
                skipped++;
                continue;
            }

            // Insert achievement
            sqlite.prepare(`
                INSERT INTO achievement_definitions (
                    id, title, description, emoji, category, rarity,
                    check_type, criteria, grant_role, points, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                achievement.id,
                achievement.title,
                achievement.description,
                achievement.emoji,
                achievement.category,
                achievement.rarity,
                achievement.checkType,
                achievement.criteria,
                achievement.grantRole ? 1 : 0,
                achievement.points,
                Date.now()
            );

            inserted++;
        } catch (error) {
            console.error(`❌ Failed to insert ${achievement.id}:`, error.message);
        }
    }

    console.log(`\n✅ Seeding complete!`);
    console.log(`   Inserted: ${inserted} achievements`);
    console.log(`   Skipped: ${skipped} achievements (already exist)`);
    console.log(`   Total: ${ACHIEVEMENTS.length} core achievements\n`);

    // Print statistics
    const stats = {
        byCategory: {},
        byRarity: {},
        roleRewards: ACHIEVEMENTS.filter(a => a.grantRole).length
    };

    ACHIEVEMENTS.forEach(a => {
        stats.byCategory[a.category] = (stats.byCategory[a.category] || 0) + 1;
        stats.byRarity[a.rarity] = (stats.byRarity[a.rarity] || 0) + 1;
    });

    console.log('📊 Achievement Statistics:');
    console.log('\n   By Category:');
    Object.entries(stats.byCategory).forEach(([cat, count]) => {
        console.log(`      ${cat}: ${count}`);
    });

    console.log('\n   By Rarity:');
    Object.entries(stats.byRarity).forEach(([rarity, count]) => {
        console.log(`      ${rarity}: ${count}`);
    });

    console.log(`\n   Role Rewards: ${stats.roleRewards}/82 (${Math.round(stats.roleRewards/82*100)}%)\n`);

    sqlite.close();
}

// Run seeding
seedAchievements().catch(error => {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
});
