const fs = require('fs');
const path = require('path');

function readCommand() {
    return fs.readFileSync(path.join(__dirname, '../src/commands/administration/achievement.js'), 'utf8');
}

function functionBody(source, name) {
    const start = source.indexOf(`async function ${name}`);
    const next = source.indexOf('\n/**', start);
    return source.slice(start, next === -1 ? undefined : next);
}

describe('Achievement Command Interaction Acknowledgement', () => {
    test('setup acknowledges before reading database state', () => {
        const body = functionBody(readCommand(), 'handleSetup');

        expect(body.indexOf('await interaction.deferReply')).toBeGreaterThan(-1);
        expect(body.indexOf('await interaction.deferReply')).toBeLessThan(body.indexOf("dbLog.select('achievementRoleConfig'"));
        expect(body).toContain('interaction.editReply');
    });

    test('view acknowledges before reading database state', () => {
        const body = functionBody(readCommand(), 'handleView');

        expect(body.indexOf('await interaction.deferReply')).toBeGreaterThan(-1);
        expect(body.indexOf('await interaction.deferReply')).toBeLessThan(body.indexOf("dbLog.select('achievementRoleConfig'"));
        expect(body).toContain('interaction.editReply');
    });

    test('disable acknowledges before reading database state', () => {
        const body = functionBody(readCommand(), 'handleDisable');

        expect(body.indexOf('await interaction.deferReply')).toBeGreaterThan(-1);
        expect(body.indexOf('await interaction.deferReply')).toBeLessThan(body.indexOf("dbLog.select('guilds'"));
        expect(body).toContain('interaction.editReply');
    });

    test('enable acknowledges before reading database state', () => {
        const body = functionBody(readCommand(), 'handleEnable');

        expect(body.indexOf('await interaction.deferReply')).toBeGreaterThan(-1);
        expect(body.indexOf('await interaction.deferReply')).toBeLessThan(body.indexOf("dbLog.select('guilds'"));
        expect(body).toContain('interaction.editReply');
    });
});
