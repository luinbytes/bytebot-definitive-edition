/**
 * Deprecation Pattern Tests
 * Ensures deprecated Discord.js patterns are not used
 */

const fs = require('fs');
const path = require('path');
const { glob } = require('glob');

describe('Deprecation Pattern Checks', () => {
    let sourceFiles;

    beforeAll(async () => {
        sourceFiles = await glob('src/**/*.js');
    });

    test('should not use deprecated ephemeral: true pattern', () => {
        const violations = [];

        sourceFiles.forEach(file => {
            const content = fs.readFileSync(file, 'utf8');
            // Match ephemeral: true (but not in comments)
            const lines = content.split('\n');
            lines.forEach((line, idx) => {
                if (line.includes('ephemeral: true') && !line.trim().startsWith('//')) {
                    violations.push({
                        file,
                        line: idx + 1,
                        content: line.trim()
                    });
                }
            });
        });

        if (violations.length > 0) {
            console.error('Deprecated ephemeral: true usage found:');
            violations.forEach(v => console.error(`- ${v.file}:${v.line}`));
            console.error('Use flags: [MessageFlags.Ephemeral] instead.');
        }

        expect(violations.length).toBe(0);
    });

    test('should not use console.log/console.error directly (use logger)', () => {
        const violations = [];
        const EXCLUDE_FILES = ['logger.js', 'index.js']; // logger.js uses console, index.js is database

        sourceFiles.forEach(file => {
            const fileName = path.basename(file);
            if (EXCLUDE_FILES.includes(fileName)) return;
            if (file.includes('database')) return; // Allow in database folder for early errors

            const content = fs.readFileSync(file, 'utf8');
            const lines = content.split('\n');
            lines.forEach((line, idx) => {
                if ((line.includes('console.log') || line.includes('console.error'))
                    && !line.trim().startsWith('//')) {
                    violations.push({
                        file,
                        line: idx + 1,
                        content: line.trim()
                    });
                }
            });
        });

        if (violations.length > 0) {
            console.error('Direct console usage found (use logger utility instead):');
            violations.forEach(v => console.error(`- ${v.file}:${v.line}: ${v.content.slice(0, 50)}...`));
        }

        expect(violations.length).toBe(0);
    });

    test('should use MessageFlags import when using ephemeral responses', () => {
        const violations = [];

        sourceFiles.forEach(file => {
            const content = fs.readFileSync(file, 'utf8');

            // If file uses MessageFlags.Ephemeral, it should import MessageFlags
            if (content.includes('MessageFlags.Ephemeral')) {
                if (!content.includes('MessageFlags') ||
                    (!content.includes("require('discord.js')") && !content.includes('from "discord.js"'))) {
                    // Check if MessageFlags is actually imported
                    if (!content.match(/\{\s*[^}]*MessageFlags[^}]*\}\s*=\s*require/)) {
                        violations.push(file);
                    }
                }
            }
        });

        if (violations.length > 0) {
            console.error('Files using MessageFlags.Ephemeral without proper import:');
            violations.forEach(v => console.error(`- ${v}`));
        }

        expect(violations.length).toBe(0);
    });
});
