const help = require('../src/commands/utility/help');

test('/bot help discovers every public Greed category without advertising unfinished commands', async () => {
    const reply = jest.fn();
    const interaction = {
        options: { getString: jest.fn().mockReturnValue(null) },
        reply
    };
    const client = {
        commands: new Map(),
        user: { displayAvatarURL: jest.fn().mockReturnValue('https://example.com/avatar.png') }
    };

    await help.execute(interaction, client);

    const response = reply.mock.calls[0][0];
    const parityField = response.embeds[0].data.fields.find(field => field.name === 'Public Parity Map');
    const commonPaths = response.embeds[0].data.fields.find(field => field.name === 'Common Paths');
    const publicCategories = [
        'Auto', 'Economy', 'Fun', 'Information', 'LastFM', 'Levels', 'Logs',
        'Manipulation', 'Moderation', 'Roleplay', 'Security', 'Server', 'Settings',
        'Snipe', 'Socials', 'Utility', 'Voice', 'Boosters', 'Developer', 'Music'
    ];

    expect(parityField.value).toContain('planned');
    publicCategories.forEach(category => expect(parityField.value).toContain(category));
    expect(parityField.value.length).toBeLessThanOrEqual(1024);
    expect(commonPaths.value).toContain('/fun uwuify');
    expect(commonPaths.value).toContain('/fun uwulock add');
    expect(commonPaths.value).toContain('/server security antinuke-settings');
    expect(commonPaths.value).toContain('/server antiraid settings');
    expect(commonPaths.value).toContain('/server automod filter');
    expect(commonPaths.value).toContain('/ticket setup');
    expect(commonPaths.value).toContain('/giveaway start');
    expect(commonPaths.value).toContain('/counter add');
    expect(commonPaths.value).toContain('/economy balance');
    expect(parityField.value).toContain('/economy` Economy');
    expect(parityField.value).toContain('/ticket` Tickets');
});
