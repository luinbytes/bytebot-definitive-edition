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
    const moreCommonPaths = response.embeds[0].data.fields.find(field => field.name === 'More Common Paths');
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
    expect(commonPaths.value).toContain('/image effect apply');
    expect(commonPaths.value).toContain('/fun snipe protect');
    expect(commonPaths.value).toContain('/fun roleplay action');
    expect(commonPaths.value).toContain('/fun game blacktea');
    expect(commonPaths.value).toContain('/server security antinuke-settings');
    expect(commonPaths.value).toContain('/server antiraid settings');
    expect(commonPaths.value).toContain('/server automod filter');
    expect(commonPaths.value).toContain('/ticket setup');
    expect(commonPaths.value).toContain('/giveaway start');
    expect(commonPaths.value).toContain('/counter add');
    expect(commonPaths.value).toContain('/economy balance');
    expect(commonPaths.value).toContain('/economy game coinflip');
    expect(moreCommonPaths.value).toContain('/lookup weather');
    expect(moreCommonPaths.value).toContain('/repost');
    expect(moreCommonPaths.value).toContain('/ai ocr');
    expect(moreCommonPaths.value).toContain('/ai tts');
    expect(moreCommonPaths.value).toContain('/server role info');
    expect(parityField.value).toContain('/lookup` Information, Utility');
    expect(parityField.value).toContain('/repost` Socials, Utility');
    expect(parityField.value).toContain('/ai` Information, Utility');
    expect(moreCommonPaths.value).toContain('/reactionrole add');
    expect(moreCommonPaths.value).toContain('/server backup create');
    expect(moreCommonPaths.value).toContain('/mod user warn');
    expect(parityField.value).toContain('/economy` Economy');
    expect(parityField.value).toContain('/image` Manipulation');
    expect(parityField.value).toContain('/ticket` Tickets');
    expect(parityField.value).toContain('Provider-blocked');
    expect(parityField.value).toContain('Rolimons');
    expect(parityField.value).toContain('Valorant');
});

test('/bot help records bounded snipe and terminal policy mappings', async () => {
    const reply = jest.fn();
    const fun = require('../src/commands/fun/fun');
    fun.category = 'Fun';
    await help.execute({ options: { getString: () => 'fun' }, reply }, {
        commands: new Map([['fun', fun]])
    });

    const field = reply.mock.calls[0][0].embeds[0].data.fields
        .find(item => item.name === 'Public parity and safety');
    expect(field.value).toContain('10 entries');
    expect(field.value).toContain('40 provider-backed');
    expect(field.value).toContain('policy-excluded');
});

test('/bot help records the Greed bal compatibility mapping', async () => {
    const reply = jest.fn();
    const economy = require('../src/commands/economy/economy');
    economy.category = 'Economy';
    const interaction = {
        options: { getString: jest.fn().mockReturnValue('economy') },
        reply
    };

    await help.execute(interaction, { commands: new Map([['economy', economy]]) });

    const compatibility = reply.mock.calls[0][0].embeds[0].data.fields
        .find(field => field.name === 'Compatibility');
    expect(compatibility.value).toContain('`bal`');
    expect(compatibility.value).toContain('/economy balance');
    expect(compatibility.value).toContain('/economy game');
    expect(compatibility.value).toContain('ByteBot-owned');
});
