const interactionCreate = require('../src/events/interactionCreate');

describe('Join DM Server Info interaction', () => {
    const button = userId => ({
        id: `interaction-${userId}`,
        customId: 'join_dm:info:guild1:user1',
        user: { id: userId },
        isButton: () => true,
        reply: jest.fn()
    });
    const client = { guilds: { cache: new Map([['guild1', { id: 'guild1', name: 'Guild', memberCount: 42 }]]) } };

    test('only the original recipient can open the button', async () => {
        const other = button('user2');
        await interactionCreate.execute(other, client);
        expect(other.reply.mock.calls[0][0].content).toContain('belongs to another member');

        const recipient = button('user1');
        await interactionCreate.execute(recipient, client);
        expect(recipient.reply.mock.calls[0][0].embeds[0].data.description).toContain('Members: **42**');
    });
});
