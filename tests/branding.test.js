const fs = require('fs');
const path = require('path');

// Directories to scan
const SCAN_DIRS = [
    path.join(__dirname, '../src/commands'),
    path.join(__dirname, '../src/events'),
    path.join(__dirname, '../src/utils') // excluding embeds.js itself
];

// File to exclude
const EXCLUDE_FILES = ['embeds.js'];

// Regex to find direct usages of EmbedBuilder
const EMBED_BUILDER_REGEX = /new EmbedBuilder\(\)/;

function scanDirectory(dir) {
    let results = [];
    const files = fs.readdirSync(dir);

    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            results = results.concat(scanDirectory(fullPath));
        } else if (file.endsWith('.js')) {
            if (EXCLUDE_FILES.includes(file)) continue;

            const content = fs.readFileSync(fullPath, 'utf8');
            if (EMBED_BUILDER_REGEX.test(content)) {
                results.push(fullPath);
            }
        }
    }
    return results;
}

describe('Branding Consistency Check', () => {
    test('Should not use direct EmbedBuilder instantiation outside of embeds.js', () => {
        let violations = [];
        for (const dir of SCAN_DIRS) {
            if (fs.existsSync(dir)) {
                violations = violations.concat(scanDirectory(dir));
            }
        }

        if (violations.length > 0) {
            console.error('The following files violate branding guidelines by using "new EmbedBuilder()" directly:');
            violations.forEach(v => console.error(`- ${v}`));
            console.error('Please use the src/utils/embeds.js utility instead.');
        }

        expect(violations.length).toBe(0);
    });
});
