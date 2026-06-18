const ToolInstaller = require('./ToolInstaller');
const path = require('path');

class WindsurfInstaller extends ToolInstaller {
    get key() {
        return 'windsurf';
    }

    get name() {
        return 'Windsurf';
    }

    get commandsDir() {
        return path.join('.windsurf', 'workflows');
    }

    get detectPath() {
        return '.windsurf';
    }
}

module.exports = WindsurfInstaller;
