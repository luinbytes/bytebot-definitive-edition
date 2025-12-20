/**
 * BytePod Ownership Reclaim Logic Tests
 * Tests for the ownership transfer and reclaim system edge cases
 */

const fs = require('fs');
const path = require('path');

// Test utilities
function readFile(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

describe('Ownership Reclaim - Database Schema', () => {
    test('bytepods table should have reclaimRequestPending column', () => {
        const schemaContent = readFile('src/database/schema.js');

        expect(schemaContent).toContain('reclaimRequestPending');
        expect(schemaContent).toContain("mode: 'boolean'");
        expect(schemaContent).toContain('.default(false)');
    });

    test('expectedSchema should include reclaim_request_pending column', () => {
        const indexContent = readFile('src/database/index.js');

        expect(indexContent).toContain('reclaim_request_pending');
        expect(indexContent).toMatch(/reclaim_request_pending:\s*'INTEGER DEFAULT 0'/);
    });

    test('bytepods table should have originalOwnerId column', () => {
        const schemaContent = readFile('src/database/schema.js');

        expect(schemaContent).toContain('originalOwnerId');
        expect(schemaContent).toContain('original_owner_id');
    });
});

describe('Ownership Reclaim - VoiceStateUpdate Logic', () => {
    const voiceStateContent = readFile('src/events/voiceStateUpdate.js');

    test('should check reclaimRequestPending before sending prompt', () => {
        // Should have the condition !podData.reclaimRequestPending
        expect(voiceStateContent).toContain('!podData.reclaimRequestPending');

        // Should be part of the condition for sending reclaim prompt
        const reclaimConditionRegex = /else if\s*\(([\s\S]*?)!podData\.reclaimRequestPending/;
        expect(voiceStateContent).toMatch(reclaimConditionRegex);
    });

    test('should set reclaimRequestPending to true when sending prompt', () => {
        expect(voiceStateContent).toContain('reclaimRequestPending: true');

        // Should update the database after sending the prompt
        const updateRegex = /db\.update\(bytepods\)[\s\S]*?\.set\(\{\s*reclaimRequestPending:\s*true/;
        expect(voiceStateContent).toMatch(updateRegex);
    });

    test('should backfill originalOwnerId for old pods', () => {
        expect(voiceStateContent).toContain('!podData.originalOwnerId');
        expect(voiceStateContent).toContain('Backfilled originalOwnerId');

        // Should check if originalOwnerId is null and current user is owner
        expect(voiceStateContent).toContain('podData.ownerId === member.id');
    });

    test('should log when sending reclaim prompt', () => {
        expect(voiceStateContent).toContain('Sent ownership reclaim prompt');
        expect(voiceStateContent).toContain('logger.info');
    });
});

describe('Ownership Reclaim - Button Interaction Logic', () => {
    const bytepodContent = readFile('src/commands/utility/bytepod.js');

    test('should use reply instead of deferUpdate to avoid voice reconnect', () => {
        // Should NOT use deferUpdate for reclaim request
        const reclaimRequestSection = bytepodContent.match(
            /bytepod_reclaim_request_([\s\S]*?)return;/
        );

        expect(reclaimRequestSection).toBeTruthy();
        expect(reclaimRequestSection[0]).toContain('await interaction.reply');
        expect(reclaimRequestSection[0]).toContain('MessageFlags.Ephemeral');

        // Should NOT contain the actual deferUpdate() call (comments are ok)
        expect(reclaimRequestSection[0]).not.toContain('await interaction.deferUpdate()');
    });

    test('should send ephemeral confirmation when request is sent', () => {
        expect(bytepodContent).toContain('Request sent to the current owner!');
        expect(bytepodContent).toContain('MessageFlags.Ephemeral');
    });

    test('should disable button after clicking (not delete message)', () => {
        const reclaimRequestSection = bytepodContent.match(
            /bytepod_reclaim_request_([\s\S]*?)return;/
        );

        // Should edit the message to remove components
        expect(reclaimRequestSection[0]).toContain('interaction.message.edit');
        expect(reclaimRequestSection[0]).toContain('components: []');

        // Should NOT delete the message in this section
        expect(reclaimRequestSection[0]).not.toContain('message.delete');
    });

    test('should clear reclaimRequestPending when ownership is accepted', () => {
        expect(bytepodContent).toContain('bytepod_reclaim_accept');
        expect(bytepodContent).toContain('reclaimRequestPending: false');

        // Should be part of the accept handler
        const hasAcceptHandler = bytepodContent.includes('bytepod_reclaim_accept') &&
                                  bytepodContent.includes('ownerId: requesterId') &&
                                  bytepodContent.includes('reclaimRequestPending: false');
        expect(hasAcceptHandler).toBe(true);
    });

    test('should clear reclaimRequestPending when ownership is denied', () => {
        expect(bytepodContent).toContain('bytepod_reclaim_deny');
        expect(bytepodContent).toContain('reclaimRequestPending: false');

        // Should update the database to clear the flag
        const hasDenyHandler = bytepodContent.includes('bytepod_reclaim_deny') &&
                                bytepodContent.includes('db.update(bytepods)') &&
                                bytepodContent.includes('reclaimRequestPending: false');
        expect(hasDenyHandler).toBe(true);
    });
});

describe('Ownership Reclaim - Edge Case Prevention', () => {
    const voiceStateContent = readFile('src/events/voiceStateUpdate.js');
    const bytepodContent = readFile('src/commands/utility/bytepod.js');

    test('should prevent duplicate prompts with multiple checks', () => {
        // Check 1: originalOwnerId must match
        expect(voiceStateContent).toContain('podData.originalOwnerId === member.id');

        // Check 2: ownerId must NOT match (ownership was transferred)
        expect(voiceStateContent).toContain('podData.ownerId !== member.id');

        // Check 3: Not in grace period
        expect(voiceStateContent).toContain('!podData.ownerLeftAt');

        // Check 4: No pending request (THE FIX)
        expect(voiceStateContent).toContain('!podData.reclaimRequestPending');
    });

    test('should validate requester ID on button click', () => {
        expect(bytepodContent).toContain('interaction.user.id !== requesterId');
        expect(bytepodContent).toContain('This button is not for you!');
    });

    test('should validate originalOwnerId on button click', () => {
        expect(bytepodContent).toContain('podData.originalOwnerId !== requesterId');
        expect(bytepodContent).toContain('Only the original creator can request ownership back');
    });

    test('should validate current owner for accept/deny', () => {
        expect(bytepodContent).toContain('interaction.user.id !== podData.ownerId');
        expect(bytepodContent).toContain('Only the current owner can accept');
        expect(bytepodContent).toContain('Only the current owner can deny');
    });
});

describe('Ownership Reclaim - Error Handling', () => {
    const voiceStateContent = readFile('src/events/voiceStateUpdate.js');
    const bytepodContent = readFile('src/commands/utility/bytepod.js');

    test('should handle errors when sending reclaim prompt', () => {
        const reclaimPromptSection = voiceStateContent.match(
            /Send reclaim prompt via DM([\s\S]*?)Case 3:/
        );

        expect(reclaimPromptSection).toBeTruthy();
        expect(reclaimPromptSection[0]).toContain('try {');
        expect(reclaimPromptSection[0]).toContain('} catch (e)');
        expect(reclaimPromptSection[0]).toContain('Could not DM reclaim prompt');
    });

    test('should handle errors when sending Accept/Deny message', () => {
        const reclaimRequestSection = bytepodContent.match(
            /bytepod_reclaim_request_([\s\S]*?)return;/
        );

        expect(reclaimRequestSection[0]).toContain('try {');
        expect(reclaimRequestSection[0]).toContain('} catch (e)');
        expect(reclaimRequestSection[0]).toContain('logger.error');
    });

    test('should handle errors during ownership transfer', () => {
        // Check that accept handler has try/catch and error handling
        expect(bytepodContent).toContain('bytepod_reclaim_accept');

        const hasErrorHandling = bytepodContent.includes('Failed to transfer ownership') &&
                                  bytepodContent.includes('logger.error');
        expect(hasErrorHandling).toBe(true);
    });
});

describe('Ownership Reclaim - Documentation', () => {
    test('CLAUDE.md should document the new reclaimRequestPending field', () => {
        const claudeContent = readFile('CLAUDE.md');

        expect(claudeContent).toContain('reclaimRequestPending');
        expect(claudeContent).toContain('Prevents duplicate reclaim prompts');
    });

    test('CLAUDE.md should document the voice reconnect fix', () => {
        const claudeContent = readFile('CLAUDE.md');

        expect(claudeContent).toContain('Voice Reconnect Bug');
        expect(claudeContent).toContain('deferUpdate');
    });

    test('CLAUDE.md should document the duplicate prompt fix', () => {
        const claudeContent = readFile('CLAUDE.md');

        expect(claudeContent).toContain('Duplicate Reclaim Prompts');
        expect(claudeContent).toContain('reclaimRequestPending');
        expect(claudeContent).toContain('bytepods table');
    });

    test('CLAUDE.md should document the originalOwnerId backfill', () => {
        const claudeContent = readFile('CLAUDE.md');

        expect(claudeContent).toContain('originalOwnerId Backfill');
        expect(claudeContent).toContain('old pods');
    });
});

describe('Ownership Reclaim - Code Quality', () => {
    const bytepodContent = readFile('src/commands/utility/bytepod.js');

    test('should not have nested deferUpdate + delete anti-pattern', () => {
        // The request handler should NOT use deferUpdate (the bug that caused voice reconnects)
        const requestMatch = bytepodContent.match(/if \(customId\.startsWith\('bytepod_reclaim_request_'\)\) \{([\s\S]*?)return;\s*\}/);

        expect(requestMatch).toBeTruthy();

        // Should NOT have the actual deferUpdate() call (comments mentioning it are ok)
        expect(requestMatch[1]).not.toContain('await interaction.deferUpdate()');

        // Should use reply instead
        expect(requestMatch[1]).toContain('await interaction.reply(');
    });

    test('should use logger for all reclaim-related operations', () => {
        const voiceStateContent = readFile('src/events/voiceStateUpdate.js');

        // Should log when sending prompt
        expect(voiceStateContent).toContain('logger.info(`Sent ownership reclaim prompt');

        // Should log when backfilling
        expect(voiceStateContent).toContain('logger.info(`Backfilled originalOwnerId');
    });
});
