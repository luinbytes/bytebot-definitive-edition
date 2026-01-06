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
            // Match ephemeral: true (but not in comments or deferReply/reply/safeReply)
            const lines = content.split('\n');
            lines.forEach((line, idx) => {
                // Allow ephemeral: true in deferReply(), reply(), and safeReply() - this is correct usage
                if (line.includes('ephemeral: true') &&
                    !line.trim().startsWith('//') &&
                    !line.includes('deferReply') &&
                    !line.includes('.reply(') &&
                    !line.includes('safeReply(')) {
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
            console.error('Use flags: [MessageFlags.Ephemeral] instead, or use ephemeral: true in deferReply()/reply()/safeReply()');
        }

        expect(violations.length).toBe(0);
    });

    test('should not use console.log/console.error directly (use logger)', () => {
        const violations = [];
        const EXCLUDE_FILES = ['logger.js', 'index.js', 'config.js']; // logger.js uses console, index.js/config.js load before logger

        sourceFiles.forEach(file => {
            const fileName = path.basename(file);
            if (EXCLUDE_FILES.includes(fileName)) return;
            if (file.includes('database')) return; // Allow in database folder for early errors

            const content = fs.readFileSync(file, 'utf8');
            const lines = content.split('\n');
            lines.forEach((line, idx) => {
                // Check for console.log/error/warn
                if ((line.includes('console.log') || line.includes('console.error') || line.includes('console.warn'))
                    && !line.trim().startsWith('//')) {
                    // Check if previous line has eslint-disable comment
                    const prevLine = idx > 0 ? lines[idx - 1].trim() : '';
                    if (prevLine.includes('eslint-disable-next-line no-console')) {
                        return; // Skip this line, it's intentionally exempted
                    }
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
