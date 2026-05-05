const fs = require('fs');
const path = require('path');

function readFile(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

describe('BytePod session summary edge cases', () => {
    const voiceStateContent = readFile('src/events/voiceStateUpdate.js');

    test('bot-restart summary fallback preserves the final leaving user duration', () => {
        const fallbackSection = voiceStateContent.match(
            /Bot restart fallback: can't recover past durations([\s\S]*?)stats = \{([\s\S]*?)\};/
        );

        expect(fallbackSection).toBeTruthy();
        expect(fallbackSection[0]).toContain('leavingUserDuration');
        expect(fallbackSection[0]).toMatch(/activeDurations\.set\(\s*leavingUserDuration\.userId/);
        expect(fallbackSection[0]).toContain('visitorIds.add(leavingUserDuration.userId');
    });
});
