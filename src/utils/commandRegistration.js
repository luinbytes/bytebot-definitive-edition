function shouldRegisterCommand(command) {
    return command.register !== false;
}

module.exports = {
    shouldRegisterCommand
};
