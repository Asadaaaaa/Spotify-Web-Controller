const colors = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    green: '\x1b[32m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    magenta: '\x1b[35m',
    red: '\x1b[31m',
    gray: '\x1b[90m'
};

function getTime() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${colors.gray}[${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}]${colors.reset}`;
}

module.exports = { colors, getTime };
