const { runGuildLifecycle } = require('../src/utils/guildLifecycle');

test('serializes overlapping guild removal and rejoin work', async () => {
    const order = [];
    let finishRemoval;
    const removalGate = new Promise(resolve => { finishRemoval = resolve; });
    const removal = runGuildLifecycle('guild1', async () => {
        order.push('remove-start');
        await removalGate;
        order.push('remove-end');
    });
    const rejoin = runGuildLifecycle('guild1', async () => { order.push('rejoin'); });

    finishRemoval();
    await Promise.all([removal, rejoin]);

    expect(order).toEqual(['remove-start', 'remove-end', 'rejoin']);
});
