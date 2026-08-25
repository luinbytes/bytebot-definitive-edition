const { heartbeatFresh } = require('../src/utils/runtimeHeartbeat');

process.exitCode = heartbeatFresh(process.env.BYTEBOT_HEALTH_FILE || '/tmp/bytebot-health') ? 0 : 1;
