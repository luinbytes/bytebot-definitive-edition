const embeds = require('../src/utils/embeds');
const config = require('../config.json');

describe('Embed Utility Framework', () => {
    test('base embed should have brand color and footer', () => {
        const embed = embeds.base('Title', 'Description');
        const data = embed.toJSON();

        expect(data.color).toBe(parseInt(config.brand.color.replace('#', ''), 16));
        expect(data.footer.text).toBe(config.brand.name);
    });

    test('success embed should have success color', () => {
        const embed = embeds.success('Title', 'Description');
        const data = embed.toJSON();

        expect(data.color).toBe(parseInt(config.colors.success.replace('#', ''), 16));
        expect(data.title).toContain('✅');
    });

    test('error embed should have error color', () => {
        const embed = embeds.error('Title', 'Description');
        const data = embed.toJSON();

        expect(data.color).toBe(parseInt(config.colors.error.replace('#', ''), 16));
        expect(data.title).toContain('❌');
    });
});
