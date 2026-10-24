jest.mock('../src/database', () => ({ db: {} }));

const { MessageFlags } = require('discord.js');
const help = require('../src/commands/utility/help');

function catalog() {
    const files = [
        ['me', 'utility/me', 'Utility'],
        ['bot', 'developer/bot', 'Developer'],
        ['fun', 'fun/fun', 'Fun'],
        ['economy', 'economy/economy', 'Economy'],
        ['help', 'utility/help', 'Utility'],
        ['avatar', 'utility/avatar', 'Utility'],
        ['deploy', 'developer/deploy', 'Developer']
    ];
    return { commands: new Map(files.map(([name, file, category]) => [
        name, { ...require(`../src/commands/${file}`), category }
    ])) };
}

async function execute(client, command = null) {
    const reply = jest.fn();
    await help.execute({ options: { getString: () => command }, reply }, client);
    return reply.mock.calls[0][0];
}

function text(payload) {
    const embed = payload.embeds[0].toJSON();
    return [embed.title, embed.description, ...(embed.fields || []).flatMap(field => [field.name, field.value])].filter(Boolean).join('\n');
}

test('full reminder paths normalize slash, case, and whitespace and show leaf arguments', async () => {
    const result = await execute(catalog(), ' /ME  reminder\tADD ');
    expect(result.flags).toContain(MessageFlags.Ephemeral);
    expect(text(result)).toContain('/me reminder add');
    for (const value of ['delivery', 'time', 'message', 'required', 'DM', 'dm', 'This Channel', 'channel', '1000']) {
        expect(text(result)).toContain(value);
    }
    expect(text(result)).not.toContain('Command Not Found');
});

async function complete(client, value = '', focus = 'command', user = { id: 'member' }) {
    const respond = jest.fn();
    await help.autocomplete({ options: { getFocused: () => ({ name: focus, value }) }, respond, user }, client);
    expect(respond).toHaveBeenCalledTimes(1);
    return respond.mock.calls[0][0];
}

test('discovery excludes adapters and private operations for every caller', async () => {
    const client = catalog();
    client.commands.set('secret', { devOnly: true, data: { name: 'secret', description: 'Private root' } });
    client.commands.set('menu', { data: { type: 2, name: 'menu' } });
    const bot = text(await execute(client, 'bot'));
    for (const path of ['bot help', 'bot ping', 'bot stats']) expect(bot).toContain(`/${path}`);
    for (const path of ['avatar', 'help', 'deploy', 'secret', 'bot deploy', 'bot unregister', 'bot guild', 'bot achievement check']) {
        expect(text(await execute(client, path))).toContain('Command Not Found');
    }
    expect(bot).toContain('Utility');
    expect(bot).not.toMatch(/deploy|unregister|guild|achievement|developer/i);
    const config = require('../src/utils/config');
    const developers = jest.replaceProperty(config, 'developers', ['developer']);
    try {
        for (const user of [{ id: 'member' }, { id: 'developer' }]) {
            expect(await complete(client, '/BoT ', 'command', user)).toEqual([
                { name: '/bot', value: 'bot' },
                { name: '/bot help', value: 'bot help' },
                { name: '/bot ping', value: 'bot ping' },
                { name: '/bot stats', value: 'bot stats' }
            ]);
        }
    } finally {
        developers.restore();
    }
});

test('autocomplete returns canonical inspectable topics and handles unexpected focus', async () => {
    const client = catalog();
    const choices = await complete(client, ' /ME  rem');
    expect(choices.map(choice => choice.value)).toEqual([
        'me reminder', 'me reminder add', 'me reminder cancel', 'me reminder list', 'me reminder snooze'
    ]);
    for (const choice of choices) {
        expect(text(await execute(client, choice.value))).not.toContain('Command Not Found');
    }
    expect(await complete(client, 'me', 'other')).toEqual([]);
    expect(await complete(client, '/'.repeat(101))).toEqual([]);
});

function buttons(payload) {
    return payload.components[0].toJSON().components;
}

async function click(client, customId) {
    const interaction = {
        customId, isButton: () => true,
        deferUpdate: jest.fn(), editReply: jest.fn(), reply: jest.fn()
    };
    await help.handleInteraction(interaction, client);
    return interaction;
}

function assertBounded(payload) {
    expect(payload.embeds).toHaveLength(1);
    expect(payload.allowedMentions).toEqual({ parse: [] });
    const embed = payload.embeds[0].toJSON();
    expect(embed.title.length).toBeLessThanOrEqual(256);
    expect((embed.description || '').length).toBeLessThanOrEqual(4096);
    expect((embed.footer?.text || '').length).toBeLessThanOrEqual(2048);
    expect(embed.fields?.length || 0).toBeLessThanOrEqual(25);
    const strings = [embed.title, embed.description, embed.footer?.text, embed.author?.name];
    for (const field of embed.fields || []) {
        expect(field.name.length).toBeLessThanOrEqual(256);
        expect(field.value.length).toBeLessThanOrEqual(1024);
        strings.push(field.name, field.value);
    }
    expect(strings.filter(Boolean).reduce((sum, item) => sum + item.length, 0)).toBeLessThanOrEqual(6000);
    expect(embed.footer.text).toContain('/bot help');
    const controls = payload.components?.flatMap(row => row.toJSON().components) || [];
    expect(new Set(controls.map(control => control.custom_id)).size).toBe(controls.length);
    for (const button of controls) {
        expect(button.custom_id.length).toBeLessThanOrEqual(100);
        expect(button.label.length).toBeLessThanOrEqual(80);
        expect(button.custom_id).toMatch(/^help_page_/);
    }
}

async function allPages(client, command = null) {
    const pages = [await execute(client, command)];
    const seen = new Set();
    expect(buttons(pages[0])[0].disabled).toBe(true);
    while (!buttons(pages.at(-1))[2].disabled) {
        expect(pages.length).toBeLessThan(1000);
        const id = buttons(pages.at(-1))[2].custom_id;
        expect(seen.has(id)).toBe(false);
        seen.add(id);
        const interaction = await click(client, id);
        expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
        expect(interaction.editReply).toHaveBeenCalledTimes(1);
        expect(interaction.reply).not.toHaveBeenCalled();
        pages.push(interaction.editReply.mock.calls[0][0]);
        expect(buttons(pages.at(-1))[0].disabled).toBe(false);
    }
    pages.forEach(assertBounded);
    return pages;
}

test('browse pagination is public, covers real leaves, and has no adapter or private operation leaks', async () => {
    const client = catalog();
    const pages = await allPages(client);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0].flags).toBeUndefined();
    const output = pages.map(text).join('\n');
    expect(output).toContain('4 registered roots');
    for (const value of ['/me reminder add', '/me bookmark search', '/fun uwuify', '/economy game coinflip', '/bot stats']) {
        expect(output).toContain(value);
    }
    expect(output).not.toMatch(/\/avatar|\/help|\/deploy|\/bot (?:deploy|guild|achievement|unregister)/);
    const previous = await click(client, buttons(pages[1])[0].custom_id);
    expect(text(previous.editReply.mock.calls[0][0])).toBe(text(pages[0]));
    const overview = await click(client, buttons(pages.at(-1))[3].custom_id);
    expect(text(overview.editReply.mock.calls[0][0])).toBe(text(pages[0]));
});

test.each([
    'help_page_indicator', 'help_page_0', 'help_page_-1', 'help_page_1junk',
    'help_page_1.0', 'help_page_+1', 'help_page_1e2', 'help_page_9999999999999999999999999',
    'help_page_v2_0123456789abcdef_0_0', 'help_page_v1_0123456789abcdef_0_0',
    'help_page_v1_0123456789abcdef_0_', 'help_page_' + 'x'.repeat(101)
])('malformed or stale cursor %s gets one private restart reply', async customId => {
    const interaction = await click(catalog(), customId);
    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    const result = interaction.reply.mock.calls[0][0];
    expect(result.flags).toContain(MessageFlags.Ephemeral);
    expect(text(result)).toContain('Run /bot help again');
    assertBounded(result);
});

test('current revisions still reject missing views and out-of-range pages and become stale after schema changes', async () => {
    const client = catalog();
    const first = await execute(client);
    const current = buttons(first)[2].custom_id;
    for (const id of [current.replace(/_\d+_\d+$/, '_999999999_0'), current.replace(/_\d+$/, '_999999999'), ...['01', '-1', '1junk', '1.0', '+1', '1e2', '9007199254740992'].map(page => current.replace(/_\d+$/, `_${page}`))]) {
        expect((await click(client, id)).reply).toHaveBeenCalledTimes(1);
    }
    client.commands.delete('fun');
    expect((await click(client, current)).reply).toHaveBeenCalledTimes(1);
});

test('empty catalogs do not invent routes and remain bounded', async () => {
    const client = { commands: new Map() };
    const pages = await allPages(client);
    expect(pages).toHaveLength(1);
    expect(text(pages[0])).toContain('0 registered roots • 0 runnable paths • 0 categories');
    expect(text(pages[0])).toContain('No commands available');
    expect(text(pages[0])).not.toMatch(/\/me|\/economy|\/bot (?:ping|stats)/);
    expect(await complete(client)).toEqual([]);
});

test('bookmark bounds, optional arguments, root arguments, and browse topics stay distinct', async () => {
    const client = catalog();
    const search = text(await execute(client, 'me bookmark search'));
    for (const value of ['query', 'required', 'Minimum length: 2', 'Maximum length: 100']) expect(search).toContain(value);
    expect(text(await execute(client, 'me bookmark list'))).toContain('optional • Integer');
    expect(text(await execute(client, 'me bookmark view'))).toContain('Minimum value: 1');
    for (const path of ['me', 'me reminder', 'me bookmark']) {
        const output = text(await execute(client, path));
        expect(output).toContain('Browse topic');
        expect(output).not.toContain('\nUsage\n');
        expect(output).not.toContain('Argument:');
    }
    client.commands.set('standalone', {
        data: { name: 'standalone', description: 'A standalone command', options: [
            { type: 10, name: 'amount', description: 'A number', min_value: 0, max_value: 5 },
            { type: 7, name: 'channel', description: 'A channel', channel_types: [0, 2] },
            { type: 3, name: 'name', description: 'An optional name', autocomplete: true }
        ] }
    });
    const standalone = text(await execute(client, 'standalone'));
    for (const value of ['Usage\n/standalone', 'Other', 'optional • Number', 'Minimum value: 0', 'Maximum value: 5', 'Channel types: 0, 2', 'Autocomplete available.']) {
        expect(standalone).toContain(value);
    }
    for (const path of ['me reminder add delivery', 'me unknown', '//me', '@everyone', 'me/'.repeat(50)]) {
        const result = await execute(client, path);
        expect(result.flags).toContain(MessageFlags.Ephemeral);
        expect(text(result)).toContain('Command Not Found');
        expect(text(result)).not.toContain(path);
        assertBounded(result);
    }
});

test('compatibility, provider availability, and policy facts survive pagination without internal parity copy', async () => {
    const client = catalog();
    const fun = (await allPages(client, 'fun')).map(text).join('\n');
    for (const fact of ['10 entries', '15 minutes', 'global self-protection', '40 provider-backed', 'fuck', 'spank', 'nutkick', 'howgay', 'pp', 'bitches', 'nword', 'nwordlb', 'policy-excluded']) {
        expect(fun).toContain(fact);
    }
    const economy = (await allPages(client, 'economy')).map(text).join('\n');
    for (const fact of ['`bal`', '/economy balance', '/economy game', '10–1,000,000', 'ByteBot-owned', 'gang owner/admin']) {
        expect(economy.toLowerCase()).toContain(fact.toLowerCase());
    }
    const overview = (await allPages(client)).map(text).join('\n');
    for (const fact of ['Unavailable provider features', 'persistent social feeds/downloads', 'Rolimons', 'Valorant', 'Minecraft', 'Spotify', 'Reddit', 'YouTube', 'Telegram', 'bio providers']) {
        expect(overview).toContain(fact);
    }
    expect([fun, economy, overview].join('\n')).not.toMatch(/parity|evidence gaps|#56|legacy commands remain available/i);
});

function largeCatalog() {
    const root = 'r'.repeat(32);
    const group = 'g'.repeat(32);
    const options = Array.from({ length: 25 }, (_, index) => ({
        type: 1, name: `leaf${String(index).padStart(2, '0')}`.padEnd(32, 'x'),
        description: `Leaf ${index} ${'🐟'.repeat(40)}`,
        options: Array.from({ length: 25 }, (_, argument) => ({
            type: 3, name: `argument${argument}`, description: `Description ${argument} ${'🐟'.repeat(40)}`,
            required: true, min_length: 0, max_length: 6000,
            choices: Array.from({ length: 25 }, (_, choice) => ({
                name: `Label ${argument}-${choice} ${'🐟'.repeat(30)}`,
                value: `value-${argument}-${choice}-${'v'.repeat(65)}`
            }))
        }))
    }));
    return {
        root, group, options,
        client: { commands: new Map([[root, { data: { name: root, description: 'Large schema', options: [
            { type: 2, name: group, description: 'A large group', options }
        ] } }]]) }
    };
}

test('large schema pages retain every option, description, choice, and canonical path within Discord limits', async () => {
    const { client, root, group, options } = largeCatalog();
    const browse = (await allPages(client)).map(text).join('\n');
    for (const leaf of options) expect(browse).toContain(`/${root} ${group} ${leaf.name}`);
    const path = `${root} ${group} ${options[0].name}`;
    expect(path.length).toBe(98);
    const pages = await allPages(client, path);
    expect(pages.length).toBeGreaterThan(10);
    const fields = pages.flatMap(page => page.embeds[0].toJSON().fields);
    const values = fields.map(field => field.value).join('');
    for (const option of options[0].options) {
        const optionFields = fields.filter(field => field.name === `Argument: ${option.name}` || field.name === `Argument: ${option.name} (continued)`);
        const content = optionFields.map(field => field.value).join('');
        expect(content).toContain(option.description);
        for (const choice of option.choices) expect(content.split(`${choice.name}: ${choice.value}`).length - 1).toBe(1);
    }
    expect(values).not.toContain('\uFFFD');
    for (const field of fields) expect(field.value).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
    const choices = await complete(client);
    expect(choices).toHaveLength(25);
    expect(new Set(choices.map(choice => choice.value)).size).toBe(25);
    for (const choice of choices) {
        expect(choice.name.length).toBeLessThanOrEqual(100);
        expect(choice.value.length).toBeLessThanOrEqual(100);
        expect(text(await execute(client, choice.value))).not.toContain('Command Not Found');
    }
}, 30000);

test('every registered public schema path and leaf option remains reachable', async () => {
    const path = require('path');
    const { globSync } = require('glob');
    const commands = new Map();
    for (const file of globSync('src/commands/**/!(context-menus)/*.js')) {
        const command = require(path.resolve(file));
        const folder = path.basename(path.dirname(file));
        commands.set(command.data.name, {
            ...command, category: folder === 'lastfm' ? 'LastFM' : folder[0].toUpperCase() + folder.slice(1)
        });
    }
    const client = { commands };
    const expected = [];
    for (const command of commands.values()) {
        if (command.register === false || command.devOnly) continue;
        const schema = command.data.toJSON();
        if (schema.type !== undefined && schema.type !== 1) continue;
        function inspect(node, tokens) {
            if (node.options?.some(option => [1, 2].includes(option.type))) {
                node.options.filter(option => [1, 2].includes(option.type)).forEach(child => inspect(child, [...tokens, child.name]));
            } else if (schema.name !== 'bot' || ['help', 'ping', 'stats'].includes(tokens.slice(1).join(' '))) {
                expected.push({ path: tokens.join(' '), options: node.options || [] });
            }
        }
        inspect(schema, [schema.name]);
    }
    const overview = (await allPages(client)).map(text).join('\n');
    expect(expected.length).toBeGreaterThan(100);
    expect(overview).toContain(`${expected.length} runnable paths`);
    const advertised = overview.split('\n').filter(line => line.startsWith('/'));
    expect(advertised.sort()).toEqual(expected.map(leaf => `/${leaf.path}`).sort());
    for (const leaf of expected) {
        const pages = await allPages(client, leaf.path);
        expect(pages[0].flags).toContain(MessageFlags.Ephemeral);
        const fields = pages.flatMap(page => page.embeds[0].toJSON().fields);
        for (const option of leaf.options) {
            const content = fields.filter(field => field.name === `Argument: ${option.name}` || field.name === `Argument: ${option.name} (continued)`)
                .map(field => field.value).join('');
            expect(content).toContain(option.description);
            expect(content).toContain(option.required ? 'required' : 'optional');
            for (const choice of option.choices || []) expect(content).toContain(`${choice.name}: ${choice.value}`);
            for (const [key, label] of Object.entries({ min_value: 'Minimum value', max_value: 'Maximum value', min_length: 'Minimum length', max_length: 'Maximum length' })) {
                if (option[key] !== undefined) expect(content).toContain(`${label}: ${option[key]}`);
            }
        }
    }
    for (const publicPath of [
        '/fun uwuify', '/fun uwulock add', '/image effect apply', '/fun snipe protect',
        '/fun roleplay action', '/fun game blacktea', '/server security antinuke-settings',
        '/server antiraid settings', '/server automod filter', '/ticket setup',
        '/giveaway start', '/counter add', '/economy balance', '/economy game coinflip',
        '/lookup weather', '/repost', '/ai ocr', '/ai tts', '/server role info',
        '/reactionrole add', '/server backup create', '/mod user warn'
    ]) expect(overview).toContain(publicPath);
}, 60000);

test('catalog ordering and cursors are stable across insertion order and unknown categories', async () => {
    const commands = new Map([
        ['z', { category: 'Zebra', data: { name: 'z', description: 'Zebra command' } }],
        ['a', { category: 'Alpha', data: { name: 'a', description: 'Alpha command' } }],
        ['u', { category: 'Utility', data: { name: 'u', description: 'Utility command' } }]
    ]);
    const first = await execute({ commands });
    const second = await execute({ commands: new Map([...commands].reverse()) });
    expect(text(second)).toBe(text(first));
    expect(buttons(second)).toEqual(buttons(first));
    const output = text(first);
    expect(output.indexOf('/u')).toBeLessThan(output.indexOf('/a'));
    expect(output.indexOf('/a')).toBeLessThan(output.indexOf('/z'));
});

test('text compatibility aliases only describe paths present in the current schemas', async () => {
    const client = { commands: new Map([['levels', require('../src/commands/utility/levels')]]) };
    const output = (await allPages(client)).map(text).join('\n');
    for (const value of ['`level`', '`rank`', '`xp`', '`lvl`', '`levels lb`', '`levels top`', '`rankcard`', '`rc`', '`rankcard colour`', '`rankcard accent`']) {
        expect(output).toContain(value);
    }
    expect((await allPages({ commands: new Map() })).map(text).join('\n')).not.toContain('/levels');
});
