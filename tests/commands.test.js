const { glob } = require('glob');
const path = require('path');

describe('Command Structural Integrity', () => {
    let commandFiles;

    beforeAll(async () => {
        commandFiles = await glob('src/commands/**/*.js');
    });

    test('should have at least one command', () => {
        expect(commandFiles.length).toBeGreaterThan(0);
    });

    test('every command should have mandatory properties', () => {
        commandFiles.forEach((file) => {
            const command = require(path.resolve(file));

            // Check for 'data' property
            expect(command).toHaveProperty('data');
            expect(command.data).toHaveProperty('name');

            // Context menus (type 2 or 3) don't have descriptions
            // Slash commands (type 1 or undefined) do have descriptions
            const isContextMenu = command.data.type === 2 || command.data.type === 3;
            if (!isContextMenu) {
                expect(command.data).toHaveProperty('description');
            }

            // Check for 'execute' function
            expect(command).toHaveProperty('execute');
            expect(typeof command.execute).toBe('function');

            // Optional but recommended: cooldown check if it exists
            if (command.cooldown) {
                expect(typeof command.cooldown).toBe('number');
            }
        });
    });
});
