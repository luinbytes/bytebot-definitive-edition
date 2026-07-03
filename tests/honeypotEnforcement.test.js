const { PermissionFlagsBits } = require('discord.js');

jest.mock('../src/database', () => ({
    db: {
        select: jest.fn(),
        insert: jest.fn()
    }
}));

jest.mock('../src/utils/logger', () => ({
    warn: jest.fn(),
    error: jest.fn()
}));

jest.mock('../src/utils/embeds', () => ({
    brand: jest.fn(() => ({
        setDescription: jest.fn().mockReturnThis(),
        addFields: jest.fn().mockReturnThis(),
        setFooter: jest.fn().mockReturnThis()
    })),
    warn: jest.fn(() => ({}))
}));

const { db } = require('../src/database');
const { handleHoneypotMessage, DELETE_MESSAGE_SECONDS } = require('../src/utils/honeypotUtil');

function chain(result) {
    return {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn(() => result),
        all: jest.fn(() => Array.isArray(result) ? result : [])
    };
}

function insertChain() {
    return {
        values: jest.fn()
    };
}

function message(overrides = {}) {
    const ban = jest.fn();
    return {
        id: 'msg1',
        channelId: 'danger1',
        content: 'free nitro https://bad.example',
        system: false,
        webhookId: null,
        delete: jest.fn(),
        attachments: new Map(),
        author: {
            id: 'user1',
            bot: false,
            tag: 'Spammer#0001',
            username: 'Spammer',
            createdAt: new Date('2026-01-01T00:00:00Z')
        },
        member: {
            displayName: 'Spammer',
            joinedAt: new Date('2026-02-01T00:00:00Z'),
            permissions: { has: jest.fn(() => false) },
            roles: { cache: new Map() },
            ban
        },
        guild: {
            id: 'guild1',
            ownerId: 'owner1',
            channels: { fetch: jest.fn(() => null) },
            members: { fetch: jest.fn() }
        },
        client: { user: { id: 'bot1' } },
        ...overrides,
        _ban: ban
    };
}

describe('Honeypot enforcement behavior', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('deletes exempt messages without banning', async () => {
        const msg = message();
        msg.member.permissions.has.mockImplementation(permission => permission === PermissionFlagsBits.ManageMessages);
        db.select
            .mockReturnValueOnce(chain({ guildId: 'guild1', channelId: 'danger1', enabled: true }))
            .mockReturnValue(chain(null));

        const handled = await handleHoneypotMessage(msg);

        expect(handled).toBe(true);
        expect(msg.delete).toHaveBeenCalled();
        expect(msg._ban).not.toHaveBeenCalled();
    });

    test('bans non-exempt members and deletes recent messages', async () => {
        const msg = message();
        db.select
            .mockReturnValueOnce(chain({ guildId: 'guild1', channelId: 'danger1', enabled: true, shameBoardMessageId: null }))
            .mockReturnValueOnce(chain(null))
            .mockReturnValueOnce(chain([]))
            .mockReturnValue(chain([]));
        db.insert.mockReturnValue(insertChain());

        const handled = await handleHoneypotMessage(msg);

        expect(handled).toBe(true);
        expect(msg.delete).toHaveBeenCalled();
        expect(msg._ban).toHaveBeenCalledWith(expect.objectContaining({
            deleteMessageSeconds: DELETE_MESSAGE_SECONDS,
            reason: expect.stringContaining('Honeypot trap triggered')
        }));
        expect(db.insert).toHaveBeenCalledTimes(2);
    });
});
