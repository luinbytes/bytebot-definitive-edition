const community = require('../src/commands/utility/community');

function createInteraction({ customId } = {}) {
    const reply = jest.fn();
    const editReply = jest.fn();

    return {
        customId,
        isButton: jest.fn(() => Boolean(customId)),
        reply,
        editReply,
        deferUpdate: jest.fn(),
        replyPayload: () => reply.mock.calls[0]?.[0],
        editReplyPayload: () => editReply.mock.calls[0]?.[0]
    };
}

describe('community hub interaction', () => {
    test('offers the member community destinations in a safe initial response', async () => {
        const interaction = createInteraction();

        await community.execute(interaction);

        const payload = interaction.replyPayload();
        const embed = payload.embeds[0].toJSON();
        const buttonIds = payload.components[0].components.map(button => button.data.custom_id);

        expect(community.data.toJSON().name).toBe('community');
        expect(payload.flags).toBeDefined();
        expect(embed.title).toContain('Community Hub');
        expect(embed.fields.map(field => field.name)).toEqual(expect.arrayContaining([
            'Your Progress',
            'Community Features',
            'Explore'
        ]));
        const destinations = embed.fields.map(field => field.value).join('\n');
        expect(destinations).toEqual(expect.stringContaining('/me achievement progress'));
        expect(destinations).toEqual(expect.stringContaining('achievement chains'));
        expect(destinations).toEqual(expect.stringContaining('/me achievement browse'));
        expect(destinations).toEqual(expect.stringContaining('/me streak view'));
        expect(destinations).toEqual(expect.stringContaining('/pod panel'));
        expect(destinations).toEqual(expect.stringContaining('/me birthday view'));
        expect(destinations).toEqual(expect.stringContaining('/me reminder list'));
        expect(destinations).toEqual(expect.stringContaining('/server suggestion submit'));
        expect(destinations).toEqual(expect.stringContaining('/server suggestion list'));
        expect(destinations).toEqual(expect.stringContaining('/me bookmark list'));
        expect(destinations).toEqual(expect.stringContaining('Starboard'));
        expect(buttonIds).toContain('community_page_starboard');
        expect(destinations).toEqual(expect.stringContaining('/game f1 schedule'));
        expect(destinations).toEqual(expect.stringContaining('/server stats'));
        expect(destinations).not.toEqual(expect.stringContaining('/server starboard top'));
        expect(destinations).not.toEqual(expect.stringContaining('/server achievement view'));
        expect(buttonIds).toEqual(expect.arrayContaining(['community_page_progress', 'community_page_community', 'community_page_starboard', 'community_page_explore']));
    });

    test('renders a destination page through the button interaction seam', async () => {
        const interaction = createInteraction({ customId: 'community_page_progress' });

        await community.handleInteraction(interaction);

        const payload = interaction.editReplyPayload();
        const embed = payload.embeds[0].toJSON();

        expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
        expect(embed.title).toContain('Your Progress');
        expect(embed.fields.map(field => field.value).join('\n')).toEqual(expect.stringContaining('/me streak view'));
        expect(embed.fields.map(field => field.value).join('\n')).toEqual(expect.stringContaining('/me achievement progress'));
    });

    test('keeps every member destination public and avoids admin-only server paths', async () => {
        const pageIds = ['community_page_progress', 'community_page_community', 'community_page_explore'];
        const destinations = [];

        for (const customId of pageIds) {
            const interaction = createInteraction({ customId });
            await community.handleInteraction(interaction);
            destinations.push(...interaction.editReplyPayload().embeds[0].toJSON().fields.map(field => field.value));
        }

        const allDestinations = destinations.join('\n');
        expect(allDestinations).toEqual(expect.stringContaining('/server suggestion submit'));
        expect(allDestinations).toEqual(expect.stringContaining('/server suggestion list'));
        expect(allDestinations).toEqual(expect.stringContaining('/server birthday upcoming'));
        expect(allDestinations).not.toEqual(expect.stringContaining('/server starboard top'));
        expect(allDestinations).not.toEqual(expect.stringContaining('/server achievement view'));
    });

    test('rejects unavailable navigation destinations with a safe private response', async () => {
        const interaction = createInteraction({ customId: 'community_page_unknown' });

        await community.handleInteraction(interaction);

        const payload = interaction.replyPayload();
        expect(interaction.deferUpdate).not.toHaveBeenCalled();
        expect(payload.flags).toBeDefined();
        expect(payload.embeds[0].toJSON().title).toContain('Destination Unavailable');
    });
});
