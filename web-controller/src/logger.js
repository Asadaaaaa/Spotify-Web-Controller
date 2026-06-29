const { colors, getTime } = require('./colors');

class Logger {
    constructor() {
        this.logHistory = [];
        this.onLogCallback = null;
    }

    setLogCallback(callback) {
        this.onLogCallback = callback;
    }

    logToDashboard(type, formattedMsg) {
        const timestamp = getTime();
        this.logHistory.push(`${timestamp} ${formattedMsg}`);
        if (this.logHistory.length > 3) {
            this.logHistory.shift();
        }
        if (this.onLogCallback) {
            this.onLogCallback();
        } else {
            console.log(`${timestamp} ${formattedMsg}`);
        }
    }

    info(msg) {
        this.logToDashboard('info', `${colors.gray}[INFO]${colors.reset} ${msg}`);
    }

    success(msg) {
        this.logToDashboard('success', `${colors.green}[SUCCESS]${colors.reset} ${colors.green}${msg}${colors.reset}`);
    }

    warn(msg) {
        this.logToDashboard('warn', `${colors.yellow}[WARN]${colors.reset} ${colors.yellow}${msg}${colors.reset}`);
    }

    error(msg, err = '') {
        const errMsg = err ? ` - ${err.message || err}` : '';
        this.logToDashboard('error', `${colors.red}[ERROR]${colors.reset} ${colors.red}${colors.bold}${msg}${colors.reset}${errMsg}`);
    }

    spotify(msg) {
        this.logToDashboard('spotify', `${colors.cyan}[Spotify]${colors.reset} ${msg}`);
    }

    client(msg) {
        this.logToDashboard('client', `${colors.magenta}[Client]${colors.reset} ${msg}`);
    }

    system(msg) {
        this.logToDashboard('system', `${colors.bold}${colors.green}[SYSTEM]${colors.reset} ${colors.bold}${colors.green}${msg}${colors.reset}`);
    }
}

const logger = new Logger();
module.exports = logger;
