const { glob } = require('glob');
const path = require('path');

describe('Event Structural Integrity', () => {
    let eventFiles;

    beforeAll(async () => {
        eventFiles = await glob('src/events/**/*.js');
    });

    test('should have at least one event', () => {
        expect(eventFiles.length).toBeGreaterThan(0);
    });

    test('every event should have mandatory properties', () => {
        eventFiles.forEach((file) => {
            const event = require(path.resolve(file));

            // Check for 'name' property
            expect(event).toHaveProperty('name');

            // Check for 'execute' function
            expect(event).toHaveProperty('execute');
            expect(typeof event.execute).toBe('function');
        });
    });
});
