const { Events } = require('discord.js');

module.exports = {
    name: Events.ChannelUpdate,
    execute(_oldChannel, newChannel) {
        newChannel.client.voiceMasterService?.handleChannelEvent(newChannel);
    }
};
