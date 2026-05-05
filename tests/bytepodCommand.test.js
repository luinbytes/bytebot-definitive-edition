const fs = require('fs');
const path = require('path');

function readFile(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

describe('BytePod command data access', () => {
    const bytepodContent = readFile('src/commands/utility/bytepod.js');

    test('/bytepod panel scopes owner lookup to the current guild', () => {
        const panelSection = bytepodContent.match(
            /if \(subdomain === 'panel'\) \{([\s\S]*?)if \(group === 'preset'\)/
        );

        expect(panelSection).toBeTruthy();
        expect(panelSection[1]).toContain('eq(bytepods.ownerId, interaction.user.id)');
        expect(panelSection[1]).toContain('eq(bytepods.guildId, interaction.guild.id)');
    });

    test('/bytepod panel sends the control panel into the BytePod channel', () => {
        const panelSection = bytepodContent.match(
            /if \(subdomain === 'panel'\) \{([\s\S]*?)if \(group === 'preset'\)/
        );

        expect(panelSection).toBeTruthy();
        expect(panelSection[1]).toContain('await interaction.deferReply({ flags: [MessageFlags.Ephemeral] })');
        expect(panelSection[1]).toContain('const panelMessage = await channel.send({ embeds: panelEmbeds, components: components })');
        expect(panelSection[1]).toContain('return interaction.editReply');
    });
});
