const fs = require('fs');
const path = require('path');

function readFile(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

describe('BytePod creation race prevention', () => {
    const voiceStateContent = readFile('src/events/voiceStateUpdate.js');

    test('coalesces duplicate join-hub events before creating a channel', () => {
        expect(voiceStateContent).toContain('pendingPodCreations');
        expect(voiceStateContent).toContain('creationKey');

        const joinedHubSection = voiceStateContent.match(
            /if \(joinedChannelId === hubId\) \{([\s\S]*?)\/\/ Create Channel/
        );

        expect(joinedHubSection).toBeTruthy();
        expect(joinedHubSection[1]).toContain('pendingPodCreations.has(creationKey)');
        expect(joinedHubSection[1]).toContain('pendingPodCreations.add(creationKey');
    });

    test('checks current voice cache before creating a channel for late duplicate events', () => {
        const joinedHubSection = voiceStateContent.match(
            /if \(joinedChannelId === hubId\) \{([\s\S]*?)\/\/ Create Channel/
        );

        expect(joinedHubSection).toBeTruthy();
        expect(joinedHubSection[1]).toContain('const currentVoice = guild.voiceStates.cache.get(member.id)');
        expect(joinedHubSection[1]).toContain('currentVoice.channelId !== hubId');
    });

    test('checks for an existing owned pod before creating a new one', () => {
        const joinedHubSection = voiceStateContent.match(
            /if \(joinedChannelId === hubId\) \{([\s\S]*?)\/\/ Create Channel/
        );

        expect(joinedHubSection).toBeTruthy();
        expect(joinedHubSection[1]).toContain('existingOwnedPod');
        expect(joinedHubSection[1]).toContain('eq(bytepods.ownerId, member.id)');
        expect(joinedHubSection[1]).toContain('eq(bytepods.guildId, guild.id)');
        expect(joinedHubSection[1]).toContain("operation: 'existingOwnedPodCleanup'");
    });

    test('clears the creation guard after success or failure', () => {
        const joinedHubSection = voiceStateContent.match(
            /if \(joinedChannelId === hubId\) \{([\s\S]*?)\/\/ --- JOIN POD TRIGGER/
        );

        expect(joinedHubSection).toBeTruthy();
        expect(joinedHubSection[1]).toContain('finally');
        expect(joinedHubSection[1]).toContain('pendingPodCreations.delete(creationKey)');
    });
});

describe('BytePod reclaim interaction safety', () => {
    const bytepodContent = readFile('src/commands/utility/bytepod.js');

    test('accept handler uses reply instead of deferUpdate to avoid voice reconnects', () => {
        const acceptSection = bytepodContent.match(
            /if \(customId\.startsWith\('bytepod_reclaim_accept_'\)\) \{([\s\S]*?)return;\s*\}/
        );

        expect(acceptSection).toBeTruthy();
        expect(acceptSection[1]).toContain('await interaction.reply(');
        expect(acceptSection[1]).not.toContain('await interaction.deferUpdate()');
    });

    test('deny handler uses reply instead of deferUpdate to avoid voice reconnects', () => {
        const denySection = bytepodContent.match(
            /if \(customId\.startsWith\('bytepod_reclaim_deny_'\)\) \{([\s\S]*?)return;\s*\}/
        );

        expect(denySection).toBeTruthy();
        expect(denySection[1]).toContain('await interaction.reply(');
        expect(denySection[1]).not.toContain('await interaction.deferUpdate()');
    });
});
