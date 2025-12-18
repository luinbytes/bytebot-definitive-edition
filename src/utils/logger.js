const chalk = require('chalk');

function timestamp() {
    return new Date().toLocaleString();
}

const logger = {
    info: (msg) => console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.blue('[INFO]')} ${msg}`),
    success: (msg) => console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.green('[SUCCESS]')} ${msg}`),
    warn: (msg) => console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.yellow('[WARN]')} ${msg}`),
    error: (msg) => console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.red('[ERROR]')} ${msg}`),
    debug: (msg) => console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.magenta('[DEBUG]')} ${msg}`)
};

module.exports = logger;
