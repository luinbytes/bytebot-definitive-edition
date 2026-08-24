describe('/lastfm command', () => {
    test('fits every pinned family into one member intent hub', () => {
        const command = require('../src/commands/lastfm/lastfm').data.toJSON();
        const paths = Object.fromEntries(command.options.map(option => [
            option.name, option.type === 2 ? option.options.map(sub => sub.name) : null
        ]));
        expect(paths).toEqual({
            now: null,
            account: ['link', 'oauth', 'refresh', 'unlink'],
            listening: ['recent', 'server'],
            charts: ['artists', 'albums', 'tracks', 'collage'],
            library: ['artist', 'milestone', 'update'],
            community: ['whoknows', 'crowns', 'taste'],
            customize: ['presentation', 'view', 'variables', 'reactions', 'copy', 'alias']
        });
        expect(command.dm_permission).toBe(false);
        expect(command.default_member_permissions).toBeUndefined();
        expect(command.options).toHaveLength(7);
    });

    test('keeps account mutations private and listening results public', async () => {
        const command = require('../src/commands/lastfm/lastfm');
        const service = {
            link: jest.fn(async () => ({ username: 'alice' })),
            account: jest.fn(() => ({ username: 'alice' })),
            requireAccount: jest.fn(() => ({ username: 'alice' })),
            recentTracks: jest.fn(async () => [{ name: 'Song', artist: 'Artist', nowPlaying: true }])
        };
        const interaction = (group, action) => ({
            user: { id: 'u1' }, guild: { members: { cache: new Map() } }, deferred: false,
            options: {
                getSubcommandGroup: () => group, getSubcommand: () => action,
                getString: name => name === 'username' ? 'alice' : null,
                getUser: () => null, getInteger: () => null
            },
            deferReply: jest.fn(async function (options) { this.deferred = true; this.deferOptions = options; }),
            editReply: jest.fn()
        });
        const account = interaction('account', 'link');
        await command.execute(account, { lastfmService: service });
        expect(account.deferReply).toHaveBeenCalledWith(expect.objectContaining({ flags: expect.any(Array) }));

        const listening = interaction('listening', 'recent');
        await command.execute(listening, { lastfmService: service });
        expect(listening.deferReply).toHaveBeenCalledWith({ flags: [] });
        expect(listening.editReply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
    });
});
