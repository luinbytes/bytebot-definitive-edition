let native;

module.exports = (...args) => {
    if (!native) {
        native = require('sharp');
        native.cache(false);
        native.concurrency(1);
    }
    return native(...args);
};
