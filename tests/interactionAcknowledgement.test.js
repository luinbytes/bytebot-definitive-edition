const fs = require('fs');
const path = require('path');

function readFile(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function functionBody(source, name) {
    const start = source.indexOf(`async function ${name}`);
    const next = source.indexOf('\n/**', start);
    return source.slice(start, next === -1 ? undefined : next);
}

describe('Interaction acknowledgement timing', () => {
    test('central handler defers long-running commands before command usage writes', () => {
        const source = readFile('src/events/interactionCreate.js');
        const deferIndex = source.indexOf('if (command.longRunning)');
        const statsIndex = source.indexOf('// Update database tracking');

        expect(deferIndex).toBeGreaterThan(-1);
        expect(statsIndex).toBeGreaterThan(-1);
        expect(deferIndex).toBeLessThan(statsIndex);
    });

    test('welcome command acknowledges before loading guild configuration', () => {
        const source = readFile('src/commands/administration/welcome.js');
        const executeStart = source.indexOf('async execute(interaction)');
        const executeEnd = source.indexOf('\n};', executeStart);
        const body = source.slice(executeStart, executeEnd);

        expect(body.indexOf('await interaction.deferReply')).toBeGreaterThan(-1);
        expect(body.indexOf('await interaction.deferReply')).toBeLessThan(body.indexOf("dbLog.select('guilds'"));
        expect(body).not.toContain('interaction.reply({');
    });

    test('moderation modal actions acknowledge before fetching users', () => {
        const source = readFile('src/commands/context-menus/modactions.js');
        const body = source.slice(source.indexOf('async handleModal'), source.indexOf('\n};', source.indexOf('async handleModal')));

        expect(body.indexOf('await interaction.deferReply')).toBeGreaterThan(-1);
        expect(body.indexOf('await interaction.deferReply')).toBeLessThan(body.indexOf('client.users.fetch'));
        expect(body).not.toContain('interaction.reply({');
    });

    test('moderation history button acknowledges before reading history', () => {
        const body = functionBody(readFile('src/commands/context-menus/modactions.js'), 'showHistory');

        expect(body.indexOf('await interaction.deferReply')).toBeGreaterThan(-1);
        expect(body.indexOf('await interaction.deferReply')).toBeLessThan(body.indexOf('db.select()'));
        expect(body).not.toContain('interaction.reply({');
    });

    test('bookmark clear confirmation acknowledges before deleting bookmarks', () => {
        const body = functionBody(readFile('src/commands/utility/bookmark.js'), 'handleClearConfirm');

        expect(body.indexOf('await interaction.deferUpdate')).toBeGreaterThan(-1);
        expect(body.indexOf('await interaction.deferUpdate')).toBeLessThan(body.indexOf('bookmarkUtil.deleteAllBookmarks'));
        expect(body).not.toContain('interaction.update({');
    });
});
