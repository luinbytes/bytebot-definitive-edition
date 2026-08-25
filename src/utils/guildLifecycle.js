const operations = new Map();

async function runGuildLifecycle(guildId, task) {
    const previous = operations.get(guildId) || Promise.resolve();
    const operation = previous.catch(() => {}).then(task);
    operations.set(guildId, operation);
    try {
        return await operation;
    } finally {
        if (operations.get(guildId) === operation) operations.delete(guildId);
    }
}

module.exports = { runGuildLifecycle };
