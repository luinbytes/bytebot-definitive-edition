const path = require('path');
const { PermissionFlagsBits } = require('discord.js');

describe('Honeypot command shape', () => {
    const command = require(path.resolve('src/commands/administration/honeypot.js'));
    const json = command.data.toJSON();

    test('uses ManageGuild and exposes setup/disable/configure', () => {
        expect(json.name).toBe('honeypot');
        expect(json.default_member_permissions).toBe(PermissionFlagsBits.ManageGuild.toString());
        expect(command.permissions).toEqual([PermissionFlagsBits.ManageGuild]);
        expect(command.longRunning).toBe(true);
        expect(command.deferEphemeral).toBe(true);
        expect(json.options.map(option => option.name)).toEqual(['setup', 'disable', 'configure']);
    });

    test('configure exposes view and exemption operations', () => {
        const configure = json.options.find(option => option.name === 'configure');

        expect(configure.options.map(option => option.name)).toEqual([
            'view',
            'exempt-user-add',
            'exempt-user-remove',
            'exempt-role-add',
            'exempt-role-remove'
        ]);
    });
});

describe('Honeypot utility helpers', () => {
    const { buildBanReason, sanitizeSnippet } = require('../src/utils/honeypotUtil');

    test('sanitizes URLs and caps snippets', () => {
        const snippet = sanitizeSnippet(`grab this https://bad.example/${'x'.repeat(200)}`);

        expect(snippet).toContain('[link removed]');
        expect(snippet).not.toContain('https://bad.example');
        expect(snippet.length).toBeLessThanOrEqual(120);
    });

    test('builds compact audit-log reason', () => {
        const reason = buildBanReason('spam text');

        expect(reason).toBe('Honeypot trap triggered in #danger: "spam text"');
        expect(reason.length).toBeLessThanOrEqual(512);
    });
});

describe('Honeypot messageCreate integration', () => {
    test('runs before auto-responder and activity tracking', () => {
        const fs = require('fs');
        const source = fs.readFileSync(path.resolve('src/events/messageCreate.js'), 'utf8');

        expect(source.indexOf('handleHoneypotMessage')).toBeGreaterThan(-1);
        expect(source.indexOf('handleHoneypotMessage')).toBeLessThan(source.indexOf('client.autoResponderService'));
        expect(source.indexOf('handleHoneypotMessage')).toBeLessThan(source.indexOf('client.activityStreakService'));
    });
});
