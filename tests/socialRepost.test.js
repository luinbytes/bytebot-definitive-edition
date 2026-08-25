const command = require('../src/commands/utility/repost');

function interaction(url) {
    return {
        options: { getString: jest.fn().mockReturnValue(url) },
        reply: jest.fn().mockResolvedValue()
    };
}

test('/repost forwards only canonical supported post links without mentions', async () => {
    expect(command.data.toJSON()).toMatchObject({
        name: 'repost',
        description: 'Repost a social media post from a link',
        dm_permission: true,
        options: [expect.objectContaining({ name: 'url', required: true, max_length: 2048 })]
    });
    expect(command.sourceCategories).toEqual(['Socials', 'Utility']);

    const accepted = [
        ['https://www.tiktok.com/@greed/video/123?utm_source=test#fragment', 'https://www.tiktok.com/@greed/video/123'],
        ['https://instagram.com/reel/Ab_C-12/?igsh=test', 'https://www.instagram.com/reel/Ab_C-12/'],
        ['https://twitter.com/greed/status/123456?ref_src=test', 'https://x.com/greed/status/123456']
    ];
    for (const [input, expected] of accepted) {
        const call = interaction(input);
        await command.execute(call);
        expect(call.reply).toHaveBeenCalledWith({ content: expected, allowedMentions: { parse: [] } });
    }

    for (const [input, message] of [
        ['not a url', 'Please provide a valid URL\n-# Example: repost https://www.tiktok.com/@user/video/123'],
        ['https://www.tiktok.com/@greed', 'Please provide a post/video URL\n-# Profile or username lookups are not supported in this command'],
        ['https://example.com/post/123', 'Unsupported platform\n-# Supported: Instagram, TikTok, X/Twitter']
    ]) {
        await expect(command.execute(interaction(input))).rejects.toThrow(message);
    }
});
