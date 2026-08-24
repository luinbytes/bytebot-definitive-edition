describe('Greed-compatible rich content', () => {
    test('renders documented embed scripts with variables and suppressed mentions', () => {
        const { renderScript } = require('../src/services/richContentService');
        const payload = renderScript(
            '{content: Hello {user.mention}}$v{embed}$v{title: Rules}$v{description: Welcome to {guild.name}}',
            { user: { id: '10', username: 'Member' }, guild: { id: '20', name: 'Guild' }, channel: { id: '30', name: 'general' } }
        );

        expect(payload.content).toBe('Hello <@10>');
        expect(payload.embeds[0].toJSON()).toEqual(expect.objectContaining({ title: 'Rules', description: 'Welcome to Guild' }));
        expect(payload.allowedMentions).toEqual({ parse: [], repliedUser: false });
    });

    test('renders content-only scripts as message content rather than directive text', () => {
        const { renderScript } = require('../src/services/richContentService');

        expect(renderScript('{content: Hello there}')).toEqual({
            content: 'Hello there', allowedMentions: { parse: [], repliedUser: false }
        });
    });

    test('renders Components V2 text and link buttons without legacy message fields', () => {
        const { MessageFlags } = require('discord.js');
        const { renderScript } = require('../src/services/richContentService');
        const payload = renderScript('{cv2}{text: Hello {user.mention}}{button: Docs && https://example.com}', {
            user: { id: '10', username: 'Member' }
        });

        expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
        expect(payload).not.toHaveProperty('content');
        expect(payload).not.toHaveProperty('embeds');
        expect(payload.components.map(component => component.toJSON())).toEqual([
            { type: 10, content: 'Hello <@10>' },
            expect.objectContaining({ components: [expect.objectContaining({ type: 2, label: 'Docs', url: 'https://example.com/' })] })
        ]);
    });

    test('renders documented nested Components V2 layouts and custom-script buttons', () => {
        const { renderScript } = require('../src/services/richContentService');
        const payload = renderScript(
            '{cv2}{container: accent: #5865f2 && {text: Rules}{separator: large}{section: {text: Read first}{button: label: Open && custom: rules && style: success}}{gallery: https://example.com/a.png && description: A}}',
            { customScripts: new Set(['rules']) }
        );
        const json = payload.components[0].toJSON();

        expect(json).toEqual(expect.objectContaining({ type: 17, accent_color: 0x5865f2 }));
        expect(json.components.map(component => component.type)).toEqual([10, 14, 9, 12]);
        expect(json.components[2].accessory).toEqual(expect.objectContaining({ custom_id: 'rich:custom:rules', style: 3 }));
        expect(json.components[3].items[0]).toEqual(expect.objectContaining({ media: { url: 'https://example.com/a.png' }, description: 'A' }));
    });

    test('renders explicit action rows and disabled display selects', () => {
        const { renderScript } = require('../src/services/richContentService');
        const payload = renderScript(
            '{cv2}{actionrow: {button: One && https://example.com/1}{button: Two && https://example.com/2}}{select: placeholder: Choose && Alpha: a && Beta: b}'
        );
        const json = payload.components.map(component => component.toJSON());

        expect(json[0].components).toHaveLength(2);
        expect(json[1].components[0]).toEqual(expect.objectContaining({ type: 3, disabled: true, placeholder: 'Choose' }));
        expect(json[1].components[0].options.map(option => option.label)).toEqual(['Alpha', 'Beta']);
    });

    test('rejects legacy embed fields that exceed Discord limits instead of truncating them', () => {
        const { renderScript } = require('../src/services/richContentService');

        expect(() => renderScript(`{embed}$v{title: ${'x'.repeat(257)}}`)).toThrow(/title.*256/i);
    });

    test('rejects Components V2 payloads above Discord total-component and URL limits', () => {
        const { renderScript } = require('../src/services/richContentService');

        expect(() => renderScript(`{cv2}${'{text: x}'.repeat(41)}`)).toThrow(/40 components/i);
        expect(() => renderScript('{cv2}{button: Bad && ftp://example.com}')).toThrow(/URL|HTTP/i);
    });
});
