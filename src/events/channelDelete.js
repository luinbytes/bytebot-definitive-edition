const { Events } = require('discord.js');

module.exports = {
    name: Events.ChannelDelete,
    execute(channel) {
        channel.client.voiceMasterService?.handleChannelDelete(channel);
    }
};
