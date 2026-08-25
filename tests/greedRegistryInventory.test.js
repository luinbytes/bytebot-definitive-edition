const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

const expectedCounts = {
    auto: 55, boosters: 3, developer: 4, economy: 50, fun: 71,
    information: 48, lastfm: 22, levels: 8, logs: 7, manipulation: 3,
    moderation: 101, music: 9, roleplay: 1, security: 102, server: 214,
    settings: 42, snipe: 5, socials: 11, utility: 123, voice: 33
};

test('every pinned English Greed command file has an owner and terminal source state', () => {
    const lines = fs.readFileSync(path.join(__dirname, '../docs/research/greed-command-registry-inventory.csv'), 'utf8').trim().split('\n');
    expect(lines.shift()).toBe('path,owner_issues,state');
    expect(lines).toHaveLength(912);
    expect(createHash('sha256').update(lines.map(line => line.split(',')[0]).join('\n')).digest('hex'))
        .toBe('1935aaa6fd85ef11e3a77902c68a9b56a0cf268e72eed547fb876264d7384ff9');

    const paths = new Set();
    const counts = {};
    for (const line of lines) {
        const [commandPath, ownerIssues, state] = line.split(',');
        const family = commandPath.split('/')[3];
        expect(commandPath).toMatch(/^locales\/en\/commands\/[^/]+\/.+\.json$/);
        expect(ownerIssues).toMatch(/^#\d+(;#\d+)*$/);
        expect(state).toBe(family === 'developer' ? 'evidence-gap' : 'source-reconciled');
        expect(paths.has(commandPath)).toBe(false);
        paths.add(commandPath);
        counts[family] = (counts[family] || 0) + 1;
    }
    expect(counts).toEqual(expectedCounts);
});
